/**
 * GR-4 (adopted gap rule, EVALS.md) — Unit Ambiguity Review Card block builder
 * (pure logic, no Slack imports).
 *
 * An item with unit_ambiguous: true (PRD §9.2 rule 4 — e.g. "we crossed 400
 * this month" could mean attendance vs unique individuals, or monthly vs
 * cumulative) must never render as a plain confirmation card and must never
 * be auto-proposed as the target field's value. This card is visually
 * distinct and forces an explicit acknowledgment of the ambiguity before the
 * human can confirm or edit it — reusing the same confirm/edit/reject
 * actions as a normal confirmation card, since the underlying state machine
 * (proposed -> confirmed | rejected) is identical; only what's shown differs.
 */

import type { Block } from '@slack/types';

function bucketConfidence(confidence: number): 'high' | 'medium' {
  return confidence >= 0.8 ? 'high' : 'medium';
}

export function buildUnitAmbiguityCardBlocks(
  requirementLabel: string,
  evidence: {
    id: string;
    claim_text: string;
    quote_text: string;
    source_ref: string;
    confidence: number;
    note: string;
  }
): Block[] {
  const confidenceBucket = bucketConfidence(evidence.confidence);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${requirementLabel}: this number's unit needs a second look.* (confidence: ${confidenceBucket})`,
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
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Why this needs a look: ${evidence.note || 'The unit (e.g. attendance vs. unique individuals, monthly vs. cumulative) is not clear from the source.'}`,
      },
    } as Block,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Confirm as written',
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
