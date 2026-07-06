export type RequirementStatus =
  | "confirmed"
  | "needs_review"
  | "needs_redaction"
  | "conflict"
  | "missing";

export interface RequirementGapInfo {
  requirementKey: string;
  label: string;
  status: RequirementStatus;
  ledgerDisplayText: string;
  suggestion?: string;
}

export interface GapReport {
  requirements: RequirementGapInfo[];
  confirmedCount: number;
  totalRequired: number;
}

interface EvidenceRow {
  id: string;
  requirement_id: string;
  source_type: string;
  status: string;
  pii_state: string;
  value_json: string | null;
}

interface ConflictRow {
  requirement_id: string;
  kind: string;
  status: string;
}

interface RequirementRow {
  id: string;
  key: string;
  label: string;
  type: string;
  params_json: string | null;
  required?: number;
}

export function computeGapReport(
  requirements: RequirementRow[],
  evidenceRows: EvidenceRow[],
  openConflicts: ConflictRow[]
): GapReport {
  const gapInfos: RequirementGapInfo[] = [];

  for (const req of requirements) {
    const reqEvidence = evidenceRows.filter(
      (e) => e.requirement_id === req.id
    );
    const reqConflicts = openConflicts.filter(
      (c) => c.requirement_id === req.id && c.status === "open"
    );

    let status: RequirementStatus;
    let ledgerDisplayText: string;
    let suggestion: string | undefined;

    const valueMismatchConflict = reqConflicts.find(
      (c) => c.kind === "value_mismatch"
    );
    if (valueMismatchConflict) {
      status = "conflict";
      ledgerDisplayText = "conflict found";
    }
    else if (reqConflicts.some((c) => c.kind === "unit_suspicion")) {
      status = "needs_review";
      ledgerDisplayText = "unit check raised";
    }
    else if (
      reqEvidence.some(
        (e) => e.pii_state === "detected" || e.pii_state === "masked"
      )
    ) {
      status = "needs_redaction";
      ledgerDisplayText = "found, needs redaction";
    }
    else if (reqEvidence.some((e) => e.status === "confirmed")) {
      status = "confirmed";
      if (req.type === "artifact") {
        const confirmedArtifact = reqEvidence.find(
          (e) => e.status === "confirmed"
        );
        if (confirmedArtifact && confirmedArtifact.value_json) {
          try {
            const parsed = JSON.parse(confirmedArtifact.value_json);
            if (parsed.fileCount !== undefined && parsed.distinctDateCount !== undefined) {
              ledgerDisplayText = `verified, ${parsed.fileCount} files across ${parsed.distinctDateCount} dates`;
            } else {
              ledgerDisplayText = "confirmed";
            }
          } catch {
            ledgerDisplayText = "confirmed";
          }
        } else {
          ledgerDisplayText = "confirmed";
        }
      } else {
        ledgerDisplayText = "confirmed";
      }
    }
    else if (reqEvidence.some((e) => e.status === "proposed")) {
      status = "needs_review";
      const proposedRow = reqEvidence.find((e) => e.status === "proposed");
      const sourceType = proposedRow?.source_type ?? "slack";
      const sourceLabel =
        sourceType === "sheet"
          ? "Sheet"
          : sourceType === "drive"
            ? "Drive"
            : "Slack";
      ledgerDisplayText = `proposed (${sourceLabel})`;
    }
    else {
      status = "missing";
      ledgerDisplayText = "missing";

      if (req.key === "program_challenges") {
        suggestion =
          "I found no evidence in the reporting period. This is usually one paragraph from the program lead; consider asking in #yl-field-updates.";
      } else {
        switch (req.type) {
          case "count":
            suggestion =
              "Count requirements are usually tracked in a shared sheet. Check if there's a data entry tab.";
            break;
          case "series":
            suggestion =
              "Attendance records are often in the same channel as session updates; try asking in the program channel.";
            break;
          case "story":
            suggestion =
              "Stories and outcomes are often shared in reflections or retrospective threads. Try asking the program team.";
            break;
          case "artifact":
            suggestion =
              "Artifacts like photos or documents are often in a shared Drive folder. Check if the folder is configured.";
            break;
          case "finance":
            suggestion =
              "Financial data is usually in a budget or expense tracking sheet. Check with the finance coordinator.";
            break;
          case "narrative":
            suggestion =
              "Narrative sections are often drafted by program leads. Try asking in the program communications channel.";
            break;
          default:
            suggestion = "No evidence found for this requirement. Contact the relevant team member.";
        }
      }
    }

    gapInfos.push({
      requirementKey: req.key,
      label: req.label,
      status,
      ledgerDisplayText,
      suggestion,
    });
  }

  const confirmedCount = gapInfos.filter(
    (info) => info.status === "confirmed"
  ).length;
  const totalRequired = requirements.filter((r) => r.required !== 0).length;

  return {
    requirements: gapInfos,
    confirmedCount,
    totalRequired,
  };
}
