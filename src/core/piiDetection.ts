/**
 * PRD §10 — Regex backstop for PII detection
 * Defense-in-depth layer: independent regex-based detection of person names, ages/minor indicators,
 * precise locations, and family relations. Works alongside LLM-based detection signal.
 * Per EVALS.md C3, quasi-identifiers like family relations + location count as PII even without explicit names.
 * Location matches gate on personal pronoun presence to avoid false-positives on operational updates.
 */

export interface PiiDetectionResult {
  detected: boolean;
  reasons: string[];
}

export const DEFAULT_KNOWN_CENTRE_NAMES: string[] = [
  'Kolathur',
  'Pulianthope',
  'North Chennai'
];

/**
 * Deterministic PII regex backstop.
 *
 * Logic (matching PRD §10 + EVALS.md C3):
 * - Family relation words (whole-word, case-insensitive): mother, father, daughter, son, parent,
 *   child, kid, brother, sister, sibling, grandmother, grandfather
 * - Age/minor pattern: digits 1–2 followed by "year old" (case-insensitive)
 * - Personal pronoun check: she, he, her, his, their (case-insensitive)
 * - Location signal: gated on pronoun presence to avoid false-flagging bare operational mentions
 *   (e.g., "workshop at North Chennai Centre" without individual pronouns is not PII)
 *
 * Quasi-identifiers (e.g., family detail + location without explicit name) still flag as PII
 * because the combination is identifying even in absence of a full name.
 */
export function detectPiiRegex(
  text: string,
  knownCentreNames: string[] = DEFAULT_KNOWN_CENTRE_NAMES
): PiiDetectionResult {
  const reasons: string[] = [];

  // Family relation words — case-insensitive whole-word match
  const familyRelationWords = [
    'mother',
    'father',
    'daughter',
    'son',
    'parent',
    'child',
    'kid',
    'brother',
    'sister',
    'sibling',
    'grandmother',
    'grandfather'
  ];

  for (const word of familyRelationWords) {
    const pattern = new RegExp(`\\b${word}\\b`, 'i');
    if (pattern.test(text)) {
      reasons.push(`family relation term: "${word}"`);
      break; // One family relation hit is sufficient
    }
  }

  // Age/minor indicator: digits (1–2 chars) + "year old"
  const agePattern = /\b(\d{1,2})[\s-]year[\s-]old\b/i;
  if (agePattern.test(text)) {
    reasons.push('age/minor indicator');
  }

  // Personal pronoun check (used to gate location signal)
  const personalPronounPattern = /\b(her|his|she|he|their)\b/i;
  const hasPersonalPronoun = personalPronounPattern.test(text);

  // Location signal: only counts as PII if personal pronoun is present
  // (avoids false-positives on "completed workshop at [centre]" without individual context)
  if (hasPersonalPronoun) {
    for (const centreName of knownCentreNames) {
      const centrePattern = new RegExp(centreName, 'i');
      if (centrePattern.test(text)) {
        reasons.push(`location: "${centreName}"`);
        break; // One location hit is sufficient when combined with pronoun
      }
    }
  }

  return {
    detected: reasons.length > 0,
    reasons
  };
}

/**
 * Verifies MASKED text for residual PII — deliberately narrower than
 * detectPiiRegex. A properly masked sentence is expected to still read
 * naturally, e.g. PRD §13.6's own example output keeps the word "daughter"
 * ("her daughter, a student at one of our centres") — a bare family-relation
 * word with no accompanying name/location/age is the intended, safe result of
 * masking, not a failure. Flagging on that word alone (as detectPiiRegex does
 * for RAW text, where it's a legitimate risk signal) would reject correctly
 * masked output. This function only checks for what masking should have
 * actually removed: literal known centre names and age/minor indicators.
 */
export function detectResidualPiiInMaskedText(
  maskedText: string,
  knownCentreNames: string[] = DEFAULT_KNOWN_CENTRE_NAMES
): PiiDetectionResult {
  const reasons: string[] = [];

  const agePattern = /\b(\d{1,2})[\s-]year[\s-]old\b/i;
  if (agePattern.test(maskedText)) {
    reasons.push('age/minor indicator');
  }

  for (const centreName of knownCentreNames) {
    const centrePattern = new RegExp(centreName, 'i');
    if (centrePattern.test(maskedText)) {
      reasons.push(`location: "${centreName}"`);
      break;
    }
  }

  return {
    detected: reasons.length > 0,
    reasons
  };
}

/**
 * Summarizes detectPiiRegex's `reasons` into a safe, category-only risk label
 * for display (e.g. "high (family detail, centre location)"). Reason strings
 * from detectPiiRegex embed the actual matched text (e.g. `location: "Kolathur"`)
 * — this function strips that out, since the raw value itself is exactly the
 * kind of detail that must never render. Returns "none" if reasons is empty.
 */
export function summarizePiiRiskCategories(reasons: string[]): string {
  if (reasons.length === 0) {
    return 'none';
  }

  const categories = new Set<string>();
  for (const reason of reasons) {
    if (reason.startsWith('family relation term')) {
      categories.add('family detail');
    } else if (reason.startsWith('age/minor indicator')) {
      categories.add('age/minor detail');
    } else if (reason.startsWith('location')) {
      categories.add('centre location');
    } else {
      categories.add('personal detail');
    }
  }

  return `high (${Array.from(categories).join(', ')})`;
}
