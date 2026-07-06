# PLAN.md — Phase-by-Phase Build & Test Plan

Execution plan for [PRD.md](PRD.md) §16, with test gates from [EVALS.md](EVALS.md) wired into every phase. This file owns the calendar and the per-phase definition of "tested"; the PRD owns scope; EVALS.md owns pass/fail.

**Hard deadline: July 13, 2026, 5:00 PM PDT** (Slack Agent Builder Challenge, submission period ends). Judging runs **July 14 – August 6**; winners ~August 11. The deployed app and sandbox must stay running through the judging window.

---

## Decision log

Deviations from PRD.md's locked stack (§7.2), made by the project owner during the build rather than discovered as spec defects (contrast with EVALS.md's FR-numbered failure reports, which document the spec being wrong — these are deliberate substitutions).

**DR-001 (July 6, 2026): LLM switched from Claude to Gemini 3.5 Flash.** PRD §7.2 locks "Claude API, model `claude-sonnet-4-6`, strict JSON output." Project owner elected to use the Gemini API instead, choosing Gemini 3.5 Flash specifically (over Gemini 2.5 Pro / 3 Pro) for its free tier — relevant given the hackathon's tight budget and timeline. CLAUDE.md's Locked Stack section is updated to reflect this; PRD.md is left unedited per its freeze (§0) since this isn't a proven defect, and every place it says "Claude" should now be read as "the configured Gemini model." Scope of the change: extraction (§9.2), PII tagging (§10), and drafting (§12) — the prompt contracts, output schemas, and post-extraction validators are unaffected; only the model client swaps (`@google/generative-ai` instead of `@anthropic-ai/sdk`).

**Watch item:** Flash-tier models trade reasoning depth for speed/cost versus Pro-tier. The PRD's confidence-scoring rules (§11.7) and speculative-language detection (holdouts A4, A6 in EVALS.md) lean on exactly the kind of nuanced judgment Flash may handle less reliably than Pro. If Phase 4's `npm run eval` pass rate on those specific fixtures is weak, escalate the extraction call (only) to Gemini 2.5 Pro while keeping Flash for lighter tasks (PII tagging, drafting) — don't silently lower the confidence thresholds to compensate.

---

## Hackathon compliance (verified against slackhack.devpost.com, July 5, 2026)

| Requirement (official rules) | Our status |
| --- | --- |
| Track selection | **Slack Agent for Good** — "nonprofit operations" is an explicitly listed qualifying impact area |
| Use ≥1 of: Slack AI capabilities, MCP server integration, Real-Time Search API | We use **two**: Slack AI (assistant surface) + RTS API. MCP ledger server is a stretch third. Name all used tech explicitly in the Devpost description (Stage One is pass/fail screening) |
| Video: **under 3 minutes**, shows the project functioning, publicly hosted on YouTube/Vimeo/Facebook/Youku, no copyrighted music/trademarks/confidential info | Beat sheet in PRD §15 (2:15 target). **Raw PII must not appear in the video** (PRD §10) — masked versions only |
| Text description of features/functionality | Write in Phase 5; name track, problem, technologies |
| Architecture diagram (one page) | Mirrors PRD §7.1; produce in Phase 5 |
| **URL to the Slack developer sandbox** included in the submission | New detail vs PRD §2 — add the URL itself, not just access |
| Judge access: sandbox shared with slackhack@salesforce.com and testing@devpost.com | Do in Phase 5, verify logins work |
| Project "capable of being successfully installed and running consistently" | Deploy to Railway/Render in Phase 5; **keep it and the sandbox running through Aug 6** |
| Newly created by entrant; original work; open-source deps OK with license compliance | Greenfield ✓; stick to permissive-license npm deps |
| Team ≤ 4, age 18+, eligible country (India is eligible) | Confirm on Devpost registration |

**Judging rubric (4 × 25%, equally weighted):** Technological Implementation · Design (UX, balanced frontend/backend) · Potential Impact · Quality of Idea. The demo and description should hit all four explicitly — the evidence-engine rigor (landmines) sells implementation; the assistant-pane cards sell design; nonprofit hours-saved sells impact; "evidence ledger, not report generator" sells idea.

---

## Test infrastructure (set up in Phase 1, grows every phase)

Three layers, one command each:

