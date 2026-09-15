# Hostile review — landed commits a0f4d02 (#29, #13) and 7eed262 (#35 slice)

- **Session:** read-only. No file under review was edited, staged, or committed; foreign untracked files (`.scratch/*`, `test/repro-h1.js`) were not touched. Method: committed-state inspection (`git show`), call-site cross-examination, ticket cross-check, plus one throwaway Puppeteer probe run outside the repo.
- **Reviewed state:** both commits are ancestors of the HEAD at review start (`617ba18`). The reviewed revisions are `a0f4d02:rapid-feedback.user.js`, `7eed262:test/common.js`, `7eed262:test/run.js`; **all line numbers below are from those revisions** (they equaled HEAD's revisions of those files when the review began), so `HEAD:<file>:<line>` citations mean that reviewed revision, not today's HEAD. The shared checkout moved while this review ran — HEAD is now `460a0dc`, and `922d147` (2026-09-16 07:47) edits the userscript — see **F0** below.
- **Independent verification of the 8-suite claim:** `cd test && npm test` → `8/8 suites passed`, `rc=0`, run at `460a0dc` with the sha unchanged before/after the run (log: `artifacts/wave-2026-09-16/review-29-13-35-suite-head.log`; also run green at `617ba18`). This confirms the prior evidence (`artifacts/wave-2026-09-15/suite-29-fix.log`, `suite-35.log`) and, importantly, shows the green suite does **not** cover the risk below.

### F0 [scope note] A commit landed during the review; it does not disturb any finding

`922d147` ("Popover: name the centered fallback rect; drop no-op try/catch on plain assignment", #40) has exactly two hunks, neither in the regions this review relies on: `@@ -1336` turns the reposition fallback rect into a named `centeredFallbackRect()`, and `@@ -1435` drops a `try/catch` around `initial.editRef = annotations[initial.editIndex]` in `showPopover`. It has no hunk in the popover attach/fill region (`root.appendChild(popover)` → `syncSelection()`), in `save()`/`hidePopover()`, or in either test file, so F2.1/F2.2 and the F1.1 probe (which used the pre-commit and pre-`922d147` texts) stand; only line numbers ≥ 1355 in the userscript shift by +8. `460a0dc` deletes `oxalpha-redesign/` only.

## Verdicts

| Commit | Verdict | One-line reason |
| --- | --- | --- |
| `a0f4d02` drop legacy storage-key migration + pre-envelope load branch | **BLOCK** | The deleted branch is the only reader of a format the tool itself wrote until v5.13 **under the same key**; payloads are now silently dropped and the next save overwrites them. Reproduced (F1.1). Ticket #29's own acceptance text is not met (F1.2). |
| `7eed262` waitFor bounded-polling predicates | **APPROVED** (3 minor notes) | Semantics verified equivalent-or-stricter against the popover construction and save ordering; no new flake vector found. Minor: a count claim in the message (F2.4), abort-on-timeout diagnostics (F2.5), one unused export (F2.6). |

The green suite cannot arbitrate commit 1: the only test that expressed the deleted behaviour was rewritten inside the same commit (F1.3).

---

## Commit 1 — `a0f4d02` "Subtraction: drop legacy storage-key migration + pre-envelope load branch (#29, #13)" → **BLOCK**

### F1.1 [BLOCK — irreversible, silent data loss] The pre-envelope branch reads a format this tool wrote until v5.13, under the *same* key

Chain of evidence:

1. `HEAD:rapid-feedback.user.js:127` — `const STORAGE_KEY = 'scope_feedback_annotations';` (unchanged since the v4.0 file, `2e09bfe~1:scope-feedback.user.js:29`).
2. v5.13's writer put a **bare array** under that key: `daf6b0f:rapid-feedback.user.js:633` — `localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations))`.
3. v5.14 introduced the envelope **and** the compat reader in the same commit: `2afe902:rapid-feedback.user.js:677` — `if (Array.isArray(parsed)) rows = parsed; // pre-envelope format (or migrated legacy)`, plus `:679-683` which re-emitted the envelope via `save()` on load. So the deleted block was the migration path for every install that saved before v5.14. The deleted lines are `a0f4d02~1:rapid-feedback.user.js:1068` (the array branch) and `:1073` (the re-emit `save()`).
4. `HEAD:rapid-feedback.user.js:1056-1066` — `load()` now reads only `parsed.annotations` (`:1063`); a bare array makes `rows === null` (`:1063`) and nothing loads.
5. `HEAD:rapid-feedback.user.js:1070-1076` — `save()` writes `{ version: 1, annotations }` to the same key (`:1072`), and it is reached from every mutation (`persist()` `:1078-1080`; panel edit `:2329`, delete `:2350`, add `:2399`, clear `:3127`; popover Submit `:1994`).

Reproduction (throwaway probe, outside the repo; raw output in `artifacts/wave-2026-09-16/review-29-13-35-probe.log`). Seed = exactly what v5.13 wrote (bare array, 2 rows) under `scope_feedback_annotations`, then load the userscript, then submit one new comment through the real UI:

| build | loaded after seed | storage after load | after 1 new Submit | old rows survive? |
| --- | --- | --- | --- | --- |
| `a0f4d02~1` (branch present) | **2** | envelope, n=2 (migrated) | envelope, n=3 | **yes** |
| HEAD (branch deleted) | **0** | bare array, n=2 (invisible) | envelope, **n=1** | **no — overwritten** |

So the failure mode is not a graceful skip: the annotations are invisible, and the first save of any kind permanently replaces them. This is the data-loss path the stakes asked to flag, and it is silent on both ends (no toast; `:1073-1075` only toasts on quota failure).

Exposure window is real, not theoretical: v5.14 landed 2026-08-22 and `a0f4d02` landed 2026-09-15, so any origin the user last annotated before 2026-08-22 and has not re-opened with v5.14–v5.17 still holds a bare array. The script auto-updates from `main` (`rapid-feedback.user.js:29-30` `@updateURL`/`@downloadURL`), so the upgrade arrives without the user doing anything. Annotations are per-origin, and per-origin staleness across weeks is normal for this tool.

### F1.2 [acceptance not met] #29's stated acceptance is the opposite of the shipped behaviour

#29 acceptance, verbatim: *"a stored row saved by the pre-envelope format (if any exists in the wild) degrades gracefully per the existing corrupt-row skip."*

`HEAD:1063-1064`: for a bare array, `parsed.annotations` is `undefined` → `rows = null` → the `Array.isArray(rows)` guard at `:1064` never runs, so the corrupt-row skip (which keeps well-formed objects) does nothing. A valid pre-envelope row is treated as *the store being empty*, not as a corrupt row. The deletion does not meet the acceptance criterion it was merged under.

### F1.3 [gate adjusted to fit the change] The suite went red and the test input was changed instead of the code

- Before the seed edit, HEAD's code fails the suite: `artifacts/wave-2026-09-15/suite-29.log:131` → `FAIL  annotation from another page loads`, followed by `HARNESS ERROR TypeError: Cannot read properties of null (reading 'click')` (the loaded set was empty, so the panel row click at `test/run5.js:104` hit `null`).
- The commit changed `test/run5.js:93` from the bare array to `{ version: 1, annotations: [...] }`, which made the suite green.

Cross-examined as asked, the seed change **does preserve the original intent**: the two assertions at `test/run5.js:103` and `:109-110` still test cross-page persistence and in-place editing, and the new seed is more faithful to what the tool writes today. The problem is what the edit removed: it was the *only* harness expression of pre-envelope support (`rg "Array.isArray(parsed)|parsed\?\.annotations" test/` → nothing; no other suite seeds storage — `test/run5.js:93` was the sole writer, `test/run6.js:81,113` clear it), and it was removed in the same commit that deleted the behaviour, with no replacement assertion and no recorded decision. The commit message frames this as a "hidden coupling finding"; the coupling is to on-disk user data, and "the input was wrong" is not the same claim as "the code is right".

### F1.4 [process] #13 is an evaluate-only ticket and was implemented without a recorded evaluation

`gh issue view 13`: *"Speculative deletion — evaluate whether this is worth doing (implementation is explicitly NOT the todo)"*, with a "Decision question … (a) delete it, (b) keep it and add a one-line comment dating the decision, (c) …". `a0f4d02` implemented option (a); #13 and #29 are still `OPEN` with no comment recording the evaluation or the decision.

The risk framing that fed the ticket also understated this case: `artifacts/wave-2026-09-11/forced-subtraction.md:30,48` classify the legacy-key removal as "Fake break: none" and the residual risk as "silent (benign) data shadowing". That is true only for a *different key* (data survives, recoverable by hand). For the same-key pre-envelope payload the first save destroys it — destructive, not shadowing. The two deletions were batched as one "compatibility paths" item, and the benign framing of one was applied to both.

### F1.5 [verified correct] The componentStack rejection is sound

`HEAD:640` writes `componentStack`, `HEAD:753` reads `source.componentStack` (`refs.push(...source.componentStack.map(...))`). Deleting it would have broken the export. Rejecting that #29 item was right.

### F1.6 [nuance] The legacy-key half is the low-risk half

No version in this repo's history ever *wrote* `rapid_feedback_annotations` (`git log --all -S"setItem('rapid_feedback_annotations'"` → no commits; the read first appears at `2e09bfe:rapid-feedback.user.js:310`, i.e. v4.1, and at `2168518:435`, v5.0). The earliest repo build already used `scope_feedback_annotations` (`2e09bfe~1:scope-feedback.user.js:29`). So dropping the key fallback is low risk unless a pre-v4.1 gist-era build wrote the other key — unprovable from this repo, and the residual is shadowing (recoverable), not loss. Note the provenance claim in `.scratch/forced-subtraction-2026-09-10.md:85` ("dormant since the v2-era rename") is wrong: the rename is v4.1, 2026-08.

### F1.7 Minimal remedy (1 line, keeps the subtraction's spirit)

```js
const rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? parsed.annotations : null);
```

Restores the read without restoring the write-back/legacy key the batch actually wanted gone. If the owner instead decides pre-envelope support is dead, the acceptable forms are (a) copy the payload to a backup key once before the first overwrite, or (b) a recorded decision on #29/#13 plus a test that asserts the drop — never silence.

---

## Commit 2 — `7eed262` "Harness: waitFor bounded-polling predicates replace run.js settle-sleeps (#35 slice)" → **APPROVED**

### F2.1 [verified] No new race on popover-open: the DOM is fully built before the popover is observable

`waitForPopover` (test/common.js:68) waits on `POP` = "a `.rf-popover` inside any chrome shadow root" (`test/common.js:7`). In the userscript the popover is attached at `HEAD:2039` (`root.appendChild(popover)`) and the selection rows are built *after* it by `syncSelection()` at `:2058` → `renderMembers()` `:1609` → `selList.appendChild(row)` `:1657/:1673`. The "Similar" button the very next step clicks is created and appended even earlier (`:1525-1532`). All of that is one synchronous task, and CDP `page.evaluate` can only observe between tasks — so the poll cannot see a half-built popover, and the assertions immediately after each conversion (`test/run.js:19-34`, `:195-200`) see the same DOM the old 200/250 ms nap delivered.

### F2.2 [verified] No ordering flake on the storage read

`test/run.js:102` waits for the popover to close, then `:106` reads `localStorage`. Submit is safe by construction: `submit()` `HEAD:1986` → `persist()` `:1994` → `save()` `:1078-1080` → `localStorage.setItem` `:1072` (synchronous) → then `keepStyles()` `:2005` → `hidePopover()` `:2006` → `popoverEl.remove()` `:2181`. The write always precedes the close, so the wait can never return early.

### F2.3 [verified stricter] Failure paths fail louder, not quieter

Submit early-returns without closing the popover when the comment is empty (`HEAD:1992`) — under the old sleep the next read could pick up the *previous* annotation and give an ambiguous result; now `waitForPopoverGone` times out with a named error and the last value (`test/common.js:66`). Both fail loudly; the new form fails faster and names the condition.

### F2.4 [MINOR — claim accuracy] "15 mechanical settle-sleeps" is 14

`git show a0f4d02:test/run.js | grep -c setTimeout` → **22**; `git show HEAD:test/run.js | grep -c setTimeout` → **8** ⇒ 14 conversions. The 8 kept sites named in the message match HEAD exactly: `test/run.js:55,72,79,86,198,211,278,282`.

### F2.5 [MINOR — diagnostics] A timeout now aborts the whole 8-suite run

`test/run-all.js:5` stops at the first thrown suite and `:8` prints `HARNESS ERROR` / `exit 2`. A `waitFor` stall in run.js therefore hides run2–run8 results for that run, where the old fixed nap would have produced a FAIL check and continued. Still loud (non-zero exit), and not a new class of failure — a missing element already threw (see `suite-29.log:131-143`) — but it trades failure-time coverage for failure-time speed. Either catch waitFor timeouts into a FAIL check inside `withPage`, or state the abort as intentional.

### F2.6 [MINOR — dead export] `waitFor` is exported but never imported

`test/common.js:71` exports `waitFor`; `test/run.js:1` imports only `waitForPopover`/`waitForPopoverGone` and no other file imports it (`rg "waitFor" test/`). Either use it for the remaining same-condition naps (`test/run.js:198`, and the re-render naps at `:55/:72`) in the F4/F5 slices, or drop it from the export. Repo rule: build it or delete it.

### F2.7 [MINOR — worth exploring, not a defect here] The kept naps at `:278/:282` remain the softest spots

The commit correctly keeps them (a fail-soft assertion wants `false`, and `waitFor` throws), but a `waitForPopoverGone` in a try/catch with a short timeout, or an absence-predicate variant that returns `false` instead of throwing, would be stricter and still diagnostic. Fits #35's remaining slices; no action needed to land this commit.

---

## Cross-cutting finding (pre-existing) — X1 [MINOR] the envelope's `version` field is never read

`save()` writes `version: STORAGE_VERSION` (`HEAD:1072`, `:128`) and the comment at `:1068` promises "a future format change can migrate instead of guessing", but `load()` (`HEAD:1056-1066`) never compares `parsed.version` to `STORAGE_VERSION` — it shape-guesses `parsed.annotations` exactly as before. So the versioning guarantee does not exist today, and the deletion in commit 1 partly rests on it ("the current envelope is versioned" — #13 body). `test/run5.js:93` also hard-codes `version: 1`. Either honour the field (validate + branch to a migration) or delete it; leaving a written-but-never-read field is the dormant-code smell the repo's own rules forbid.

---

## Tickets (NOT filed — this session was read-only)

Ready-to-file, so the findings live in the tracker rather than only in this report:

- **T1 — comment/reopen on #29 (blocker):** *"[wave 2026-09-16] a0f4d02 drops the only reader of pre-envelope payloads → silent irreversible data loss for installs updating from ≤v5.13."* Evidence: F1.1 probe table + `HEAD:1056-1066`/`:1072` + `daf6b0f:633` + `2afe902:677`. Decision question: restore the one-line read-only compat, or deliberately deprecate with a backup key? Acceptance text in #29 is currently unsatisfiable as written (F1.2).
- **T2 — comment on #13:** record the evaluation/decision that #13 explicitly deferred ("implementation is explicitly NOT the todo"), and correct the "v2-era rename" provenance (v4.1, F1.6).
- **T3 — new:** *"Envelope `version` field is written and never read (`:1072` vs `:1056-1066`) — honour or delete."* (X1)
- **T4 — new:** *"run-all.js aborts all suites on a waitFor timeout — decide abort vs per-suite FAIL."* (F2.5)
- **T5 — new (tidy):** *"`waitFor` exported but unused; remaining same-condition naps at run.js:55/72/198."* (F2.6, F2.7)

## Appendix — reproduction

```
# commit 2 independent check
cd test && npm test > .../review-29-13-35-suite-head.log 2>&1   # -> 8/8 suites passed, rc=0

# commit 1 data-loss probe (temp dir, no repo writes); seed = v5.13's bare array, then submit via UI
node probe.js "PRE-a0f4d02" ./rf-pre-a0f4d02.js   # loaded 2 | after save n=3 | PRE-ENVELOPE A survives? true
node probe.js "HEAD"        ./rf-head.js          # loaded 0 | after save n=1 | PRE-ENVELOPE A survives? false
```

Scripts/outputs: `artifacts/wave-2026-09-16/review-29-13-35-suite-head.log`, `artifacts/wave-2026-09-16/review-29-13-35-probe.log`.
