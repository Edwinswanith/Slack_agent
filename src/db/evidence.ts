/**
 * PRD §8, §9 — Evidence data access layer
 *
 * Pure database functions (no I/O beyond better-sqlite3).
 * Caller passes db connection and ISO timestamps.
 * Handles evidence CRUD, audit logging, and enforced constraints (GR-2, GR-3).
 */

import Database from 'better-sqlite3';

/**
 * Database row returned by queries
 */
export interface EvidenceRow {
  id: string;
  grant_id: string;
  requirement_id: string;
  source_type: string;
  source_ref: string;
  claim_text: string;
  quote_text: string;
  value_json: string | null;
  confidence: number;
  pii_state: string; // 'none' | 'detected' | 'masked' | 'approved_redacted' | 'rejected'
  status: string; // 'proposed' | 'confirmed' | 'rejected' | 'needs_redaction' | 'conflicted'
  extracted_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  masked_claim_text: string | null;
  masked_quote_text: string | null;
  unit_ambiguous?: boolean;
  note?: string;
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  details_json: string | null;
  at: string;
}

/**
 * Insert a proposed evidence row into the database.
 * Enforces GR-2 dedupe: skips if (requirement_id, source_ref) already exists.
 * If pii_detected is true, inserts with status 'needs_redaction' (Phase 3 redaction phase).
 * If pii_detected is false, inserts with status 'proposed' (ready for Phase 2 confirmation).
 *
 * @param db Database connection
 * @param evidence Object with: id, grant_id, requirement_id, source_type, source_ref,
 *        claim_text, quote_text, value_json?, confidence, unit_ambiguous, pii_detected, note, extracted_at
 * @returns true if inserted, false if skipped (GR-2 duplicate)
 */