1. **`npm test` — unit (Vitest).** Pure functions, no network: validators, unit-sanity check (GR-1), dedupe (GR-2), date/period logic, drafter input filter, citation parser. SQLite via better-sqlite3 `:memory:`.
2. **`npm run test:integration` — pipeline (Vitest).** Drives the real modules end-to-end against fixture data and a temp SQLite file: card state transitions, idempotency, conflict flow, PII state machine, drafter refusals. Slack/Google clients mocked at the API boundary; Bolt handlers kept thin so logic is testable without a socket.
3. **`npm run eval` — LLM fixtures.** JSON goldens in `evals/fixtures/` run through the *real* extraction and PII prompts (temperature 0), asserted structurally (item counts, flags, quote-verbatim, confidence bands) — never on exact prose. This is EVALS.md groups A and C1a/C3. Track pass rate in `evals/RESULTS.md`; a regression here blocks the phase gate.

Architecture rule that makes this possible: `src/core/` is pure logic (extraction contract, validators, delta/gap/draft engines, state machines) — fully testable offline; `src/slack/` and `src/google/` are thin adapters. Manual sandbox smoke tests only prove the adapters.

---

## Phase calendar (July 5 → 13)

| Phase | Dates | Scope | EVALS gates | Exit artifact |
| --- | --- | --- | --- | --- |
| 0 | Jul 5–6 | Sandbox + manifest + assistant pane hello + **RTS availability check** | — | Screenshot of assistant-pane reply; RTS verdict written down |
| 1 | Jul 6–7 | Scaffold, Google SA, Sheet reads, requirements JSON from real template, Ledger Summary | **F2** | Ledger screenshot with live Sheet numbers |
| 2 | Jul 7–9 | Retrieval, extraction + validators, confirmation cards, SQLite persistence | **B3 B4 D1 D2 D3 F1** | Confirm click → status change + DB row |
| 3 | Jul 9–10 | Conflict detection, unit-sanity (GR-1), PII state machine + reveal audit | **B1 B2 B5 C2 C3 C4** | Screen recording: 432 flag + redaction card |
| 4 | Jul 10–11 | Gap detector, drafter + citations, refusals | **A1–A6 C1a C1b E1–E5 F3** | Cited draft screenshot, permalinks working |
| 5 | Jul 11–13 | Seed polish, error-state sweep, deploy, diagram, video, judge access, submit | Full re-run of all 26 + stranger session | **Submitted entry** (buffer: Jul 13 morning) |

Slack timestamps can't be backdated — post seed messages starting **now** and on their scripted days (Jul 8 message on Jul 8, etc.); it's free realism and the Jul 18/22/24 messages land before the Jul 13 deadline only if re-dated — so compress the seeded "story" to Jul 5–12 and adjust card copy accordingly. Sheet edit for the conflict must happen *after* the "54 attended" message. Drive files: set `modifiedTime` via API at upload.

### Phase 0 — Prove the surface (Jul 5–6)
Build: Slack Dev Program sandbox; app manifest (scopes/events per PRD §7.3, Agent toggle on); Bolt + Socket Mode skeleton; assistant pane replies to a message; `assistant.threads.setStatus` streaming works. **Day-0 fork:** test one RTS query — write the verdict (available / gated → fallback per §7.4) into this file.
Test: manual — pane replies within 3s.
Gate: screenshot or a failure report; do not touch Phase 1 without it.

### Phase 1 — Real numbers on screen (Jul 6–7)
Build: repo scaffold (Node, Vitest, better-sqlite3, `src/core` vs adapters); `.env.example`; Google SA client (read-only); requirements JSON cloned from a **real funder template** (download it first — PRD §14.1); Ledger Summary block from live Sheet reads.
Test: sheet-client unit tests (mocked API); F2 integration (revoke SA access → exact §13.8 copy, nothing breaks).
Gate: ledger screenshot with live numbers + `npm test` green.

**Gate met, July 6, 2026:** live end-to-end test against the real "Youth Literacy Attendance Tracker" Sheet (service account, read-only, Viewer access). Ledger Summary posted in the assistant pane from "Prepare the Bright Futures July report" showed: 8 sessions (W1–W8: 51, 55, 49, 58, 52, 57, 61, 49), Summary tab 432 "students served" vs Roster tab 61 unique students, surfaced side by side without resolution (correct — unit-sanity resolution is Phase 3/GR-1). `npm test` 14/14 green. One implementation fix during this gate: `readAttendanceTrackerSnapshot` initially required numeric-typed cells and silently found zero matches, because this Sheet's cells returned numeric strings (e.g. `"51"`) rather than JS numbers from the Sheets API — the parser now coerces numeric strings via `toNumberOrNull`, which is the more robust behavior regardless of source-cell formatting. No screenshot image was captured (no direct access to the user's screen); this written record with the actual verified values is the exit artifact, consistent with how Phase 0's gate was closed.

