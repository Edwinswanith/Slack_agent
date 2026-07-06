export function detectDirectCommandRefusal(text: string): string | null {
  const lower = text.toLowerCase().trim();

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
