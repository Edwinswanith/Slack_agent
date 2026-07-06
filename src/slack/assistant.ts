import { Assistant, type App, type SayFn, type SetStatusFn, type Logger } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import Database from 'better-sqlite3';
import { getDb } from '../db/index.js';
import { seedBrightFuturesGrant } from '../db/seed.js';
import { readAttendanceTrackerSnapshot, SheetAccessError, type AttendanceTrackerSnapshot } from '../google/sheets.js';
import { buildLedgerPreview, getGrantAndRequirements, type Grant, type Requirement } from '../core/ledger.js';
import { retrieveCandidateMessages } from './retrieval.js';
import { extractEvidence, ExtractionError } from '../llm/gemini.js';
import { maskPiiTextVerified, PiiMaskingError } from '../llm/piiMasking.js';
import { detectPiiRegex, summarizePiiRiskCategories } from '../core/piiDetection.js';
import { runValidators, type ValidatorContext } from '../core/validators.js';
import {
  insertProposedEvidence,
  confirmEvidence,
  rejectEvidence,
  editEvidence,
  editMaskedClaimText,
  getEvidenceById,
  maskEvidenceRow,
  approveRedactedEvidence,
  revealPii,
} from '../db/evidence.js';
import { createConflict, getConflictById, resolveConflict, skipConflict } from '../db/conflicts.js';
import { buildConfirmationCardBlocks } from '../core/confirmationCard.js';
import { buildRedactionCardBlocks } from '../core/redactionCard.js';
import { buildConflictCardBlocks } from '../core/conflictCard.js';
import { buildUnitSuspicionCardBlocks } from '../core/unitSuspicionCard.js';
import { checkUnitSanity } from '../core/unitSanity.js';
import { detectValueMismatch } from '../core/conflictDetection.js';
import {
  mapWorkshopsCompletedCandidate,
  mapStudentsServedCandidate,
  mapSessionAttendanceCandidates,
  extractSessionNumber,
  extractNumericValue,
} from '../core/sheetEvidenceMapper.js';
import { detectDirectCommandRefusal } from '../core/gr5Refusal.js';
import { computeGapReport } from '../core/gapDetector.js';
import { buildDraftSection, getDraftableEvidence } from '../core/drafter.js';
import { createDraft, approveDraft } from '../db/drafts.js';
import { listSessionPhotos, verifySessionPhotos, DriveAccessError } from '../google/drive.js';

// Verbatim, PRD §13.1.
const WELCOME_TEXT =
  'I build funder reports from proof. I search your program channels, attendance sheets, and Drive folders, ' +
  'then show you every piece of evidence before it goes anywhere. Try: "Prepare the Bright Futures July report."';

const PHASE1_PLACEHOLDER_REPLY =
  'I only know how to preview the Bright Futures Youth Literacy report right now. Try: "Prepare the Bright Futures July report."';

// PRD §13.8, verbatim.
const SHEET_UNREACHABLE_TEXT =
  'I could not read the attendance tracker. Check that the sheet is shared with the GrantProof service account. Nothing was changed.';

// PRD §13.8, verbatim.
const GENERIC_FAILURE_TEXT =
  'Something failed on my side. No data was changed. Try again, and if it repeats, that is a bug worth telling the builder about.';

// PRD §13.8, F1 — exact copy for unknown grant
const UNKNOWN_GRANT_TEXT =
  'I only know one grant right now: Bright Futures Youth Literacy. Try: Prepare the Bright Futures July report.';

/**
 * Resolve the grant intent from user input.
 * Returns one of: "bright_futures" | "unknown_grant" | "not_a_grant_request"
 *
 * - "bright_futures": matches bright futures + report/scan, or exact phrase
 * - "unknown_grant": matches grant-like request (scan <something>) that is not bright futures
 * - "not_a_grant_request": anything else
 *
 * EVALS.md F1 compliance: "/grantproof scan acme" → "unknown_grant"
 */
function resolveGrantIntent(text: string): 'bright_futures' | 'unknown_grant' | 'not_a_grant_request' {
  const normalized = text.trim().toLowerCase();

  // Exact match
  if (normalized === 'prepare the bright futures july report') {
    return 'bright_futures';
  }

  // Bright Futures + report/scan
  const mentionsBrightFutures = normalized.includes('bright futures') || normalized.includes('bright-futures');
  const mentionsAction = normalized.includes('report') || normalized.includes('scan');

  if (mentionsBrightFutures && mentionsAction) {
    return 'bright_futures';
  }

  // Unknown grant: looks like grant-scan but not bright futures
  // Pattern: "scan <something>" or "prepare the <something> report" where <something> != bright futures
  const scanPattern = /^scan\s+(.+)$/i;
  const preparePattern = /^prepare\s+the\s+(.+?)\s+report$/i;

  const scanMatch = normalized.match(scanPattern);
  const prepareMatch = normalized.match(preparePattern);

  if (scanMatch || prepareMatch) {
    return 'unknown_grant';
  }

  return 'not_a_grant_request';
}

/**
 * Secondary intent check, only consulted when resolveGrantIntent returns
 * 'not_a_grant_request' — keeps the existing bright_futures/unknown_grant
 * routing (and its test coverage) completely unchanged.
 */
function resolveActionIntent(text: string): 'draft_request' | 'gap_summary' | null {
  const normalized = text.trim().toLowerCase();

  const isDraftRequest =
    normalized.includes('draft') &&
    (normalized.includes('outcomes section') ||
      normalized.includes('outcomes') ||
      normalized.includes('report section') ||
      normalized.includes('the report'));

  if (isDraftRequest) {
    return 'draft_request';
  }

  const isGapSummary =
    normalized.includes('gap') ||
    normalized.includes('missing') ||
    normalized.includes("what's missing") ||
    normalized.includes('still missing');

  if (isGapSummary) {
    return 'gap_summary';
  }

  return null;
}

