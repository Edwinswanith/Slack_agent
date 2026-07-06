/**
 * PRD §13.6 — PII Redaction Card block builder (pure logic, no Slack/DB imports)
 *
 * Builds Block Kit blocks for PII redaction confirmation cards.
 * SAFETY-CRITICAL: This function must NEVER be called with raw/unmasked PII text.
 * The type signature deliberately provides only maskedClaimText (already masked by caller),
 * never raw text, making it structurally impossible to leak unredacted PII through this function.
 */

import type { Block } from '@slack/types';

/**
 * Build Slack Block Kit blocks for a PII redaction card.
 * Matches PRD §13.6 exact layout:
 * 1. Bold requirement label + PII risk indicator
 * 2. "Redacted version: ..." line (displaying only pre-masked text)
 * 3. Four action buttons: approve redacted, edit, reveal original, reject
 *
 * SAFETY CONSTRAINT: The evidence parameter intentionally has NO raw_text field.
 * Callers MUST mask PII before calling this function and pass only the masked result.
 * This makes it impossible to accidentally pass raw/unredacted text into the rendered card.
 *
 * @param requirementLabel The requirement label (e.g., "Beneficiary story")
 * @param evidence The evidence item with already-masked claim text (NOT raw text)
 * @returns Array of Slack Block Kit blocks
 */
export function buildRedactionCardBlocks(
  requirementLabel: string,
  evidence: {
    id: string;
    maskedClaimText: string; // MUST already be masked by the caller — raw text never enters this function
    piiRiskLabel: string; // e.g., "high (child's name, centre location)"
  }
): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${requirementLabel}* found. PII risk: ${evidence.piiRiskLabel}.`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Redacted version: "${evidence.maskedClaimText}"`,
      },
    } as Block,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Approve redacted',
            emoji: true,
          },
          value: evidence.id,
          action_id: 'approve_redacted',
          style: 'primary',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Edit',
            emoji: true,
          },
          value: evidence.id,
          action_id: 'edit_evidence',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Reveal original',
            emoji: true,
          },
          value: evidence.id,
          action_id: 'reveal_pii',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Reject',
            emoji: true,
          },
          value: evidence.id,
          action_id: 'reject_evidence',
        },
      ],
    } as Block,
  ];
}
