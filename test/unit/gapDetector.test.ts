import { describe, it, expect } from "vitest";
import {
  computeGapReport,
} from "../../src/core/gapDetector.js";

describe("Gap Detector (PRD §11)", () => {
  const mockRequirements = [
    {
      id: "req_1",
      key: "program_challenges",
      label: "Challenges Encountered and Solutions",
      type: "narrative",
      required: 1,
      params_json: null,
    },
    {
      id: "req_2",
      key: "attendance_by_session",
      label: "Attendance by Session",
      type: "series",
      required: 1,
      params_json: null,
    },
    {
      id: "req_3",
      key: "session_photos",
      label: "Session Photos",
      type: "artifact",
      required: 1,
      params_json: null,
    },
  ];

  describe("Status precedence rules", () => {
    it("should set status=conflict for open value_mismatch conflict", () => {
      const evidence = [
        {
          id: "e1",
          requirement_id: "req_1",
          source_type: "slack",
          status: "confirmed",
          pii_state: "none",
          value_json: null,
        },
      ];

      const conflicts = [
        {
          requirement_id: "req_1",
          kind: "value_mismatch",
          status: "open",
        },
      ];

      const report = computeGapReport(
        mockRequirements,
        evidence as any,
        conflicts as any
      );

      const programChallenges = report.requirements.find(
        (r) => r.requirementKey === "program_challenges"
      );
      expect(programChallenges?.status).toBe("conflict");
      expect(programChallenges?.ledgerDisplayText).toBe("conflict found");
    });

    it("should set status=confirmed and format artifact ledger text", () => {
      const evidence = [
        {
          id: "e1",
          requirement_id: "req_3",
          source_type: "drive",
          status: "confirmed",
          pii_state: "none",
          value_json: JSON.stringify({
            fileCount: 6,
            distinctDateCount: 2,
          }),
        },
      ];

      const report = computeGapReport(mockRequirements, evidence as any, []);

      const photos = report.requirements.find(
        (r) => r.requirementKey === "session_photos"
      );
      expect(photos?.status).toBe("confirmed");
      expect(photos?.ledgerDisplayText).toBe(
        "verified, 6 files across 2 dates"
      );
    });

    it("should set status=missing with suggestion for program_challenges", () => {
      const report = computeGapReport(mockRequirements, [], []);

      const programChallenges = report.requirements.find(
        (r) => r.requirementKey === "program_challenges"
      );
      expect(programChallenges?.status).toBe("missing");
      expect(programChallenges?.suggestion).toBe(
        "I found no evidence in the reporting period. This is usually one paragraph from the program lead; consider asking in #yl-field-updates."
      );
    });
  });

  describe("PRD §13.8 dependency: Slack-sourced types classify as missing with zero evidence", () => {
    // The assistant's "No evidence found" error state (§13.8) fires for any
    // story/finance/narrative requirement with status === "missing" — locking
    // this in here means a future change to computeGapReport can't silently
    // break that trigger.
    const slackSourcedRequirements = [
      {
        id: "req_story",
        key: "beneficiary_story",
        label: "Beneficiary Story",
        type: "story",
        required: 1,
        params_json: null,
      },
      {
        id: "req_finance",
        key: "budget_variance",
        label: "Budget Variance Explanation",
        type: "finance",
        required: 1,
        params_json: null,
      },
      {
        id: "req_narrative",
        key: "program_challenges",
        label: "Challenges Encountered and Solutions",
        type: "narrative",
        required: 1,
        params_json: null,
      },
    ];

    it("classifies story, finance, and narrative requirements as missing when no evidence exists", () => {
      const report = computeGapReport(slackSourcedRequirements, [], []);

      for (const key of ["beneficiary_story", "budget_variance", "program_challenges"]) {
        const info = report.requirements.find((r) => r.requirementKey === key);
        expect(info?.status).toBe("missing");
      }
    });
  });

  describe("Coverage metrics", () => {
    it("should count confirmed requirements correctly", () => {
      const evidence = [
        {
          id: "e1",
          requirement_id: "req_1",
          source_type: "slack",
          status: "confirmed",
          pii_state: "none",
          value_json: null,
        },
      ];

      const report = computeGapReport(mockRequirements, evidence as any, []);

      expect(report.confirmedCount).toBe(1);
      expect(report.totalRequired).toBe(3);
    });
  });
});
