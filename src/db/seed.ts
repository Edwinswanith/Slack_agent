import Database from "better-sqlite3";

/**
 * Seed a single grant (Bright Futures Foundation, Youth Literacy Grant)
 * with its 7 requirements based on PRD §14.1.
 *
 * Uses INSERT OR IGNORE for idempotency — safe to call every startup.
 * This matches the real Instrumentl grant progress report template structure.
 */
export function seedBrightFuturesGrant(db: Database.Database): void {
  const grantId = "grant_bright_futures";
  const grantName = "Bright Futures Foundation, Youth Literacy Grant";
  const funder = "Bright Futures Foundation";
  const periodStart = "2026-07-01";
  const periodEnd = "2026-07-31";
  const reportDue = "2026-07-31";

  // Insert grant (idempotent)
  const insertGrant = db.prepare(`
    INSERT OR IGNORE INTO grants (id, name, funder, reporting_period_start, reporting_period_end, report_due, template_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertGrant.run(grantId, grantName, funder, periodStart, periodEnd, reportDue, "instrumentl-standard");

  // Define the 7 requirements based on real funder template language
  const requirements = [
    {
      id: "req_workshops_completed",
      key: "workshops_completed",
      label: "Number of Sessions Conducted",
      type: "count",
      paramsJson: null,
    },
    {
      id: "req_students_served",
      key: "students_served",
      label: "Unique Participants Served",
      type: "count",
      paramsJson: null,
    },
    {
      id: "req_attendance_by_session",
      key: "attendance_by_session",
      label: "Attendance by Session",
      type: "series",
      paramsJson: null,
    },
    {
      id: "req_beneficiary_story",
      key: "beneficiary_story",
      label: "Program Impact Story",
      type: "story",
      paramsJson: null,
    },
    {
      id: "req_session_photos",
      key: "session_photos",
      label: "Supporting Documentation (Photos/Evidence)",
      type: "artifact",
      paramsJson: JSON.stringify({ min_sessions: 2 }),
    },
    {
      id: "req_budget_variance",
      key: "budget_variance",
      label: "Variance Explanation",
      type: "finance",
      paramsJson: null,
    },
    {
      id: "req_program_challenges",
      key: "program_challenges",
      label: "Challenges Encountered and Solutions",
      type: "narrative",
      paramsJson: null,
    },
  ];

  // Insert requirements (idempotent)
  const insertRequirement = db.prepare(`
    INSERT OR IGNORE INTO requirements (id, grant_id, key, label, type, required, params_json)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);

  for (const req of requirements) {
    insertRequirement.run(
      req.id,
      grantId,
      req.key,
      req.label,
      req.type,
      req.paramsJson
    );
  }
}
