import { describe, it, expect } from 'vitest';
import {
  ConflictCandidate,
  ConflictCheckResult,
  detectValueMismatch
} from '../../src/core/conflictDetection.js';

describe('Conflict Detection (PRD §9.5)', () => {
  describe('B2: Slack 54 vs Sheet 49 — EVALS.md B2 landmine', () => {
    it('should detect conflict when Slack value (54) differs from Sheet value (49)', () => {
      const candidate: ConflictCandidate = {
        slackValue: 54,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: 49,
        sheetSourceRef: 'Attendance!B5'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(true);
      expect(result.note).toContain('54');
      expect(result.note).toContain('49');
      expect(result.note).toContain(candidate.slackSourceRef);
      expect(result.note).toContain(candidate.sheetSourceRef);
    });
  });

  describe('Matching case: both values equal (49 and 49)', () => {
    it('should return no conflict when values are exactly equal', () => {
      const candidate: ConflictCandidate = {
        slackValue: 49,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: 49,
        sheetSourceRef: 'Attendance!B5'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(false);
      expect(result.note).toBe('');
    });
  });

  describe('Edge case: zero values', () => {
    it('should return no conflict when both values are zero', () => {
      const candidate: ConflictCandidate = {
        slackValue: 0,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: 0,
        sheetSourceRef: 'Summary!A1'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(false);
      expect(result.note).toBe('');
    });

    it('should detect conflict when Slack is zero but Sheet is non-zero', () => {
      const candidate: ConflictCandidate = {
        slackValue: 0,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: 1,
        sheetSourceRef: 'Summary!A1'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(true);
      expect(result.note).toContain('0');
      expect(result.note).toContain('1');
    });
  });

  describe('Edge case: negative values', () => {
    it('should return no conflict when both values are negative and equal', () => {
      const candidate: ConflictCandidate = {
        slackValue: -5,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: -5,
        sheetSourceRef: 'Adjustments!B2'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(false);
      expect(result.note).toBe('');
    });

    it('should detect conflict between negative and positive values', () => {
      const candidate: ConflictCandidate = {
        slackValue: -10,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: 10,
        sheetSourceRef: 'Adjustments!B2'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(true);
      expect(result.note).toContain('-10');
      expect(result.note).toContain('10');
    });
  });

  describe('Exact integer equality enforcement', () => {
    it('should detect conflict for any numeric inequality (100 vs 100.001 as integers is 100 vs 100)', () => {
      // If both are stored as integers, even minute differences show conflicts
      const candidate: ConflictCandidate = {
        slackValue: 100,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: 101,
        sheetSourceRef: 'Count!C3'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(true);
      expect(result.note).toContain('100');
      expect(result.note).toContain('101');
    });

    it('should return no conflict for large equal values', () => {
      const candidate: ConflictCandidate = {
        slackValue: 9999,
        slackSourceRef: 'https://slack.com/archives/C123/p456',
        sheetValue: 9999,
        sheetSourceRef: 'Summary!B99'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(false);
      expect(result.note).toBe('');
    });
  });

  describe('Note format validation', () => {
    it('should include explanatory text only when conflict exists', () => {
      const candidate: ConflictCandidate = {
        slackValue: 50,
        slackSourceRef: 'source_a',
        sheetValue: 50,
        sheetSourceRef: 'source_b'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(false);
      expect(result.note).toBe(''); // Empty string when no conflict
    });

    it('should include all four data points in conflict note', () => {
      const candidate: ConflictCandidate = {
        slackValue: 432,
        slackSourceRef: 'https://slack.com/archives/channel/ts',
        sheetValue: 61,
        sheetSourceRef: 'Roster!B2'
      };

      const result = detectValueMismatch(candidate);

      expect(result.hasConflict).toBe(true);
      // Verify all parts are present
      expect(result.note).toContain('432');
      expect(result.note).toContain('61');
      expect(result.note).toContain('https://slack.com/archives/channel/ts');
      expect(result.note).toContain('Roster!B2');
    });
  });
});
