# Abstraction-Level Zoom — Test Harness (2026-09-12)

Analysis target: `test/run.js`, `test/run3.js`–`test/run8.js`, `test/common.js`, `test/run-all.js`, plus `git show HEAD:test/run2.js`.

Already ticketed and not re-reported: #31 (shadow-root scan IIFEs and missing `PANEL`/`BANNER` constants), #9/#14 (page errors, isolation, and unsafe `find().click()`), #22 (worktree versus HEAD), and #1 (dirty v5.18 diff). The userscript and frozen redesign directories were outside this pass.

## Findings

### F1 — Chord-selection gesture is repeated in every suite [STRONG]

Evidence: `test/run.js:8-17,124-127,156-159,191-194,233-236,275-278,289-292`; `test/run3.js:6-9,21-24,35-38`; `test/run4.js:24-27,44-47`; `test/run5.js:33-37,61-65,79-82`; `test/run7.js:26-31`; `test/run8.js:8-17`; foreign-WIP file — no edits: `test/run2.js` at HEAD `:8-11,48-51`.

The same low-level sequence is conventionally reassembled, often with different waits:

- press `Alt`;
- press `Meta`;
- click one or more selectors;
- release `Meta`;
- release `Alt`;
- sleep until the popover is presumed settled.

Proposed brick: `async chordSelect(page, chordClick, selectors, { settleMs = 200 } = {})` — owns key ordering, clicks all selectors, releases keys in `finally`, and waits for the selection UI to settle. A separate `async chordPick(page, chordClick, selector, options)` may express one-target picks without making callers construct a one-item array. This would make gesture semantics one named operation instead of test-local ceremony.

### F2 — Alternate fixture setup forks `withPage` and duplicates harness bootstrapping [STRONG]

Evidence: `test/common.js:26-52` provides launch, page creation, viewport, listeners, shadow-root opening, `page.html` navigation, userscript injection, and `chordClick`; `test/run4.js:3-21` re-reads the script, navigates to `page2.html`, creates another `chordClick`, and bypasses `withPage`.

The repeated/forked setup is:

- read the userscript from disk;
- navigate to a fixture;
- create a selector-to-center-point click helper;
- inject the userscript;
- run the suite callback;
- rely on the caller to reproduce any required harness instrumentation.

Proposed brick: `withPage(run, { fixture = 'page.html', onPage } = {})` — keeps browser/page lifecycle and the standard pre-document hook in `common.js`, navigates the requested fixture, injects the script, and supplies the same click helper. `run4` could request `page2.html` and add only its SVG-specific assertions/listener. This is setup abstraction, not a request to merge the intentionally different fixtures.

### F3 — Fixed-delay settling is hand-rolled throughout the suites [MEDIUM]

Evidence: repeated `new Promise(...setTimeout...)` calls in `test/run.js:17,55,72,79,86,102,127,134,159,164,194,198,211,236,260,278,292,297`; `test/run3.js:8,15,23,37,39,55`; `test/run4.js:27,32,34,40,47,53-58`; `test/run5.js:26,37,65,74,82,101,105,115`; `test/run6.js:11-14,47,61,75-79,92,99,108,126,146,162,168-174,199,204,210,228,257-260,273-274`; `test/run7.js:15,31,54,69`; `test/run8.js:17,24,34`.

The recurring sequence is:

- perform an action that changes harness state;
- guess a duration for rendering/event propagation;
- sleep;
- query the DOM and assert.

Proposed brick: `async waitForHarness(page, condition, { timeoutMs, description })` — polls a supplied browser-side predicate with a bounded timeout and useful failure text; provide focused predicates such as `waitForPopover(page, present = true)` and `waitForAnnotationCount(page, count)`. Keep a small `delay(ms)` only for genuinely time-based behavior (for example the slow-release test), rather than using arbitrary sleeps for every UI transition.

### F4 — Popover actions are encoded as repeated selector/text-search scripts [MEDIUM]

Evidence: `test/run.js:37-44,50-54,67-71,78-79,95-101,128-133,160-163,195-201,237-238,260-261,293-296`; `test/run2.js` at HEAD `:23,29-35,52-59,69-79`; `test/run3.js:9,18,24,38,43,47,51`; `test/run4.js:8,31-34,48-57`; `test/run5.js:60-65,73-86,104-114`; `test/run6.js:59-60,84-91,114-135,159-161`; `test/run7.js:45-53`; `test/run8.js:19-23,33-34`.

Representative repeated sequence:

- interpolate `POP` into a string passed to `page.evaluate`;
- find a tab, textarea, small action button, or primary button;
- identify it by index or visible text;
- mutate `.value` or dispatch an `input` event;
- click the action;
- wait for the resulting UI state.

Proposed bricks: `async setPopoverComment(page, text)` — writes the textarea; `async clickPopoverAction(page, labelOrMatcher)` — resolves and clicks a named popover action; `async submitPopover(page, { comment, tab, styleInput })` — absorbs optional tab selection, input mutation, submit, and settling. These should remain test-facing helpers and hide only DOM mechanics, not the scenario intent.

### F5 — Popover state snapshots repeat ad-hoc DOM-to-object mapping [LOW]

Evidence: `test/run.js:19-28,59-64,73-75,87-89,104-110,165-175,203-206,239-245,298-302`; `test/run2.js` at HEAD `:12-16,25,60-63,73-75`; `test/run3.js:16-17,30-31,40-45,52-57`; `test/run5.js:38-40,66-70,83-88,106-110`; `test/run6.js:27-31,49-53,63-69,100-106,127-148,181-191,200-209,261-262`; `test/run7.js:33-39`; `test/run8.js:26-31`.

The repeated shape is:

- interpolate `POP` into an evaluated function;
- locate the popover;
- read a hand-picked set of classes, text, styles, row counts, or field values;
- return a one-off object;
- stringify that object separately for assertion detail.

Proposed brick: `async readPopover(page, fields = defaultPopoverFields)` — performs one consistent snapshot query and returns stable fields such as `open`, `rows`, `comment`, `title`, `lost`, `destination`, and `banner`; optional field readers can cover suite-specific details. Pair it with `assertCheck` only if the project wants assertion formatting centralized. This is lower strength because scenario-specific snapshots are sometimes clearer than a universal state object.

## What I did not look at

- I did not inspect or report on `rapid-feedback.user.js` or the frozen redesign experiments.
- I did not inspect the uncommitted contents of `test/run2.js`; only `git show HEAD:test/run2.js` was analyzed, and all references to it above are marked foreign-WIP file — no edits.
- I did not re-report the already-ticketed issues listed at the top, including the `PANEL`/`BANNER` shadow-root scan duplication.
- I did not run the harness or modify source files; this is a static abstraction review.

Analysis is pinned to HEAD `cfe6b70`.
