import { describe, it, expect } from 'vitest';
import {
  checkUnitSanity,
  UnitSanityInput
} from '../../src/core/unitSanity.js';

describe('Unit Sanity Check', () => {
  describe('B1: The 432 trap (determinism test — 10/10 runs)', () => {
    /**
     * EVALS.md B1: Summary = 432, which equals the sum of per-session attendance
     * [51, 55, 49, 58, 52, 57, 61, 49], and the Roster shows 61 unique students.
     * Unit suspicion must fire on every run — 10/10, not 9/10.
     */
    it('should consistently flag 432 as suspicious across 10 iterations', () => {
      const input: UnitSanityInput = {
        candidateValue: 432,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [51, 55, 49, 58, 52, 57, 61, 49],
        uniqueCount: 61,
        uniqueCountCellRef: 'Roster!B2'
      };

      // Run 10 times to prove determinism.
      for (let i = 0; i < 10; i++) {
        const result = checkUnitSanity(input);
        expect(result.suspicious).toBe(true);
        expect(result.sessionSum).toBe(432);
        expect(result.note).toContain('sum of per-session attendance');
        expect(result.note).toContain('61');
      }
    });
  });

  describe('B5: FR-001 holdout (within-5%-but-not-equal must NOT fire)', () => {
    /**
     * EVALS.md B5: Perturb W8 (the 8th session count) from 49 to 52,
     * making the sum 435 instead of 432. Now Summary (432) is within 0.7% of sum (435),
     * but NOT exactly equal. Unit suspicion must NOT fire.
     * This is the critical test proving we did NOT implement the buggy "within 5%" rule.
     */
    it('should NOT flag 432 as suspicious when sum is 435 (within 0.7% but not equal)', () => {
      const input: UnitSanityInput = {
        candidateValue: 432,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [51, 55, 49, 58, 52, 57, 61, 52], // W8: 49 → 52
        uniqueCount: 61,
        uniqueCountCellRef: 'Roster!B2'
      };

      const result = checkUnitSanity(input);
      expect(result.suspicious).toBe(false);
      expect(result.sessionSum).toBe(435);
      expect(result.note).toBe(''); // No note when not suspicious
    });
  });

  describe('Edge case: unique count equals candidate value (not a meaningful distinction)', () => {
    /**
     * If uniqueCount somehow equals candidateValue, the distinction between
     * "cumulative" and "unique" is meaningless — they're the same number.
     * In this case, we should NOT fire the suspicion, since GR-1 requires
     * "a distinct roster/unique count exists".
     */
    it('should NOT flag as suspicious when uniqueCount equals candidateValue', () => {
      const input: UnitSanityInput = {
        candidateValue: 432,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [51, 55, 49, 58, 52, 57, 61, 49],
        uniqueCount: 432, // Same as candidateValue — no distinction
        uniqueCountCellRef: 'Roster!B2'
      };

      const result = checkUnitSanity(input);
      expect(result.suspicious).toBe(false);
      expect(result.note).toBe('');
    });
  });

  describe('Normal case: no sum-equality at all', () => {
    /**
     * A typical benign case where the candidate value does not match the
     * sum of per-session counts. Should not be suspicious.
     */
    it('should NOT flag as suspicious when candidate does not equal sum', () => {
      const input: UnitSanityInput = {
        candidateValue: 100,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [10, 15, 20, 25, 30], // sum = 100... wait, let me fix this
        uniqueCount: 80,
        uniqueCountCellRef: 'Roster!B2'
      };

      // Sum = 10 + 15 + 20 + 25 + 30 = 100, which equals candidateValue.
      // Let me use different numbers.
      const input2: UnitSanityInput = {
        candidateValue: 85,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [10, 15, 20, 25, 30], // sum = 100
        uniqueCount: 80,
        uniqueCountCellRef: 'Roster!B2'
      };

      const result = checkUnitSanity(input2);
      expect(result.suspicious).toBe(false);
      expect(result.sessionSum).toBe(100);
      expect(result.note).toBe('');
    });
  });

  describe('Explanation text when suspicious', () => {
    /**
     * Verify that the note text is well-formed and references the unique count
     * when a suspicion fires.
     */
    it('should include explanatory note referencing unique count when suspicious', () => {
      const input: UnitSanityInput = {
        candidateValue: 200,
        candidateValueCellRef: 'Summary!B5',
        perSessionCounts: [25, 35, 40, 50, 50],
        uniqueCount: 45,
        uniqueCountCellRef: 'Roster!B3'
      };

      const result = checkUnitSanity(input);
      expect(result.suspicious).toBe(true);
      expect(result.sessionSum).toBe(200);
      expect(result.note).toContain('This figure equals the sum of per-session attendance');
      expect(result.note).toContain('200');
      expect(result.note).toContain('45');
      expect(result.note).toContain('cumulative attendance');
    });
  });

  describe('Zero and edge values', () => {
    it('should handle zero candidate value', () => {
      const input: UnitSanityInput = {
        candidateValue: 0,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [0, 0, 0],
        uniqueCount: 5,
        uniqueCountCellRef: 'Roster!B2'
      };

      const result = checkUnitSanity(input);
      expect(result.suspicious).toBe(true);
      expect(result.sessionSum).toBe(0);
    });

    it('should handle empty per-session counts', () => {
      const input: UnitSanityInput = {
        candidateValue: 0,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [],
        uniqueCount: 5,
        uniqueCountCellRef: 'Roster!B2'
      };

      const result = checkUnitSanity(input);
      expect(result.suspicious).toBe(true);
      expect(result.sessionSum).toBe(0);
    });

    it('should handle single session', () => {
      const input: UnitSanityInput = {
        candidateValue: 42,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [42],
        uniqueCount: 40,
        uniqueCountCellRef: 'Roster!B2'
      };

      const result = checkUnitSanity(input);
      expect(result.suspicious).toBe(true);
      expect(result.sessionSum).toBe(42);
    });
  });

  describe('Large numbers', () => {
    it('should handle large candidate values', () => {
      const input: UnitSanityInput = {
        candidateValue: 50000,
        candidateValueCellRef: 'Summary!B4',
        perSessionCounts: [5000, 6000, 7000, 8000, 9000, 10000, 5000],
        uniqueCount: 4000,
        uniqueCountCellRef: 'Roster!B2'
      };

      const result = checkUnitSanity(input);
      expect(result.suspicious).toBe(true);
      expect(result.sessionSum).toBe(50000);
    });
  });
});
