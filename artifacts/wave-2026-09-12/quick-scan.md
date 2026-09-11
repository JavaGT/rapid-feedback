# Quick-scan delta — 2026-09-12

Baseline: `HEAD cfe6b70` (`cfe6b70954a3597c1d30230fd7a5964e662a33b2`).
Scope was limited to the README, root AGENTS.md, the newest eight commits,
package/test wiring, and repository hygiene. Existing open issues #1–#31 were
used as the duplicate filter; no tickets were opened.

## Ranked findings

| Rank / strength | Evidence | Finding | One-line fix sketch |
|---|---|---|---|
| 1 — **Strong** | `test/run6.js:71-78`; `rapid-feedback.user.js:2986-2992` at HEAD; `ea5e8b1` message and `.scratch/converged-goal.md:14-16` | The newest commit calls this a “two-stage Escape test” and describes preserving a textarea draft, but the committed test only presses Escape twice and checks that the offset is eventually cleared. It passes against HEAD’s old one-stage handler: the first press closes the popover, and the second operates on the next layer. Thus it does not detect the exact draft-loss regression it claims to cover. | After the first Escape, assert the popover still exists, the textarea value is unchanged, and focus has left the editable; then assert the second Escape closes it. Land the implementation and test contract together. |
| 2 — **Worth exploring** | `rapid-feedback.user.js:3031-3033`; `README.md:25-38` | The userscript exposes a user-facing `Alt+Shift+R` recovery shortcut to reset a dragged popover’s position, but the README’s interactions table documents the other keyboard gestures and does not mention it. A user whose popover is misplaced has no documented recovery path. | Add `Alt+Shift+R — Reset the open popover position` to the interactions table, including the Mac/Windows modifier wording if platform-specific behavior is intended. |
| 3 — **Worth exploring** | `.gitignore:1-2`; root `AGENTS.md:9`; current untracked `.scratch/repro/`, `.scratch/wave-2026-09-12-0700/`, and `artifacts/automation-receipts/2026-09-12/` | Ignore coverage only handles dependencies and macOS metadata. The repo’s documented per-agent scratch area and generated automation receipts therefore appear as untracked litter on every scan, while durable reports under `artifacts/wave-*` are intentionally committed. This increases dirty-tree ambiguity and makes accidental commits easier. | Add narrowly scoped ignores for generated scratch/probe and automation-receipt paths (for example `.scratch/repro/`, `.scratch/wave-*/`, and `artifacts/automation-receipts/`), while keeping report paths trackable. |

## Checks that produced no new finding

- `README.md:83-89` matches the actual test command: `test/package.json:3`
  defines `npm test` as `node run-all.js`, and `test/run-all.js:1` wires
  `run.js` plus `run2.js`–`run8.js`; all eight suite files exist.
- A clean archive of `HEAD` ran `cd test && npm test` successfully: **8/8
  suites passed**. The existing run-all fail-fast/unguarded assertion issues
  were excluded because they are already covered by open issues #14 and #9.
- No new contradiction was found in the root AGENTS.md navigation facts. Its
  dated dirty-path note remains a snapshot, not a claim that no other agent
  files can become dirty.
- README feature claims checked against HEAD (multi-select, destination pick,
  live style preview, iframe handling, selectors, exports, storage envelope,
  and Svelte context) had no additional delta finding. Storage keys are not
  advertised by README, so there is no key-name contradiction to report.

## What I did not look at

- The uncommitted `rapid-feedback.user.js` and `test/run2.js` changes, except
  to identify them as foreign WIP; all behavior conclusions use committed
  `HEAD` content.
- Frozen redesign directories, broad userscript architecture, prior-wave
  findings, and any issue already represented by open #1–#31.
- Browser/manual UX, accessibility, performance, security, cross-tab storage,
  and production Tampermonkey installation behavior beyond README/code
  consistency.
