# Wave 2026-09-15 0730 — quick-scan + abstraction-zoom (combined, native)

Scope: the only delta since the 2026-09-13 scan baseline — commit `270fca0`
(v5.18 lane + draft safety), the recently-changed hotspot. Repo navigation docs
read first (AGENTS.md, prior receipts); settled decisions not re-litigated.

## Ranked findings (strength x leverage)

1. **resetPopoverPosition mixes geometry policy into a state-reset brick** —
   MEDIUM strength / MEDIUM-LOW leverage. `rapid-feedback.user.js:1352`: the
   off-screen fallback rect (`top: 80`, `Math.max(8, (innerWidth - POPOVER_W)/2)`,
   centering) is hand-rolled inline inside a function whose job is "clear the
   dragged offset and re-place". The same viewport-edge/centering policy lives
   in `placePopover` (:1356-1362, gap/pad). Drift risk if placement policy
   changes. → ticketed as **#40** item 1 (abstraction-zoom class: ad-hoc
   structure mirrored by convention).
2. **No-op try/catch around a plain assignment** — LOW / LOW.
   `rapid-feedback.user.js:1441`: `try { initial.editRef = annotations[...] } catch {}`
   cannot throw; contrast :91/:96 where try/catch guards real platform
   accessors. → ticketed as **#40** item 2 (forced-subtraction class: dead armor).

## Zoomed clean

`eventFromEditable` (:80-97) — one abstraction level, guarded platform accessors
justified. `popoverDraftGuard` closure (:1813-1817) — dirty-check policy named
and commented. Edit-by-identity submit (:2002-2012) — identity pin at
showPopover + indexOf replace; comments carry the invariant. FAB click handler
(:1250-1253) — three-way branch at the right level. README interactions table
matches code (Alt+Shift+R documented).

## Tickets

- **#40** created: v5.18 follow-ups (both items, evaluate-framed).

## What I did not look at

- `test/run2.js` v5.18 additions (suite exercise, not hotspot review) — the
  #35 wait-predicate slice touches harness call sites instead.
- Suites run3-run8 bodies (no changes since their 09-10/09-12 zooms).
- `.scratch/` untracked files (foreign WIP, read-only per AGENTS.md).
- oxalpha-redesign/ (#11 remains sequenced behind the blind-plan lane;
  unchanged this wave).
