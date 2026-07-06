# GrantProof

A Slack-native evidence ledger for nonprofit grant reporting, built for the **Slack Agent Builder Challenge** ("Slack Agent for Good" track).

GrantProof finds the proof of a nonprofit's work across Slack, Google Sheets, and Google Drive, maps it to a funder's reporting requirements, flags what is missing or suspicious, redacts PII, and drafts report sections where every claim links to a source.

```
Funder requirements -> evidence search (Slack + Sheets + Drive)
  -> extraction with citations -> human confirmation
  -> gap and conflict flags -> cited draft section (human approved)
```

**Product religion:** no claim beyond what the source supports. Nothing enters a draft unless a human confirmed it. This is an evidence engine with a reporting surface — not a grant writer, discovery tool, CRM, or autonomous submitter.

## Stack

- Node 20 + [Bolt for JS](https://slack.dev/bolt-js/), Socket Mode (no public URL needed for dev/demo)
- SQLite via `better-sqlite3`
- Gemini (strict JSON output) for extraction, PII tagging, and drafting
- Google Sheets + Drive, read-only, via a service account (no OAuth)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - Slack app credentials (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`)
   - `GRANTPROOF_CHANNEL_IDS` — comma-separated Slack channel IDs to search
   - `GOOGLE_APPLICATION_CREDENTIALS` — path to a Google service account JSON key
   - `GRANTPROOF_SHEET_ID` — the attendance tracker Sheet's ID
   - `GRANTPROOF_DRIVE_FOLDER_ID` — the session-photos Drive folder's ID
   - `GOOGLE_API_KEY` — Gemini API key
   - `DATABASE_PATH` — SQLite file path (defaults to `./grantproof.db`)
3. Share the Sheet and Drive folder with the service account's email (Viewer access) — GrantProof never writes to Google, read-only by design.
4. `npm run dev` — starts the Bolt app in Socket Mode with hot reload.

In Slack, message the app or open its Assistant pane and try: **"Prepare the Bright Futures July report."**

## Testing

- `npm test` — unit tests (Vitest)
- `npm run eval` — LLM-eval fixtures against the real extraction pipeline (`evals/fixtures/`)

## Project docs

- [`PRD.md`](PRD.md) — the frozen build spec (source of truth; do not edit before Phase 5)
- [`EVALS.md`](EVALS.md) — the 26-case test contract, adopted gap rules (GR-1…GR-5), and failure reports
- [`PLAN.md`](PLAN.md) — phase-by-phase build log, live-test findings, and known deviations
- [`LATER.md`](LATER.md) — ideas explicitly cut from MVP scope

## Status

Phases 0–4 complete: Slack scaffold, Sheet/Drive reads, evidence extraction with human confirmation, conflict detection, unit-sanity checking, PII redaction, gap detection, and cited drafting. Phase 5 (seed data polish, deployment, demo video, Devpost submission) is in progress.