async function postBrightFuturesLedgerPreview(
  say: SayFn,
  setStatus: SetStatusFn,
  logger: Logger,
  client: WebClient
): Promise<void> {
  const sheetId = process.env.GRANTPROOF_SHEET_ID;
  try {
    await setStatus('Reading the attendance tracker...');
    if (!sheetId) {
      logger.error('GRANTPROOF_SHEET_ID is not set');
      await say(SHEET_UNREACHABLE_TEXT);
      return;
    }

    const db = getDb();
    seedBrightFuturesGrant(db);

    const snapshot = await readAttendanceTrackerSnapshot(sheetId);
    const { grant, requirements } = getGrantAndRequirements(db, 'grant_bright_futures');
    if (!grant) {
      logger.error('grant_bright_futures missing after seed');
      await say(GENERIC_FAILURE_TEXT);
      return;
    }

    const blocks = buildLedgerPreview(grant, requirements, snapshot);
    await say({
      text: `${grant.name} — Ledger Summary preview`,
      blocks: blocks as KnownBlock[],
    });

    // Phase 2: Retrieve and extract evidence from Slack/Sheets/Drive
    // (This is skipped gracefully if GRANTPROOF_CHANNEL_IDS is not set)
    await runEvidencePipeline(db, grant, requirements, say, logger, client);

    // Phase 3: propose Sheet-sourced evidence and run the deterministic
    // unit-sanity (§9.4) and conflict (§9.5) checks against it.
    await runSheetEvidenceAndChecks(db, grant, requirements, snapshot, say, logger);

    // Phase 4: verify Drive-sourced session_photos evidence (§9.1), then post
    // the real per-requirement Ledger Summary (§13.2) now that the evidence
    // pipeline, Sheet checks, and Drive check have all had a chance to run.
    await runDriveEvidenceCheck(db, grant, requirements, say, logger);
    await postRealLedgerSummary(db, grant, requirements, say, logger);
  } catch (error) {
    if (error instanceof SheetAccessError) {
      logger.error('sheet access failed', error);
      await say(SHEET_UNREACHABLE_TEXT);
      return;
    }
    logger.error('postBrightFuturesLedgerPreview failed', error);
    await say(GENERIC_FAILURE_TEXT);
  }
}

/**
 * Splits a requirement label into significant lowercase words for keyword
 * prefiltering. A literal full-phrase match (e.g. "Variance Explanation")
 * would almost never appear verbatim in casual Slack messages, so retrieval
 * matches on individual words instead.
 */
function labelToKeywords(label: string): string[] {
  const stopwords = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'by', 'for']);
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !stopwords.has(word));
}

/**
 * Phase 2 evidence pipeline: retrieve, extract, validate, and post confirmation cards.
 * Gracefully skips if GRANTPROOF_CHANNEL_IDS is not set.
 */
