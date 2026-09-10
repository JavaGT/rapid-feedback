# AGENTS.md — rapid-feedback

Settled facts for agents working in this repo. Feature/install docs live in [README.md](README.md); this file covers what agents keep having to re-derive.

## What is what

- `rapid-feedback.user.js` (repo root) is the shipped Tampermonkey userscript and the single source of truth. Do not develop in `luna-redesign/`, `deepseek-redesign/`, or `oxalpha-redesign/` — those are frozen one-shot rebuild experiments kept for comparison (#11 tracks the oxalpha deletion).
- `test/` holds the dev-only Puppeteer harness. `test/run-all.js` wires suites run1–run8. Run with `cd test && npm install && npm test`; override the Chrome binary with `RAPID_FEEDBACK_CHROME`. Tests introspect the closed shadow roots, so the harness force-opens them (`test/common.js`).
- `.scratch/` is per-agent working space (notes, plans, repro pages). Untracked files anywhere — including `test/repro-h1.js` — may be another agent's in-flight work: read-only until claimed.

## Worktree discipline

- The worktree is shared and often carries another agent's uncommitted WIP (the "v5.18 lane"). Never write, stash, or reset files you do not own; commit only your own paths, and check `git diff --stat` per file before committing.
- Analyze committed state, not the worktree: `git show HEAD:rapid-feedback.user.js`. A red test run may reflect foreign WIP, not HEAD — establish whether HEAD is green before blaming your change (see issues #1/#22 for a past incident).

## Conventions

- Tickets: `gh -R JavaGT/rapid-feedback`, titles prefixed `[wave YYYY-MM-DD]`. Every material finding (strong, speculative, or evaluate-only) gets an issue; never close a ticket just because a report exists — close on reconciled evidence.
- Decision memos and converged goals live in `.scratch/converged-goal.md`; the v5 architecture map in `.scratch/rapid-feedback-v5/MAP.md`.
- Pain journal: when friction costs you time, append one line to `~/.config/opencode/pain-journals/rapid-feedback.md` (`date | area | one line`) without stopping task work.
