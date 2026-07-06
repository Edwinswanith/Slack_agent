import { describe, it, expect } from "vitest";
import {
  buildDraftSection,
  getDraftableEvidence,
  DraftableEvidenceRow,
} from "../../src/core/drafter.js";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Drafter (PRD §12, EVALS.md E1-E5)", () => {
  const mockRequirements = [
    {
      id: "req_1",
      key: "program_challenges",
      label: "Challenges Encountered and Solutions",
      type: "narrative",
      required: 1,
    },
    {
      id: "req_2",
      key: "attendance_by_session",
      label: "Attendance by Session",
      type: "series",
      required: 1,
    },
    {
      id: "req_3",
      key: "session_photos",
      label: "Session Photos",
      type: "artifact",
      required: 1,
    },
  ];

  describe("E1: Zero approved evidence → refusal", () => {
    it("should refuse with exact §13.8 copy when no evidence is draftable", () => {
      const result = buildDraftSection(
        "outcomes",
        mockRequirements,
        []
      );

      expect(result.refused).toBe(true);
      expect((result as any).refusalText).toBe(
        "I cannot draft yet: no evidence has been confirmed. Confirm at least one item first."
      );
    });
  });

  describe("E2: Missing requirement → bracketed gap", () => {
    it("should render bracketed gap for missing narrative requirement", () => {
      const evidence: DraftableEvidenceRow[] = [
        {
          id: "e2",
          requirement_id: "req_2",
          requirement_key: "attendance_by_session",
          requirement_label: "Attendance by Session",
          requirement_type: "series",
          source_type: "slack",
          source_ref: "https://slack.com/archives/C123/p456",
          claim_text: "Workshop 1 had 45 students.",
          pii_state: "none",
          masked_claim_text: null,
        },
      ];

      const result = buildDraftSection(
        "outcomes",
        mockRequirements,
        evidence
      );

      expect(result.refused).toBe(false);
      const content = (result as any).contentMd;
      expect(content).toContain(
        "[Challenges Encountered and Solutions: no evidence collected yet]"
      );
    });
  });

  describe("E3: Citation integrity → all citations resolvable", () => {
    it("should build citations matching evidence rows exactly", () => {
      const evidence: DraftableEvidenceRow[] = [
        {
          id: "e1",
          requirement_id: "req_1",
          requirement_key: "program_challenges",
          requirement_label: "Challenges Encountered and Solutions",
          requirement_type: "narrative",
          source_type: "slack",
          source_ref: "https://slack.com/archives/C123/p456",
          claim_text: "We faced budget constraints.",
          pii_state: "none",
          masked_claim_text: null,
        },
        {
          id: "e2",
          requirement_id: "req_2",
          requirement_key: "attendance_by_session",
          requirement_label: "Attendance by Session",
          requirement_type: "series",
          source_type: "sheet",
          source_ref: "Sessions!B10",
          claim_text: "45 students",
          pii_state: "none",
          masked_claim_text: null,
        },
      ];

      const result = buildDraftSection(
        "outcomes",
        [mockRequirements[0], mockRequirements[1]],
        evidence
      );

      expect(result.refused).toBe(false);
      const citations = (result as any).citations;

      expect(citations).toHaveLength(2);
      expect(citations[0].sourceRef).toBe("https://slack.com/archives/C123/p456");
      expect(citations[1].sourceRef).toBe("Sessions!B10");
      expect(citations[1].displayText).toBe("Sheet: Sessions!B10");
    });
  });

  describe("PRD §12 rule 4: series requirements never sum — one cited sentence per row", () => {
    it("should list each confirmed session individually, never compute a total", () => {
      const evidence: DraftableEvidenceRow[] = [
        {
          id: "e1",
          requirement_id: "req_2",
          requirement_key: "attendance_by_session",
          requirement_label: "Attendance by Session",
          requirement_type: "series",
          source_type: "sheet",
          source_ref: "Sessions!B2",
          claim_text: "Workshop 1 had 51 students in attendance (Sheet).",
          pii_state: "none",
          masked_claim_text: null,
        },
        {
          id: "e2",
          requirement_id: "req_2",
          requirement_key: "attendance_by_session",
          requirement_label: "Attendance by Session",
          requirement_type: "series",
          source_type: "sheet",
          source_ref: "Sessions!B3",
          claim_text: "Workshop 2 had 55 students in attendance (Sheet).",
          pii_state: "none",
          masked_claim_text: null,
        },
      ];

      const result = buildDraftSection("outcomes", [mockRequirements[1]], evidence);

      expect(result.refused).toBe(false);
      const content = (result as any).contentMd;
      const citations = (result as any).citations;

      expect(content).toContain("Workshop 1 had 51 students in attendance (Sheet).");
      expect(content).toContain("Workshop 2 had 55 students in attendance (Sheet).");
      expect(content).not.toMatch(/cumulative|total|across \d+ confirmed sessions/i);
      expect(citations).toHaveLength(2);
      expect(citations.map((c: any) => c.sourceRef)).toEqual(["Sessions!B2", "Sessions!B3"]);
    });
  });

  describe("E4: getDraftableEvidence filters proposed rows", () => {
    it("should exclude proposed evidence from draftable rows", () => {
      const db = new Database(":memory:");
      const schemaPath = path.join(__dirname, "../../src/db/schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      db.exec(schema);

      db.prepare(
        `INSERT INTO grants VALUES ('grant1', 'Test Grant', 'Test Funder', '2026-07-01', '2026-07-31', '2026-08-15', null)`
      ).run();

      db.prepare(
        `INSERT INTO requirements VALUES ('req1', 'grant1', 'key1', 'Req 1', 'narrative', 1, null)`
      ).run();

      db.prepare(
        `INSERT INTO requirements VALUES ('req2', 'grant1', 'key2', 'Req 2', 'narrative', 1, null)`
      ).run();

      db.prepare(`
        INSERT INTO evidence VALUES (
          'e_proposed', 'grant1', 'req1', 'slack', 'ref1',
          'Proposed claim', null, null, 0.9, 'none', 'proposed',
          '2026-07-05T10:00:00Z', null, null, null, null
        )
      `).run();

      db.prepare(`
        INSERT INTO evidence VALUES (
          'e_confirmed', 'grant1', 'req2', 'slack', 'ref2',
          'Confirmed claim', null, null, 0.9, 'none', 'confirmed',
          '2026-07-05T10:00:00Z', 'U123', '2026-07-05T11:00:00Z', null, null
        )
      `).run();

      const draftable = getDraftableEvidence(db, 'grant1');

      expect(draftable).toHaveLength(1);
      expect(draftable[0].id).toBe('e_confirmed');

      db.close();
    });
  });

  describe("PII safety: masked vs raw claim text", () => {
    it("should use masked_claim_text for approved_redacted pii_state", () => {
      const evidence: DraftableEvidenceRow[] = [
        {
          id: "e1",
          requirement_id: "req_1",
          requirement_key: "program_challenges",
          requirement_label: "Challenges Encountered and Solutions",
          requirement_type: "narrative",
          source_type: "slack",
          source_ref: "ref1",
          claim_text: "Student named John Smith had difficulty.",
          pii_state: "approved_redacted",
          masked_claim_text: "One [student] had difficulty.",
        },
      ];

      const result = buildDraftSection(
        "outcomes",
        [mockRequirements[0]],
        evidence
      );

      expect(result.refused).toBe(false);
      const content = (result as any).contentMd;

      expect(content).toContain("[student]");
      expect(content).not.toContain("John Smith");
    });
  });
});