async function runEvidencePipeline(
  db: Database.Database,
  grant: Grant,
  requirements: Requirement[],
  say: SayFn,
  logger: Logger,
  client: WebClient
): Promise<void> {
  try {
    const channelIdsEnv = process.env.GRANTPROOF_CHANNEL_IDS;
    if (!channelIdsEnv) {
      logger.info('GRANTPROOF_CHANNEL_IDS not set; skipping Phase 2 evidence pipeline');
      return;
    }

    const channelIds = channelIdsEnv.split(',').map((id) => id.trim()).filter(Boolean);
    if (channelIds.length === 0) {
      logger.info('No channel IDs configured; skipping evidence pipeline');
      return;
    }

    logger.info('Starting Phase 2 evidence pipeline', { channelCount: channelIds.length });

    // Filter requirements that need Slack evidence (not Sheet-sourced counts)
    // Per PRD §14: attendance_by_session, beneficiary_story, budget_variance, program_challenges are Slack-sourced
    const slackRequirements = requirements.filter((req) =>
      ['attendance_by_session', 'beneficiary_story', 'budget_variance', 'program_challenges'].includes(req.key)
    );

    if (slackRequirements.length === 0) {
      logger.info('No Slack-sourced requirements found');
      return;
    }

    // Build keywords for retrieval from requirement labels, split into individual
    // significant words — a full-phrase match would rarely appear verbatim in
    // casual Slack messages.
    const keywords = slackRequirements.flatMap((req) => labelToKeywords(req.label));

    logger.info('Retrieving candidate messages', { keywords });
    const messages = await retrieveCandidateMessages(
      client,
      channelIds,
      grant.reporting_period_start,
      grant.reporting_period_end,
      keywords,
      logger
    );

    logger.info('Retrieved messages', { count: messages.length });

    if (messages.length === 0) {
      logger.info('No messages retrieved; no evidence to extract');
      return;
    }

    // Build source materials for extraction
    const sourceMaterials = messages.map((msg) => ({
      sourceRef: msg.permalink || `#${msg.channel}:${msg.ts}`,
      text: msg.text,
    }));

    // Extract evidence
    logger.info('Extracting evidence');
    const extractionResults = await extractEvidence(
      sourceMaterials,
      slackRequirements.map((req) => req.key)
    );

    logger.info('Extraction complete', { itemCount: extractionResults.length });

    if (extractionResults.length === 0) {
      logger.info('No evidence extracted');
      return;
    }

    // Build validator context
    const sourceDates: Record<string, string> = {};
    for (const msg of messages) {
      const sourceRef = msg.permalink || `#${msg.channel}:${msg.ts}`;
      // Approximate the date from the Slack ts (Unix timestamp with microseconds)
      const seconds = parseFloat(msg.ts);
      const date = new Date(seconds * 1000);
      sourceDates[sourceRef] = date.toISOString().split('T')[0];
    }

    const validatorContext: ValidatorContext = {
      knownRequirementKeys: slackRequirements.map((req) => req.key),
      sourceMaterials,
      sourceDates,
      reportingPeriodStart: grant.reporting_period_start,
      reportingPeriodEnd: grant.reporting_period_end,
    };

    // Validate and insert evidence, then post confirmation cards
    for (const item of extractionResults) {
      const validationResult = runValidators(item, validatorContext);

      if (!validationResult.valid) {
        logger.info('Evidence item dropped by validators', {
          requirement_key: item.requirement_key,
          reason: validationResult.reason,
        });
        continue;
      }

      const req = slackRequirements.find((r) => r.key === item.requirement_key);
      if (!req) {
        // Shouldn't happen — validator 1 already checked requirement_key against
        // this same list — but guard rather than crash the whole pipeline.
        logger.error('Validated item has no matching requirement', { requirement_key: item.requirement_key });
        continue;
      }

      // PRD §10: "Detection is an LLM tag pass plus regex... Any hit sets
      // pii_state = detected." The LLM's own pii_detected flag is one signal;
      // the regex backstop must be an INDEPENDENT second signal on the raw
      // extracted text, not just a post-hoc check run after an item is
      // already flagged — otherwise a quasi-identifier the model misses
      // (EVALS.md C3) sails straight through to an unmasked confirmation card.
      const regexSignal = detectPiiRegex(`${item.claim_text} ${item.quote_text}`);
      const piiDetected = item.pii_detected || regexSignal.detected;
      if (regexSignal.detected && !item.pii_detected) {
        logger.info('Regex backstop caught PII the LLM extraction missed', {
          requirement_key: item.requirement_key,
          reasons: regexSignal.reasons,
        });
      }

      const evidenceId = `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const inserted = insertProposedEvidence(db, {
        id: evidenceId,
        grant_id: grant.id,
        requirement_id: req.id,
        source_type: 'slack',
        source_ref: item.source_ref,
        claim_text: item.claim_text,
        quote_text: item.quote_text,
        value_json: item.value,
        confidence: item.confidence,
        unit_ambiguous: item.unit_ambiguous,
        pii_detected: piiDetected,
        note: item.note,
        extracted_at: new Date().toISOString(),
      });

      if (!inserted) {
        logger.info('Evidence item skipped (GR-2 dedupe)', {
          requirement_key: item.requirement_key,
          source_ref: item.source_ref,
        });
        continue;
      }

      // PRD §10: raw PII must never render. insertProposedEvidence already
      // persisted this row as pii_state='detected'/status='needs_redaction'.
      // Masking runs in a separate pass below (not gated behind "inserted
      // just now" — a row from an earlier scan that GR-2 skips re-inserting
      // this time must still get masked, not stay stuck at 'detected' forever).
      if (piiDetected) {
        continue;
      }

      logger.info('Posting confirmation card', {
        evidenceId,
        requirement_key: item.requirement_key,
      });

      const blocks = buildConfirmationCardBlocks(req.label, {
        id: evidenceId,
        claim_text: item.claim_text,
        quote_text: item.quote_text,
        source_ref: item.source_ref,
        confidence: item.confidence,
      });

      await say({
        text: `Evidence for ${req.label}`,
        blocks: blocks as KnownBlock[],
      });
    }

    // Mask and post Redaction Cards for every PII-flagged row still awaiting
    // it — covers rows inserted just now AND rows from an earlier scan that
    // GR-2 dedupe correctly skipped re-inserting this time. A row that's
    // already past 'detected' (masked/approved_redacted/rejected) is not
    // matched by this query, so nothing here re-masks or re-posts for it.
    const pendingPiiRows = db
      .prepare("SELECT id, requirement_id FROM evidence WHERE grant_id = ? AND pii_state = 'detected'")
      .all(grant.id) as Array<{ id: string; requirement_id: string }>;

    logger.info('Checking for PII rows pending masking', { count: pendingPiiRows.length });

    for (const pendingRow of pendingPiiRows) {
      const req = requirements.find((r) => r.id === pendingRow.requirement_id);
      logger.info('Attempting to mask and post redaction card', { evidenceId: pendingRow.id });
      await maskAndPostRedactionCard(db, pendingRow.id, req?.label ?? 'Evidence', say, logger);
    }

    logger.info('Evidence pipeline complete');
  } catch (error) {
    if (error instanceof ExtractionError) {
      logger.error('Extraction API error', {
        message: error.message,
        statusCode: error.statusCode,
      });
      return;
    }
    logger.error('Evidence pipeline failed', error);
  }
}

/**
 * PRD §10 — masks a PII-flagged evidence row and posts its Redaction Card.
 * Never renders raw claim_text/quote_text: masking runs before anything is
 * posted, and the card builder's type signature only accepts masked text.
 * If masking fails, or the regex backstop still flags the masked output,
 * fails closed — no card is posted and the row stays pii_state='detected'
 * for a future run to retry, exactly like a confidence<0.5 item is logged
 * only and never shown (PRD §9.3.5's "never propose" precedent).
 */
async function maskAndPostRedactionCard(
  db: Database.Database,
  evidenceId: string,
  requirementLabel: string,
  say: SayFn,
  logger: Logger
): Promise<void> {
  const row = getEvidenceById(db, evidenceId);
  if (!row) {
    logger.error('maskAndPostRedactionCard: evidence row not found', { evidenceId });
    return;
  }

  try {
    const [maskedClaim, maskedQuote] = await Promise.all([
      maskPiiTextVerified(row.claim_text),
      maskPiiTextVerified(row.quote_text),
    ]);

    if (!maskedClaim.verifiedSafe || !maskedQuote.verifiedSafe) {
      logger.error('PII masking did not pass the regex backstop; card withheld', {
        evidenceId,
        claimSignals: maskedClaim.remainingSignals,
        quoteSignals: maskedQuote.remainingSignals,
      });
      return;
    }

    maskEvidenceRow(db, evidenceId, maskedClaim.maskedText, maskedQuote.maskedText, new Date().toISOString());

    // Risk label is computed from the RAW text's regex signals but only ever
    // surfaces category names (e.g. "family detail"), never the matched
    // value itself (e.g. never the actual centre name) — see
    // summarizePiiRiskCategories for why this split is safety-critical.
    const rawSignal = detectPiiRegex(`${row.claim_text} ${row.quote_text}`);
    const piiRiskLabel = summarizePiiRiskCategories(rawSignal.reasons);

    const blocks = buildRedactionCardBlocks(requirementLabel, {
      id: evidenceId,
      maskedClaimText: maskedClaim.maskedText,
      piiRiskLabel,
    });

    await say({
      text: `${requirementLabel} found. PII risk: ${piiRiskLabel}.`,
      blocks: blocks as KnownBlock[],
    });
  } catch (error) {
    if (error instanceof PiiMaskingError) {
      logger.error('PII masking failed; card withheld, evidence stays needs_redaction', {
        evidenceId,
        message: error.message,
      });
      return;
    }
    logger.error('maskAndPostRedactionCard failed', error);
  }
}

/**
 * Phase 3: proposes Sheet-sourced evidence (workshops completed, per-session
 * attendance, students served) and runs the deterministic unit-sanity check
 * (§9.4) and conflict check (§9.5) against it before posting any card.
 * GR-2 dedupe (via insertProposedEvidence) makes this safe to re-run.
 */
async function runSheetEvidenceAndChecks(
  db: Database.Database,
  grant: Grant,
  requirements: Requirement[],
  snapshot: AttendanceTrackerSnapshot,
  say: SayFn,
  logger: Logger
): Promise<void> {
  try {
    const workshopsReq = requirements.find((r) => r.key === 'workshops_completed');
    const attendanceReq = requirements.find((r) => r.key === 'attendance_by_session');
    const studentsServedReq = requirements.find((r) => r.key === 'students_served');
    const nowIso = new Date().toISOString();

    // --- workshops_completed: plain Sheet evidence, no check needed ---
    if (workshopsReq) {
      const candidate = mapWorkshopsCompletedCandidate(snapshot);
      const evidenceId = `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const inserted = insertProposedEvidence(db, {
        id: evidenceId,
        grant_id: grant.id,
        requirement_id: workshopsReq.id,
        source_type: 'sheet',
        source_ref: candidate.sourceRef,
        claim_text: candidate.claimText,
        quote_text: candidate.quoteText,
        value_json: candidate.value,
        confidence: 1,
        unit_ambiguous: false,
        pii_detected: false,
        note: '',
        extracted_at: nowIso,
      });
      if (inserted) {
        const blocks = buildConfirmationCardBlocks(workshopsReq.label, {
          id: evidenceId,
          claim_text: candidate.claimText,
          quote_text: candidate.quoteText,
          source_ref: candidate.sourceRef,
          confidence: 1,
        });
        await say({ text: `Evidence for ${workshopsReq.label}`, blocks: blocks as KnownBlock[] });
      }
    }

    // --- attendance_by_session: per-session Sheet evidence, checked against
    // any existing Slack claim for the same session number ---
    if (attendanceReq) {
      const candidates = mapSessionAttendanceCandidates(snapshot);
      const existingRows = db
        .prepare("SELECT * FROM evidence WHERE requirement_id = ? AND source_type = 'slack'")
        .all(attendanceReq.id) as Array<{ id: string; claim_text: string; quote_text: string; value_json: string | null; source_ref: string; status: string }>;

      for (const candidate of candidates) {
        // Look up rather than assume: GR-2 dedupe means a prior scan may
        // already have proposed this exact Sheet cell as evidence, and a
        // Slack claim about the same session can arrive on a LATER scan —
        // the conflict check must still run against that pre-existing row,
        // not be skipped just because insertProposedEvidence returns false.
        const existingSheetRow = db
          .prepare("SELECT id, status FROM evidence WHERE requirement_id = ? AND source_ref = ? AND source_type = 'sheet'")
          .get(attendanceReq.id, candidate.sourceRef) as { id: string; status: string } | undefined;

        let evidenceId: string;
        let isNewRow: boolean;
        if (existingSheetRow) {
          evidenceId = existingSheetRow.id;
          isNewRow = false;
        } else {
          evidenceId = `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          insertProposedEvidence(db, {
            id: evidenceId,
            grant_id: grant.id,
            requirement_id: attendanceReq.id,
            source_type: 'sheet',
            source_ref: candidate.sourceRef,
            claim_text: candidate.claimText,
            quote_text: candidate.quoteText,
            value_json: candidate.value,
            confidence: 1,
            unit_ambiguous: false,
            pii_detected: false,
            note: '',
            extracted_at: nowIso,
          });
          isNewRow = true;
        }

        // Look for a Slack-sourced claim about the same session number.
        const matchingSlackRow = existingRows.find(
          (r) => r.status !== 'rejected' && extractSessionNumber(`${r.claim_text} ${r.quote_text}`) === candidate.sessionNumber
        );

        if (matchingSlackRow) {
          const slackValue = extractNumericValue(matchingSlackRow.claim_text, matchingSlackRow.value_json);
          if (slackValue !== null) {
            const check = detectValueMismatch({
              slackValue,
              slackSourceRef: matchingSlackRow.source_ref,
              sheetValue: candidate.value.n,
              sheetSourceRef: candidate.sourceRef,
            });

            if (check.hasConflict) {
              // Don't raise (or re-post a card for) a conflict already open
              // between this exact pair — avoids spamming the same Conflict
              // Card on every re-scan.
              const existingConflict = db
                .prepare("SELECT id FROM conflicts WHERE evidence_a = ? AND evidence_b = ? AND kind = 'value_mismatch'")
                .get(matchingSlackRow.id, evidenceId);
              if (existingConflict) continue;

              // Both rows stay/become 'conflicted' until a human resolves —
              // this overrides an already-'confirmed' Slack row on purpose
              // (PRD §9.5: mark both evidence rows conflicted).
              db.prepare("UPDATE evidence SET status = 'conflicted' WHERE id = ?").run(evidenceId);
              db.prepare("UPDATE evidence SET status = 'conflicted' WHERE id = ?").run(matchingSlackRow.id);

              const conflictId = `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
              createConflict(db, {
                id: conflictId,
                requirement_id: attendanceReq.id,
                evidence_a: matchingSlackRow.id,
                evidence_b: evidenceId,
                kind: 'value_mismatch',
                note: check.note,
              });

              const blocks = buildConflictCardBlocks(`${attendanceReq.label}, Workshop ${candidate.sessionNumber}`, {
                conflictId,
                slackValue,
                slackSourceDescription: matchingSlackRow.source_ref.startsWith('http') ? 'linked message' : matchingSlackRow.source_ref,
                slackQuoteText: matchingSlackRow.quote_text,
                sheetValue: candidate.value.n,
                sheetSourceRef: candidate.sourceRef,
              });
              await say({ text: `Conflict found for ${attendanceReq.label}`, blocks: blocks as KnownBlock[] });
              continue;
            }
          }
        }

        // No conflicting Slack claim for this session — propose normally,
        // but only post a card the first time this row is created.
        if (!isNewRow) continue;
        const blocks = buildConfirmationCardBlocks(`${attendanceReq.label}, Workshop ${candidate.sessionNumber}`, {
          id: evidenceId,
          claim_text: candidate.claimText,
          quote_text: candidate.quoteText,
          source_ref: candidate.sourceRef,
          confidence: 1,
        });
        await say({ text: `Evidence for ${attendanceReq.label}`, blocks: blocks as KnownBlock[] });
      }
    }

    // --- students_served: unit-sanity check against the Summary value ---
    if (studentsServedReq) {
      const candidate = mapStudentsServedCandidate(snapshot);
      const evidenceId = `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const inserted = insertProposedEvidence(db, {
        id: evidenceId,
        grant_id: grant.id,
        requirement_id: studentsServedReq.id,
        source_type: 'sheet',
        source_ref: candidate.sourceRef,
        claim_text: candidate.claimText,
        quote_text: candidate.quoteText,
        value_json: candidate.value,
        confidence: 1,
        unit_ambiguous: false,
        pii_detected: false,
        note: '',
        extracted_at: nowIso,
      });

      if (inserted) {
        const check = checkUnitSanity({
          candidateValue: snapshot.summaryStudentsServedValue,
          candidateValueCellRef: snapshot.summaryStudentsServedCellRef,
          perSessionCounts: snapshot.sessionCounts,
          uniqueCount: snapshot.uniqueStudents,
          uniqueCountCellRef: snapshot.uniqueStudentsCellRef,
        });

        if (check.suspicious) {
          db.prepare("UPDATE evidence SET status = 'conflicted' WHERE id = ?").run(evidenceId);

          const conflictId = `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          createConflict(db, {
            id: conflictId,
            requirement_id: studentsServedReq.id,
            evidence_a: evidenceId,
            evidence_b: null,
            kind: 'unit_suspicion',
            note: check.note,
          });

          const blocks = buildUnitSuspicionCardBlocks(studentsServedReq.label, {
            conflictId,
            candidateValue: snapshot.summaryStudentsServedValue,
            sessionCount: snapshot.sessionCounts.length,
            uniqueCount: snapshot.uniqueStudents,
          });
          await say({ text: `Unit suspicion flagged for ${studentsServedReq.label}`, blocks: blocks as KnownBlock[] });
        } else {
          const blocks = buildConfirmationCardBlocks(studentsServedReq.label, {
            id: evidenceId,
            claim_text: candidate.claimText,
            quote_text: candidate.quoteText,
            source_ref: candidate.sourceRef,
            confidence: 1,
          });
          await say({ text: `Evidence for ${studentsServedReq.label}`, blocks: blocks as KnownBlock[] });
        }
      }
    }
  } catch (error) {
    logger.error('runSheetEvidenceAndChecks failed', error);
  }
}

