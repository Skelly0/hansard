# Privacy Differential Review Report

Date: 2026-05-10
Scope: focused review of the working-tree privacy changes across API, bot, MCP, and web surfaces.
Resolution status: findings were fixed in this branch after review and retained here as the regression map.

## Findings

### P1: Sealed or anonymous live election turnout remains visible through the API/web path

`VoteService.getTurnout` accepts a viewer and hides draft elections, but it does not read `elections.config` or apply the same sealed/anonymous live-vote guard added to the bot command. `GET /api/elections/:id/turnout` is available to any authenticated user, and the election detail page always fetches and renders the returned `eligible`, `voted`, and `turnoutPct` values.

Evidence:
- `packages/api/src/services/voteService.ts:431` fetches only `results`, `status`, and `createdById`; no `config` is selected.
- `packages/api/src/services/voteService.ts:446` counts ballots for the election and returns `voted`/`totalBallots`.
- `packages/api/src/routes/voting.ts:334` exposes `/api/elections/:id/turnout` behind `requireAuth`.
- `packages/web/src/pages/ElectionDetail.tsx:81` fetches turnout, then renders `Votes Cast` at `packages/web/src/pages/ElectionDetail.tsx:207`.
- `packages/bot/src/commands/vote/turnout.ts:46` already blocks nonstaff live turnout when `sealedResults` or `anonymousBallots` is set, so the API/web surface is inconsistent with the intended rule.

Impact:
Any authenticated player can poll turnout during a live sealed or anonymous election through the web/API route, learning participation counts that the bot now deliberately hides. That can reveal voting progress, enable pressure campaigns, or leak whether particular small cohorts have likely voted.

Fix applied:
Selected `config` in `getTurnout`, applied the same nonstaff guard used by the bot for `status === 'voting_open' && (config.sealedResults || config.anonymousBallots)`, and added API service tests for sealed and anonymous live elections.

### P2: Simulation history redacts summary details but leaves staff notes visible to nonstaff

The time advance schema marks `notes` as staff context, and the API now sanitizes the `summary` payload for nonstaff. The sanitizer leaves `notes` intact, and the web page renders them for every returned history entry.

Evidence:
- `packages/db/src/schema/simulation.ts:50` defines `notes` with the comment `staff can add context`.
- `packages/api/src/routes/simulation.ts:80` exposes `/api/simulation/history` to authenticated users.
- `packages/api/src/services/simulationService.ts:910` sanitizes time advance rows for nonstaff but only replaces `summary`.
- `packages/web/src/pages/Simulation.tsx:421` renders `entry.notes`.
- `packages/api/src/routes/simulation.ts:35` currently accepts `notes` on advance requests but does not pass them into `advanceTime` at `packages/api/src/routes/simulation.ts:44`, which lowers immediate exploitability for UI-created notes but does not protect existing/manual/future note rows.

Impact:
If staff notes exist in `time_advance_log`, nonstaff users can read them through simulation history. Those notes may contain private health, pending-death, moderation, or narrative planning details.

Fix applied:
Set `notes: null` for nonstaff in `sanitizeTimeAdvanceLog`, and added a regression test that nonstaff history redacts both sensitive summary arrays and notes.

## Coverage Notes

- Reviewed changed privacy-sensitive service, route, bot command, MCP tool, and web consumer paths.
- Searched tests for turnout coverage; existing sealed/anonymous tests covered bill-voter and player-election-history redaction, but not `VoteService.getTurnout`.
- Added regression coverage for sealed/anonymous live turnout and simulation notes redaction.
- Focused API verification passed with `pnpm --filter @hansard/api test:run -- src/services/voteService.test.ts src/services/simulationService.test.ts` (Vitest ran 20 files, 139 tests).
