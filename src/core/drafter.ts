import Database from "better-sqlite3";

export interface DraftableEvidenceRow {
  id: string;
  requirement_id: string;
  requirement_key: string;
  requirement_label: string;
  requirement_type: string;
  source_type: string;
  source_ref: string;
  claim_text: string;
  pii_state: string;
  masked_claim_text: string | null;
}

export interface DraftCitation {
  requirementKey: string;
  sourceType: string;
  sourceRef: string;
  displayText: string;
}

export type DraftResult =
  | { refused: true; refusalText: string }
  | {
      refused: false;
      sectionName: string;
      contentMd: string;
      citations: DraftCitation[];
    };

export function buildDraftSection(
  sectionName: string,
  requirements: Array<{
    id: string;
    key: string;
    label: string;
    type: string;
    required: number;
  }>,
  draftableEvidence: DraftableEvidenceRow[]
): DraftResult {
  if (draftableEvidence.length === 0) {
    return {
      refused: true,
      refusalText:
        "I cannot draft yet: no evidence has been confirmed. Confirm at least one item first.",
    };
  }

  const sentences: string[] = [];
  const citations: DraftCitation[] = [];

  for (const req of requirements) {
    if (req.type === "artifact") {
      continue;
    }

    const reqEvidence = draftableEvidence.filter(
      (e) => e.requirement_id === req.id
    );

    if (reqEvidence.length === 0) {
      sentences.push(`[${req.label}: no evidence collected yet]`);
      continue;
    }

    if (req.type === "series" && reqEvidence.length > 1) {
      for (const evidence of reqEvidence) {
        const claimText =
          evidence.pii_state === "approved_redacted" && evidence.masked_claim_text
            ? evidence.masked_claim_text
            : evidence.claim_text;
        const citationRef = buildCitationRef(evidence);
        sentences.push(`${claimText.replace(/\.$/, "")}. (${citationRef})`);
        citations.push({
          requirementKey: evidence.requirement_key,
          sourceType: evidence.source_type,
          sourceRef: evidence.source_ref,
          displayText: citationRef,
        });
      }
      continue;
    }

    const evidence = reqEvidence[0];
    const claimText =
      evidence.pii_state === "approved_redacted" && evidence.masked_claim_text
        ? evidence.masked_claim_text
        : evidence.claim_text;

    const citationRef = buildCitationRef(evidence);
    sentences.push(`${claimText.replace(/\.$/, "")}. (${citationRef})`);

    citations.push({
      requirementKey: evidence.requirement_key,
      sourceType: evidence.source_type,
      sourceRef: evidence.source_ref,
      displayText: citationRef,
    });
  }

  const contentMd = sentences.join(" ");

  return {
    refused: false,
    sectionName,
    contentMd,
    citations,
  };
}

function buildCitationRef(evidence: DraftableEvidenceRow): string {
  if (evidence.source_type === "sheet") {
    return `Sheet: ${evidence.source_ref}`;
  } else if (evidence.source_type === "drive") {
    return `Drive: ${evidence.source_ref}`;
  } else if (evidence.source_ref.startsWith("http")) {
    return `<${evidence.source_ref}|View message>`;
  } else {
    return `Slack: ${evidence.source_ref}`;
  }
}

export function getDraftableEvidence(
  db: Database.Database,
  grantId: string
): DraftableEvidenceRow[] {
  const stmt = db.prepare(`
    SELECT
      e.id,
      e.requirement_id,
      r.key as requirement_key,
      r.label as requirement_label,
      r.type as requirement_type,
      e.source_type,
      e.source_ref,
      e.claim_text,
      e.pii_state,
      e.masked_claim_text
    FROM evidence e
    JOIN requirements r ON e.requirement_id = r.id
    WHERE e.grant_id = ?
      AND e.status = 'confirmed'
      AND e.pii_state NOT IN ('detected', 'masked')
  `);

  const rows = stmt.all(grantId) as DraftableEvidenceRow[];
  return rows;
}