/**
 * Phase 4 / PRD §9.1 artifacts: proposes Drive-sourced evidence for the
 * session_photos requirement, ONLY when the folder verifiably satisfies the
 * artifact rule (file count, image mimetypes, dates inside the reporting
 * period, spanning the required distinct session dates) — "a folder exists"
 * is not evidence, so an unverified folder proposes nothing and the
 * requirement honestly stays 'missing'. Gracefully skips (no user-facing
 * error) if GRANTPROOF_DRIVE_FOLDER_ID isn't configured yet, since the
 * folder may not have been shared with the service account yet.
 */
async function runDriveEvidenceCheck(
  db: Database.Database,
  grant: Grant,
  requirements: Requirement[],
  say: SayFn,
  logger: Logger
): Promise<void> {
  const folderId = process.env.GRANTPROOF_DRIVE_FOLDER_ID;
  if (!folderId) {
    logger.info('GRANTPROOF_DRIVE_FOLDER_ID not set, skipping Drive evidence check');
    return;
  }

  const photosReq = requirements.find((r) => r.key === 'session_photos');
  if (!photosReq) return;

  try {
    const params = photosReq.params_json ? (JSON.parse(photosReq.params_json) as { min_sessions?: number }) : {};
    const minSessions = params.min_sessions ?? 2;

    const files = await listSessionPhotos(folderId);
    const result = verifySessionPhotos(files, grant.reporting_period_start, grant.reporting_period_end, minSessions);

    if (!result.verified) {
      logger.info('Drive session_photos not verified', { note: result.note });
      return;
    }

    const evidenceId = `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const claimText = `Session photos verified: ${result.note}.`;
    const inserted = insertProposedEvidence(db, {
      id: evidenceId,
      grant_id: grant.id,
      requirement_id: photosReq.id,
      source_type: 'drive',
      source_ref: folderId,
      claim_text: claimText,
      quote_text: result.note,
      value_json: { fileCount: result.fileCount, distinctDateCount: result.distinctDates.length },
      confidence: 1,
      unit_ambiguous: false,
      pii_detected: false,
      note: '',
      extracted_at: new Date().toISOString(),
    });

    if (inserted) {
      const blocks = buildConfirmationCardBlocks(photosReq.label, {
        id: evidenceId,
        claim_text: claimText,
        quote_text: result.note,
        source_ref: folderId,
        confidence: 1,
      });
      await say({ text: `Evidence for ${photosReq.label}`, blocks: blocks as KnownBlock[] });
    }
  } catch (error) {
    if (error instanceof DriveAccessError) {
      logger.error('Drive access failed, skipping session_photos evidence', error);
      return;
    }
    logger.error('runDriveEvidenceCheck failed', error);
  }
}

/**
 * PRD §13.2 exact Ledger Summary format, powered by the real per-requirement
 * status the gap detector computes (§11) — supersedes the Phase 1-only
 * Sheet-numbers preview (buildLedgerPreview, still posted earlier for its
 * raw-numbers value) once the evidence pipeline and checks have run.
 */
async function postRealLedgerSummary(
  db: Database.Database,
  grant: Grant,
  requirements: Requirement[],
  say: SayFn,
  logger: Logger
): Promise<void> {
  try {
    const evidenceRows = db.prepare('SELECT * FROM evidence WHERE grant_id = ?').all(grant.id) as Array<{
      id: string;
      requirement_id: string;
      source_type: string;
      status: string;
      pii_state: string;
      value_json: string | null;
    }>;
    const requirementIds = requirements.map((r) => r.id);
    const openConflicts =
      requirementIds.length === 0
        ? []
        : (db
            .prepare(
              `SELECT requirement_id, kind, status FROM conflicts WHERE status = 'open' AND requirement_id IN (${requirementIds.map(() => '?').join(',')})`
            )
            .all(...requirementIds) as Array<{ requirement_id: string; kind: string; status: string }>);

    const report = computeGapReport(requirements, evidenceRows, openConflicts);

    const lines = [
      `*${grant.name}.* Report due ${grant.report_due}. *Coverage: ${report.confirmedCount} of ${report.totalRequired} requirements.*`,
      ...report.requirements.map((r) => `${r.label}: ${r.ledgerDisplayText}.`),
      'I will walk you through each item. Nothing enters a report until you confirm it.',
    ];

    await say({
      text: `${grant.name} — Ledger Summary`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: lines.join('\n') },
        },
      ] as KnownBlock[],
    });
  } catch (error) {
    logger.error('postRealLedgerSummary failed', error);
  }
}

/**
 * PRD §12 — "Draft the outcomes section." Assembles a cited draft from
 * confirmed/approved_redacted evidence only; refuses per §13.8 with zero
 * evidence (no draft row created — E1).
 */
async function postDraftSection(say: SayFn, logger: Logger): Promise<void> {
  try {
    const db = getDb();
    seedBrightFuturesGrant(db);
    const { grant, requirements } = getGrantAndRequirements(db, 'grant_bright_futures');
    if (!grant) {
      logger.error('grant_bright_futures missing after seed');
      await say(GENERIC_FAILURE_TEXT);
      return;
    }

    const draftableEvidence = getDraftableEvidence(db, grant.id);
    const result = buildDraftSection('outcomes', requirements, draftableEvidence);

    if (result.refused) {
      await say(result.refusalText);
      return;
    }

    const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    createDraft(db, {
      id: draftId,
      grant_id: grant.id,
      section: result.sectionName,
      content_md: result.contentMd,
      citations: result.citations,
      created_at: new Date().toISOString(),
    });

    await say({
      text: 'Draft outcomes section ready',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Draft: Outcomes section*\n\`\`\`\n${result.contentMd}\n\`\`\`` },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve', emoji: true },
              value: draftId,
              action_id: 'approve_draft',
              style: 'primary',
            },
          ],
        },
      ] as KnownBlock[],
    });
  } catch (error) {
    logger.error('postDraftSection failed', error);
    await say(GENERIC_FAILURE_TEXT);
  }
}

