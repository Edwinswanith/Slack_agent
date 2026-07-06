import Database from "better-sqlite3";
import { AttendanceTrackerSnapshot } from "../google/sheets.js";

/**
 * Database row types for reading from SQLite.
 */
interface Grant {
  id: string;
  name: string;
  funder: string;
  reporting_period_start: string;
  reporting_period_end: string;
  report_due: string;
}

interface Requirement {
  id: string;
  grant_id: string;
  key: string;
  label: string;
  type: string;
  required: number;
  params_json: string | null;
}

/**
 * Builds a plain-object Phase 1 preview of the evidence ledger.
 * Shows raw signal from the Sheet snapshot without inference or full status logic.
 *
 * Output is a Slack Block Kit-compatible object (or string list) that can be
 * posted directly to chat.postMessage. Surfaces both summary values
 * (students served from Summary tab) and unique student count (from Roster tab)
 * so the unit-sanity landmine is visible but not resolved — that's Phase 3's job.
 *
 * Other requirement types (series, story, artifact, finance, narrative) that
 * Sheets cannot supply show as "not yet checked (Phase 2+)".
 *
 * @param grant The grant row from the database
 * @param requirements Array of requirement rows from the database
 * @param sheetSnapshot The typed data read from the attendance tracker sheet
 * @returns Slack Block Kit blocks array suitable for chat.postMessage
 */
export function buildLedgerPreview(
  grant: Grant,
  requirements: Requirement[],
  sheetSnapshot: AttendanceTrackerSnapshot
): unknown[] {
  const blocks: unknown[] = [];

  // Header: grant name, funder, and report due date
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${grant.name}*\nFunder: ${grant.funder}\nReport Due: ${grant.report_due}`,
    },
  });

  // Phase 1 Preview disclaimer
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "📋 *Phase 1 Preview* — Live Sheet numbers only. Full ledger with status (confirmed/conflict/missing) arrives in Phase 2+.",
    },
  });

  blocks.push({
    type: "divider",
  });

  // Iterate through each requirement and surface available signals
  for (const req of requirements) {
    if (req.type === "count") {
      // Count-type requirements: map to Sheet signals
      if (req.key === "workshops_completed") {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${req.label}*\n\`${sheetSnapshot.workshopCount}\` sessions across Sessions tab (W1-W8: ${sheetSnapshot.sessionCounts.join(", ")})`,
          },
        });
      } else if (req.key === "students_served") {
        // Deliberately surface both values to show the mismatch
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${req.label}*\nSummary tab: \`${sheetSnapshot.summaryStudentsServedValue}\` served\nRoster tab: \`${sheetSnapshot.uniqueStudents}\` unique students\n⚠️ Values differ — requires review in Phase 3`,
          },
        });
      } else {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${req.label}*\nNo Sheet mapping available — requires Phase 2+ extraction`,
          },
        });
      }
    } else {
      // Non-count requirements: cannot source from Sheets alone
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${req.label}* (${req.type})\nNot yet checked — Phase 2+ will search Slack/Drive`,
        },
      });
    }

    blocks.push({
      type: "divider",
    });
  }

  // Footer: next steps
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "Next: Phase 2 will extract evidence from Slack channels and Drive. Confirmations → conflicts → redaction → draft.",
    },
  });

  return blocks;
}

/**
 * Helper: fetch grant and requirements from database by grant ID.
 * Used internally by assistant.ts to set up data before calling buildLedgerPreview.
 */
export function getGrantAndRequirements(
  db: Database.Database,
  grantId: string
): { grant: Grant | null; requirements: Requirement[] } {
  const getGrant = db.prepare("SELECT * FROM grants WHERE id = ?");
  const getReqs = db.prepare("SELECT * FROM requirements WHERE grant_id = ? ORDER BY id");

  const grant = getGrant.get(grantId) as Grant | undefined;
  const requirements = getReqs.all(grantId) as Requirement[];

  return {
    grant: grant || null,
    requirements,
  };
}
