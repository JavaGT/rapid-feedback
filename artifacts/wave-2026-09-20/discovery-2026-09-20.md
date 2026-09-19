# Discovery report — wave 2026-09-20 (scheduled 07:30, run_id scheduled-20260920, attempt 1)

Executed 07:31–07:5x NZST 2026-09-20. Baseline: HEAD 5f0fd5e, tracked tree clean at start
(untracked `.scratch/*` 2026-09-10 leftovers + `test/repro-h1.js` treated as foreign per AGENTS.md,
untouched). No code commits since the 2026-09-19 catch-up (5f0fd5e is artifacts-only), so the code
surface is byte-identical to the one the 2026-09-19 discovery pass covered.

Context that shaped this pass: tickets **#65–#69** ("[wave 2026-09-20]", filed 07:17 NZST by an
unaccounted execution — second occurrence of the pattern tracked on #63) already covered an
adversarial second pass over the userscript, harness selection, and docs drift. This wave therefore
made **independent verification of those five filings** its quick-scan scope, rather than re-walking
zones the 09-19 pass cleared hours earlier.

## quick-scan — complete (verification pass; the five filings stand, no new finding)

Every line citation in #65–#69 was independently read at HEAD 5f0fd5e (tracked tree clean ⇒ worktree
equals HEAD). Results, posted as per-ticket comments:

- **#65** (re-injection re-attaches the full listener set; no top-document teardown) — **verified**.
  Exhaustive `removeEventListener` sweep: only :236 (frame docs), :1437-1438 (anchor scroll),
  :2186-2190/:2240-2244 (drag). Strengthening evidence added: `pruneFeedbackDocuments` :243-249
  explicitly skips the top document, so no path detaches a superseded top-doc listener set.
- **#66** (Alt+Shift+R autorepeat spams toast + storage) — **verified**, one nuance posted: after the
  first autorepeat `popoverOffset` is null, so repeats hit `localStorage.removeItem` (:1110), not a
  write. The toast-per-repeat cost (:1356, 2s lifetime :1227) stands.
- **#67** (opened-gesture release lands in the double-tap window) — **verified**; mechanism traced
  (:2933-2936 clear-before-keyup ⇒ fast-path :3113-3117 can never match ⇒ :3118-3125 arms the panel
  toggle with an unconsumed keyup).
- **#68** (harness browser-selection friction) — **verified**: README :90/:92 vs `test/common.js:6-9`
  precedence and unvalidated `RAPID_FEEDBACK_BROWSER`; AGENTS.md (#55) holds the ladder, README lags.
- **#69** (speculative micro-batch ×5) — **all five verified**, including the undocumented
  `__SCOPE_FEEDBACK_API__` claim (`rg` over README.md + AGENTS.md returns rc=1) and the `clear()`
  bypass of `persist()`'s `renderPanel()` (:3164 vs :1090-1094).

Dedupe cross-check of each filing's "distinct from" lists against the open set (#3/#5/#16/#21/#34/
#49/#51/#55/#57/#61): no duplicates found. No new finding beyond the five — re-walking the zones the
09-19 pass cleared (toast/FAB, dragging, chord-hold/pick, events, storage split) would duplicate.

## abstraction-zoom — no admitted scope (deferred, listed)

No code changed since the 09-19 pass, whose deferred list stands and is all ticketed: showPopover
:1445-2216 (#16), panel :2273-2552 (#20), selector/describe engine (#52/#7/#24), element-capture trio
(#27), componentFramesFor (#19), export block (#30), history wrapper (#51), storage semantics
(#15/#8). The five new filings add no new mixed-abstraction site claim. Deferred to the next wave
with code changes.

## forced-subtraction — skipped as redundant (deferred)

The 09-19 mechanical sweep (156 functions, zero unreferenced, 44 single-caller helpers inspected)
ran against this exact code state. Re-running it against an unchanged tree is manufactured work; the
subtraction backlog remains tracked (#62, #61, #65-class lifecycle questions). Deferred to the next
wave that lands code.

## pain-journal — complete

Journal live and current through 2026-09-19 (mined). No unmined entries at start. One new friction
line appended this run: the stale route policy zeroing review lanes two waves running → ticketed as
**#70** (evaluate: refresh route verification or widen the window). Mined line recorded 2026-09-20.

## Reviews / validation

- No hostile review dispatched: route policy 2026-09-13.2 (verified_at 2026-09-13T02:08:05Z,
  stale_after_seconds 86400) was stale by ~6.4 days at run start; classify-and-defer per policy,
  no retry. Consequence ticketed as #70. No scoped code commit landed this wave, so no commit lacks
  its review round.
- Verification evidence is the per-ticket comments (links in the receipt) plus this report; no suite
  run was needed (no code changed, nothing implemented).

## What I did not look at

- `test/run.js`–`run10.js` bodies (duplication surface ticketed #56/#57/#58/#59/#31/#33; #68 owns the
  selection seam).
- showPopover/panel interiors (#16/#20), export formatting (#30), Svelte meta paths (#52/#24), GM API
  error paths (#15/#8) — all ticketed.
- The identity of the 07:17 execution (not determinable from artifacts; second data point recorded on
  #63 — that question is scheduler/owner-side).
- `.scratch/` historical notes (untracked, foreign; read-only per AGENTS.md).
