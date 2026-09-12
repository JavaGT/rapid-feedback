# Forced-subtraction report — frozen redesign dirs (2026-09-13)

**Baseline:** `3bf9be9` · **Deletion commit:** `9eb0911` · **Ticket:** #39
(hostile-APPROVED, closed) · Sibling ticket: #11 (oxalpha, claimed by the
2026-09-10 lane, untouched).

## Partition and admission

| Bucket | Verdict |
|---|---|
| `rapid-feedback.user.js` (2,104+ lines) | **Deferred** — foreign uncommitted v5.18 WIP; deletion batch already ticketed (#29 et al.), read-only this wave |
| Test harness | **Deferred** — 2026-09-12 subtraction pass done; refactors DEFER-UNTIL per committed `evaluation-34-35-36.md` |
| `luna-redesign/`, `deepseek-redesign/` | **Admitted** — the 2026-09-12 wave's deferred bucket, unblocked (no lane dependency, no code references) |
| `oxalpha-redesign/` | **Deferred** — #11, claimed and sequenced behind the blind-plan lane (checkpoint comment posted this wave) |

## Finding → execution (#39)

- **GOES:** both folders (128 + 2,477 lines, untouched since 2026-08-21).
  Purpose delivered; comparisons durably tracked in git
  (`.scratch/comparison.md`, `.scratch/comparison-deepseek.md`).
- **STAYS:** comparison docs, `app-brief.md`, wave reports, foreign untracked
  blind-plan scratch (verified zero references from them to the deleted dirs).
- **BREAKS (cross-examined):** none. `rg --hidden` over the repo finds only
  doc/report matches — zero `.js`/test references. Harness wires only the
  root userscript (`test/common.js`).

## Acceptance ("nothing broke")

Clean archive of HEAD with both dirs removed:
`node test/run-all.js` → **8/8 suites passed, exit=0**
(`deletion-sim-test.log`). Hostile review (glm-5.3-flash route) verified all
five checks — commit scope exact, residual refs docs-only, comparisons still
tracked, acceptance log, foreign WIP untouched — verdict **APPROVED**
(`hostile-review-39.md`). Reviewer note: `app-brief.md:75` still names
`luna-redesign/` as a deliverable target — historical brief, stale but
harmless; left as history.

## Process note

The first reference sweep used `rg` without `--hidden`, which silently
skipped `.scratch/` (dot-directory) and nearly produced a wrong BREAKS claim;
caught before ticketing by re-reading the comparison docs. Friction recorded
in the pain journal.