/**
 * PRD §13.7 — Gap Summary: per-requirement nudges for anything not yet
 * confirmed. Suggestions are nudges to a human, never an auto-post.
 */
async function postGapSummary(say: SayFn, logger: Logger): Promise<void> {
  try {
    const db = getDb();
    seedBrightFuturesGrant(db);
    const { grant, requirements } = getGrantAndRequirements(db, 'grant_bright_futures');
    if (!grant) {
      logger.error('grant_bright_futures missing after seed');
      await say(GENERIC_FAILURE_TEXT);
      return;
    }

    const evidenceRows = db.prepare('SELECT * FROM evidence WHERE grant_id = ?').all(grant.id) as Array<{
      id: string;
      requirement_id: string;
      source_type: string;
      status: string;
      pii_state: string;
      value_json: string | null;
    }>;
    const requirementIds = requirements.map((r) => r.id);
    const openConflicts =
      requirementIds.length === 0
        ? []
        : (db
            .prepare(
              `SELECT requirement_id, kind, status FROM conflicts WHERE status = 'open' AND requirement_id IN (${requirementIds.map(() => '?').join(',')})`
            )
            .all(...requirementIds) as Array<{ requirement_id: string; kind: string; status: string }>);

    const report = computeGapReport(requirements, evidenceRows, openConflicts);
    const outstanding = report.requirements.filter((r) => r.status !== 'confirmed');

    let text: string;
    if (outstanding.length === 0) {
      text = `All ${report.totalRequired} requirements are confirmed.`;
    } else {
      const lines = [`*${outstanding.length} requirements still missing.*`];
      for (const r of outstanding) {
        if (r.status === 'missing') {
          lines.push(`${r.label}: ${r.suggestion ?? 'No evidence found yet.'}`);
        } else if (r.status === 'conflict') {
          lines.push(`${r.label}: resolve the conflict above.`);
        } else if (r.status === 'needs_redaction') {
          lines.push(`${r.label}: this item needs redaction approval above.`);
        } else if (r.ledgerDisplayText.includes('unit check')) {
          lines.push(`${r.label}: resolve the unit-suspicion check above.`);
        } else {
          lines.push(`${r.label}: still pending confirmation above.`);
        }
      }
      text = lines.join('\n');
    }

    await say({ text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] as KnownBlock[] });
  } catch (error) {
    logger.error('postGapSummary failed', error);
    await say(GENERIC_FAILURE_TEXT);
  }
}

