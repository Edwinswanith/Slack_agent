# GrantProof Manifest — Verification & Manual Configuration Notes

## Status: Ready for Import

The manifest at `manifest.json` is valid, complete, and paste-ready for **api.slack.com/apps → Create New App → From an app manifest**.

---

## Platform note: this app uses `assistant_view`, not `agent_view` — confirmed live (update to FR-002)

Original research (June 30, 2026 Slack changelog, "Introducing the Agent messaging experience") found that **new apps can only use `agent_view`** — the older `assistant_view` was expected to be unavailable. In practice, testing against a real Slack app during Phase 0 sandbox setup, **`features.assistant_view` was what Slack's own "Agents" configuration page wrote into this app's manifest** (not `agent_view`) — this manifest has been updated to match reality rather than the pre-testing assumption. Likely explanation: this app predates the June 30 cutover and retained eligibility for the legacy surface; a genuinely brand-new app might still be `agent_view`-only. Treat `assistant_view` as this app's confirmed configuration, not a universal rule.

This is actually the simpler outcome: `assistant_view` is exactly what the installed `@slack/bolt@4.7.3` `Assistant` class (`threadStarted` / `threadContextChanged` / `userMessage`, built on `assistant_thread_started` / `assistant_thread_context_changed` / `message`) is designed for — no mismatch to hedge around. `src/slack/assistant.ts` still also registers a defensive `app_home_opened` handler (harmless, and event_subscriptions already includes it), but the `Assistant` class is now confirmed to be the live, correct, primary path — not a hedge against an ambiguous platform state.

---

## Gotcha: `pkce_enabled` cannot be removed once true

This app has PKCE enabled from before it was repurposed for GrantProof. **Any manifest save that omits `oauth_config.pkce_enabled` fails outright** with `"PKCE cannot be disabled once enabled"` — Slack shows this as a small red banner near the top of the JSON editor, easy to miss if you don't scroll up after clicking Save Changes. This was the actual root cause of several manifest saves silently appearing not to take effect during Phase 0 setup (the editor doesn't visibly flag *what* changed on refresh — it just reverts everything, which looks identical to "nothing saved" if you never saw the error). `manifest.json` in this repo keeps `"pkce_enabled": true` for exactly this reason, even though this app never uses the OAuth redirect flow it belongs to.

**Lesson for next time something "won't save":** scroll to the very top of the App Manifest editor and look for a red error banner before assuming the button is broken or the page is cached.

---

## Verified Fields

- ✓ `display_information` with name, description, background_color, long_description
- ✓ `features.slash_commands` with command, description, usage_hint, should_escape
- ✓ `features.bot_user` with display_name, always_online
- ✓ `features.app_home` with `messages_tab_enabled: true` — required so the assistant conversation surface has somewhere to render
- ✓ `features.assistant_view` with assistant_description, suggested_prompts (array) — confirmed live as this app's actual configuration (see platform note above); each prompt: title, message. This field was reachable only through the **Agents** page in the app dashboard, not by pasting JSON into **App Manifest** directly — configure it there if it's ever missing after a manifest re-import.
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

## Phase 2 addition: search:read.* scopes for the Real-Time Search API attempt

PRD §7.4 names the Real-time Search API (`assistant.search.context`) as the primary retrieval path. That method's bot-token requirement is `search:read.public`, `search:read.files`, `search:read.users` — none of which were in the original Phase 0 scope list (that list came from PRD §7.3, written before the RTS scope requirement was confirmed against current docs). Added here so the code can genuinely attempt the call rather than skip it. Per Slack's own docs, semantic search additionally requires a workspace on a Slack AI Search plan obtained through Slack's partnerships team — a hackathon dev sandbox almost certainly doesn't have this, so expect `assistant.search.info`/`assistant.search.context` to report the feature unavailable. This was supposed to be checked as a "Day-0 fork" in Phase 0 (per PLAN.md) but was missed; it's being closed out now at the start of Phase 2. PRD §7.4's fallback (`conversations.history`) is the path that actually needs to work.

**After pasting this manifest update:** reinstall the app to the workspace (OAuth & Permissions → Reinstall) so the new scopes take effect — adding scopes to an already-installed app doesn't apply them until reinstall.

## Support References

- [Introducing the Agent messaging experience (June 2026) | Slack Developer Docs](https://docs.slack.dev/changelog/2026/06/30/agent-messages-tab/)
- [App manifest reference | Slack Developer Docs](https://docs.slack.dev/reference/app-manifest/)
- [Using Socket Mode | Slack Developer Docs](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/)
- [Adding agent features with Bolt for JavaScript | Slack Developer Docs](https://docs.slack.dev/tools/bolt-js/concepts/adding-agent-features/)
- [Developing agents | Slack Developer Docs](https://docs.slack.dev/ai/developing-agents)
- `node_modules/@slack/bolt/dist/Assistant.d.ts` — ground truth for the installed `Assistant` class API (v4.7.3)
