# Evaluation: tickets #34, #35, and #36

**Scope and method.** Read-only evaluation of the committed harness (`git show HEAD:path`) and the three ticket bodies fetched with `gh`. I did not run the test suite, edit source files, run Git write commands, or post to GitHub. The current worktree has foreign changes in `rapid-feedback.user.js` and `test/run2.js`; those were treated as context only. The sequencing condition below comes from issue #1: the in-flight v5.18 userscript diff currently breaks run4, so harness work should wait until that diff is completed or reverted and the 8-suite baseline is restored.

## #34 — `withPage` fixture seam for run4

**Verdict: DEFER-UNTIL the v5.18 diff is resolved and the clean 8-suite baseline is restored.**

**Decision question:** Is it worth making `withPage` accept a fixture/second-page setup so run4 does not duplicate bootstrap and click-helper code while preserving reinjection and isolation semantics?

**Verified evidence:**

- `test/common.js:26-42` launches the browser, installs the open-shadow-root hook on every document, navigates to `page.html`, and injects `SCRIPT`.
- `test/common.js:44-48` defines `chordClick` and passes it to the suite callback.
- `test/run4.js:3-7` independently imports `fs`/`path` and rereads the userscript.
- `test/run4.js:12-21` enters `withPage`, navigates to `page2.html`, reinjects the script, and redeclares `chordClick`. This is load-bearing: navigation drops the original document injection, and the second fixture must be isolated from the first scenario.

**Risks/conflicts:** A fixture option alone is unsafe if it changes the current bootstrap order: the open-shadow-root hook must be installed before navigation, and `page2.html` must be reinjected after navigation. Storage clearing/isolation must remain explicit rather than being silently added to every fixture. The dirty `test/run2.js` WIP is not part of this seam and must not be rewritten or used as a test oracle. Even after that WIP is settled, issue #1's v5.18 failure in run4 makes this a poor concurrent change: it would blur whether a run4 failure is fixture plumbing or product behavior.

**If adopted:** Extend `withPage` with a deliberately narrow fixture option (for example `{ fixture, onPage }`) and keep the common browser/open-shadow-root setup in one place. Have the fixture path perform navigation, userscript reinjection, and any scenario-specific storage reset in an explicit callback; return the existing `chordClick` rather than redefining it in run4. Update only `test/common.js` and `test/run4.js`, then compare run4's assertions and isolation behavior byte-for-byte at the boundary. **Effort: M.**

**Coverage impact:** Coverage-neutral. It changes harness setup and removes duplicated plumbing; run4's SVG/non-HTML and undo assertions remain, and the 8-suite list in `test/run-all.js:1-7` need not change.

## #35 — harness interaction helpers

**Verdict: DEFER-UNTIL the v5.18 diff is resolved and the clean 8-suite baseline is restored; then adopt the wait-predicate slice first.**

**Decision question:** Is it worth replacing repeated fixed sleeps and popover interaction sequences with bounded, diagnostic helpers without hiding scenario-specific assertions?

**Verified evidence:**

- `test/run.js:15-17`, `test/run.js:49-55`, and `test/run.js:77-102` repeatedly use fixed `setTimeout` settling around selection, add-element, and submit flows.
- `test/run3.js:5-24` repeats chord selection, a fixed 150ms wait, direct textarea mutation, primary-button click, and another state read.
- `test/run5.js:59-70` repeats popover comment mutation, chord clicks, release, a 250ms wait, and a state snapshot; `test/run5.js:90-117` repeats reload/reinject, panel open, edit, and save sequencing.
- `test/run6.js:7-14` has a local chord-and-settle wrapper, while `test/run6.js:47`, `test/run6.js:61`, `test/run6.js:75-79`, and `test/run6.js:92` add more fixed sleeps around behavior that is not uniformly time-based.
- `test/run8.js:17-36` repeats the same chord-release wait, popover interaction, target removal, wait, and submit verification.

