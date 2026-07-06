import { Assistant, type App } from '@slack/bolt';

// Verbatim, PRD §13.1.
const WELCOME_TEXT =
  'I build funder reports from proof. I search your program channels, attendance sheets, and Drive folders, ' +
  'then show you every piece of evidence before it goes anywhere. Try: "Prepare the Bright Futures July report."';

const PHASE0_PLACEHOLDER_REPLY =
  'Phase 0 skeleton — evidence search lands in later phases. (Slack connection confirmed.)';

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
  userMessage: async ({ say, setStatus, logger }) => {
    try {
      await setStatus('Thinking...');
      await say(PHASE0_PLACEHOLDER_REPLY);
    } catch (error) {
      logger.error('assistant.userMessage failed', error);
    }
  },
});

export function registerAssistantHandlers(app: App): void {
  app.assistant(assistant);

  // Defensive fallback. Slack's June 2026 manifest change ("agent messaging experience",
  // features.agent_view — new apps can no longer opt into the older assistant_view) altered
  // how conversation-start is signaled; per Slack's own changelog, assistant_thread_started
  // "no longer indicates when a user has actively opened a DM" under agent_view, so the
  // Assistant class above may not reliably greet on first open. Greet on app_home_opened too
  // so Phase 0's exit criterion (a reply inside the assistant pane) is met either way.
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