export function insertProposedEvidence(
  db: Database.Database,
  evidence: {
    id: string;
    grant_id: string;
    requirement_id: string;
    source_type: string;
    source_ref: string;
    claim_text: string;
    quote_text: string;
    value_json?: Record<string, unknown>;
    confidence: number;
    unit_ambiguous: boolean;
    pii_detected: boolean;
    note: string;
    extracted_at: string;
  }
): boolean {
  // GR-2: skip if (requirement_id, source_ref) already exists in any status
  const existing = db
    .prepare(
      'SELECT id FROM evidence WHERE requirement_id = ? AND source_ref = ? LIMIT 1'
    )
    .get(evidence.requirement_id, evidence.source_ref);

  if (existing) {
    return false; // Dedupe skip
  }

  // Determine initial status: if PII detected, mark for Phase 3 redaction
  const status = evidence.pii_detected ? 'needs_redaction' : 'proposed';
  const piiState = evidence.pii_detected ? 'detected' : 'none';

  const stmt = db.prepare(
    `INSERT INTO evidence (
      id, grant_id, requirement_id, source_type, source_ref,
      claim_text, quote_text, value_json, confidence, pii_state, status,
      extracted_at, confirmed_by, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
  );

  stmt.run(
    evidence.id,
    evidence.grant_id,
    evidence.requirement_id,
    evidence.source_type,
    evidence.source_ref,
    evidence.claim_text,
    evidence.quote_text,
    evidence.value_json ? JSON.stringify(evidence.value_json) : null,
    evidence.confidence,
    piiState,
    status,
    evidence.extracted_at
  );

  return true; // Actually inserted
}

/**
 * Confirm an evidence item idempotently (GR-1: D1 case).
 * Updates status to 'confirmed' only if not already confirmed.
 * Writes an audit row only on actual state change.
 * Returns true if the status changed, false if already confirmed (safe double-click).
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @param actingUser User ID who is confirming
 * @param nowIso ISO timestamp string of the action
 * @returns true if changed, false if already confirmed
 */
export function confirmEvidence(
  db: Database.Database,
  evidenceId: string,
  actingUser: string,
  nowIso: string
): boolean {
  // Check current status
  const row = db
    .prepare('SELECT status, confirmed_by FROM evidence WHERE id = ? LIMIT 1')
    .get(evidenceId) as Pick<EvidenceRow, 'status' | 'confirmed_by'> | undefined;

  if (!row) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  // Idempotent: if already confirmed, return false
  if (row.status === 'confirmed') {
    return false;
  }

  // Update status to confirmed
  db.prepare(
    'UPDATE evidence SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?'
  ).run('confirmed', actingUser, nowIso, evidenceId);

  // Write audit row (only on state change)
  const auditId = `audit-confirm-${evidenceId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    auditId,
    actingUser,
    'confirm',
    evidenceId,
    JSON.stringify({ status_before: row.status, status_after: 'confirmed' }),
    nowIso
  );

  return true; // Status changed
}

/**
 * Reject an evidence item idempotently.
 * Updates status to 'rejected' only if not already rejected.
 * Writes an audit row only on actual state change.
 * Returns true if changed, false if already rejected (safe double-click).
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @param actingUser User ID who is rejecting
 * @param nowIso ISO timestamp string of the action
 * @returns true if changed, false if already rejected
 */
export function rejectEvidence(
  db: Database.Database,
  evidenceId: string,
  actingUser: string,
  nowIso: string
): boolean {
  // Check current status
  const row = db
    .prepare('SELECT status, pii_state FROM evidence WHERE id = ? LIMIT 1')
    .get(evidenceId) as Pick<EvidenceRow, 'status' | 'pii_state'> | undefined;

  if (!row) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  // Idempotent: if already rejected, return false
  if (row.status === 'rejected') {
    return false;
  }

  const statusBefore = row.status;

  // Update status to rejected. A PII item mid-redaction (pii_state
  // 'detected' or 'masked') also completes its state machine to 'rejected'
  // (PRD §10: masked -> rejected on human Reject) — non-PII items
  // (pii_state 'none') are left untouched.
  if (row.pii_state === 'detected' || row.pii_state === 'masked') {
    db.prepare('UPDATE evidence SET status = ?, pii_state = ? WHERE id = ?').run(
      'rejected',
      'rejected',
      evidenceId
    );
  } else {
    db.prepare('UPDATE evidence SET status = ? WHERE id = ?').run('rejected', evidenceId);
  }

  // Write audit row (only on state change)
  const auditId = `audit-reject-${evidenceId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    auditId,
    actingUser,
    'reject',
    evidenceId,
    JSON.stringify({ status_before: statusBefore, status_after: 'rejected' }),
    nowIso
  );

  return true; // Status changed
}

/**
 * Edit the MASKED claim text of a PII-flagged evidence row. The raw
 * claim_text/quote_text columns are never touched by this function — a human
 * editing a redaction card only ever sees and edits the masked version
 * (PRD §10: raw PII must never render, including in "before" states like an
 * edit box). pii_state and status are left as-is; the caller decides whether
 * an edit should require re-approval.
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @param actingUser User ID who is editing
 * @param nowIso ISO timestamp string of the action
 * @param newMaskedClaimText Updated masked claim text
 */
export function editMaskedClaimText(
  db: Database.Database,
  evidenceId: string,
  actingUser: string,
  nowIso: string,
  newMaskedClaimText: string
): void {
  const row = db
    .prepare('SELECT masked_claim_text FROM evidence WHERE id = ? LIMIT 1')
    .get(evidenceId) as Pick<EvidenceRow, 'masked_claim_text'> | undefined;

  if (!row) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  db.prepare('UPDATE evidence SET masked_claim_text = ? WHERE id = ?').run(newMaskedClaimText, evidenceId);

  const auditId = `audit-edit-masked-${evidenceId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    auditId,
    actingUser,
    'edit',
    evidenceId,
    JSON.stringify({ masked_claim_text_before: row.masked_claim_text, masked_claim_text_after: newMaskedClaimText }),
    nowIso
  );
}

/**
 * Edit an evidence item's claim_text (and optionally value_json).
 * quote_text is immutable (GR-3).
 * Status stays 'proposed' — user must confirm again after editing.
 * Writes an 'edit' audit row with old and new values.
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @param actingUser User ID who is editing
 * @param nowIso ISO timestamp string of the action
 * @param newClaimText Updated claim text
 * @param newValueJson Optional new value JSON object
 */
export function editEvidence(
  db: Database.Database,
  evidenceId: string,
  actingUser: string,
  nowIso: string,
  newClaimText: string,
  newValueJson?: Record<string, unknown>
): void {
  // Fetch current state
  const row = db
    .prepare('SELECT claim_text, value_json FROM evidence WHERE id = ? LIMIT 1')
    .get(evidenceId) as Pick<EvidenceRow, 'claim_text' | 'value_json'> | undefined;

  if (!row) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  const oldClaimText = row.claim_text;
  const oldValueJson = row.value_json;

  // Update claim_text (and optionally value_json if numeric)
  const updateStmt = newValueJson
    ? db.prepare('UPDATE evidence SET claim_text = ?, value_json = ? WHERE id = ?')
    : db.prepare('UPDATE evidence SET claim_text = ? WHERE id = ?');

  if (newValueJson) {
    updateStmt.run(newClaimText, JSON.stringify(newValueJson), evidenceId);
  } else {
    updateStmt.run(newClaimText, evidenceId);
  }

  // Write audit row with old/new values
  const auditId = `audit-edit-${evidenceId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    auditId,
    actingUser,
    'edit',
    evidenceId,
    JSON.stringify({
      claim_text_before: oldClaimText,
      claim_text_after: newClaimText,
      value_json_before: oldValueJson ? JSON.parse(oldValueJson) : null,
      value_json_after: newValueJson || null,
    }),
    nowIso
  );
}

/**
 * PRD §10 — PII state machine: detected -> masked.
 * Automatic, system-driven (no human actor); must run before the item's
 * confirmation/redaction card is ever posted, since the card can only show
 * masked_claim_text/masked_quote_text, never the raw columns.
 * Idempotent: no-op (returns false) if the row is not currently 'detected'.
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @param maskedClaimText Pre-masked claim text (caller must have already run it through the masking layer)
 * @param maskedQuoteText Pre-masked quote text
 * @param nowIso ISO timestamp string of the action
 * @returns true if the row transitioned, false if it was not in 'detected' state
 */
export function maskEvidenceRow(
  db: Database.Database,
  evidenceId: string,
  maskedClaimText: string,
  maskedQuoteText: string,
  nowIso: string
): boolean {
  const row = db
    .prepare('SELECT pii_state FROM evidence WHERE id = ? LIMIT 1')
    .get(evidenceId) as Pick<EvidenceRow, 'pii_state'> | undefined;

  if (!row) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  if (row.pii_state !== 'detected') {
    return false;
  }

  db.prepare(
    'UPDATE evidence SET pii_state = ?, masked_claim_text = ?, masked_quote_text = ? WHERE id = ?'
  ).run('masked', maskedClaimText, maskedQuoteText, evidenceId);

  const auditId = `audit-mask-${evidenceId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(auditId, 'system', 'mask_pii', evidenceId, JSON.stringify({ pii_state_before: 'detected', pii_state_after: 'masked' }), nowIso);

  return true;
}

/**
 * PRD §10 — PII state machine: masked -> approved_redacted (human clicks
 * Approve redacted). Treated as equivalent to a normal Confirm: status also
 * moves to 'confirmed' and confirmed_by/confirmed_at are set, so the
 * drafter's single "status = confirmed" check keeps working — pii_state
 * is the additional, safety-critical gate the drafter must also check
 * (PRD §10: "Only approved_redacted items can enter a draft").
 * Idempotent: returns false if already approved_redacted.
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @param actingUser User ID who approved the redacted version
 * @param nowIso ISO timestamp string of the action
 * @returns true if the row transitioned, false if already approved_redacted
 */
export function approveRedactedEvidence(
  db: Database.Database,
  evidenceId: string,
  actingUser: string,
  nowIso: string
): boolean {
  const row = db
    .prepare('SELECT pii_state FROM evidence WHERE id = ? LIMIT 1')
    .get(evidenceId) as Pick<EvidenceRow, 'pii_state'> | undefined;

  if (!row) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  if (row.pii_state === 'approved_redacted') {
    return false;
  }

  db.prepare(
    'UPDATE evidence SET pii_state = ?, status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?'
  ).run('approved_redacted', 'confirmed', actingUser, nowIso, evidenceId);

  const auditId = `audit-approve-redacted-${evidenceId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    auditId,
    actingUser,
    'approve_redacted',
    evidenceId,
    JSON.stringify({ pii_state_before: row.pii_state, pii_state_after: 'approved_redacted' }),
    nowIso
  );

  return true;
}

/**
 * PRD §10 — "Reveal original" support. Returns the RAW claim_text/quote_text
 * so the caller can post them as an ephemeral message to the requesting user
 * ONLY (never to the channel). This function does not change any state —
 * pii_state is left exactly as it was (masked/approved_redacted/rejected).
 * Every call writes a reveal_pii audit row, per PRD §10.
 *
 * SAFETY CONSTRAINT: callers MUST render the returned raw text ephemerally,
 * scoped to requestingUser, and MUST NEVER post it to the channel or log it.
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @param requestingUser User ID who clicked Reveal original
 * @param nowIso ISO timestamp string of the action
 * @returns The raw claim_text and quote_text
 */
export function revealPii(
  db: Database.Database,
  evidenceId: string,
  requestingUser: string,
  nowIso: string
): { claim_text: string; quote_text: string } {
  const row = db
    .prepare('SELECT claim_text, quote_text FROM evidence WHERE id = ? LIMIT 1')
    .get(evidenceId) as Pick<EvidenceRow, 'claim_text' | 'quote_text'> | undefined;

  if (!row) {
    throw new Error(`Evidence ${evidenceId} not found`);
  }

  const auditId = `audit-reveal-pii-${evidenceId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(auditId, requestingUser, 'reveal_pii', evidenceId, JSON.stringify({ requested_by: requestingUser }), nowIso);

  return { claim_text: row.claim_text, quote_text: row.quote_text };
}

/**
 * Fetch all evidence rows for a requirement, ordered by extraction time (newest first).
 *
 * @param db Database connection
 * @param requirementId Requirement row ID
 * @returns Array of evidence rows
 */
export function getEvidenceForRequirement(
  db: Database.Database,
  requirementId: string
): EvidenceRow[] {
  return db
    .prepare('SELECT * FROM evidence WHERE requirement_id = ? ORDER BY extracted_at DESC')
    .all(requirementId) as EvidenceRow[];
}

/**
 * Fetch a single evidence row by id.
 *
 * @param db Database connection
 * @param evidenceId Evidence row ID
 * @returns The evidence row, or null if not found
 */
export function getEvidenceById(db: Database.Database, evidenceId: string): EvidenceRow | null {
  const row = db.prepare('SELECT * FROM evidence WHERE id = ? LIMIT 1').get(evidenceId) as
    | EvidenceRow
    | undefined;
  return row ?? null;
}

/**
 * Insert a raw audit row into the audit table.
 * (Low-level function; called by higher-level confirm/reject/edit functions.)
 *
 * @param db Database connection
 * @param auditRow Audit row data
 */
export function insertAuditRow(
  db: Database.Database,
  auditRow: {
    id: string;
    actor: string;
    action: string;
    entity: string;
    details_json?: Record<string, unknown>;
    at: string;
  }
): void {
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    auditRow.id,
    auditRow.actor,
    auditRow.action,
    auditRow.entity,
    auditRow.details_json ? JSON.stringify(auditRow.details_json) : null,
    auditRow.at
  );
}
