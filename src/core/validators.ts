/**
 * PRD §9.3 — Post-extraction validators (pure logic, no I/O)
 * All validators are pure functions: (item, context) => { valid: boolean, reason?: string }
 */

export interface ExtractionItem {
  requirement_key: string;
  claim_text: string;
  quote_text: string;
  source_ref: string;
  value?: Record<string, unknown>;
  confidence: number;
  unit_ambiguous: boolean;
  pii_detected: boolean;
  note: string;
}

export interface ValidatorContext {
  knownRequirementKeys: string[];
  sourceMaterials: Array<{ sourceRef: string; text: string }>;
  sourceDates: Record<string, string>; // sourceRef -> ISO date string
  reportingPeriodStart: string; // ISO date string
  reportingPeriodEnd: string; // ISO date string
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validator 1: JSON shape and requirement key check
 * requirement_key must be one of the known requirement keys
 */
export function validateJsonShape(
  item: ExtractionItem,
  context: ValidatorContext
): ValidationResult {
  if (!context.knownRequirementKeys.includes(item.requirement_key)) {
    return {
      valid: false,
      reason: `Unknown requirement_key: ${item.requirement_key}`
    };
  }
  return { valid: true };
}

/**
 * Validator 3: source_ref resolves to an actual source material
 * The source must exist in the sourceMaterials array
 * Run this BEFORE quote check so unresolvable refs are caught first
 */
export function validateSourceRefResolution(
  item: ExtractionItem,
  context: ValidatorContext
): ValidationResult {
  const resolved = context.sourceMaterials.find(
    (s) => s.sourceRef === item.source_ref
  );

  if (!resolved) {
    return {
      valid: false,
      reason: `source_ref does not resolve: ${item.source_ref}`
    };
  }

  return { valid: true };
}

/**
 * Validator 2: quote_text appears verbatim in the referenced source
 * Case-sensitive exact substring match
 * Assumes source_ref has already been validated (run validator 3 first)
 */
export function validateQuoteInSource(
  item: ExtractionItem,
  context: ValidatorContext
): ValidationResult {
  const sourceMaterial = context.sourceMaterials.find(
    (s) => s.sourceRef === item.source_ref
  );

  if (!sourceMaterial) {
    // This should not happen if validator 3 ran first, but be defensive
    return {
      valid: false,
      reason: `source_ref does not resolve: ${item.source_ref}`
    };
  }

  if (!sourceMaterial.text.includes(item.quote_text)) {
    return {
      valid: false,
      reason: `quote_text not found verbatim in source (${item.source_ref})`
    };
  }

  return { valid: true };
}

/**
 * Validator 4: numeric values parse, and dates fall within reporting period
 * If value.n exists and is numeric, check the value parses.
 * Check the source date falls within [reportingPeriodStart, reportingPeriodEnd] inclusive.
 */
export function validateValueAndDate(
  item: ExtractionItem,
  context: ValidatorContext
): ValidationResult {
  // If there's a numeric value, validate it parses as a number
  if (item.value && 'n' in item.value) {
    const n = item.value.n;
    if (typeof n !== 'number' || isNaN(n)) {
      return {
        valid: false,
        reason: `value.n is not a valid number: ${n}`
      };
    }
  }

  // Check date falls within reporting period (inclusive on both ends)
  const sourceDate = context.sourceDates[item.source_ref];
  if (!sourceDate) {
    return {
      valid: false,
      reason: `No date found for source_ref: ${item.source_ref}`
    };
  }

  // ISO date string comparison (works correctly for YYYY-MM-DD)
  if (
    sourceDate < context.reportingPeriodStart ||
    sourceDate > context.reportingPeriodEnd
  ) {
    return {
      valid: false,
      reason: `source date ${sourceDate} falls outside reporting period [${context.reportingPeriodStart}, ${context.reportingPeriodEnd}]`
    };
  }

  return { valid: true };
}

/**
 * Validator 5: confidence >= 0.5
 * Items with confidence below 0.5 are never proposed; log only, return invalid.
 * This is a routing signal; the item is dropped before any card is shown.
 */
export function validateConfidence(
  item: ExtractionItem,
  _context: ValidatorContext
): ValidationResult {
  if (item.confidence < 0.5) {
    return {
      valid: false,
      reason: `confidence ${item.confidence} is below minimum threshold 0.5`
    };
  }

  return { valid: true };
}

/**
 * Validator 6: PII detection is a routing signal, not a rejection
 * Items with pii_detected: true are valid but routed to the PII layer.
 * This validator always returns valid: true, because the caller (not this module)
 * is responsible for special handling. The item survives with pii_detected intact.
 */
export function validatePiiDetection(
  item: ExtractionItem,
  _context: ValidatorContext
): ValidationResult {
  // PII is a routing signal, not a rejection. Always valid, caller routes differently.
  return { valid: true };
}

/**
 * Run all six validators in order
 * Returns { valid: true } if all pass, or { valid: false, reason: string } at first failure.
 * Order: 1, 3, 2, 4, 5, 6 (check source_ref before quote to fail fast on bad refs)
 * Validator 6 (PII) always passes; pii_detected items are routed by the caller, not rejected here.
 */
export function runValidators(
  item: ExtractionItem,
  context: ValidatorContext
): ValidationResult {
  // Validator 1: JSON shape and requirement key
  const v1 = validateJsonShape(item, context);
  if (!v1.valid) return v1;

  // Validator 3: source_ref resolves (check BEFORE quote validation to fail fast)
  const v3 = validateSourceRefResolution(item, context);
  if (!v3.valid) return v3;

  // Validator 2: quote_text verbatim in source (assumes source_ref exists)
  const v2 = validateQuoteInSource(item, context);
  if (!v2.valid) return v2;

  // Validator 4: numeric values and dates
  const v4 = validateValueAndDate(item, context);
  if (!v4.valid) return v4;

  // Validator 5: confidence threshold
  const v5 = validateConfidence(item, context);
  if (!v5.valid) return v5;

  // Validator 6: PII routing (always passes, caller handles routing)
  const v6 = validatePiiDetection(item, context);
  if (!v6.valid) return v6;

  return { valid: true };
}
