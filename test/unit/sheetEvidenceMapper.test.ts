import { describe, it, expect } from 'vitest';
import {
  extractSessionNumber,
  extractNumericValue,
  mapSessionAttendanceCandidates,
  mapWorkshopsCompletedCandidate,
  mapStudentsServedCandidate,
} from '../../src/core/sheetEvidenceMapper.js';
import type { AttendanceTrackerSnapshot } from '../../src/google/sheets.js';

describe('extractSessionNumber', () => {
  it('parses "Workshop 8" from the real B2 demo claim text', () => {
    expect(extractSessionNumber('Workshop 8 was completed with an attendance of 54 students.')).toBe(8);
  });

  it('parses "Session 8" case-insensitively', () => {
    expect(extractSessionNumber('session 8 had good turnout')).toBe(8);
  });

  it('returns null when no session/workshop reference is present', () => {
    expect(extractSessionNumber('Transport costs exceeded the budget by 18%.')).toBeNull();
  });
});

describe('extractNumericValue', () => {
  it('prefers value_json.n when present', () => {
    expect(extractNumericValue('Workshop 8 had 999 students', JSON.stringify({ n: 49 }))).toBe(49);
  });

  it('falls back to parsing claim_text when value_json is null (the real B2 demo row)', () => {
    expect(extractNumericValue('Workshop 8 was completed with an attendance of 54 students.', null)).toBe(54);
  });

  it('falls back to claim_text when value_json is malformed JSON', () => {
    expect(extractNumericValue('54 students attended', 'not-json')).toBe(54);
  });

  it('returns null when no number is present anywhere', () => {
    expect(extractNumericValue('No numbers here', null)).toBeNull();
  });
});

describe('Sheet evidence mapping (PRD §14.2 demo data)', () => {
  const snapshot: AttendanceTrackerSnapshot = {
    sessionCounts: [51, 55, 49, 58, 52, 57, 61, 49],
    sessionCellRefs: ['Sessions!B2', 'Sessions!B3', 'Sessions!B4', 'Sessions!B5', 'Sessions!B6', 'Sessions!B7', 'Sessions!B8', 'Sessions!B9'],
    sessionSum: 432,
    workshopCount: 8,
    workshopCountCellRef: 'Sessions!B10',
    uniqueStudents: 61,
    uniqueStudentsCellRef: 'Roster!B2',
    summaryStudentsServedValue: 432,
    summaryStudentsServedCellRef: 'Summary!B4',
  };

  it('maps 8 per-session candidates with correct session numbers and values', () => {
    const candidates = mapSessionAttendanceCandidates(snapshot);
    expect(candidates).toHaveLength(8);
    expect(candidates[7].sessionNumber).toBe(8);
    expect(candidates[7].value.n).toBe(49);
    expect(candidates[7].sourceRef).toBe('Sessions!B9');
  });

  it('maps the workshops-completed candidate', () => {
    const candidate = mapWorkshopsCompletedCandidate(snapshot);
    expect(candidate.value.n).toBe(8);
    expect(candidate.sourceRef).toBe('Sessions!B10');
  });

  it('maps the students-served candidate to the Summary value (the 432 landmine)', () => {
    const candidate = mapStudentsServedCandidate(snapshot);
    expect(candidate.value.n).toBe(432);
    expect(candidate.sourceRef).toBe('Summary!B4');
  });
});
