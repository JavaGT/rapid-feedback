# Forced-subtraction report — test harness interior

**Repo:** `JavaGT/rapid-feedback`  
**Pinned baseline:** `cfe6b70954a3597c1d30230fd7a5964e662a33b2` (`cfe6b70`)  
**Scope:** admitted `test/run.js`, `run3.js`–`run8.js`, `common.js`, `run-all.js`, plus `run2.js` from `git show HEAD:test/run2.js` (96 lines).  
**Method:** read-only call-site cross-examination with `rg`, `git show HEAD:<path>`, and line-count inspection. No source/test files were edited.

## Partition and exclusions

| Bucket | Verdict |
|---|---|
| Admitted harness | Reviewed below. All eight committed suites are wired by `test/run-all.js`. |
| `test/run2.js` working-tree additions | Flag only: the on-disk file has foreign uncommitted WIP; this report uses committed HEAD, not those additions. |
| `test/repro-h1.js` | One-line reference only: already verdict-deleted under #9; not re-reported. |
| `luna-redesign/`, `deepseek-redesign/`, `oxalpha-redesign/` | Deferred; deletion is tracked in #11. |
| `.scratch/` | Deferred. |
| `rapid-feedback.user.js` | Deferred; deletion batch is already ticketed in #29. |
| #9/#14/#22/#31 | Existing findings, not re-reported. |

## Per-suite subtraction tables

### `test/common.js` — 54 LOC

| GOES | Why safe / estimate |
|---|---|
| None as a block. | `SCRIPT`, `POP`, `MARKERS`, `createReporter`, and `withPage` all have real consumers. A diagnostic-only cleanup of the two logging listeners is possible, but is not worth the lost failure context and overlaps existing harness-hardening work. |

| STAYS | Evidence |
|---|---|
| `withPage` | Imported by all eight suites; it owns browser lifecycle, fixture loading, shadow-root opening, script injection, and cleanup. |
| `POP` | Imported by runs 1–8 and interpolated into actual assertions/actions. |
| `MARKERS` | Imported and evaluated by `run.js` and committed `run2.js`; deleting it breaks those tests. |
| `createReporter` | Every suite calls both `check` and `finish`. |
| page setup | `evaluateOnNewDocument` must run before userscript creation; `page.goto` and `page.evaluate(SCRIPT)` are the common fixture contract. |

| BREAKS claim cross-exam | Result |
|---|---|
| “`MARKERS` is duplicate boilerplate and can go.” | **Unpredicted break:** `rg` finds consumers in `run.js` and HEAD `run2.js`; marker cleanup assertions would stop evaluating. |
| “The common page-error/console listeners can be removed without consequence.” | **Fake break for pass/fail:** most suites do not assert the common logs; **but** this is not a recommended deletion because it removes diagnosis, and `run4` has an additional listener that independently asserts page errors. |

### `test/run.js` — 309 LOC

| GOES | Why safe / estimate |
|---|---|
| API-key/markdown console dump at lines 116–121 | `md` is only printed; `apiKeys` is only printed. Removing the diagnostic dump preserves every `check` and behavior assertion. **~6 LOC.** |

| STAYS | Evidence |
|---|---|
| Group selection/style/remove/add flows | This is the broad baseline for multi-target editing, destination pick mode, preview rollback, and export shape. Later suites do not cover this exact combination. |
| Svelte/shadow/a11y/hostile metadata checks | Unique coverage; these are not boilerplate assertions. |
| component-file “similar” grouping | `run3` covers sibling similarity, while this checks component-file grouping; different predicate and fixture. |

| BREAKS claim cross-exam | Result |
|---|---|
| “The markdown/API printout is load-bearing.” | **Fake break:** `rg` shows no consumer of `md` or `apiKeys` after the print; the checks use `out`, `ann`, and separate API calls. |
| “The repeated similar-selection block duplicates `run3` and can go.” | **Unpredicted break:** `run.js` asserts component-file grouping (`c2` only), whereas `run3` asserts direct sibling grouping and undo. Removing either loses a distinct rule. |

### `test/run2.js` — 96 LOC at HEAD

| GOES | Why safe / estimate |
|---|---|
| Final markdown dump at lines 92–93 | `md` is required by the destination-context assertion; only the unconditional console dump can go. **~2 LOC.** |

| STAYS | Evidence |
|---|---|
| Single-target preview/cancel/marker cleanup | It is the committed consumer of `MARKERS` besides `run.js`; this is a focused baseline before group work. |
| Destination round-trip and source context | `run.js` also tests destination selection, but with a different full-flow fixture and export assertions; keep as stable duplication rather than churn. |
| Escape from add mode and export fields | Distinct state transition and destination metadata assertions. |

