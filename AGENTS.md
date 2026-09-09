# rapid-feedback — agent notes

- Friction journal: append one line per friction event (date | area | one line) to
  `~/.config/opencode/pain-journals/rapid-feedback.md` without stopping task work.
- Mine the journal before planning: repetition weight = priority signal.
- Tests: `node test/run-all.js` from repo root (puppeteer-core drives system Chrome;
  deps live in `test/node_modules`). Keep the baseline green before/after changes —
  every suite runs even when one crashes, and any red suite blocks a commit.
