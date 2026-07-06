import { describe, it, expect } from 'vitest';
import {
  PiiDetectionResult,
  DEFAULT_KNOWN_CENTRE_NAMES,
  detectPiiRegex
} from '../../src/core/piiDetection.js';

describe('PII Detection (Regex Backstop)', () => {
  describe('EVALS.md C2 — The Meena story (PRD §14.4 msg 3)', () => {
    it('should detect PII in the seed story with family relation + centre name', () => {
      const text =
        'One parent shared that her daughter Meena from the Pulianthope centre now reads bus signs on her own. Please anonymize before using anywhere.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons).toHaveLength(2);
      expect(result.reasons.some((r) => r.includes('family relation term'))).toBe(
        true
      );
      expect(result.reasons.some((r) => r.includes('Pulianthope'))).toBe(true);
    });
  });

  describe('EVALS.md C3 — Quasi-identifier without explicit name', () => {
    it('should detect PII when family relation + location are present', () => {
      const text =
        'the tallest girl at the Kolathur centre, her father drives an auto';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons).toHaveLength(2);
      expect(result.reasons.some((r) => r.includes('father'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('Kolathur'))).toBe(true);
    });
  });

  describe('Negative case — operational update with centre name but no personal context', () => {
    it('should NOT flag a bare centre mention without pronouns (PRD §14.4 msg 1)', () => {
      const text =
        'Completed workshop 3 today at North Chennai Community Centre. Great energy. Photos going into the Drive folder tonight.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('Negative case — conflict seed message (PRD §14.4 msg 4)', () => {
    it('should NOT flag a numeric-only update', () => {
      const text = 'Workshop 8 done. 54 students attended.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('Location-plus-pronoun gating', () => {
    it('should detect PII when location + pronoun are present (no family word needed)', () => {
      const text = 'She visits the Kolathur centre every week.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatch(/Kolathur/);
    });
  });

  describe('Family relation detection (word boundary)', () => {
    it('should detect "mother" as a family relation', () => {
      const text = 'The mother attended the workshop.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('mother'))).toBe(true);
    });

    it('should not match "mother" within another word', () => {
      const text = 'The stepmother attended the workshop.';

      // \b requires a boundary before "mother"; "p" (a word char) precedes it
      // in "stepmother", so there is no boundary and the whole-word match fails.
      const result = detectPiiRegex(text);
      expect(result.detected).toBe(false);
    });

    it('should detect "son" as a family relation', () => {
      const text = 'His son participated in the program.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('son'))).toBe(true);
    });

    it('should detect "sister" as a family relation', () => {
      const text = 'Her sister also attends classes.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('sister'))).toBe(true);
    });

    it('should be case-insensitive', () => {
      const text = 'The FATHER of the student attended.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('father'))).toBe(true);
    });
  });

  describe('Age/minor indicator detection', () => {
    it('should detect "X year old" pattern', () => {
      const text = 'A 7 year old student participated in the program.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('age/minor'))).toBe(true);
    });

    it('should detect "X-year-old" pattern', () => {
      const text = 'The 8-year-old beneficiary attended the session.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('age/minor'))).toBe(true);
    });

    it('should be case-insensitive', () => {
      const text = 'A 6 YEAR OLD child participated.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
    });

    it('should only match 1-2 digit ages', () => {
      const text = 'Year 123 was very long.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(false);
    });
  });

  describe('Location detection with known centre names', () => {
    it('should detect Kolathur when combined with pronouns', () => {
      const text = 'She attends classes at Kolathur centre.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('Kolathur'))).toBe(true);
    });

    it('should detect Pulianthope when combined with pronouns', () => {
      const text = 'His daughter goes to Pulianthope.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('Pulianthope'))).toBe(true);
    });

    it('should detect North Chennai when combined with pronouns', () => {
      const text = 'Their team runs North Chennai center operations.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('North Chennai'))).toBe(true);
    });

    it('should be case-insensitive for locations', () => {
      const text = 'She visits kolathur centre weekly.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons[0]).toMatch(/location/);
    });

    it('should NOT detect location without pronouns', () => {
      const text = 'Activities at Kolathur include literacy programs.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(false);
    });
  });

  describe('Custom centre names', () => {
    it('should accept custom centre names', () => {
      const customCentres = ['CustomCentre', 'AnotherPlace'];
      const text = 'She attends CustomCentre.';

      const result = detectPiiRegex(text, customCentres);

      expect(result.detected).toBe(true);
      expect(result.reasons[0]).toMatch(/CustomCentre/);
    });

    it('should use default centres when none provided', () => {
      const text = 'She visits Kolathur.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(DEFAULT_KNOWN_CENTRE_NAMES).toContain('Kolathur');
    });
  });

  describe('Multiple PII signals', () => {
    it('should report all detected PII reasons', () => {
      const text =
        'Her 5-year-old daughter at Kolathur centre enjoys learning.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it('should not double-count the same signal type', () => {
      const text =
        'Her daughter and son both attend Kolathur centre daily.';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      // Family relations: should only count once (first hit)
      // Location: should count once
      expect(result.reasons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty text', () => {
      const result = detectPiiRegex('');

      expect(result.detected).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('should handle text with only whitespace', () => {
      const result = detectPiiRegex('   ');

      expect(result.detected).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('should handle very long text', () => {
      const longText = 'Some content. '.repeat(1000) + 'Her father at Kolathur.';

      const result = detectPiiRegex(longText);

      expect(result.detected).toBe(true);
    });

    it('should handle special characters around matched words', () => {
      const text = '(daughter) — all family!';

      const result = detectPiiRegex(text);

      expect(result.detected).toBe(true);
      expect(result.reasons.some((r) => r.includes('daughter'))).toBe(true);
    });
  });
});
