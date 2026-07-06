/**
 * PRD §8, §9.5, §9.4 — Conflict data access layer (value_mismatch and unit_suspicion rows).
 * Pure database functions (no I/O beyond better-sqlite3).
 */

import Database from 'better-sqlite3';

export interface ConflictRow {
  id: string;
  requirement_id: string;
  evidence_a: string;
  evidence_b: string | null;
  kind: string; // 'value_mismatch' | 'unit_suspicion'
  note: string;
  status: string; // 'open' | 'resolved'
  resolved_choice: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

/**
 * Insert a new open conflict row (value_mismatch or unit_suspicion).
 * Does not touch the referenced evidence rows — callers are responsible for
 * marking them 'conflicted' themselves (evidence.ts has no conflict-specific
 * function since the exact fields to update vary by call site).
 */
export function createConflict(
  db: Database.Database,
  conflict: {
    id: string;
    requirement_id: string;
    evidence_a: string;
    evidence_b?: string | null;
    kind: 'value_mismatch' | 'unit_suspicion';
    note: string;
  }
): void {
  db.prepare(
    `INSERT INTO conflicts (id, requirement_id, evidence_a, evidence_b, kind, note, status)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`
  ).run(
    conflict.id,
    conflict.requirement_id,
    conflict.evidence_a,
    conflict.evidence_b ?? null,
    conflict.kind,
    conflict.note
  );
}

export function getConflictById(db: Database.Database, conflictId: string): ConflictRow | null {
  const row = db.prepare('SELECT * FROM conflicts WHERE id = ? LIMIT 1').get(conflictId) as
    | ConflictRow
    | undefined;
  return row ?? null;
}

/**
 * Resolve an open conflict with a human's choice. Idempotent: a second
 * resolve attempt on an already-resolved conflict is a no-op (returns false)
 * so a double-click can't overwrite an earlier choice or write two audit rows.
 */
export function resolveConflict(
  db: Database.Database,
  conflictId: string,
  actingUser: string,
  nowIso: string,
  resolvedChoice: string
): boolean {
  const row = db.prepare('SELECT status FROM conflicts WHERE id = ? LIMIT 1').get(conflictId) as
    | Pick<ConflictRow, 'status'>
    | undefined;

  if (!row) {
    throw new Error(`Conflict ${conflictId} not found`);
  }

  if (row.status === 'resolved') {
    return false;
  }

  db.prepare(
    'UPDATE conflicts SET status = ?, resolved_choice = ?, resolved_by = ?, resolved_at = ? WHERE id = ?'
  ).run('resolved', resolvedChoice, actingUser, nowIso, conflictId);

  const auditId = `audit-resolve-conflict-${conflictId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(auditId, actingUser, 'resolve_conflict', conflictId, JSON.stringify({ resolved_choice: resolvedChoice }), nowIso);

  return true;
}

/**
 * Records a "Skip for now" choice: writes an audit row but leaves the
 * conflict open (status stays 'open') since nothing was actually decided.
 */
export function skipConflict(db: Database.Database, conflictId: string, actingUser: string, nowIso: string): void {
  const auditId = `audit-skip-conflict-${conflictId}-${Date.now()}`;
  db.prepare(
    `INSERT INTO audit (id, actor, action, entity, details_json, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(auditId, actingUser, 'skip_conflict', conflictId, JSON.stringify({}), nowIso);
}
