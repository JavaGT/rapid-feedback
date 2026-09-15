# Hostile review — wave 2026-09-16: 922d147 (#40) and 460a0dc (#11)

- Reviewed: committed state only (`git show 922d147`, `git show 460a0dc`, parents `922d147^` and `460a0dc^`), HEAD = `460a0dc`.
- Read-only: no files edited/staged/committed (this report is the requested deliverable; it is untracked in the foreign `.scratch`/`artifacts` working space).
- Baseline: `artifacts/wave-2026-09-16/suite-full.log` → `8/8 suites passed`, `rc=0`, run against HEAD after both commits.
- Note on line numbers: the userscript text is identical between `922d147` and `460a0dc` (the second commit touches only `oxalpha-redesign/`), so HEAD line numbers below are valid for both.

---

## Commit `922d147` — "Popover: name the centered fallback rect; drop no-op try/catch (#40)"

**Verdict: APPROVED** — both claims verified exactly; no behavior change to popover placement, edit-target pinning, or persisted annotation shape.

### Claim (a): `centeredFallbackRect()` is behavior-identical to the old inline literal — VERIFIED

Old literal, `922d147^` (`270fca0`) `rapid-feedback.user.js:1349`:

```js
const rect = el?.isConnected ? getViewportRect(el) : { top: 80, bottom: 80, left: Math.max(8, (innerWidth - POPOVER_W) / 2), right: Math.max(8, (innerWidth + POPOVER_W) / 2) };
```

New, HEAD `rapid-feedback.user.js:1339` + `:1360-1363`:

```js
const rect = el?.isConnected ? getViewportRect(el) : centeredFallbackRect();
...
function centeredFallbackRect() {
    const pad = 8;
    return { top: 80, bottom: 80, left: Math.max(pad, (innerWidth - POPOVER_W) / 2), right: Math.max(pad, (innerWidth + POPOVER_W) / 2) };
}
```

Evidence the substitution is exact, not merely similar:

- `pad = 8` (`:1361`) is the literal `8` from both old `Math.max` calls; every other token (`top: 80`, `bottom: 80`, both `innerWidth ± POPOVER_W) / 2` expressions) is byte-identical.
- Free variables resolve identically. `POPOVER_W` is the enclosing-IIFE `const` (`:132`, value 320); `innerWidth` is the global read at call time. Both were, and remain, captured from the same scope — the function takes no parameters and shadows neither name.
- Call-time semantics match: the old expression evaluated at `resetPopoverPosition` call time; the function also evaluates `innerWidth`/`POPOVER_W` on each call. No hoisting hazard: the call site (`:1339`) precedes the definition textually, but `centeredFallbackRect` is a top-level function declaration inside the IIFE (`'use strict'` at `:35`), so it is hoisted.
- Exactly one call site exists (`rg centeredFallbackRect` → `:1339` call, `:1360` definition). No other consumer of the fallback rect changed semantics.

### Claim (b): the removed try/catch guarded a plain read + assignment that cannot throw — VERIFIED

Removed line (`922d147^` `270fca0:1440`); HEAD body `:1437-1439`:

```js
if (initial && Number.isInteger(initial.editIndex) && !initial.editRef && annotations[initial.editIndex]) {
    initial.editRef = annotations[initial.editIndex];   // try/catch removed here
}
```

- `annotations` is the module-level `let annotations = []` (`:143`), an ordinary Array. The guarded RHS repeats the read `annotations[initial.editIndex]` that the `if` condition on the same line already evaluated to a truthy value. A read that just succeeded cannot throw on re-read — and any throwing getter would already have thrown in the condition, i.e. *outside* the old `try` body, so the removed wrapper never protected that path anyway.
- `initial` is truthy (first clause of the condition) and is always an internally constructed object literal, never a host/proxy object: `:2095` `{ members: [...] }`, `:2371` object literal, `:2635` `pickMode.draft` (built by `currentDraft()` `:1984-1997` / passed through `enterPick`), `:2638` spread literal `{ ...draft, destination }`; `:2792`/`:2920` pass `undefined` (condition short-circuits). None are frozen/sealed and none define an `editRef` accessor.
- Script is strict (`'use strict'` at `:35`), so a *non-writable* property assignment would throw — but no call site supplies such a target, so the statement cannot throw in practice. This is the one residual assumption; it is reasonable and matches #40's framing ("dead armor").
- The guarded access is unlike the platform-accessor guards, which are untouched: `catch` count went 29 → 28 and a diff of the catch-lines shows the *only* removed wrapper is this one. Guard at `:85` (`e.composedPath()`), `:91` (`n.isContentEditable`), and `:1301` (`new URL(a.url)`) all remain.
- Minor documentation nit (not a code defect): #40 and the commit message cite the second platform guard as "`:96`". In `270fca0` and HEAD the composedPath guard is at `:85` and the isContentEditable guard at `:91`; `:96` is `const CATEGORIES = [`. The substantive claim (platform guards stay) is true; the line citation is off by one site.

