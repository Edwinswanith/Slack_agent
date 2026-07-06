import { describe, it, expect } from "vitest";
import { resolveGrantIntent } from "../../src/slack/assistant.js";

describe("resolveGrantIntent", () => {
  it("matches the exact Bright Futures phrase", () => {
    expect(resolveGrantIntent("Prepare the Bright Futures July report")).toBe("bright_futures");
  });

  it("is case-insensitive", () => {
    expect(resolveGrantIntent("PREPARE THE BRIGHT FUTURES JULY REPORT")).toBe("bright_futures");
    expect(resolveGrantIntent("bright futures report")).toBe("bright_futures");
  });

  it("matches Bright Futures combined with report or scan in any phrasing", () => {
    expect(resolveGrantIntent("can you scan bright futures for me")).toBe("bright_futures");
    expect(resolveGrantIntent("bright-futures report please")).toBe("bright_futures");
  });

  it("EVALS.md F1 — '/grantproof scan acme' (command text 'scan acme') resolves to unknown_grant", () => {
    expect(resolveGrantIntent("scan acme")).toBe("unknown_grant");
  });

  it("resolves an unrecognized grant name in report phrasing to unknown_grant", () => {
    expect(resolveGrantIntent("prepare the acme foundation report")).toBe("unknown_grant");
  });

  it("returns not_a_grant_request for empty input", () => {
    expect(resolveGrantIntent("")).toBe("not_a_grant_request");
  });

  it("returns not_a_grant_request for whitespace-only input", () => {
    expect(resolveGrantIntent("   \n\t  ")).toBe("not_a_grant_request");
  });

  it("returns not_a_grant_request for emoji-only input", () => {
    expect(resolveGrantIntent("🎉🎉🎉")).toBe("not_a_grant_request");
  });

  it("returns not_a_grant_request for plain gibberish", () => {
    expect(resolveGrantIntent("asdkfjhaslkdfjqwoeiruqwoiuer")).toBe("not_a_grant_request");
  });

  it("returns not_a_grant_request for 'scan' with no target", () => {
    expect(resolveGrantIntent("scan")).toBe("not_a_grant_request");
  });

  it("does not throw on a very long garbage string", () => {
    const garbage = "x".repeat(5000);
    expect(() => resolveGrantIntent(garbage)).not.toThrow();
    expect(resolveGrantIntent(garbage)).toBe("not_a_grant_request");
  });
});