const assistant = new Assistant({
  threadStarted: async ({ say, setSuggestedPrompts, saveThreadContext, logger }) => {
    try {
      await say(WELCOME_TEXT);
      await saveThreadContext();
      await setSuggestedPrompts({
        title: 'Try this:',
        prompts: [{ title: 'Prepare the Bright Futures July report', message: 'Prepare the Bright Futures July report' }],
      });
    } catch (error) {
      logger.error('assistant.threadStarted failed', error);
    }
  },
  userMessage: async ({ message, say, setStatus, logger, client }) => {
    try {
      const text = 'text' in message && typeof message.text === 'string' ? message.text : '';

      // GR-5: direct-command refusals run before anything else — zero state change.
      const refusalText = detectDirectCommandRefusal(text);
      if (refusalText) {
        await say(refusalText);
        return;
      }

      const intent = resolveGrantIntent(text);

      if (intent === 'bright_futures') {
        await postBrightFuturesLedgerPreview(say, setStatus, logger, client);
        return;
      }

      if (intent === 'unknown_grant') {
        await setStatus('Thinking...');
        await say(UNKNOWN_GRANT_TEXT);
        return;
      }

      // not_a_grant_request: check Phase 4 secondary intents before falling
      // back to the generic placeholder reply.
      const actionIntent = resolveActionIntent(text);
      if (actionIntent === 'draft_request') {
        await setStatus('Drafting...');
        await postDraftSection(say, logger);
        return;
      }
      if (actionIntent === 'gap_summary') {
        await setStatus('Checking coverage...');
        await postGapSummary(say, logger);
        return;
      }

      await setStatus('Thinking...');
      await say(PHASE1_PLACEHOLDER_REPLY);
    } catch (error) {
      logger.error('assistant.userMessage failed', error);
    }
  },
});

