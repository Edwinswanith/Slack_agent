import 'dotenv/config';
import { App } from '@slack/bolt';
import { registerAssistantHandlers } from './assistant.js';

const REQUIRED_ENV_VARS = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET'] as const;

for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    throw new Error(`Missing required env var ${name} — copy .env.example to .env and fill it in.`);
  }
}

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

registerAssistantHandlers(app);

async function main(): Promise<void> {
  await app.start();
  app.logger.info('⚡️ GrantProof is running (Socket Mode)');
}

main().catch((err: unknown) => {
  app.logger.error('GrantProof failed to start', err);
  process.exit(1);
});