| BREAKS claim cross-exam | Result |
|---|---|
| “The final `console.log` is required because `md` is used there.” | **Fake break:** the preceding destination-context check uses `md`; the print itself has no effect. |
| “The `localStorage`/API reset added by the foreign WIP can be judged here.” | **Unpredicted break risk:** the working-tree addition is outside the admitted HEAD analysis. It is explicitly flag-only, not evidence for this report. |

### `test/run3.js` — 60 LOC

| GOES | Why safe / estimate |
|---|---|
| None recommended. | The suite is already compact and each block covers a separate lifecycle: edit, missing member, sibling similarity/undo, duplicate-label disclosure, and SPA close. |

| STAYS | Evidence |
|---|---|
| All five flows | Each has a distinct assertion and fixture mutation; no dead local is exposed by `rg`. |

| BREAKS claim cross-exam | Result |
|---|---|
| “Similarity checks duplicate other suites.” | **Fake break:** `run.js` uses component-file grouping and `run4` uses SVG/primary promotion; this suite checks direct siblings, undo, duplicate labels, and navigation closure. |
| “The `pushState` block is incidental.” | **Unpredicted break:** it is the only admitted assertion that an in-flight popover closes on SPA navigation; deleting it loses that contract. |

### `test/run4.js` — 66 LOC

| GOES | Why safe / estimate |
|---|---|
| None recommended. | Two short edge cases are the suite’s entire purpose: SVG primary handling and undo after promotion. |

| STAYS | Evidence |
|---|---|
| Local `SCRIPT`, `page2.html`, and local `chordClick` | `withPage` has already loaded `page.html`; this suite navigates to `page2.html`, so it must re-inject the userscript and redefine the click helper. |
| `errors` listener and `localStorage.clear()` | The former makes the SVG regression observable; the latter isolates the second scenario from the first. |

| BREAKS claim cross-exam | Result |
|---|---|
| “`SCRIPT`/`path` is duplicate setup and can be removed.” | **Unpredicted break:** after navigation to `page2.html`, common’s earlier injection is gone; without local re-injection the SVG test is testing an uninstrumented page. |
| “The explicit `localStorage.clear()` is cleanup only.” | **Unpredicted break:** stale annotation state from the SVG scenario can alter the following promotion/undo scenario. |

### `test/run5.js` — 121 LOC

| GOES | Why safe / estimate |
|---|---|
| None recommended. | Chrome click-through and off-page editing overlap `run6` in theme, but use different entry points and assertions. Stable duplication is preferable to making one failure mask another. |

| STAYS | Evidence |
|---|---|
| Concealed/revealed FAB and popover pass-through | Unique direct hit-testing contract. |
| Panel cannot be annotated | Unique panel-chrome target check. |
| Off-page comment edit | Unique reload/storage path and in-place edit assertion. |

| BREAKS claim cross-exam | Result |
|---|---|
| “`PANEL` is a repeated selector and can be deleted.” | **Unpredicted break:** it is interpolated into multiple assertions/actions in this suite; no equivalent exported helper exists in `common.js`. Selector centralization is already covered by #31 and is not re-reported. |
| “The second page reload is redundant.” | **Fake break:** it is the behavior under test—loading an annotation whose URL differs from the current page and editing it in place. |

### `test/run6.js` — 278 LOC

| GOES | Why safe / estimate |
|---|---|
| None as behavior. | The file is large, but every block checks a separate regression: drag persistence, revert, clear confirmation, ambiguity, history churn, chrome pass-through, lost/revived drafts, empty chord, slow release, and tall-page placement. |
| Optional diagnostic-only result detail | Some long failure-detail expressions could be shortened, but that is readability churn, not subtraction. No ticket recommended. |

| STAYS | Evidence |
|---|---|
| `annot`, `hostWith`, and all resets | They are used by multiple later blocks; resets isolate persisted state between behaviors. |
| CDP slow-release path | It is the only test of a real delayed mouse release beyond the gesture window. |

| BREAKS claim cross-exam | Result |
|---|---|
| “This monolith is 278 LOC, so one or more behavior blocks are safe to delete.” | **Fake break:** size alone is not deadness; `rg` maps each block to a distinct check and there are no unused helpers. Split/reorganize is a future ticket, not a deletion. |
| “The repeated `localStorage.clear()` calls are redundant.” | **Unpredicted break:** later revert/clear/ambiguity scenarios depend on starting without prior annotations or restore points. |

