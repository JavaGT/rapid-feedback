# Hostile review — #46 popover placement seam + `POPOVER_INSETS`

- Repo: `/Users/server/Development/rapid-feedback` @ `fbadc45` (worktree dirty only with foreign untracked `.scratch/` + `test/repro-h1.js`)
- Range: `2aed5bf..fbadc45` (two commits: `0ffde94` tests-first, `fbadc45` centralization)
- Files in range: `rapid-feedback.user.js`, `test/run-all.js`, `test/run10.js` (new)
- Method: read committed state (`git show fbadc45:...`), static branch analysis, and execution of `test/run10.js` plus a geometry probe against the shipped script
- Reviewer mandate: try to break the change; read-only except this file

## Verdict

**FIX-FIRST.** `fbadc45` is behavior-preserving and `run10` is green (10/10; full suite 10/10 suites / 123 checks), so there is no shipped-behavior regression to BLOCK. But the commit's central claim — "the gap-to-target / pad-to-viewport-edge policy now has one named source" — is false: two live literal-`8` policy sites remain, including the *drag* clamp itself (`beginPopoverDrag`, `rapid-feedback.user.js:2233-2234`) and a second copy of the fallback rect (`currentAutoPosition`, `:2265`). The issue's own cross-examination listed exactly this as the top break risk ("any caller left on literal `8` keeps the policy split"), and `run10`'s drag case exercises the un-centralized literal, not `POPOVER_INSETS`, so it cannot detect the split. The work is a real, safe progression, but #46's deliverable is not met; fix the two call sites and tighten two test assertions before closing.

## Claim-by-claim

### Claim 1 — "run10 formulas are an independent oracle pinning all five placePopover branches, the centered fallback (rect top 80 then below-gap), and the 8px drag clamp"

**Partly true; overstated on branch coverage and on the drag clamp.**

I executed `run10` against `fbadc45` — 10/10 PASS. I measured the shipped popover height in the harness at `h = 407` (`offsetHeight` of `.rf-popover`, 1200×800). At the post-change viewport (`vh-1 = 799`), production branch selection for the seven matrix cases is:

| Case (run10.js:77-83) | rect @ vw×vh | Production branch (h=407) | Label | Match |
|---|---|---|---|---|
| room below target | [100,100,200,50] @1200×800 | below (`150+407+16≤799`) | below | ✅ |
| target near bottom | [100,700,200,50] | above (`700-407-8=285≥8`) | above | ✅ |
| full-height at left | [100,0,100,800] | right (`200+320+16≤1200`) | right | ✅ |
| full-height at right | [1100,0,100,800] | left (`1100-320-8=772≥8`) | left | ✅ |
| target fills viewport | [0,0,1200,800] | overlap (all four guards fail) | overlap | ✅ |
| lower-half target | [0,500,1200,300] | **above** (`500-407-8=85≥8`) | **overlap** | ❌ |
| narrow viewport | [700,50,80,40] @800×600 | below; left clamps 700→472 | below | ✅ |

- The five branches are each reached at least once (case 5 pins `overlap`), so branch-level coverage holds.
- **Finding A (test honesty, medium):** case 6 (`run10.js:82`) is labeled `overlap` but production takes the `above` branch. It passes only because, for `r.top > innerHeight/2`, the overlap `bestY` arm `r.top - h - gap` is numerically identical to the above branch. Consequence: the overlap branch's lower-half ternary arm (`rapid-feedback.user.js:1366`, `r.top > innerHeight / 2`) is **never exercised** — a regression that dropped the ternary and always used `r.bottom + gap` would still pass `run10`. The label is misleading and the case adds no branch coverage.
- **Finding B (test honesty, medium):** the "8px drag clamp" is pinned by the test-local `PAD = 8` (`run10.js:7`), not by `POPOVER_INSETS`. The code the drag case drives is `beginPopoverDrag` (`rapid-feedback.user.js:2233-2234`), which still uses literal `8`. So the suite does not test the centralization at the drag site at all; it tests the duplicate literal. This is the direct link between Claim 1 and the incomplete centralization (Claim 2).
- Centered fallback: with `h=407`, `centeredFallbackRect()` (`:1373-1375`) yields `top=80`; `placePopover` takes `below` (`80+407+16=503≤800`) → `top=88`, `left=440`. `run10.js:101` asserts exactly that. The `Math.max(pad, ...)` guard in `centeredFallbackRect` is **not** exercised (at `iw=1200`, `(1200-320)/2=440 > 8`), and the expectation is conditional on `h ≤ 704` (a taller popover would leave the `below` branch). The assertion is real but narrower than the claim.

### Claim 2 — "fbadc45 preserves behavior exactly … equals the old literals at all three former sites … branch order/top:80/measured-height untouched"

