# Discovery report — wave 2026-09-19 (manual catch-up, run_id manual-catchup-20260919, attempt 1)

Executed 11:49-12:1x NZST 2026-09-19 as the catch-up substitute for the skipped 07:30 automation.
Baseline: HEAD f37bba2, tracked tree clean at start (untracked `.scratch/*` + `test/repro-h1.js`
treated as foreign per AGENTS.md). Suite baseline: 10/10 suites green, rc=0 (suite log in this dir).

Context that shaped this pass: tickets #56-#62 (stamped wave 2026-09-19, filed 07:14-07:15 NZST by an
earlier unaccounted execution — see #63) already cover the harness-brick duplication surface
(lastAnnotation, STORAGE_KEY, centerOf, run-all selector, createFab boot, run6/run10 micros, URL
predicates). This pass therefore targeted zones with no open ticket and the standing process lanes.

## quick-scan — no new code finding (scope inspected, evidence)

Zones walked with no open-ticket coverage; all clean, recently hardened:
- Toast `rapid-feedback.user.js:1219-1228` — one-shot, pointer-events:none, bounded 2s lifetime.
- FAB `:1230-1314` — lazy `createFab` guard `:1232`, hit-test-safe host comment `:1234-1236`,
  grace timer `:1281-1291`, hover math `:1292-1296`. Boot-ordering already evaluated (#62).
- Popover dragging `:2217-2271` — #46 POPOVER_INSETS centralization landed (fbadc45); threshold,
  clamp, multi-document teardown `:2239-2259` all single-path.
- Chord-hold outline / pick modes `:2552-2707` — table-driven `PICK_MODES :2616-2631`, shared
  overlay root `:2559-2572`. Overlay fast-path `:2780` is documented intent (comment `:2778-2779`),
  not drift.
- Events `:2714-2868` — #48 window hardened (533c7bd, 2aed5bf); inspection edge cases already
  evaluated (#53), guard prologues tracked (#21).
- Storage split from #47 (1c9f21d) verified intact: readStoredAnnotations/annotationRowsFromPayload/
  hydrateAnnotations `:1057-1071`.

Findings filed from non-code lanes instead: #63 (orphaned execution left no receipt/artifacts for its
7 ticket filings), #64 (deepseek-direct seat balance pre-check, mined from pain journal).

## abstraction-zoom — no-finding (all major zones already tracked)

Admitted scope: the zones above. Deferred (each already has an open ticket; re-litigating would
duplicate): showPopover 1445-2216 (#16), panel 2273-2552 (#20), selector/describe engine (#52,
#7, #24), element capture trio (#27), componentFramesFor (#19), export block (#30), history wrapper
(#51), storage semantics (#15, #8). No new mixed-abstraction site found in the admitted scope.

## forced-subtraction — no-finding (mechanical sweep clean)

Method: extracted all 156 top-level/nested `function` names, counted references across the
userscript, `test/*.js`, and README (definition subtracted). Zero functions with no referencing
site; 44 single-caller helpers inspected by name — all are called from live paths (spot-verified:
`concealFab :1273`, `currentAutoPosition :2224`, `captureDestination :2629`, `isOverlayShell :2781`,
`annotationRowsFromPayload :1068`). No GOES candidates at function level. The subtraction backlog is
tracked (#62 boot-ordering, #61 run6/run10 micros, #44-pattern changelog pruning already landed).
No BREAKS claims made; nothing deleted.

## pain-journal — complete

Mined the one unmined entry (2026-09-18 deepseek-direct Insufficient Balance) → #64
(evaluate-only); pruned the mined line to a dated disposition per journal convention. No new
friction appended (none encountered beyond the already-ticketed stale-route deferral).

## Reviews / validation

- Baseline verification: full 10-suite harness run from repo root (`npm --prefix test test`),
  10/10 suites passed, all checks green, rc=0 — `suite-2026-09-19.log` in this directory.
- No hostile review dispatched: inline route policy 2026-09-13.2 verified_at 2026-09-13T02:08:05Z
  with stale_after_seconds 86400 was already stale at run start (~5.9 days). Policy requires
  classify-and-defer, no guessing. No scoped code commit landed this wave, so no commit lacks its
  review round. Next wave must re-verify route freshness before scheduling reviewers.

## What I did not look at

- `test/run.js`-`run10.js` bodies beyond reference counting (harness duplication is #56/#57/#58/#59/#31/#33).
- showPopover/panel interiors (ticketed #16/#20; too large for this box).
- Export/markdown formatting details (#30), Svelte meta paths (#52/#24), GM API error paths beyond
  storage (#15/#8), README/feature docs drift (read only as reference).
- `.scratch/` historical notes (untracked, foreign; read-only per AGENTS.md).
- The identity/origin of the 07:14 execution (not determinable from artifacts; question framed in #63).
