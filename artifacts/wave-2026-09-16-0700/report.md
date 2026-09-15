# Wave 2026-09-16 0700 (attempt 1) — discovery report

Run: `rapid-feedback-0700`, attempt 1, started 2026-09-16T11:21+12:00. Coordinator: GLM
(native discovery/implementation); review via `opencode2` child on the route-table route.
Baseline: `2b796fd` (morning wave artifacts); this wave's commit: `6077199`.

## Admitted playbooks and outcomes

### quick-scan — complete (no-new-finding after verification)
Hotspots since the 09-15 scan baseline: `7eed262` (harness waitFor, already reviewed +
ticketed #42/#43 this morning), `0be14c2`/`922d147` (user.js, hostile-APPROVED this
morning), `fbaae75` (AGENTS.md). Docs-vs-code spot checks all passed:
- README interactions table already documents dirty-draft Escape (README:36, "Esc | Leave
  the comment box first when the draft holds work") — an apparent drift finding was
  retracted after reading the table (initial grep for "Escape" missed the "Esc" row).
- README:38-39 matches the Alt+Shift+R / FAB reset behavior (user.js:3045-3048, :1243).
- **What I did not look at:** `test/run2.js`–`run8.js` internals (only run.js/common.js
  hotspots), the panel/export code paths (ticketed #20/#26/#30 territory), `.scratch/`
  untracked files (foreign, read-only), userscript storage/envelope internals (#41 open).

### abstraction-zoom — complete (no-new-finding)
Admitted area: the v5.18-added functions (270fca0 delta, ~85 lines) — `eventFromEditable`
(:83), `resetPopoverPosition` (:1337, now uses `centeredFallbackRect` per 922d147), the
`editRef` identity pin (:1440), `popoverDraftGuard` (:1819), the submit-by-identity
branch (:2010), the document-capture keydown handler (:3044). All are single-level,
named, and commented to constraint standard. The Escape handler's layering maps to #5
(one Escape-priority owner) and the composedPath pattern to #21 — both already ticketed;
nothing new to file. Deferred: whole-file splits of the userscript (#16/#19/#20 scope)
and the test suites (#31/#33/#36) — re-litigating ticketed areas was out of budget.

### forced-subtraction — complete (analysis + evaluate ticket)
Admitted area: the userscript header `@note` changelog block (`rapid-feedback.user.js:6-31`,
19 entries, grows every version, zero consumers — grepped harness + tooling). GOES: all
but the newest ~3 notes. STAYS: @version/@name/@description + newest note (Tampermonkey
update-prompt surface). BREAKS cross-exam: none at runtime (free-form metadata). Filed as
**#44 (evaluate-only; implementation explicitly NOT the todo)**. Deferred areas:
storage/envelope (#41 open), harness sleeps (#43 open) — both already ticketed.

### pain-journal — complete (entry mined → fix landed)
Journal was live; one unmined entry (2026-09-16 shell): bare `cd test` persisted into the
next tool call and broke a git pathspec. Root cause: AGENTS.md:8 itself documented the
bare-`cd` form. Fix: AGENTS.md now documents `npm --prefix test install && npm --prefix
test test` from the repo root (or a `(cd test && npm test)` subshell). Journal entry
replaced with a `mined` line. Ticket **#45**, fix committed as `6077199`.

## Focused check
`npm --prefix test test` from repo root: **8/8 suites passed** (rc=0), log
`suite-root-invocation.log`. `npm --prefix test install` also verified (rc=0) — both
documented forms work.

## False positives caught (verification-before-filing)
1. "No-op try/catch at user.js:1441" — already removed by `922d147` this morning; the
   270fca0 diff I first read was the pre-fix side.
2. "README missing dirty-Escape docs" — present at README:36; my grep pattern missed it.

## Child usage
1/3: hostile review of `6077199` + #44 BREAKS cross-exam (`deepseek-v4.1-flash` route,
background). Consultants not seated: both deliverables are trivia-graded with direct
in-repo precedent; cross-evaluation would be ceremony, not evidence.

## Hostile review round (deepseek-v4.1-flash) — verdicts and reconciliation
Log: `review-6077199-dispatch.log`. All three findings accepted and remedied in `0b1de4c`:
1. **FIX-FIRST — cwd-hazard overbroad.** Reviewer's runtime resets cwd per tool call
   (`cd /private/tmp` then separate `pwd` → repo root), refuting "persists in every
   runtime here"; this wave's ZCode shell does persist, so it is runtime-dependent.
   AGENTS.md wording now says a bare `cd test` "can outlive its command, chained in-call
   or persisted across calls depending on runtime". Command itself APPROVED
   (test/package.json:2; 8/8 suites, 107 PASS = baseline).
2. **MINOR — README.md:85-89 contradiction.** README still showed the bare `cd test`
   sequence; aligned to the same `npm --prefix test` form.
3. **#44 corrections posted as a ticket comment:** notes are lines 6-23+31 (24-30 are
   @author/@match/@grant), header is non-chronological so GOES must prune by version not
   position, and STAYS rationale corrected (@note is not a Tampermonkey metadata key; no
   update prompt renders it — retention value is human archaeology only).

Reconciliation: #45 **closed** (criteria met, remedies landed, reviewed); #44 stays open
as evaluate-only. No second review round: the remedies are verbatim the reviewer's own
prescriptions, verified by inspection against its evidence.
