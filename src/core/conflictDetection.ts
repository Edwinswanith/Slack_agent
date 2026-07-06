/**
 * Conflict Detection Module (PRD §9.5)
 *
 * For each numeric requirement, compare Slack-sourced values against Sheet values.
 * Integers compare exactly. On mismatch, open a value_mismatch conflict and mark
 * both evidence rows conflicted until a human resolves.
 *
 * This module provides pure functions with no I/O.
 */

/**
 * Candidate pair of values from different sources (Slack vs Sheet)
 * to be checked for conflicts.
 */
export interface ConflictCandidate {
  slackValue: number;
  slackSourceRef: string; // Slack permalink or similar source reference
  sheetValue: number;
  sheetSourceRef: string; // e.g. "Sessions!B9"
}

/**
 * Result of a conflict check.
 * When hasConflict is true, note explains the mismatch with both values and source refs.
 */
export interface ConflictCheckResult {
  hasConflict: boolean;
  note: string; // only meaningful when hasConflict=true
}

/**
 * Detects value mismatches between Slack and Sheet evidence.
 *
 * Logic: Uses EXACT integer equality (no tolerance, no rounding, no percentage band).
 * If slackValue !== sheetValue, a conflict is detected.
 *
 * @param input A candidate pair from different sources
 * @returns A conflict check result with hasConflict boolean and explanatory note
 *
 * @example
 * const candidate: ConflictCandidate = {
 *   slackValue: 54,
 *   slackSourceRef: 'https://slack.com/archives/C123/p456',
 *   sheetValue: 49,
 *   sheetSourceRef: 'Attendance!B5'
 * };
 * const result = detectValueMismatch(candidate);
 * // result.hasConflict === true
 * // result.note contains explanation of the mismatch
 */
export function detectValueMismatch(input: ConflictCandidate): ConflictCheckResult {
  // Exact integer comparison: no tolerance, no rounding
  const hasConflict = input.slackValue !== input.sheetValue;

  if (hasConflict) {
    const note = `Value mismatch: Slack reported ${input.slackValue} (${input.slackSourceRef}) but Sheet shows ${input.sheetValue} (${input.sheetSourceRef}). Requires human resolution.`;
    return { hasConflict: true, note };
  }

  return { hasConflict: false, note: '' };
}
