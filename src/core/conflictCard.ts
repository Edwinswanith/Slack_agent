/**
 * PRD §13.4 — Conflict Card block builder (pure logic, no Slack/DB imports)
 *
 * Builds Block Kit blocks for numeric value conflicts between Slack and Sheet sources.
 * Presents both values neutrally and lets the human decide which is correct.
 */

import type { Block } from '@slack/types';

/**
 * Build Slack Block Kit blocks for a conflict card.
 * Matches PRD §13.4 exact layout:
 * 1. Bold header: "{requirementLabel}: your sources disagree."
 * 2. Slack source line: "Slack ({slackSourceDescription}): "{slackQuoteText}""
 * 3. Sheet source line: "Sheet ({sheetSourceRef}): {sheetValue}."
 * 4. Neutral prompt asking for human decision
 * 5. Three action buttons: use Sheet value, use Slack value, skip for now
 *
 * @param requirementLabel The requirement label (e.g., "Attendance, Workshop 8")
 * @param input Configuration object with conflict details
 * @returns Array of Slack Block Kit blocks
 */
export function buildConflictCardBlocks(
  requirementLabel: string,
  input: {
    conflictId: string;
    slackValue: number;
    slackSourceDescription: string;
    slackQuoteText: string;
    sheetValue: number;
    sheetSourceRef: string;
  }
): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${requirementLabel}: your sources disagree.*`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Slack (${input.slackSourceDescription}): "${input.slackQuoteText}"`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Sheet (${input.sheetSourceRef}): ${input.sheetValue}.`,
      },
    } as Block,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Both sources are shown below; you decide which value is correct.',
      },
    } as Block,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Use ${input.sheetValue} (Sheet)`,
            emoji: true,
          },
          value: input.conflictId,
          action_id: 'use_sheet_value',
          style: 'primary',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Use ${input.slackValue} (Slack)`,
            emoji: true,
          },
          value: input.conflictId,
          action_id: 'use_slack_value',
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Skip for now',
            emoji: true,
          },
          value: input.conflictId,
          action_id: 'skip_conflict',
        },
      ],
    } as Block,
  ];
}
