/**
 * Unit-Sanity Check: GrantProof's hero feature for detecting when a headline count
 * is actually cumulative attendance mislabeled as unique individuals served.
 *
 * Rule (GR-1, EVALS.md): unit_suspicion fires iff the candidate value EXACTLY EQUALS
 * (integer equality) the sum of per-session counts AND a distinct roster/unique count
 * exists elsewhere in the sources.
 *
 * This supersedes the PRD's "within 5%" pseudocode (see FR-001).
 */

export interface UnitSanityInput {
  /**
   * The headline value to check, e.g. "Students served" from the Summary tab.
   * Example: 432
   */
  candidateValue: number;

  /**
   * Cell reference for the candidate value, e.g. "Summary!B4".
   * Used in reporting and logging.
   */
  candidateValueCellRef: string;

  /**
   * Per-session counts, e.g. [51, 55, 49, 58, 52, 57, 61, 49].
   * These should be the individual attendance figures from the tracking sheet.
   */
  perSessionCounts: number[];

  /**
   * The unique/distinct count from elsewhere in the sources, e.g. 61 (from Roster tab).
   * This represents the actual number of distinct individuals.
   */
  uniqueCount: number;

  /**
   * Cell reference for the unique count, e.g. "Roster!B2".
   * Used in the note when suspicious.
   */
  uniqueCountCellRef: string;
}

export interface UnitSanityResult {
  /**
   * True if the unit suspicion fires: candidateValue exactly equals the sum of
   * perSessionCounts AND uniqueCount is distinct from candidateValue.
   */
  suspicious: boolean;

  /**
   * The sum of perSessionCounts. Always computed and returned.
   */
  sessionSum: number;

  /**
   * A human-readable explanation. Only meaningful when suspicious=true.
   * When suspicious, explains the discrepancy and references the unique count.
   */
  note: string;
}

/**
 * Check if a candidate value (e.g. "Students served") is suspicious as a mislabel
 * of cumulative attendance as unique individuals.
 *
 * @param input The input data: candidate value, per-session counts, unique count, and cell refs.
 * @returns A result object with the `suspicious` flag, sessionSum, and explanatory note.
 */
export function checkUnitSanity(input: UnitSanityInput): UnitSanityResult {
  // Calculate the sum of per-session counts.
  const sessionSum = input.perSessionCounts.reduce((sum, count) => sum + count, 0);

  // Determine if suspicion fires:
  // - candidateValue MUST exactly equal sessionSum (integer equality)
  // - uniqueCount MUST be different from candidateValue (otherwise no distinction)
  const suspicious =
    input.candidateValue === sessionSum &&
    input.uniqueCount !== input.candidateValue;

  // Build the explanatory note.
  let note = '';
  if (suspicious) {
    note =
      `This figure equals the sum of per-session attendance (${sessionSum}). ` +
      `It may be cumulative attendance, not unique individuals. ` +
      `Roster shows ${input.uniqueCount} unique students.`;
  }

  return {
    suspicious,
    sessionSum,
    note
  };
}
