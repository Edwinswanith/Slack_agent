/**
 * PRD §13.5 — Unit Suspicion Card block builder (pure logic, no Slack/DB imports)
 *
 * Builds Block Kit blocks for unit-suspicion conflict detection cards.
 * When a count exactly equals the sum of per-session counts (indicating cumulative
 * attendance rather than unique students), this card presents the conflict and
 * allows the user to choose between the unique count or the cumulative count.
 */

import type { Block } from '@slack/types';

/**
 * Build Slack Block Kit blocks for a unit suspicion card.
 * Matches PRD §13.5 exact layout:
 * 1. Bold requirement label with "this number needs a second look."
 * 2. Section explaining the candidate value equals sum of all session counts
 * 3. Section mentioning the Roster's unique count
 * 4. Proposal line recommending unique students served with cumulative mention
 * 5. Three action buttons: use unique, use as written, skip
 *
 * @param requirementLabel The requirement label (e.g., "Students served")
 * @param input The unit suspicion conflict data
 * @param input.conflictId The conflict ID (used as button value for action handler)
 * @param input.candidateValue The value from the evidence (e.g., 432)
 * @param input.sessionCount The number of sessions (e.g., 8)
 * @param input.uniqueCount The unique count from the Roster (e.g., 61)
 * @returns Array of Slack Block Kit blocks
 */
export function buildUnitSuspicionCardBlocks(
  requirementLabel: string,
  input: {
    conflictId: string;
    candidateValue: number;
    sessionCount: number;
    uniqueCount: number;
  }
): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${requirementLabel}: this number needs a second look.*`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `The Summary tab says "${requirementLabel}: ${input.candidateValue}", but ${input.candidateValue} exactly equals the sum of all ${input.sessionCount} session attendance counts. That is cumulative attendance, not unique students. The Roster tab lists *${input.uniqueCount} unique students*.`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Proposal: report *${input.uniqueCount} unique students served*, and mention ${input.candidateValue} as cumulative attendance.`,
      },
    } as Block,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Use ${input.uniqueCount} unique`,
            emoji: true,
          },
          value: input.conflictId,
          action_id: 'use_unique_count',
          style: 'primary',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Use ${input.candidateValue} as written`,
            emoji: true,
          },
          value: input.conflictId,
          action_id: 'use_cumulative_count',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Skip',
            emoji: true,
          },
          value: input.conflictId,
          action_id: 'skip_conflict',
        },
      ],
    } as Block,
  ];
}
