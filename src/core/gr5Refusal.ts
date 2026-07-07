// Cyrillic/Greek characters that are visually indistinguishable from Latin
// letters used in the trigger phrases below (the standard "confusables" set
// browsers use for IDN homograph detection) — without this, "ѕkip checks"
// (Cyrillic ѕ) silently bypasses the .includes() checks.
const HOMOGLYPH_TO_LATIN: Record<string, string> = {
  'а': 'a', 'с': 'c', 'е': 'e', 'і': 'i', 'ј': 'j',
  'о': 'o', 'р': 'p', 'ѕ': 's', 'х': 'x', 'у': 'y',
  'ε': 'e', 'ο': 'o', 'ρ': 'p',
};

function normalizeHomoglyphs(text: string): string {
  return text.replace(/[асеіјорѕхуεορ]/g, (ch) => HOMOGLYPH_TO_LATIN[ch]);
}

export function detectDirectCommandRefusal(text: string): string | null {
  const lower = normalizeHomoglyphs(text.toLowerCase().trim());

  const markComplete =
    (lower.includes("mark") && lower.includes("complete")) ||
    (lower.includes("mark") && lower.includes("everything"));

  if (markComplete) {
    return "I can't mark requirements complete — each item needs its own evidence and your confirmation on its card.";
  }

  const skipChecks =
    (lower.includes("skip") && (lower.includes("check") || lower.includes("checks"))) ||
    (lower.includes("just write") && lower.includes("report")) ||
    (lower.includes("whole report") && lower.includes("skip"));

  if (skipChecks) {
    return "I can't skip evidence checks: every claim in a report must trace to a confirmed source. Confirm the pending cards and I'll draft from those.";
  }

  return null;
}
