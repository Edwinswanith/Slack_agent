# GrantProof Manifest — Verification & Manual Configuration Notes

## Status: Ready for Import

The manifest at `manifest.json` is valid, complete, and paste-ready for **api.slack.com/apps → Create New App → From an app manifest**.

---

## Platform note: `agent_view` is mandatory for new apps (confirmed, not beta)

As of the June 30, 2026 Slack changelog ("Introducing the Agent messaging experience"), **new apps can only use `agent_view`** — the older `assistant_view` (separate History/Chat tabs) is legacy-only and being deprecated; switching an app to `agent_view` is **not reversible**. This manifest correctly uses `features.agent_view` — there is no fallback to `assistant_view` to consider for a brand-new app.

One behavioral wrinkle this causes: per the same changelog, the `assistant_thread_started` event "no longer indicates when a user has actively opened a DM with your app" under `agent_view` — Slack now recommends `app_home_opened` (with `event.tab === 'messages'`) for that signal instead. However, **the installed `@slack/bolt@4.7.3` package still ships a full `Assistant` class built directly on `assistant_thread_started` / `assistant_thread_context_changed` / `message`** (verified by reading `node_modules/@slack/bolt/dist/Assistant.d.ts` directly, not just docs). Given real ambiguity about which signal actually fires reliably for a new `agent_view` app, `src/slack/assistant.ts` implements **both**: the `Assistant` class (matches PRD §7.3's named events exactly) plus a defensive `app_home_opened` welcome handler. Whichever one Slack actually fires in the real sandbox will produce the Phase 0 exit-criterion reply — this needs confirming against a live workspace, which requires a human with sandbox access (see the checklist below).

---

## Verified Fields

- ✓ `display_information` with name, description, background_color, long_description
- ✓ `features.slash_commands` with command, description, usage_hint, should_escape
- ✓ `features.bot_user` with display_name, always_online
- ✓ `features.app_home` with `messages_tab_enabled: true` — required so the DM-style agent conversation surface (the whole point of `agent_view`) actually has somewhere to render
- ✓ `features.agent_view` with agent_description, actions (array), suggested_prompts (array)
  - Each action: name, description
  - Each prompt: title, message
- ✓ `oauth_config.scopes.bot` includes all required scopes:
  - `assistant:write` (thread status/title/suggested-prompts methods)
  - `chat:write` (posting messages/cards)
  - `commands` (slash command handling)
  - `im:history` (read direct message history for context)
  - `im:write` (write to direct messages in assistant threads)
  - `channels:history` (read channel history for evidence scanning)
  - `channels:read` (read channel metadata)
  - `users:read` (fetch user profiles)
- ✓ `settings.event_subscriptions.bot_events`: `assistant_thread_started`, `assistant_thread_context_changed`, `message.im`, `app_home_opened`
- ✓ `settings.interactivity.is_enabled` set to true
- ✓ `settings.socket_mode_enabled` set to true
- ✓ `settings.org_deploy_enabled` and `token_rotation_enabled` set to false (safe defaults)

---

## Items Requiring Manual Verification After Import

### 1. App-Level Token (Not in Manifest)

After importing the manifest:

1. Go to **Basic Information** on your app dashboard
2. Scroll to **App-Level Tokens**
3. Click **Generate Token and Scopes**
4. Enter a name (e.g., "Socket Mode")
5. **Add the `connections:write` scope** (REQUIRED for Socket Mode WebSocket connection)
6. Click **Generate**
7. Copy the token (starts with `xapp-`) and store as `SLACK_APP_TOKEN` in your `.env`

**Why:** The manifest does not include app-level tokens (Slack API limitation). Socket Mode requires this token at runtime, but it must be generated manually in the dashboard.

---

### 2. Request URL for Interactivity

The manifest has `interactivity.is_enabled: true` but **no request URL** (intentional for Socket Mode).

**Verification:**
- Go to **Interactivity & Shortcuts** on the app dashboard
- Confirm **Interactivity** is toggled **On**
- The **Request URL** field should remain **empty** (Socket Mode receives interactions via WebSocket, not HTTP)

---

### 3. Slash Command Acknowledgment Timeout

`/grantproof` is wired in `src/slack/assistant.ts` to `ack()` immediately, then `respond()` — satisfies the 3-second rule. No manual action needed beyond confirming the command shows up under **Slash Commands** in the dashboard.

---

### 4. Signing Secret (Not in Manifest)

After import, copy the **Signing Secret** from the **Basic Information** page and store it as `SLACK_SIGNING_SECRET` in your `.env`.

---

## Environment Variables Required at Runtime

These match `.env.example` at the repo root exactly — do not rename them:

```bash
SLACK_BOT_TOKEN=xoxb-...        # OAuth & Permissions → Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...        # Basic Information → App-Level Tokens (needs connections:write)
SLACK_SIGNING_SECRET=...        # Basic Information → Signing Secret
```

---

## Manifest Import Checklist

1. [ ] Copy the entire `manifest.json` content
2. [ ] Go to https://api.slack.com/apps
3. [ ] Click **Create New App** → **From an app manifest**
4. [ ] Paste the JSON, click **Next**, then **Create**
5. [ ] On **Basic Information**: generate an **App-Level Token** with `connections:write`, copy the **Signing Secret**
6. [ ] On **OAuth & Permissions**: install the app to your workspace, copy the **Bot User OAuth Token**
7. [ ] Fill all three into `.env` (copy from `.env.example` first)
8. [ ] Confirm **Slash Commands** shows `/grantproof`
9. [ ] Confirm **Interactivity & Shortcuts** is On with no Request URL
10. [ ] Confirm **Socket Mode** is Enabled
11. [ ] `npm install && npm run dev`, then open a DM with the app in Slack and send any message — confirm the welcome text and a placeholder reply appear (Phase 0 exit criterion)

---

## Support References

- [Introducing the Agent messaging experience (June 2026) | Slack Developer Docs](https://docs.slack.dev/changelog/2026/06/30/agent-messages-tab/)
- [App manifest reference | Slack Developer Docs](https://docs.slack.dev/reference/app-manifest/)
- [Using Socket Mode | Slack Developer Docs](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/)
- [Adding agent features with Bolt for JavaScript | Slack Developer Docs](https://docs.slack.dev/tools/bolt-js/concepts/adding-agent-features/)
- [Developing agents | Slack Developer Docs](https://docs.slack.dev/ai/developing-agents)
- `node_modules/@slack/bolt/dist/Assistant.d.ts` — ground truth for the installed `Assistant` class API (v4.7.3)
