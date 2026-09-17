# Abstraction Zoom — commits 533c7bd + 2aed5bf
Repo: /Users/server/Development/rapid-feedback (userscript v5.19, HEAD = 2aed5bf)
Scope: only code introduced/modified by 533c7bd ("pick pointer-transparent feedback hints instead of editor #48") and 2aed5bf ("guard inspection hit tests without pointer coordinates"). Files touched: rapid-feedback.user.js, test/run9.js (new), test/common.js, test/run-all.js, README.md (version note only).

## 1. Outlines (one bullet per step, single abstraction level)

### inspectionElementsAt(ownerDoc, x, y) — NEW, rapid-feedback.user.js:2752-2761
- Temporarily install a document-level style that makes every element hit-testable and RF chrome (`[RF_CHROME_ATTR]`) untestable.
- While it is live, snapshot `ownerDoc.elementsFromPoint(x, y)` (style appended to head, else documentElement).
- Remove the style in `finally`, so no page event can ever observe the override.

### resolveChordTarget(e, hint) — MODIFIED, rapid-feedback.user.js:2763-2791
- Pick the initial target: explicit `hint`, else first element on the composed path, else `e.target`.
- Reject RF chrome targets; resolve the owning document.
- Define the pierce-layer test: known overlay class names as fast path, else the `isOverlayShell` geometry/paint heuristic (unchanged context).
- If the document supports hit-testing and the event carries finite pointer coordinates (2aed5bf guard, line 2775):
  - Take the inspection stack at the pointer via `inspectionElementsAt`.
  - Skip non-elements, pierce layers, RF chrome, and the page root.
  - For the first surviving candidate, keep the composed-path target when the document hit collapsed a shadow descendant onto its host; otherwise adopt the candidate (533c7bd lines 2781-2785).
  - Stop at the first survivor.
- Return null when the target is missing, non-element, or the page root (guard relocated here from the old early return by 533c7bd, line 2789); otherwise return the target.

### test/common.js env/launch — MODIFIED (533c7bd), test/common.js:5-9, 30
- Resolve browser flavor and executable path from `RAPID_FEEDBACK_BROWSER` / `RAPID_FEEDBACK_EXECUTABLE` with legacy `RAPID_FEEDBACK_CHROME` fallback and Firefox/Chrome defaults.
- Launch with per-flavor headless flags (Firefox `-no-remote`, Chrome `--no-sandbox`).

### test/run9.js — NEW suite (533c7bd), suite shape
- Fixture (test/run9.js:8-16): contenteditable `#editor` (870x11553) with a pointer-events:none `#gutter` holding hint paragraph `#hint`; click counter wired on the editor.
- Gesture (17-37): compute the point inside `#hint`'s first client rect; assert native `elementFromPoint` is the editor (fixture reproduces click-through); hold Alt+Meta, mouse-click the point, release; wait for popover, fill `.rf-popover-ta`, click `.rf-btn-primary`, wait popover gone.
- Assertions (25, 39-44): fixture reproduces click-through; saved annotation's selector resolves to `#hint`; annotation captures exactly the hint text with rect < 100px tall; editor DOM byte-identical; editor click count still 0 after the chord; a plain click afterwards bumps it to 1 (click-through preserved).
- Registered in test/run-all.js:2.

## 2. Flags (file:line at HEAD 2aed5bf), with proposed bricks and gap verification

### FLAG A (medium) — page-root predicate re-embedded by hand, 4th in-file copy
- Evidence: rapid-feedback.user.js:2789 (changed line) `if (!target || target.nodeType !== 1 || target === ownerDoc.body || target === ownerDoc.documentElement) return null;`. The same ad-hoc predicate appears at :2688 (destTargetFrom), :2736 (isOverlayShell, inverted), :2780 (loop skip, context). 533c7bd removed the early-return copy and re-added it as two copies (2780 skip + 2789 guard), net +1.
- Level mix: a named domain rule ("the page root is never annotatable") exists only as a repeated raw comparison, mirrored by convention across four sites, two of them in one function.
- Proposed brick: `isPageRoot(el, ownerDoc)` hoisted next to `isRfChrome` (~2720).
- Gap verified: grep for `documentElement` comparisons — four call sites, no existing helper; `isOverlayShell` only inverts it; none of classNameOf / filterClasses / compactAncestorChain / stripScopeHashes covers it.