### Phase 2 — The confirmation loop (Jul 7–9, longest phase)
Build: retrieval (RTS or fallback); extraction call with §9.2 contract; all six §9.3 validators; SQLite schema (§8) with the GR-2 unique index; confirmation cards; confirm/reject/edit handlers with GR-3 mechanics; audit rows.
Test: B3 B4 (validator units), D1 (double-click → one state change, one audit row), D2 (reject → rescan → no resurface), D3 (edit preserves quote, audited), F1 (unknown grant copy). First eval fixtures wired (A1, A2) as smoke — full eval gate is Phase 4.
Gate: screenshot of Confirm changing status + the DB row; all listed tests green.

### Phase 3 — The judgment layer (Jul 9–10)
Build: conflict detection (§9.5, integer-exact); unit-sanity check as a pure function per **GR-1 exact equality**; PII state machine hard-enforced in code (masked-by-default rendering, ephemeral reveal + `reveal_pii` audit, DB-level draft eligibility check).
Test: B1 (loop the pure function 10×; must fire 10/10), B5 (perturbed sum → must NOT fire), B2 (full conflict flow), C2 (Meena story end-to-end), C3 (quasi-identifier eval fixture), C4 (roster-names fixture: count cell cited, no name rendered anywhere — assert on all rendered output and logs).
Gate: screen recording of the 432 flag and redaction card; **security-reviewer agent pass over the PII layer** before closing the phase.

### Phase 4 — Honest drafting (Jul 10–11)
Build: gap detector (statuses + coverage, suggestions as nudges — GR-4 routing for ambiguous units); drafter (§12 rules: citations per fact sentence, bracketed gaps, percentages-only arithmetic, `proposed` until approved); GR-5 refusal copy for "mark everything complete" / "skip the checks".
Test: full `npm run eval` (A1–A6, C1a) green; E1 (refusal + no draft row), E2 (bracketed gap, no filler), E3 (programmatic citation parser — every fact sentence resolves or fail), E4 (proposed excluded, assert on input query), E5 (average omitted), C1b + F3 (refusals).
Gate: cited draft screenshot with clickable permalinks; eval pass rate 100% on goldens.

### Phase 5 — Stranger-proofing & ship (Jul 11–13)
Build: seed channels/Sheet/Drive per §14 (landmines intact — do not fix them); all §13.8 error states; deploy to Railway/Render (Socket Mode runs fine deployed; keep alive through Aug 6); architecture diagram; video per §15 beat sheet (masked PII only, no copyrighted music, public YouTube/Vimeo); Devpost description naming track + technologies; sandbox URL in submission; invite the two judge emails and verify they can get in; grants-manager review recorded **before** filming.
Test: full 26-case re-run; a deliberate "stranger session" — someone types unscripted garbage at every surface; F1/F2 re-verified against the deployed instance.
Gate: submitted entry, plus a `DEMO.md` runbook (how to reset seed state between judge sessions).

---

## Agents

**In the product: exactly one.** GrantProof is a single Slack agent (the assistant-pane app). The PRD explicitly rejects an agent framework — retriever, extractor, validators, gap detector, and drafter are modules in one pipeline, not agents. Inside that pipeline there are **three distinct LLM call types** (extraction §9.2, PII tag pass §10, drafter §12) — same API, three prompts, each with code-side validation. The read-only MCP ledger server (2 tools) is a post-Phase-5 stretch that would let *other* agents consume our evidence — never a dependency.

**In development (Claude Code subagents), per phase:**
- `tdd-guide` — start of every phase: write the phase's EVALS-mapped tests first
- `code-reviewer` — end of every phase, before the exit artifact
- `security-reviewer` — Phase 3 (PII layer) and Phase 5 (pre-submission sweep: no secrets in repo, no raw PII in logs)
- `database-reviewer` — Phase 2 (schema, unique index, transaction-wrapped confirms)
- `e2e-runner` — Phase 5 stranger-proofing sweep
- Verification workflows (multi-agent adversarial audits, like the ones already run on the docs) at each phase gate

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| RTS gated in sandbox | Day-0 check; §7.4 fallback is fully spec'd; we still satisfy required-tech via Slack AI capabilities |
| Bolt assistant-surface API friction | Latest `@slack/bolt`; Phase 0 exists to burn this risk first |
| 8-day window vs 42–58h estimate | Phase calendar above; PRD's own rule: 2× overrun → failure report; cut order: MCP stretch → edit modal simplification → keep the confirm loop sacred |
| App down during judging (Jul 14–Aug 6) | Deploy Phase 5, uptime monitor, don't touch the sandbox after submission |
| Raw PII leaks into video/logs | §10 rendering rules are code-enforced; security-reviewer gate; film only masked states |
| Seed timestamps look fake | Post seeds on real days starting now; compress story dates to Jul 5–12; sheet edit after conflict message |