### `test/run7.js` — 77 LOC

| GOES | Why safe / estimate |
|---|---|
| None recommended. | The iframe fixture, persisted frame path, style preview/restore, markdown frame identity, and viewport placement form one coherent regression. |

| STAYS | Evidence |
|---|---|
| All iframe assertions | No other admitted suite enters a same-origin iframe or resolves a saved frame path. |

| BREAKS claim cross-exam | Result |
|---|---|
| “The final viewport-position check duplicates ordinary popover placement.” | **Unpredicted break:** iframe placement is a top-viewport cross-document case; run6’s tall-page check does not exercise frame coordinates. |
| “The three initial iframe checks can collapse to one.” | **Fake break only if treated as equivalent:** they separately distinguish no popover, wrong outer-frame target, and missing child text. Keeping the three gives useful failure localization. |

### `test/run8.js` — 40 LOC

| GOES | Why safe / estimate |
|---|---|
| None recommended. | This is the smallest focused suite and covers frozen/lost target submission, a case not exactly covered by the larger draft-revival flow. |

| STAYS | Evidence |
|---|---|
| Target removal after draft creation and submit | `run6` tests all-target loss and revival; `run8` specifically proves submit remains enabled with the stored target gone. |

| BREAKS claim cross-exam | Result |
|---|---|
| “`run8` is redundant with `run6`’s lost-state checks.” | **Fake break:** the motivating action differs: run8 submits a frozen annotation, while run6 revives it by chord-adding a fresh target. |

### `test/run-all.js` — 8 LOC

| GOES | Why safe / estimate |
|---|---|
| Final summary `console.log` | Removing the summary would not change the final exit code. **~1 LOC**, but it is useful operator feedback and not worth a ticket. |

| STAYS | Evidence |
|---|---|
| Suite array, serial loop, exit status, catch | The array is the complete wiring; serial execution and exit code are the harness contract. |

| BREAKS claim cross-exam | Result |
|---|---|
| “The final summary controls success.” | **Fake break:** `process.exit(passed === suites.length ? 0 : 1)` controls success; the summary is output only. |

## Cross-exam summary

| Measure | Count | Notes |
|---|---:|---|
| Safe GOES LOC | **~9 LOC** | `run.js` diagnostic dump (~6), HEAD `run2.js` dump (~2), `run-all.js` summary (~1). These are optional hygiene, not behavior. |
| Whole suites/files that GO | **0** | No admitted suite is dormant or safely removable. |
| Fake breaks (misread coupling) | **7** | Diagnostic output, similarity “duplication,” iframe assertion collapse, redundant reload/size/summary claims. |
| Unpredicted breaks (hidden coupling) | **6** | `MARKERS` consumers; `run4` re-injection and storage isolation; `run3` SPA coverage; `run5` panel/reload paths; `run6` state resets; distinct iframe coordinates. |
| Stable duplicated-but-load-bearing patterns | **Several** | Repeated shadow-root scans, chord setup, and reporter calls are intentionally stable across independently failing regression surfaces. Selector sharing is already #31. |

The pass does **not** justify a 30% deletion of the admitted ~1.1k-line harness. A literal 30% cut would remove unique regression contracts. The defensible subtraction is approximately 9 LOC of diagnostics, and even that is low priority.

## Ranked ticket recommendations

1. **Evaluate a fixture/script-loading seam for `run4.js` (worth a ticket).** Let the common harness accept a fixture and injection path, or expose a deliberate second-fixture helper. This could remove the duplicated `fs/path` and click setup without risking the page2 regression. Do not delete the local setup first: the cross-exam proves it is currently load-bearing.
2. **Evaluate splitting `run6.js` by behavior (worth a ticket, not deletion).** Its 278 LOC are coherent but failure diagnosis is expensive. Split only along the existing reset boundaries and retain each regression block; do not discard coverage to meet a percentage.
3. **Remove diagnostic-only dumps (not worth a ticket).** The ~9 LOC in `run.js`, HEAD `run2.js`, and `run-all.js` can go safely, but they provide useful local failure context and do not justify tracker churn. If cleanup is bundled with another harness change, delete them then.

## What I did not look at

- No userscript internals beyond the harness call-site implications.
- No redesign directories, `.scratch/`, or `rapid-feedback.user.js` deletion batch.
- No working-tree `run2.js` WIP behavior; only `git show HEAD:test/run2.js`.
- No new browser run was used as evidence because the working tree has foreign userscript/run2 changes; this report is pinned to committed HEAD and static call-site evidence.
- No issue was created or modified.