export function registerAssistantHandlers(app: App): void {
  app.assistant(assistant);

  // Defensive fallback, confirmed non-load-bearing (FR-002 update): this app uses
  // features.assistant_view, where assistant_thread_started fires normally, so the
  // Assistant class above is the primary path. Kept as a harmless second signal.
  app.event('app_home_opened', async ({ event, client, logger }) => {
    if (event.tab !== 'messages') return;
    try {
      await client.chat.postMessage({ channel: event.channel, text: WELCOME_TEXT });
    } catch (error) {
      logger.error('app_home_opened handler failed', error);
    }
  });

  // Fallback surface (PRD §5): assistant pane is primary, slash command is a fallback.
  app.command('/grantproof', async ({ ack, respond, command }) => {
    await ack();

    // GR-5: direct-command refusals run before anything else — zero state change.
    const refusalText = detectDirectCommandRefusal(command.text);
    if (refusalText) {
      await respond({ response_type: 'ephemeral', text: refusalText });
      return;
    }

    // EVALS.md F1: handle unknown grants
    const intent = resolveGrantIntent(command.text);
    if (intent === 'unknown_grant') {
      await respond({
        response_type: 'ephemeral',
        text: UNKNOWN_GRANT_TEXT,
      });
      return;
    }

    if (intent === 'bright_futures') {
      await respond({
        response_type: 'ephemeral',
        text: 'Starting evidence search in the assistant pane. Jump there to see the ledger and confirmation cards.',
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: `GrantProof received: "${command.text}". Evidence search lands in a later phase — for now, try me in the assistant pane.`,
    });
  });

  // Phase 2: Action handlers for confirmation cards. EVALS.md D1/D2/D3 — these
  // must actually call src/db/evidence.ts, not just acknowledge and reply.
  app.action('confirm_evidence', async ({ ack, respond, action, body, logger }) => {
    await ack();
    const evidenceId = 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!evidenceId) {
      logger.error('confirm_evidence: action had no evidence id');
      return;
    }
    try {
      const db = getDb();
      confirmEvidence(db, evidenceId, actingUser, new Date().toISOString());
      await respond({
        replace_original: true,
        text: `Confirmed by <@${actingUser}>. This evidence is now part of your report.`,
      });
    } catch (error) {
      logger.error('confirm_evidence failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  });

  app.action('reject_evidence', async ({ ack, respond, action, body, logger }) => {
    await ack();
    const evidenceId = 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!evidenceId) {
      logger.error('reject_evidence: action had no evidence id');
      return;
    }
    try {
      const db = getDb();
      rejectEvidence(db, evidenceId, actingUser, new Date().toISOString());
      await respond({
        replace_original: true,
        text: `Rejected by <@${actingUser}>. This evidence will not be used.`,
      });
    } catch (error) {
      logger.error('reject_evidence failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  });

  app.action('edit_evidence', async ({ ack, action, body, client, logger }) => {
    await ack();
    const evidenceId = 'value' in action ? (action.value as string) : undefined;
    const triggerId = 'trigger_id' in body ? body.trigger_id : undefined;
    const channelId = 'channel' in body ? body.channel?.id : undefined;
    const messageTs = 'message' in body ? body.message?.ts : undefined;
    if (!evidenceId || !triggerId) {
      logger.error('edit_evidence: missing evidence id or trigger id');
      return;
    }
    try {
      const db = getDb();
      const row = getEvidenceById(db, evidenceId);
      if (!row) {
        logger.error('edit_evidence: evidence row not found', { evidenceId });
        return;
      }
      // PRD §10: raw PII must never render, including in "before" states like
      // this edit modal. Any row that ever had PII detected (pii_state !=
      // 'none' — detected, masked, approved_redacted, or rejected) shows the
      // masked text for the rest of its life; only a never-flagged row shows raw text.
      const isPii = row.pii_state !== 'none';
      const displayClaimText = isPii ? row.masked_claim_text ?? '[still masking — try again shortly]' : row.claim_text;
      const displayQuoteText = isPii ? row.masked_quote_text ?? '[still masking — try again shortly]' : row.quote_text;
      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'edit_evidence_modal',
          private_metadata: JSON.stringify({ evidenceId, channelId, messageTs }),
          title: { type: 'plain_text', text: 'Edit evidence' },
          submit: { type: 'plain_text', text: 'Save' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'input',
              block_id: 'claim_text_block',
              label: { type: 'plain_text', text: 'Claim' },
              element: {
                type: 'plain_text_input',
                action_id: 'claim_text_input',
                multiline: true,
                initial_value: displayClaimText,
              },
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: `Original quote (unchanged): "${displayQuoteText}"` }],
            },
          ],
        },
      });
    } catch (error) {
      logger.error('edit_evidence failed to open modal', error);
    }
  });

  // Edit modal submission — GR-3: quote_text stays untouched, claim_text updates,
  // status stays "proposed" so the item still needs a fresh Confirm.
  app.view('edit_evidence_modal', async ({ ack, view, body, client, logger }) => {
    await ack();
    const actingUser = body.user.id;
    let evidenceId: string | undefined;
    let channelId: string | undefined;
    let messageTs: string | undefined;
    try {
      const metadata = JSON.parse(view.private_metadata || '{}');
      evidenceId = metadata.evidenceId;
      channelId = metadata.channelId;
      messageTs = metadata.messageTs;
    } catch (error) {
      logger.error('edit_evidence_modal: failed to parse private_metadata', error);
      return;
    }
    const newClaimText = view.state.values.claim_text_block?.claim_text_input?.value;
    if (!evidenceId || !newClaimText) {
      logger.error('edit_evidence_modal: missing evidence id or new claim text');
      return;
    }
    try {
      const db = getDb();
      const before = getEvidenceById(db, evidenceId);
      if (!before) {
        logger.error('edit_evidence_modal: evidence row not found', { evidenceId });
        return;
      }

      const isPii = before.pii_state !== 'none';
      const nowIso = new Date().toISOString();

      if (isPii) {
        // PRD §10: the modal showed masked text, so the edit applies to
        // masked_claim_text only — raw claim_text/quote_text are untouched.
        editMaskedClaimText(db, evidenceId, actingUser, nowIso, newClaimText);
      } else {
        editEvidence(db, evidenceId, actingUser, nowIso, newClaimText);
      }

      const updated = getEvidenceById(db, evidenceId);
      if (!updated) {
        logger.error('edit_evidence_modal: evidence row missing after edit', { evidenceId });
        return;
      }
      const { requirements } = getGrantAndRequirements(db, updated.grant_id);
      const req = requirements.find((r) => r.id === updated.requirement_id);
      const requirementLabel = req?.label ?? 'Evidence';

      const blocks = isPii
        ? buildRedactionCardBlocks(requirementLabel, {
            id: updated.id,
            maskedClaimText: updated.masked_claim_text ?? '',
            piiRiskLabel: summarizePiiRiskCategories(detectPiiRegex(`${updated.claim_text} ${updated.quote_text}`).reasons),
          })
        : buildConfirmationCardBlocks(requirementLabel, {
            id: updated.id,
            claim_text: updated.claim_text,
            quote_text: updated.quote_text,
            source_ref: updated.source_ref,
            confidence: updated.confidence,
          });
      const updateText = `Edited evidence for ${requirementLabel} — confirm again to approve.`;
      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: updateText,
          blocks: blocks as KnownBlock[],
        });
      } else {
        logger.error('edit_evidence_modal: no channel/ts to update original message', { evidenceId });
      }
    } catch (error) {
      logger.error('edit_evidence_modal submission failed', error);
    }
  });

  // Redaction Card (PRD §13.6) — Approve redacted.
  app.action('approve_redacted', async ({ ack, respond, action, body, logger }) => {
    await ack();
    const evidenceId = 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!evidenceId) {
      logger.error('approve_redacted: action had no evidence id');
      return;
    }
    try {
      const db = getDb();
      approveRedactedEvidence(db, evidenceId, actingUser, new Date().toISOString());
      await respond({
        replace_original: true,
        text: `Approved (redacted) by <@${actingUser}>. This evidence is now part of your report.`,
      });
    } catch (error) {
      logger.error('approve_redacted failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  });

  // Redaction Card — Reveal original. SAFETY-CRITICAL: raw text must go to
  // the requesting user ONLY, via postEphemeral (never respond()/say(), whose
  // visibility rules are less explicit) — never broadcast to the channel.
  app.action('reveal_pii', async ({ ack, action, body, client, logger }) => {
    await ack();
    const evidenceId = 'value' in action ? (action.value as string) : undefined;
    const requestingUser = body.user.id;
    const channelId = 'channel' in body ? body.channel?.id : undefined;
    // The Redaction Card lives inside the assistant's conversation thread, so
    // an ephemeral reply must be threaded (thread_ts) or it posts outside the
    // visible thread pane and the user never sees it. body.message carries an
    // index signature — thread_ts isn't in Bolt's narrow type but is present
    // on real thread replies at runtime.
    const threadTs =
      'message' in body && body.message
        ? ((body.message as Record<string, unknown>).thread_ts as string | undefined) ?? body.message.ts
        : undefined;
    if (!evidenceId || !channelId) {
      logger.error('reveal_pii: missing evidence id or channel id');
      return;
    }
    try {
      const db = getDb();
      const revealed = revealPii(db, evidenceId, requestingUser, new Date().toISOString());
      await client.chat.postEphemeral({
        channel: channelId,
        user: requestingUser,
        thread_ts: threadTs,
        text: `Original (visible only to you): "${revealed.claim_text}"\nSource quote: "${revealed.quote_text}"`,
      });
    } catch (error) {
      logger.error('reveal_pii failed', error);
      await client.chat.postEphemeral({ channel: channelId, user: requestingUser, thread_ts: threadTs, text: GENERIC_FAILURE_TEXT });
    }
  });

  // Conflict Card (PRD §13.4) — Use Sheet / Use Slack / Skip.
  app.action('use_sheet_value', async ({ ack, respond, action, body, logger }) =>
    resolveConflictAction(ack, respond, action, body, logger, 'sheet')
  );
  app.action('use_slack_value', async ({ ack, respond, action, body, logger }) =>
    resolveConflictAction(ack, respond, action, body, logger, 'slack')
  );

  async function resolveConflictAction(
    ack: () => Promise<void>,
    respond: (msg: { replace_original?: boolean; text: string }) => Promise<unknown>,
    action: unknown,
    body: { user: { id: string } },
    logger: Logger,
    choice: 'sheet' | 'slack'
  ): Promise<void> {
    await ack();
    const conflictId = action && typeof action === 'object' && 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!conflictId) {
      logger.error('resolveConflictAction: action had no conflict id');
      return;
    }
    try {
      const db = getDb();
      const conflict = getConflictById(db, conflictId);
      if (!conflict) {
        logger.error('resolveConflictAction: conflict not found', { conflictId });
        return;
      }
      const changed = resolveConflict(db, conflictId, actingUser, new Date().toISOString(), choice);
      if (!changed) {
        await respond({ replace_original: true, text: `This conflict was already resolved.` });
        return;
      }
      // The chosen evidence row is confirmed; the losing row is left
      // 'conflicted' — both rows and the pick stay in the ledger per PRD §9.5.
      const winnerId = choice === 'sheet' ? conflict.evidence_b ?? conflict.evidence_a : conflict.evidence_a;
      confirmEvidence(db, winnerId, actingUser, new Date().toISOString());
      await respond({
        replace_original: true,
        text: `Resolved by <@${actingUser}>: using the ${choice === 'sheet' ? 'Sheet' : 'Slack'} value.`,
      });
    } catch (error) {
      logger.error('resolveConflictAction failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  }

  // Unit Suspicion Card (PRD §13.5) — Use unique / Use as written.
  app.action('use_unique_count', async ({ ack, respond, action, body, logger }) => {
    await ack();
    const conflictId = 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!conflictId) {
      logger.error('use_unique_count: action had no conflict id');
      return;
    }
    try {
      const db = getDb();
      const conflict = getConflictById(db, conflictId);
      if (!conflict) {
        logger.error('use_unique_count: conflict not found', { conflictId });
        return;
      }
      const changed = resolveConflict(db, conflictId, actingUser, new Date().toISOString(), 'unique');
      if (!changed) {
        await respond({ replace_original: true, text: `This conflict was already resolved.` });
        return;
      }
      const nowIso = new Date().toISOString();
      // The unique count isn't on the evidence row itself (its value_json is
      // the disputed candidate, e.g. {n: 432}) — it's only known from the
      // conflict note text, whose format is controlled by unitSanity.ts.
      const uniqueCountMatch = conflict.note.match(/Roster shows (\d+) unique students/);
      const uniqueCount = uniqueCountMatch ? parseInt(uniqueCountMatch[1], 10) : null;
      if (uniqueCount !== null) {
        editEvidence(db, conflict.evidence_a, actingUser, nowIso, `${uniqueCount} unique students were served in July.`, {
          n: uniqueCount,
          unit: 'unique_students',
        });
      } else {
        logger.error('use_unique_count: could not parse unique count from conflict note', { conflictId });
      }
      confirmEvidence(db, conflict.evidence_a, actingUser, nowIso);
      await respond({ replace_original: true, text: `Resolved by <@${actingUser}>: using the unique student count.` });
    } catch (error) {
      logger.error('use_unique_count failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  });

  app.action('use_cumulative_count', async ({ ack, respond, action, body, logger }) => {
    await ack();
    const conflictId = 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!conflictId) {
      logger.error('use_cumulative_count: action had no conflict id');
      return;
    }
    try {
      const db = getDb();
      const conflict = getConflictById(db, conflictId);
      if (!conflict) {
        logger.error('use_cumulative_count: conflict not found', { conflictId });
        return;
      }
      const changed = resolveConflict(db, conflictId, actingUser, new Date().toISOString(), 'cumulative');
      if (!changed) {
        await respond({ replace_original: true, text: `This conflict was already resolved.` });
        return;
      }
      confirmEvidence(db, conflict.evidence_a, actingUser, new Date().toISOString());
      await respond({ replace_original: true, text: `Resolved by <@${actingUser}>: using the value as written (cumulative attendance).` });
    } catch (error) {
      logger.error('use_cumulative_count failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  });

  // Shared "Skip" action for both card types — leaves the conflict open.
  app.action('skip_conflict', async ({ ack, respond, action, body, logger }) => {
    await ack();
    const conflictId = 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!conflictId) {
      logger.error('skip_conflict: action had no conflict id');
      return;
    }
    try {
      const db = getDb();
      skipConflict(db, conflictId, actingUser, new Date().toISOString());
      await respond({ replace_original: true, text: `Skipped for now by <@${actingUser}>. This is still unresolved.` });
    } catch (error) {
      logger.error('skip_conflict failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  });

  // PRD §12 rule 6 — draft stays 'proposed' until a human clicks Approve.
  app.action('approve_draft', async ({ ack, respond, action, body, logger }) => {
    await ack();
    const draftId = 'value' in action ? (action.value as string) : undefined;
    const actingUser = body.user.id;
    if (!draftId) {
      logger.error('approve_draft: action had no draft id');
      return;
    }
    try {
      const db = getDb();
      const changed = approveDraft(db, draftId, actingUser, new Date().toISOString());
      await respond({
        replace_original: true,
        text: changed
          ? `Approved by <@${actingUser}>. This draft is ready.`
          : 'This draft was already approved.',
      });
    } catch (error) {
      logger.error('approve_draft failed', error);
      await respond({ text: GENERIC_FAILURE_TEXT });
    }
  });
}
