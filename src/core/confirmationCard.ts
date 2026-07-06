/**
 * PRD §13.3 — Confirmation Card block builder (pure logic, no Slack imports)
 *
 * Builds Block Kit blocks for evidence confirmation cards.
 * Confidence bucketing: >= 0.8 = "high", otherwise = "medium"
 * (confidence < 0.5 never reaches here; validators drop them in Phase 2)
 */

import type { Block } from '@slack/types';

/**
 * Convert numeric confidence to bucketed confidence label
 * @param confidence Numeric confidence 0-1
 * @returns "high" or "medium"
 */
function bucketConfidence(confidence: number): 'high' | 'medium' {
  return confidence >= 0.8 ? 'high' : 'medium';
}

/**
 * Build Slack Block Kit blocks for a confirmation card.
 * Matches PRD §13.3 exact layout:
 * 1. Bold requirement label with confidence bucketed
 * 2. "Claim: ..." line
 * 3. "Source: ..." line with permalink as a link
 * 4. Three action buttons: confirm, edit, reject
 *
 * @param requirementLabel The requirement label (e.g., "Budget variance")
 * @param evidence The evidence item to display
 * @returns Array of Slack Block Kit blocks
 */
export function buildConfirmationCardBlocks(
  requirementLabel: string,
  evidence: {
    id: string;
    claim_text: string;
    quote_text: string;
    source_ref: string;
    confidence: number;
  }
): Block[] {
  const confidenceBucket = bucketConfidence(evidence.confidence);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${requirementLabel}* (confidence: ${confidenceBucket})`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Claim: ${evidence.claim_text}`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: evidence.source_ref.startsWith('http')
          ? `Source: "${evidence.quote_text}" <${evidence.source_ref}|View message>`
          : `Source: ${evidence.source_ref} — "${evidence.quote_text}"`,
      },
    } as Block,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Confirm',
            emoji: true,
          },
          value: evidence.id,
          action_id: 'confirm_evidence',
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