**Behavior preservation: TRUE. Completeness of centralization: FALSE.**

Values at the three sites it touched are identical (`POPOVER_INSETS = { gap: 8, pad: 8 }`, `rapid-feedback.user.js:130`): `placePopoverAt` clamp (`:1335-1338`), `placePopover` gap/pad (`:1360-1367`), `centeredFallbackRect` pad (`:1374-1375`). Branch order, `top: 80`, and `measurePopover()` usage are unchanged. I confirmed the edit is otherwise mechanical; `placePopoverAt`'s behavior is byte-for-byte equivalent.

But the pre-change file had **five** literal-`8` edge-policy sites, not three (verified on `2aed5bf` and `fbadc45`):

| # | Site | 2aed5bf | fbadc45 | Centralized? |
|---|---|---|---|---|
| 1 | `placePopoverAt` offset clamp | 1332-1333 | 1335-1338 | ✅ |
| 2 | `placePopover` gap/pad | 1355 | 1360-1367 | ✅ |
| 3 | `centeredFallbackRect` pad | 1369 | 1374-1375 | ✅ |
| 4 | `beginPopoverDrag` move clamp | 2228 | **2233-2234** | ❌ literal `8` |
| 5 | `currentAutoPosition` inline fallback rect | 2260 | **2265** | ❌ literal `8`/`80` |

- **Finding C (scope miss, high):** site 4 is *the* persisted-offset drag clamp — precisely what the commit message names as "the dragged-offset clamp." `rapid-feedback.user.js:2233-2234` still clamps `popoverOffset.x/y` with literal `8`, then `placePopoverAt` (`:1337-1338`) re-clamps the same value with `POPOVER_INSETS.pad`. If `pad` ever changes, the popover clamps to the old literal during the drag and jumps to the new pad on the anchor wake — the exact drift the ticket exists to prevent. The prior wave's cross-exam named this risk verbatim ("any caller left on literal `8` keeps the policy split").
- **Finding D (scope miss, high):** site 5 (`:2265`) re-implements `centeredFallbackRect`'s policy inline (`{ bottom: 80, left: Math.max(8, (innerWidth - POPOVER_W) / 2), top: 80 }`). It differs from the centralized helper: it omits `right`, so under a tall popover (`h > 704`) `placePopover`'s `r.right + …` is `NaN` and side placement cannot be chosen, whereas `centeredFallbackRect` defines `right` and can choose the `right` branch. Two fallback rects, one centralized and one not, with divergent edge behavior.
- **Finding E (cosmetic, low):** `placePopoverAt`'s `if (popoverOffset)` block was de-indented from two tabs to one (`rapid-feedback.user.js:1333-1341`), inconsistent with the file's tab convention. No behavior impact.

### Claim 3 — "the 1px-viewport re-place trick exercises the real anchor-key path without flipping branches in the chosen cases"

**TRUE as stated, with caveats.** The anchor key includes `innerWidth`/`innerHeight` (`rapid-feedback.user.js:1392`), and `showPopover` starts the anchor with `getTarget: () => zoomTarget` (`:2080`), so `setViewport({height: vh-1})` changes the key and re-runs `placePopoverAt`. I verified no chosen case flips branch across `vh → vh-1` at `h=407` (headroom: case 1 needs `h≤633`, case 2 `h≤684`, case 6 `h≤484` to stay `above`). The test cannot *prove* the re-place ran (non-clamped cases land identically either way), but that is not required for a placement-value assertion. Caveat: branch *selection* is content-height-dependent; case 6 has only 77px of headroom before it flips to `overlap`, and cases 1/2 have 226/277px. A future content change of ~78px silently changes which branch case 6 exercises (still passing by coincidence — see Finding A), which is why the case should be re-picked deterministically rather than relying on the current `h`.

### Claim 4 — "the Escape retry in run10 close() cannot mask a real regression"

**FALSE as written.** `close()` (`test/run10.js:10-15`) presses Escape, and on timeout presses again. The comment says "the popover may autofocus its comment box — then the first Escape only blurs." That is not how production behaves for these cases: `showPopover` calls `ta.focus()` (`rapid-feedback.user.js:2101`), but the Escape handler only blurs when the draft is **dirty** (`:3078-3089`, `if (dirty) { editable.blur(); return; }`); a pristine draft falls through to `cancelPopover()` and closes on the **first** Escape. `run10` never types, so every draft is pristine and the retry is dead code under current behavior. Consequence: if the first-Escape path regresses (e.g., `popoverDraftGuard` starts reporting dirty, or the capture listener ordering changes) such that a pristine Escape blurs instead of closing, the retry's second Escape still closes and the suite stays green. It cannot mask a total close failure (the second Escape would also fail), but it can mask a first-press regression and the stated rationale is factually wrong. This is the weakest of the five claims.

