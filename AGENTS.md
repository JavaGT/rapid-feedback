# AGENTS.md — rapid-feedback

Settled facts for agents working in this repo. Feature/install docs live in [README.md](README.md); this file covers what agents keep having to re-derive.

## What is what

- `rapid-feedback.user.js` (repo root) is the shipped Tampermonkey userscript and the single source of truth. The `oxalpha-redesign/`, `luna-redesign/`, and `deepseek-redesign/` one-shot experiments were deleted (#11, #39); their comparisons remain in `.scratch/comparison-oxalpha.md`, `.scratch/comparison.md`, and `.scratch/comparison-deepseek.md`.
- `test/` holds the dev-only Puppeteer harness. `test/run-all.js` wires the eleven suites: `test/run.js` plus `test/run2.js`–`test/run11.js` (no `run1.js`). Run from the repo root with `npm --prefix test install && npm --prefix test test` (or a `(cd test && npm test)` subshell) — a bare `cd test` can outlive its command, chained in the same call or persisted across calls in runtimes with persistent shells, leaving later git commands inside `test/` with broken repo-root pathspecs (#45); override the browser with `RAPID_FEEDBACK_BROWSER` (`chrome`/`firefox`) or a specific binary with `RAPID_FEEDBACK_EXECUTABLE` (`RAPID_FEEDBACK_CHROME` still works as a last-resort Chrome alias) (`test/common.js`). Tests introspect the closed shadow roots, so the harness force-opens them (`test/common.js`).
- `.scratch/` is per-agent working space (notes, plans, repro pages). Untracked files anywhere — including `test/repro-h1.js` — may be another agent's in-flight work: read-only until claimed.

## Worktree discipline

- The worktree is shared and often carries another agent's uncommitted WIP. Never write, stash, or reset files you do not own; commit only your own paths, and check `git diff --stat` per file before committing. Which paths are dirty changes as lanes start and stop — run `git status` first; the long-running "v5.18 lane" landed as `270fca0` (2026-09-14), and at this writing (2026-09-15) the worktree holds only untracked `.scratch/` notes plus `test/repro-h1.js`.
- Analyze committed state, not the worktree: `git show HEAD:rapid-feedback.user.js`. A red test run may reflect foreign WIP, not HEAD — establish whether HEAD is green before blaming your change (see issues #1/#22 for a past incident).

## Conventions

- Tickets: `gh -R JavaGT/rapid-feedback`, titles prefixed `[wave YYYY-MM-DD]`. Every material finding (strong, speculative, or evaluate-only) gets an issue; never close a ticket just because a report exists — close on reconciled evidence.
- Decision memos and converged goals live in `.scratch/converged-goal.md`; the v5 architecture map in `.scratch/rapid-feedback-v5/MAP.md`.
- Pain journal: when friction costs you time, append one line to `~/.config/opencode/pain-journals/rapid-feedback.md` (`date | area | one line`) without stopping task work.
- `rg` skips dot-dirs by default: when verifying references that may live in `.scratch/`, pass `--hidden` — a silent near-miss once shipped a wrong BREAKS claim (2026-09-13).
