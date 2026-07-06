/**
 * Maps a Google Sheets attendance-tracker snapshot into evidence candidates
 * (pure logic, no I/O). Sheet numbers must flow through the same evidence
 * table as Slack numbers so unit-sanity (§9.4) and conflict detection (§9.5)
 * — both of which compare "Sheet values" against "Slack-sourced values" —
 * have real rows to compare, not just display-only numbers.
 */

import type { AttendanceTrackerSnapshot } from '../google/sheets.js';

export interface SheetEvidenceCandidate {
  sourceRef: string;
  claimText: string;
  quoteText: string;
  value: { n: number };
  sessionNumber?: number; // set only for per-session attendance candidates
}

export function mapWorkshopsCompletedCandidate(snapshot: AttendanceTrackerSnapshot): SheetEvidenceCandidate {
  return {
    sourceRef: snapshot.workshopCountCellRef,
    claimText: `${snapshot.workshopCount} sessions were conducted in July.`,
    quoteText: String(snapshot.workshopCount),
    value: { n: snapshot.workshopCount }
  };
}

export function mapStudentsServedCandidate(snapshot: AttendanceTrackerSnapshot): SheetEvidenceCandidate {
  return {
    sourceRef: snapshot.summaryStudentsServedCellRef,
    claimText: `${snapshot.summaryStudentsServedValue} students were served in July.`,
    quoteText: String(snapshot.summaryStudentsServedValue),
    value: { n: snapshot.summaryStudentsServedValue }
  };
}

export function mapSessionAttendanceCandidates(snapshot: AttendanceTrackerSnapshot): SheetEvidenceCandidate[] {
  return snapshot.sessionCounts.map((count, index) => {
    const sessionNumber = index + 1;
    return {
      sourceRef: snapshot.sessionCellRefs[index],
      claimText: `Workshop ${sessionNumber} had ${count} students in attendance (Sheet).`,
      quoteText: String(count),
      value: { n: count },
      sessionNumber
    };
  });
}

/**
 * Parses a "Workshop N" / "Session N" reference out of free text
 * (a Slack claim_text or quote_text). Returns null if no such reference is found.
 */
export function extractSessionNumber(text: string): number | null {
  const match = text.match(/\b(?:workshop|session)\s+(\d+)\b/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Extracts a numeric value from an evidence row for comparison purposes.
 * Prefers value_json.n (populated when the extraction engine reports it);
 * falls back to the first integer literal found in claim_text, since the
 * extraction contract does not currently require `value` on every item and
 * real extracted rows can have a null value_json despite carrying an obvious
 * number in their claim text (e.g. "...an attendance of 54 students.").
 */
export function extractNumericValue(claimText: string, valueJson: string | null): number | null {
  if (valueJson) {
    try {
      const parsed = JSON.parse(valueJson) as { n?: unknown };
      if (typeof parsed.n === 'number' && !Number.isNaN(parsed.n)) {
        return parsed.n;
      }
    } catch {
      // fall through to claim_text parsing
    }
  }

  // Strip any "Workshop N" / "Session N" reference first — otherwise the
  // session index (e.g. the "8" in "Workshop 8 ... 54 students") would be
  // picked up as the value instead of the actual count.
  const withoutSessionRef = claimText.replace(/\b(?:workshop|session)\s+\d+\b/gi, '');
  const match = withoutSessionRef.match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  return Number.isNaN(n) ? null : n;
}