### Stakes check — no behavior change

- Popover placement: the reset path (`:1334-1344`) produces the identical rect and calls the same `placePopoverAt`/`measurePopover`. `placePopover` (`:1346-1355`) and `getViewportRect` are unmodified in the diff.
- Edit-target pinning: `initial.editRef` is still set to the record by identity in the same condition; the submit path still resolves it by identity (`:2007` `const ref = initial?.editRef;` → `annotations.indexOf(ref)`). The only delta is that a would-be-throwing assignment is no longer swallowed, which cannot occur for current callers.
- localStorage: unchanged. `buildAnnotationData` (`:1982`) persists `{...curData, comment, category, adjustedStyles, styleRestore, destination, targets}`. `editRef`/`editIndex` are runtime-only fields carried on the in-memory draft (`currentDraft` `:1851-1852`), never written to `STORAGE_KEY` (`:127`). No storage-schema impact.

---

## Commit `460a0dc` — "Delete oxalpha-redesign/ blind-rebuild experiment; comparison retained in .scratch (#11)"

**Verdict: MINOR** — deletion is correct and safe; one live doc reference to the deleted directory remains, so #11's stated acceptance is not fully met.

Evidence for the deletion claims:

- Scope: `git show --stat 460a0dc` → only `oxalpha-redesign/DESIGN.md` (-114) and `oxalpha-redesign/rapid-feedback.user.js` (-1537); -1651 total, no other path touched. `git ls-tree -r 460a0dc^ oxalpha-redesign/` lists exactly those two files, so nothing was left behind.
- Git history retains it: `git log --oneline -- oxalpha-redesign/` → `460a0dc` and `85790a7` ("Add OX Alpha independent rebuild and four-way comparison").
- No references in code or tests: `grep -rn 'oxalpha' rapid-feedback.user.js test/` and `grep -n 'oxalpha' README.md` each return no matches (rc=1).
- `.scratch` comparison docs survive and are tracked: `git ls-files .scratch | grep -i comparison` → `.scratch/comparison.md`, `.scratch/comparison-deepseek.md`, `.scratch/comparison-oxalpha.md`.
- Sequencing gate cleared: `git worktree list` shows only the main checkout at `460a0dc`; `git branch -a` shows `main` and `wave-2026-09-10` only — no blind-plan branch or worktree.

### FINDING (MINOR): stale live reference in `AGENTS.md:7`

```
- `rapid-feedback.user.js` (repo root) is the shipped Tampermonkey userscript ... Do not develop in `oxalpha-redesign/` — a frozen one-shot rebuild experiment kept for comparison (#11 tracks its deletion).
```

`oxalpha-redesign/` no longer exists, yet `AGENTS.md` still instructs agents to avoid developing in it and says #11 "tracks its deletion". #11's own acceptance criterion reads: `rg -l "oxalpha-redesign" --glob '!**/node_modules/**'` should return **only the historical comparison docs**. It now returns `AGENTS.md` in addition to the historical artifacts/`.scratch` docs.

Impact: no runtime or test impact (AGENTS.md is guidance, not code/tests — the user's "nothing broke" bar for code is met). But it is stale agent-facing guidance that a naive reader will act on, and it means #11 should not be closed as-is. Recommend updating `AGENTS.md:7` to drop the oxalpha clause (and the "kept for comparison" phrasing) — a one-line change — before closing #11.

Not actioned here because this review is explicitly read-only. No issue was filed for the same reason; the finding is recorded here and should be routed to #11 follow-through or a small follow-up ticket.

---

## Verdict summary

| Commit | Ticket | Verdict | Basis |
|---|---|---|---|
| `922d147` | #40 | **APPROVED** | both claims verified; behavior-identical fallback rect; removed guard cannot throw for all call sites; platform guards (`:85`, `:91`, `:1301`) retained; storage shape unchanged |
| `460a0dc` | #11 | **MINOR** | folder deletion correct, history retained, no code/test refs, `.scratch` comparisons survive; but `AGENTS.md:7` still references the deleted dir, so #11's literal acceptance is unmet until that line is fixed |

Both commits sit on a green `8/8` suite run (`artifacts/wave-2026-09-16/suite-full.log`, rc=0).