**Risks/conflicts:** A universal `readPopover` object could make scenario-specific checks less clear, and replacing every delay could break genuinely timing-sensitive behavior. `test/run6.js:246-262` deliberately holds a CDP mouse press for 1.8 seconds; that delay must remain raw. Helpers also risk turning a useful failure into a generic timeout unless `description` and the observed condition are included. The dirty run2 WIP is especially unsuitable for helper migration because its behavior is changing outside this evaluation. Issue #1's run4 break means this must not be mixed into the v5.18 landing decision.

**If adopted:** Start with `waitForHarness(page, predicate, { timeoutMs, description })` and focused predicates such as `waitForPopover` and `waitForAnnotationCount`; migrate only waits that observe DOM/API state. Add small, explicit helpers for setting a comment and clicking a labelled popover action only where the same mechanics recur. Keep suite-local snapshots and raw delays for intentional timing tests. Target `test/common.js`, then migrate repeated sites in `test/run.js`, `test/run3.js`, `test/run5.js`, `test/run6.js`, and `test/run8.js` in small parity-preserving batches. **Effort: M.**

**Coverage impact:** Coverage-neutral if implemented as a harness refactor. The eight suites and their assertions remain unchanged; the meaningful risk is diagnostic behavior (timeouts and messages), not loss of regression coverage.

## #36 — split `test/run6.js` along reset boundaries

**Verdict: DEFER-UNTIL the v5.18 diff is resolved and the clean 8-suite baseline is restored.**

**Decision question:** Is it worth splitting the 278-line, roughly ten-block run6 suite into smaller files to reduce failure-diagnosis cost while preserving every regression assertion and reset boundary?

**Verified evidence:**

- `test/run6.js:1-22` contains the suite-local `annot` and `hostWith` helpers used by multiple blocks.
- The first block occupies `test/run6.js:24-79` (drag persistence, reopen position, Escape reset, then `localStorage.clear()`/API clear at line 79).
- The second block occupies `test/run6.js:81-111` (style preview, restore point, panel revert, then another clear at line 111).
- Later distinct blocks are visible at `test/run6.js:113-148` (two-step Clear), `150-174` (ambiguity and history churn), `176-191` (chrome pass-through), `193-211` (lost/revived draft), `213-245` (empty chord), `246-264` (CDP slow release), and `266-274` (tall-page placement).
- `test/run-all.js:1-7` explicitly wires eight suites, so any split must update that list without changing the total suite contract.

**Risks/conflicts:** The resets at lines 79 and 111 are load-bearing; moving a block without carrying its setup/reset can create order-dependent false passes. The `annot` wrapper includes a 120ms pre-release and 200ms post-release settle (`test/run6.js:7-14`), while the CDP slow-release block has an intentional 1.8s hold (`test/run6.js:246-260`); both must retain their semantics. Splitting can also make shared fixture assumptions invisible. Do not touch foreign `test/run2.js` WIP, and do not land this while issue #1's v5.18 diff still makes run4 red: the gated lane must establish a trustworthy baseline first.

**If adopted:** Make one file per existing reset-isolated behavior group (or a small number of clearly named groups), extracting only the shared `annot`/`hostWith` setup into a common helper. Wire the new files in `test/run-all.js`; preserve each check text, fixture mutations, and reset operation, then perform an assertion-parity comparison before and after. Keep the CDP slow-release case separate from ordinary interaction cases so its deliberate timing remains obvious. **Effort: M.**

**Coverage impact:** Coverage-neutral by design. This is a test-file organization change: the same approximately ten regression blocks and assertions should execute across the same eight-suite harness, with only failure localization improving.

## Overall recommendation

All three ideas are technically viable, but none should compete with the issue #1 v5.18 decision or the foreign run2 WIP. After that lane is resolved and HEAD is again a trustworthy baseline, prioritize #35's wait-predicate slice, then #36's reset-boundary split, with #34's fixture seam either alongside or immediately after those changes. No ticket proposes deleting a regression contract.
