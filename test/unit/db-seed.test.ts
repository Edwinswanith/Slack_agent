import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { seedBrightFuturesGrant } from "../../src/db/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("seedBrightFuturesGrant", () => {
  let db: Database.Database;
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(__dirname, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new Database(tempDbPath);

    const schemaPath = path.join(__dirname, "../../src/db/schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it("should insert exactly 1 grant row", () => {
    seedBrightFuturesGrant(db);

    const grants = db.prepare("SELECT * FROM grants").all();
    expect(grants).toHaveLength(1);
    expect(grants[0]).toEqual(
      expect.objectContaining({
        id: "grant_bright_futures",
        name: "Bright Futures Foundation, Youth Literacy Grant",
        funder: "Bright Futures Foundation",
        reporting_period_start: "2026-07-01",
        reporting_period_end: "2026-07-31",
        report_due: "2026-07-31",
      })
    );
  });

  it("should insert exactly 7 requirement rows", () => {
    seedBrightFuturesGrant(db);

    const requirements = db.prepare("SELECT * FROM requirements").all();
    expect(requirements).toHaveLength(7);

    const keys = requirements.map((r: any) => r.key);
    expect(keys).toContain("workshops_completed");
    expect(keys).toContain("students_served");
    expect(keys).toContain("attendance_by_session");
    expect(keys).toContain("beneficiary_story");
    expect(keys).toContain("session_photos");
    expect(keys).toContain("budget_variance");
    expect(keys).toContain("program_challenges");
  });

  it("should set correct types for each requirement", () => {
    seedBrightFuturesGrant(db);

    const requirements = db
      .prepare("SELECT key, type FROM requirements ORDER BY key")
      .all() as any[];

    const typeMap = Object.fromEntries(requirements.map((r) => [r.key, r.type]));

    expect(typeMap.workshops_completed).toBe("count");
    expect(typeMap.students_served).toBe("count");
    expect(typeMap.attendance_by_session).toBe("series");
    expect(typeMap.beneficiary_story).toBe("story");
    expect(typeMap.session_photos).toBe("artifact");
    expect(typeMap.budget_variance).toBe("finance");
    expect(typeMap.program_challenges).toBe("narrative");
  });

  it("should set params_json correctly for session_photos (artifact)", () => {
    seedBrightFuturesGrant(db);

    const req = db
      .prepare("SELECT params_json FROM requirements WHERE key = 'session_photos'")
      .get() as any;

    expect(req.params_json).toBe('{"min_sessions":2}');
    const parsed = JSON.parse(req.params_json);
    expect(parsed.min_sessions).toBe(2);
  });

  it("should be idempotent — calling seed twice should not duplicate rows", () => {
    seedBrightFuturesGrant(db);
    seedBrightFuturesGrant(db);

    const grants = db.prepare("SELECT * FROM grants").all();
    expect(grants).toHaveLength(1);

    const requirements = db.prepare("SELECT * FROM requirements").all();
    expect(requirements).toHaveLength(7);
  });

  it("should link all requirements to the grant", () => {
    seedBrightFuturesGrant(db);

    const requirements = db
      .prepare("SELECT grant_id FROM requirements")
      .all() as any[];

    expect(requirements.every((r) => r.grant_id === "grant_bright_futures")).toBe(true);
  });

  it("should set all requirements as required (required = 1)", () => {
    seedBrightFuturesGrant(db);

    const requirements = db
      .prepare("SELECT required FROM requirements")
      .all() as any[];

    expect(requirements.every((r) => r.required === 1)).toBe(true);
  });
});
