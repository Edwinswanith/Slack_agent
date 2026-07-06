import { GoogleGenAI } from '@google/genai';
import { detectResidualPiiInMaskedText } from '../core/piiDetection.js';

/**
 * PRD §10 — LLM tag pass for PII masking (paired with the regex backstop in
 * src/core/piiDetection.ts). Replaces identifying details with semantic
 * placeholders so raw PII never needs to render anywhere.
 */
export const PII_MASKING_SYSTEM_PROMPT = `You are GrantProof's PII masking engine. You replace personally identifying
details in nonprofit program text with semantic placeholders. Rules:
1. Replace person names (beneficiaries, children, parents, guardians, staff)
   with a role placeholder: [student], [parent], [staff], [volunteer],
   [sibling], [teacher], etc.
2. Replace ages and minor indicators (e.g. "7-year-old", "she is 9") with a
   neutral phrase, or drop the age if it is not essential to the claim.
3. Replace precise locations (centre names, neighbourhoods, addresses) with
   a generic term like "one of our centres" or "a program site".
4. Replace family-relationship details that combined with other details
   could identify someone (e.g. "her daughter", "his mother") with a neutral
   term like "a student" or "a family member", unless the relationship is
   the entire point of the sentence — then keep the relationship word but
   drop the identifying specifics around it.
5. Preserve the factual substance and tone of the original claim. Do not
   invent new details, do not add commentary or disclaimers.
6. Output ONLY the masked text as plain text. No JSON, no markdown, no
   surrounding quotation marks, no preamble or explanation.

Example:
Input: "A parent reported that her daughter Meena, from the Pulianthope centre, is now able to read bus signs independently."
Output: One parent shared that her daughter, a student at one of our centres, now reads bus signs independently.`;

export class PiiMaskingError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'PiiMaskingError';
  }
}

/**
 * Result of masking one piece of text.
 * verifiedSafe is the regex backstop's read on the LLM's own output — false
 * means the masked text still trips a known PII signal and must not render.
 */
export interface PiiMaskingResult {
  maskedText: string;
  verifiedSafe: boolean;
  remainingSignals: string[];
}

/**
 * Calls Gemini to mask a single piece of text. Throws PiiMaskingError on
 * any failure — callers must never fall back to the raw input on error.
 */
async function maskPiiText(rawText: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new PiiMaskingError('GOOGLE_API_KEY environment variable is not set');
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Mask this text:\n\n${rawText}`,
      config: {
        systemInstruction: PII_MASKING_SYSTEM_PROMPT
      }
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new PiiMaskingError('Empty or missing response from Gemini API for PII masking');
    }

    return text.trim();
  } catch (e) {
    if (e instanceof PiiMaskingError) {
      throw e;
    }

    const error = e as Record<string, unknown>;
    const message = typeof error.message === 'string' ? error.message : 'Unknown Gemini API error';
    throw new PiiMaskingError(`Gemini PII masking call failed: ${message}`, e as Error);
  }
}

/**
 * Masks text and verifies the result with the regex backstop (defense in
 * depth against the LLM missing a known signal, e.g. a centre name it left
 * untouched). Callers must treat verifiedSafe=false as "cannot render" —
 * never render maskedText when the backstop still flags it.
 */
export async function maskPiiTextVerified(
  rawText: string,
  knownCentreNames?: string[]
): Promise<PiiMaskingResult> {
  const maskedText = await maskPiiText(rawText);
  const regexCheck = detectResidualPiiInMaskedText(maskedText, knownCentreNames);

  return {
    maskedText,
    verifiedSafe: !regexCheck.detected,
    remainingSignals: regexCheck.reasons
  };
}
