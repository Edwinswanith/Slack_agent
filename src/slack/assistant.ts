import { Assistant, type App, type SayFn, type SetStatusFn, type Logger } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getDb } from '../db/index.js';
import { seedBrightFuturesGrant } from '../db/seed.js';
import { readAttendanceTrackerSnapshot, SheetAccessError } from '../google/sheets.js';
import { buildLedgerPreview, getGrantAndRequirements } from '../core/ledger.js';

// Verbatim, PRD §13.1.
const WELCOME_TEXT =
  'I build funder reports from proof. I search your program channels, attendance sheets, and Drive folders, ' +
  'then show you every piece of evidence before it goes anywhere. Try: "Prepare the Bright Futures July report."';

const PHASE1_PLACEHOLDER_REPLY =
  'I only know how to preview the Bright Futures Youth Literacy report right now. Try: "Prepare the Bright Futures July report."';

// PRD §13.8, verbatim.
const SHEET_UNREACHABLE_TEXT =
  'I could not read the attendance tracker. Check that the sheet is shared with the GrantProof service account. Nothing was changed.';

// PRD §13.8, verbatim.
const GENERIC_FAILURE_TEXT =
  'Something failed on my side. No data was changed. Try again, and if it repeats, that is a bug worth telling the builder about.';

function isBrightFuturesReportRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === 'prepare the bright futures july report') return true;
  const mentionsGrant = normalized.includes('bright futures') || normalized.includes('bright-futures');
  const mentionsAction = normalized.includes('report') || normalized.includes('scan');
  return mentionsGrant && mentionsAction;
}

async function postBrightFuturesLedgerPreview(say: SayFn, setStatus: SetStatusFn, logger: Logger): Promise<void> {
  const sheetId = process.env.GRANTPROOF_SHEET_ID;
  try {
    await setStatus('Reading the attendance tracker...');
    if (!sheetId) {
      logger.error('GRANTPROOF_SHEET_ID is not set');
      await say(SHEET_UNREACHABLE_TEXT);
      return;
    }

    const db = getDb();
    seedBrightFuturesGrant(db);

    const snapshot = await readAttendanceTrackerSnapshot(sheetId);
    const { grant, requirements } = getGrantAndRequirements(db, 'grant_bright_futures');
    if (!grant) {
      logger.error('grant_bright_futures missing after seed');
      await say(GENERIC_FAILURE_TEXT);
      return;
    }

    const blocks = buildLedgerPreview(grant, requirements, snapshot);
    await say({
      text: `${grant.name} — Ledger Summary preview`,
      blocks: blocks as KnownBlock[],
    });
  } catch (error) {
    if (error instanceof SheetAccessError) {
      logger.error('sheet access failed', error);
      await say(SHEET_UNREACHABLE_TEXT);
      return;
    }
    logger.error('postBrightFuturesLedgerPreview failed', error);
    await say(GENERIC_FAILURE_TEXT);
  }
}

const assistant = new Assistant({
  threadStarted: async ({ say, setSuggestedPrompts, saveThreadContext, logger }) => {
    try {
      await say(WELCOME_TEXT);
      await saveThreadContext();
      await setSuggestedPrompts({
        title: 'Try this:',
        prompts: [{ title: 'Prepare the Bright Futures July report', message: 'Prepare the Bright Futures July report' }],
      });
    } catch (error) {
      logger.error('assistant.threadStarted failed', error);
    }
  },
  userMessage: async ({ message, say, setStatus, logger }) => {
    try {
      const text = 'text' in message && typeof message.text === 'string' ? message.text : '';
      if (isBrightFuturesReportRequest(text)) {
        await postBrightFuturesLedgerPreview(say, setStatus, logger);
        return;
      }
      await setStatus('Thinking...');
      await say(PHASE1_PLACEHOLDER_REPLY);
    } catch (error) {
      logger.error('assistant.userMessage failed', error);
    }
  },
});

export function registerAssistantHandlers(app: App): void {
  app.assistant(assistant);

  // Defensive fallback, confirmed non-load-bearing (FR-002 update): this app uses
  // features.assistant_view, where assistant_thread_started fires normally, so the
  // Assistant class above is the primary path. Kept as a harmless second signal.
  app.event('app_home_opened', async ({ event, client, logger }) => {
    if (event.tab !== 'messages') return;
    try {
      await client.chat.postMessage({ channel: event.channel, text: WELCOME_TEXT });
    } catch (error) {
      logger.error('app_home_opened handler failed', error);
    }
  });

  // Fallback surface (PRD §5): assistant pane is primary, slash command is a fallback.
  app.command('/grantproof', async ({ ack, respond, command }) => {
    await ack();
    await respond({
      response_type: 'ephemeral',
      text: `GrantProof received: "${command.text}". Evidence search lands in a later phase — for now, try me in the assistant pane.`,
    });
  });
}