### FLAG B (medium) — hand-rolled shadow host-chain walk inside the candidate loop
- Evidence: rapid-feedback.user.js:2781-2785 (added) — `let root = target?.getRootNode?.(); while (root?.host && root.host !== el) root = root.host.getRootNode(); if (root?.host !== el) target = el;` — an ad-hoc walk answering "is `el` a shadow-host ancestor of `target`", embedded mid-loop in business logic.
- Level mix: the loop body conflates two levels — candidate eligibility filtering (skip non-element/pierce/chrome/root) and host-branch reconciliation (preserve composed-path precision). The reconciliation rule exists only as an inline while-loop mirrored by no other structure.
- Proposed brick: `isHostAncestorOf(el, target)` (or `walkHostChain(el, visit)`) placed beside `isRfChrome`, which already walks the same chain for a different question; the loop then stays pure filtering.
- Gap verified: grep `getRootNode` — walks exist at :343, :359, :367-386 (selector building), :411-412, :2724 (isRfChrome, chrome detection), :2783-2784; none answer the ancestor-host question. No helper covers it.

### FLAG C (medium) — run9 continues hand-rolled chord + submit conventions; in-file helpers cover only half
- Evidence: test/run9.js:26-30 hand-rolls Alt+Meta down/click/up; test/run9.js:32-36 hand-rolls the popover fill+submit snippet. The same conventions repeat across the harness: Alt+Meta `keyboard.down` in test/run.js:8-9,124,156,191,233,256,275,289, run4.js:24,44, run5.js:33,61,79, run8.js:8-9, run10.js:18-19,76-77; the `.rf-btn-primary` submit snippet appears 20 times across all 9 suites.
- Level mix: the suite's gesture step is raw Puppeteer key/mouse choreography at the same level as its business assertions; a named gesture brick partially exists but is bypassed.
- Proposed bricks: (1) extend `chordClick` (test/common.js:47-50) to own the Alt+Meta hold and accept a selector or point — verified it currently does box-center + unmodified click only; (2) add `submitFeedback(page, text)` to test/common.js. Gap verified: grep for withChord/pressChord/submitFeedback/fillPopover — neither helper exists; `POP`, `waitForPopover`, `chordClick` cover only discovery/wait halves.
- Caveat: if deferred ticket #21 ("chord-listener prologues") was intended to span the test harness too, this flag folds into #21; the userscript listener prologues and the harness presses are distinct sites, so it is reported here with that caveat.

### FLAG D (low) — capability/validity guard split from the mechanism it protects
- Evidence: rapid-feedback.user.js:2775 (2aed5bf) `typeof ownerDoc.elementsFromPoint === 'function' && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)` sits at the call site, while the mechanism that depends on it (`inspectionElementsAt`) is the named abstraction one function up.
- Level mix: the caller must remember inspectionElementsAt's preconditions; the contract is enforced by convention, not by the brick.
- Proposed brick: fold the guards into `inspectionElementsAt` (return null on non-finite coords or missing support) so the call site conditions on the result. Single call site today, hence low.

### Positive judgments (no flag)
- `inspectionElementsAt` is itself the right named brick: one responsibility, try/finally guarantees no event observes the override, single call site, comment states the policy (browser owns paint order; no bbox guessing). 533c7bd correctly routed the previously raw `ownerDoc.elementsFromPoint` call through it.
- 2aed5bf is a correct one-line precondition fix (keyboard-originated or synthetic chord events can lack pointer coords); its only critique is Flag D's placement.
- Behavior note (not an abstraction issue): 533c7bd relocated the body/html null-return from before hit-testing to after, so a body/html initial target can now be upgraded by a real hit-test survivor — the intended fix for the gutter-hint case.

## 3. Deferred directories/sites (already ticketed — not re-reported)
- #16 showPopover split — rapid-feedback.user.js popover construction
- #19 componentFramesFor
- #20 panel shell
- #21 chord-listener prologues (userscript listener guards; see caveat on Flag C re: test harness)
- #26 category-bar duplication
- #27 element-capture trio
- #46 popover inset/gap policy
- #51 History-API route wrapper
- #52 selector/describe engine cleanups (classNameOf bypass, matchCountInScope, collectAttrs table, displayChain, readSvelteMeta)

## 4. Receipt data
- Status: complete. Flags: 0 strong, 3 medium (A, B, C), 1 low (D).
- Headline: B rapid-feedback.user.js:2783-2785; A rapid-feedback.user.js:2789; C test/run9.js:26-36.
