import { describe, it, expect } from 'vitest';
import {
  ExtractionItem,
  ValidatorContext,
  runValidators,
  validateJsonShape,
  validateQuoteInSource,
  validateSourceRefResolution,
  validateValueAndDate,
  validateConfidence,
  validatePiiDetection
} from '../../src/core/validators.js';

describe('Validators', () => {
  // Base context for tests
  const createContext = (overrides?: Partial<ValidatorContext>): ValidatorContext => ({
    knownRequirementKeys: [
      'workshops_completed',
      'students_served',
      'attendance_by_session',
      'beneficiary_story',
      'session_photos',
      'budget_variance',
      'program_challenges'
    ],
    sourceMaterials: [
      {
        sourceRef: 'sheet!Roster!B2',
        text: 'Unique students enrolled: 61'
      },
      {
        sourceRef: 'message_slack_123',
        text: 'Transport cost ran 18% over budget this month because two sessions moved to the Kolathur site.'
      },
      {
        sourceRef: 'message_slack_456',
        text: 'One parent shared that her daughter Meena from the Pulianthope centre now reads bus signs on her own.'
      }
    ],
    sourceDates: {
      'sheet!Roster!B2': '2026-07-10',
      'message_slack_123': '2026-07-18',
      'message_slack_456': '2026-07-22'
    },
    reportingPeriodStart: '2026-07-01',
    reportingPeriodEnd: '2026-07-31',
    ...overrides
  });

  describe('Happy path — well-formed item with exact quote, valid date, confidence 0.9', () => {
    it('should pass all validators', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: '61 unique students were served in July',
        quote_text: 'Unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        value: { n: 61, unit: 'unique_students' },
        confidence: 0.93,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = runValidators(item, context);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('Validator 1: JSON shape and requirement key check', () => {
    it('should reject unknown requirement_key', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'unknown_requirement',
        claim_text: 'Some claim',
        quote_text: 'Some quote',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateJsonShape(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown requirement_key');
    });

    it('should pass with known requirement_key', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Some quote',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateJsonShape(item, context);
      expect(result.valid).toBe(true);
    });
  });

  describe('Validator 2: quote_text appears verbatim in source (EVALS.md B3)', () => {
    it('should reject paraphrase (not exact substring)', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: '61 unique students were served',
        quote_text: 'around 61 unique students',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateQuoteInSource(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found verbatim');
    });

    it('should accept exact substring match', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: '61 unique students were served',
        quote_text: 'Unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateQuoteInSource(item, context);
      expect(result.valid).toBe(true);
    });

    it('should reject if quote is case-sensitive mismatch', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateQuoteInSource(item, context);
      expect(result.valid).toBe(false);
    });
  });

  describe('Validator 3: source_ref resolution', () => {
    it('should reject unresolvable source_ref', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Some text',
        source_ref: 'unknown_source_ref',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateSourceRefResolution(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not resolve');
    });

    it('should accept resolvable source_ref', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateSourceRefResolution(item, context);
      expect(result.valid).toBe(true);
    });
  });

  describe('Validator 4: numeric values and dates (EVALS.md B4)', () => {
    it('should reject message dated outside reporting period (June message, July period)', () => {
      const context = createContext({
        sourceMaterials: [
          ...createContext().sourceMaterials!,
          {
            sourceRef: 'message_june',
            text: 'Some event happened'
          }
        ],
        sourceDates: {
          ...createContext().sourceDates,
          'message_june': '2026-06-30'
        }
      });

      const item: ExtractionItem = {
        requirement_key: 'attendance_by_session',
        claim_text: 'Some attendance',
        quote_text: 'Some event happened',
        source_ref: 'message_june',
        value: { n: 50 },
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateValueAndDate(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('falls outside reporting period');
    });

    it('should accept message dated within reporting period', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'attendance_by_session',
        claim_text: 'Some attendance',
        quote_text: 'Transport cost ran 18% over budget this month because two sessions moved to the Kolathur site.',
        source_ref: 'message_slack_123',
        value: { n: 18, unit: 'percent' },
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateValueAndDate(item, context);
      expect(result.valid).toBe(true);
    });

    it('should accept dates on period boundaries (inclusive)', () => {
      const context = createContext();

      const itemStartDate: ExtractionItem = {
        requirement_key: 'attendance_by_session',
        claim_text: 'Some claim',
        quote_text: 'Some text',
        source_ref: 'message_slack_123',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      context.sourceDates['message_slack_123'] = '2026-07-01';
      const resultStart = validateValueAndDate(itemStartDate, context);
      expect(resultStart.valid).toBe(true);

      context.sourceDates['message_slack_123'] = '2026-07-31';
      const resultEnd = validateValueAndDate(itemStartDate, context);
      expect(resultEnd.valid).toBe(true);
    });

    it('should reject non-numeric value.n', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Some text',
        source_ref: 'sheet!Roster!B2',
        value: { n: 'not a number' },
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateValueAndDate(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not a valid number');
    });
  });

  describe('Validator 5: confidence threshold', () => {
    it('should reject confidence below 0.5', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.49,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateConfidence(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('below minimum threshold');
    });

    it('should accept confidence at exactly 0.5', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.5,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateConfidence(item, context);
      expect(result.valid).toBe(true);
    });

    it('should accept confidence above 0.5', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = validateConfidence(item, context);
      expect(result.valid).toBe(true);
    });
  });

  describe('Validator 6: PII detection routing', () => {
    it('should route pii_detected items without rejection (valid: true)', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'beneficiary_story',
        claim_text: 'One parent shared her daughter Meena reads bus signs',
        quote_text: 'One parent shared that her daughter Meena from the Pulianthope centre now reads bus signs on her own.',
        source_ref: 'message_slack_456',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: true,
        note: 'Contains child name and location'
      };

      const result = validatePiiDetection(item, context);
      expect(result.valid).toBe(true);
    });
  });

  describe('runValidators — combined test', () => {
    it('should fail at first validator that rejects', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'unknown_key',
        claim_text: 'Some claim',
        quote_text: 'Unique students enrolled: 61',
        source_ref: 'sheet!Roster!B2',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = runValidators(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown requirement_key');
    });

    it('should pass PII-detected item through (routed by caller)', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'beneficiary_story',
        claim_text: 'Story with PII',
        quote_text: 'One parent shared that her daughter Meena from the Pulianthope centre now reads bus signs on her own.',
        source_ref: 'message_slack_456',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: true,
        note: 'Contains PII'
      };

      const result = runValidators(item, context);
      expect(result.valid).toBe(true);
    });

    it('should fail on source_ref resolution when provided with invalid ref', () => {
      const context = createContext();
      const item: ExtractionItem = {
        requirement_key: 'students_served',
        claim_text: 'Some claim',
        quote_text: 'Some text',
        source_ref: 'nonexistent_source',
        confidence: 0.9,
        unit_ambiguous: false,
        pii_detected: false,
        note: ''
      };

      const result = runValidators(item, context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not resolve');
    });
  });
});
