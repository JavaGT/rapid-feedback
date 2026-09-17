# Hostile re-review — #46 remediation `4fd7f69`

- Repo: `/Users/server/Development/rapid-feedback` @ `4fd7f69` (worktree dirty only with foreign untracked `.scratch/` + `test/repro-h1.js`)
- Scope: `4fd7f69` ("Popover + test: FIX-FIRST remedies for the #46 hostile review"), the remediation for the FIX-FIRST verdict on `2aed5bf..fbadc45` (`hostile-review-46.md`)
- Method: read committed state (`git show 4fd7f69:...`), line-level diff inspection, whitespace inspection (`sed -n l`), and execution of `test/run10.js` plus the full suite (`npm --prefix test test`, 10/10 suites)
- Reviewer mandate: try to break the change; read-only except this file

## Verdict

**APPROVED.** All five required items are met with file:line evidence, the two shipped-code edits are value-identical substitutions of the centralized `POPOVER_INSETS.pad`, and the test suite is green (run10 10/10, full suite 10/10). The drag clamp (`rapid-feedback.user.js:2232-2235`) and the inline fallback pad (`:2268`) now source `POPOVER_INSETS.pad`; the only remaining literal-`8` policy sites are gone (grep for `clamp(..., 8` / `Math.max(8` returns empty). The old mislabeled overlap case is replaced by a true lower-arm case whose precondition is asserted live (`test/run10.js:98`, observed `{at:406,h:407,inWindow:true}`), so it can no longer pass by the above-branch formula coincidence described in Finding A. `near()` is 0.5, `close()` throws on a pristine surviving Escape instead of masking it, and `placePopoverAt`'s body is back to the file's two-tab function indentation. The diff introduces no new production literals and no behavior drift; the residual observations below are low-severity and non-blocking.

## Item-by-item

### 1. Drag clamp + inline fallback now source `POPOVER_INSETS.pad`; behavior byte-identical — PASS

- `POPOVER_INSETS = { gap: 8, pad: 8 }` — `rapid-feedback.user.js:130`, untouched by this commit.
- `beginPopoverDrag` — `rapid-feedback.user.js:2232` adds `const { pad } = POPOVER_INSETS;`, and `:2234-2235` replace the two literal-`8` clamps with `pad`. Diff (`git show 4fd7f69 -- rapid-feedback.user.js`) shows only `8` → `pad` at those four positions; no other token changed.
- `currentAutoPosition` — `rapid-feedback.user.js:2268` `Math.max(POPOVER_INSETS.pad, (innerWidth - POPOVER_W) / 2)` replaces `Math.max(8, ...)`. Identical value while `pad === 8`.
- Behavior identity is exact, not approximate: `applyPopoverPosition` rounds once at `rapid-feedback.user.js:1321`, so with `pad === 8` every clamp bound is the same integer as before.
- The fallback rect still omits `right` (`:2268` builds `{ bottom: 80, left, top: 80 }`); this is deliberate and documented at `:2262-2265` ("Mirrors the fallback rect minus `right` ... side branches stay unreachable ... as today"). It preserves pre-commit reachability — see residual note R1.

### 2. run10 has a true overlap lower-half-arm case with a live precondition; mislabeled case gone — PASS

- The old `matrixCase(... [0, 500, 1200, 300], 'overlap')` line is removed and replaced by the block at `test/run10.js:86-107`.
- Precondition is computed live and required by the assertion: `test/run10.js:98` `inWindow = g.at > g.ih / 2 && g.at < g.h + GAP + PAD`, gated into `check(... inWindow && near(g.pt, expectedTop) && near(g.pt, PAD) && near(g.pl, PAD))` at `:101-103`.
- The window is exactly the complement of production's `above` guard (`rapid-feedback.user.js:1363`, `r.top - popoverH - gap >= pad`): `at < h + gap + pad` means `above` cannot fire, and `at > ih/2` selects the overlap lower ternary arm (`:1366`). With the 1200-wide anchor, `below`/`right`/`left` cannot fire, so `inWindow === true` ⟹ the lower arm is the branch taken.
- Live run confirms the precondition and the pin: `PASS ... (preconditions {"at":406,"h":407,"inWindow":true})`. With `h = 407`, the above-branch formula would coincide with the unclamped lower arm, but the gate requires `h > 390`; had `h <= 390` the predicate is false and the check fails (no vacuous pass). Expected top is the lower-arm formula (`:99`), which differs from the upper-arm result (`g.ab + GAP` clamped to `ih - h - pad = 384`), so the ternary is now genuinely exercised — Finding A resolved.