### Claim 5 — "no shipped-code surface grew (no test-only hooks)"

**TRUE.** `0ffde94` touches only `test/run10.js` and `test/run-all.js`. `fbadc45` adds one module-scope const (`POPOVER_INSETS`, `:130`) and swaps literals; no exported/test-only seam, no new globals, no behavior hook. `run10` drives only pre-existing surfaces (`.rf-popover`, `.rf-drag-handle`, Alt+Meta chord, Alt+Shift+R at `:3068-3069`). Good — the tests-first constraint (no shipped seam) was honored.

## Test honesty / vacuity assessment

- **Cannot pass vacuously on popover absence:** if `POP` were null, `POP.getBoundingClientRect()` inside `readGeo`/fallback `evaluate` throws and the suite rejects (run-all exits non-zero). Not vacuous.
- **`waitForFunction(...).catch(() => {})`** (`run10.js:96-97`): swallows only the settle timeout; the following unconditional `evaluate` + `check` still runs. If reset never fired, `f.pt` would be the original `~158`, not `88`, so the check fails. Not vacuous, but the swallow removes the diagnostic and hides a stalled re-place behind a generic assertion failure (low).
- **`near()` tolerance `≤1`** (`run10.js:44`): production positions are integers (`applyPopoverPosition` rounds, `:1321-1323`), so a tolerance of `0.5` is sufficient. With `≤1`, a 1px error in the very value under centralization passes everywhere — e.g., clamping to `9` instead of `8` yields `|8-9|=1` in both drag cases, and a `pad=9`/`gap=9` regression shifts expected and actual together by 1. **Finding F (test honesty, medium):** the suite cannot distinguish the centralized `8` from `7`/`9`, which undercuts the "8px drag clamp" claim.
- **Oracle independence:** the formulas are an independent recomputation from live geometry (anchor rect + measured height + test constants), not a read of production output — legitimate. But they mirror production's algebra (including `r.left`-based horizontal clamps), so they pin *current behavior*, not *correctness*; a pre-existing logic bug would be reproduced by both. Appropriate for a behavior-preservation refactor; worth stating so the green suite is not over-trusted.
- **Oracle/height coupling:** the expected values use `g.h = p.offsetHeight`, the same quantity production measured. The 200ms settle + forced re-place is what keeps them equal; the test is honest here, but it is the reason the `1px` trick exists and why branch labels are height-sensitive.

## Findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| C | **high** | Drag clamp still on literal `8`; commit's "one named source" false; latent drift if `pad` changes | `rapid-feedback.user.js:2233-2234` vs `:1337-1338` |
| D | **high** | Second fallback rect (`currentAutoPosition`) duplicates `centeredFallbackRect` policy with literal `8`/`80`, and omits `right` → divergent tall-popover behavior | `:2265` vs `:1373-1375` |
| A | medium | Case 6 labeled `overlap` actually exercises `above`; overlap lower-half ternary arm untested | `test/run10.js:82`, `:1366` |
| B | medium | Drag test pins the literal `8`, not `POPOVER_INSETS`; no protection for the centralization | `test/run10.js:7,117,122-124` |
| F | medium | `near() ≤1` cannot catch a 1px pad/gap regression — the value being centralized | `test/run10.js:44` |
| — | low | `close()` retry can mask a first-Escape regression; rationale comment wrong for pristine drafts | `test/run10.js:10-15`, `rapid-feedback.user.js:3078-3089` |
| E | low | `placePopoverAt` if-block de-indented, inconsistent with file tabs | `:1333-1341` |

## Required before closing #46

1. Replace literal `8`s in `beginPopoverDrag` (`:2233-2234`) and the inline fallback rect in `currentAutoPosition` (`:2265`) with `POPOVER_INSETS` (or route both through a shared `clampPopoverPosition` / `centeredFallbackRect` helper, as the ticket proposed). This is the actual deliverable of #46.
2. Re-pick or re-label case 6 so a case deterministically reaches the overlap branch's lower-half arm (e.g., a rect with `400 < r.top < 400 + (h - gap)` — with `h=407`, `r.top` in (400, 423) at 800-high viewport), and add an assertion that distinguishes it from the above branch if possible.
3. Tighten `near()` to `≤0.5` (or assert exact integers), and make the drag expectation derive from a single exported inset value so a 1px drift fails.
4. Fix or remove the misleading `close()` comment; if the retry is kept, scope it to dirty-draft cases so it cannot mask a pristine first-Escape regression.

None of these are shipped-behavior regressions; they are the difference between "safe refactor" and "#46 done."

VERDICT: FIX-FIRST
