import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.GOOGLE_API_KEY = "fake-api-key";

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function (this: unknown) {
    Object.assign(this as object, {
      models: { generateContent: mockGenerateContent },
    });
  }),
}));

import { extractEvidence, ExtractionError } from "../../src/llm/gemini.js";

function mockResponseWithItems(items: unknown[]) {
  mockGenerateContent.mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify({ items }) }],
        },
      },
    ],
  });
}

describe("extractEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts note: null and normalizes it to an empty string (live Railway regression)", async () => {
    mockResponseWithItems([
      {
        requirement_key: "attendance_by_session",
        claim_text: "A total of 54 students attended Workshop 8.",
        quote_text: "Workshop 8 done. 54 students attended",
        source_ref: "https://example.slack.com/archives/C123/p123",
        confidence: 0.95,
        unit_ambiguous: false,
        pii_detected: false,
        note: null,
      },
    ]);

    const result = await extractEvidence([{ sourceRef: "s1", text: "t1" }], ["attendance_by_session"]);

    expect(result).toHaveLength(1);
    expect(result[0].note).toBe("");
  });

  it("still rejects an item missing a required string field", async () => {
    mockResponseWithItems([
      {
        requirement_key: "attendance_by_session",
        // claim_text missing entirely
        quote_text: "Workshop 8 done. 54 students attended",
        source_ref: "https://example.slack.com/archives/C123/p123",
        confidence: 0.95,
        unit_ambiguous: false,
        pii_detected: false,
        note: "some note",
      },
    ]);

    await expect(
      extractEvidence([{ sourceRef: "s1", text: "t1" }], ["attendance_by_session"])
    ).rejects.toThrow(ExtractionError);
  });

  it("passes through a well-formed note string unchanged", async () => {
    mockResponseWithItems([
      {
        requirement_key: "attendance_by_session",
        claim_text: "A total of 54 students attended Workshop 8.",
        quote_text: "Workshop 8 done. 54 students attended",
        source_ref: "https://example.slack.com/archives/C123/p123",
        confidence: 0.95,
        unit_ambiguous: false,
        pii_detected: false,
        note: "flagged for review",
      },
    ]);

    const result = await extractEvidence([{ sourceRef: "s1", text: "t1" }], ["attendance_by_session"]);

    expect(result[0].note).toBe("flagged for review");
  });

  it("rejects an item with a null confidence field (security sweep finding)", async () => {
    mockResponseWithItems([
      {
        requirement_key: "attendance_by_session",
        claim_text: "A total of 54 students attended Workshop 8.",
        quote_text: "Workshop 8 done. 54 students attended",
        source_ref: "https://example.slack.com/archives/C123/p123",
        confidence: null,
        unit_ambiguous: false,
        pii_detected: false,
        note: "some note",
      },
    ]);

    await expect(
      extractEvidence([{ sourceRef: "s1", text: "t1" }], ["attendance_by_session"])
    ).rejects.toThrow(ExtractionError);
  });

  it("returns an empty array when Gemini reports no qualifying items", async () => {
    mockResponseWithItems([]);

    const result = await extractEvidence([{ sourceRef: "s1", text: "t1" }], ["attendance_by_session"]);

    expect(result).toEqual([]);
  });
});