### 3. `near()` is 0.5 — PASS

- `test/run10.js:48` `const near = (a, b) => Math.abs(a - b) <= 0.5;` (was `<= 1`).
- Production positions are integers (`rapid-feedback.user.js:1321`), and every expected value in the suite is integral, so 0.5 is the tightest whole-pixel-exact tolerance. It now catches a 1px pad/gap drift: e.g. `POPOVER_INSETS.pad = 9` makes the drag clamp actual `9`/`871` against the oracle's `8`/`872`, both off by 1 > 0.5. Finding F resolved.

### 4. `close()` retries second Escape only when `.rf-popover-ta` non-empty, else throws — PASS

- `test/run10.js:12-19`: first Escape (`:13`), settle-or-fall-through (`:14`), live dirty probe `:15` `!p.querySelector('.rf-popover-ta')?.value`, hard failure `:16` `if (!dirty) throw new Error('pristine popover survived first Escape')`, and only then the second Escape (`:17`).
- This matches production: a pristine draft has no dirty guard (`rapid-feedback.user.js:1829`, `popoverDraftGuard`), so `:3085` yields `dirty = false`, `:3090` does not blur, and `:3093` `cancelPopover()` closes on the first Escape; only a dirty draft blurs first. The previous rationale comment was wrong and is corrected at `:8-11`. The retry can now only fire when there is real work to justify it, so it cannot mask a pristine first-Escape regression.

### 5. `placePopoverAt` indentation matches the file convention — PASS

- `rapid-feedback.user.js:1333-1340` body is two tabs (`sed -n '1330,1343p' | sed -n l` shows `\t\tif`, `\t\t\tconst`, `\t\t}`), matching `placePopover` (`:1359-1367`) and the one-tab function / two-tab body convention. The de-indent Finding E is resolved; the change is whitespace-only (no behavior).

## New literals / behavior drift

- `git show 4fd7f69` touches only `rapid-feedback.user.js` and `test/run10.js`. The only production edits are the `pad` substitutions plus one `const { pad } = POPOVER_INSETS;`; no new numeric literal is added to shipped code, and the two literal-`8` policy sites are removed. `grep -n "clamp([^)]*, 8\|Math.max(8\|innerWidth - POPOVER_W - 8" rapid-feedback.user.js` returns nothing.
- Test additions are test data only (`406`, `300`, `799`, timeouts), consistent with the existing cases; the independent oracle still uses test-local `GAP`/`PAD` (`test/run10.js:7`), which with the tightened `near()` is what detects 1px production drift.
- Execution: `test/run10.js` 10/10 checks; `npm --prefix test test` → 10/10 suites passed. No regression observed.

## Residual observations (low, non-blocking)

- **R1 — duplicated fallback rect still carries a literal `80`.** `currentAutoPosition` (`rapid-feedback.user.js:2268`) reproduces `centeredFallbackRect` (`:1375`) inline, keeping `top: 80`/`bottom: 80` literal and omitting `right`. #46 scopes "viewport inset/gap policy" and explicitly says to preserve the current 80px top, and the divergence is now documented (`:2262-2265`); behavior is unchanged. Only if `centeredFallbackRect`'s `top`/`bottom` were later edited would the two copies drift. Not introduced by this commit.
- **R2 — the new overlap case is intentionally pinned to a narrow window.** `h` must exceed 390 and is currently 407 (≈17px margin). If popover content shrinks by ≥18px, the case fails on its own precondition rather than passing vacuously — an honest tripwire, but it will need re-picking on a real content-height change.
- **R3 — the dirty probe inspects only the textarea value** (`test/run10.js:15`), a subset of production dirty (which also counts style tweaks/destination/category, `rapid-feedback.user.js:1829-1832`). The error direction is safe: it can only over-throw, never mask a pristine first-Escape failure.

None of these are shipped-behavior regressions, and none are within the scope the re-review was asked to enforce.

VERDICT: APPROVED
