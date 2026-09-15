# Hostile review — remedy commit `0be14c2` (#29)

- **Session:** read-only. Nothing under review was edited, staged, or committed; foreign untracked files (`.scratch/*`, `test/repro-h1.js`) were not touched. Method: committed-state inspection (`git show`, `git grep` at `HEAD`), one throwaway Puppeteer probe run outside the repo (`/private/var/folders/…/T/opencode/rf-remedy-probe/`), and one independent full-suite run outside the repo.
- **Reviewed state:** `0be14c2` ("Restore read-only pre-envelope load branch; fixes silent annotation loss on upgrade (#29)"). HEAD at review start and end was `fbaae75`; `fbaae75` changes only `AGENTS.md`, so the userscript/test bytes are identical to `0be14c2`. **All `file:line` citations are HEAD (`fbaae75`) line numbers**, which equal `0be14c2`'s.
- **What the remedy does** (`git show --stat 0be14c2`): `rapid-feedback.user.js` +4/−1, `test/run5.js` +2/−2. Nothing else.

## Verdict

**APPROVED.** The remedy restores exactly the deleted read path, reverts only the test seed that had been bent to fit the deletion, and re-establishes the guard (deleting the branch again turns `run5` red). The blocker in `artifacts/wave-2026-09-16/review-landed-29-13-35.md` is resolved; two minor test/comment notes below, no code defect.

| Axis | Result |
| --- | --- |
| 1. Upgrade-path safety | **PASS** — bare array loads (corrupt rows filtered) and the first save re-emits `{version, annotations}` preserving all rows (probe, R1) |
| 2. Subtraction spirit kept | **PASS** — no legacy-key read, no save-on-load, only the intended hunks (R2) |
| 3. Comment accuracy / edge cases | **PASS** with one minor comment-scope note (R3) |
| 4. Evidence (8-suite green) | **PASS** — `suite-fix.log` green and independently reproduced at `fbaae75` (R4) |

---

## R1 — Upgrade-path safety: verified end-to-end

Code at HEAD:

- `rapid-feedback.user.js:127` — `const STORAGE_KEY = 'scope_feedback_annotations';`
- `rapid-feedback.user.js:1056-1069` — `load()`; the restored branch is `:1066` `const rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? parsed.annotations : null);` feeding the existing filter at `:1067`.
- `rapid-feedback.user.js:1073-1079` — `save()` writes the envelope at `:1075` (`{ version: STORAGE_VERSION, annotations }`); `STORAGE_VERSION = 1` at `:128`.
- `rapid-feedback.user.js:1081-1085` — `persist()` calls `save()` at `:1083`; it is reached from every mutation (`clear()` at `:3138`; panel edit/delete/add and popover Submit via the same path).

Throwaway probe (three builds: `pre`=`a0f4d02~1`, `bad`=`a0f4d02`, `head`=`HEAD`), seeding exactly what v5.13 wrote — a bare array with two valid rows — then performing **one real edit through the panel UI** (the path that calls `persist()` → `save()`):

| build | loaded | storage right after load | after 1 edit | all rows survive? |
| --- | --- | --- | --- | --- |
| `a0f4d02~1` (old branch + write-back) | **2** | envelope, n=2 (write-back on load) | envelope, n=2 | **yes** |
| `a0f4d02` (branch deleted) | **0** | bare array, n=2 (invisible) | *(no edit control rendered)* | **no** — prior probe shows first save → envelope n=1 |
| `0be14c2`/HEAD (remedy) | **2** | bare array, n=2 (untouched) | envelope, n=2 | **yes** |

The `bad` build's loss is independently reproduced by the earlier probe (`artifacts/wave-2026-09-16/review-29-13-35-probe.log:14-19`: `loaded 0` → after Submit `envelope n=1`, `survives? false`); my probe confirms `bad` loads 0 and renders no editable row, and that `head` loads 2 and, on the first real save, writes back `{version:1, annotations:[2 rows]}`. So the fix closes the exact data-loss path.

The suite gate is also real again: `test/run5.js:93-96` seeds the bare array and `:102-103` asserts `loaded === 1`; a re-deletion of the branch gives `loaded === 0` and fails that check (this is precisely the `suite-29.log:131` failure history).

**Residual (not a remedy defect):** installs that already ran `a0f4d02` (landed 2026-09-15) and saved have already overwritten their rows; the remedy cannot recover those. Worth recording on #29 so the ~1-day exposure is acknowledged.

## R2 — Subtraction spirit kept

- **No legacy storage-key read restored.** `rapid-feedback.user.js:1058` reads only `STORAGE_KEY`; `git grep "rapid_feedback_annotations" HEAD -- rapid-feedback.user.js` → no matches (the only hits in the repo are prose in `artifacts/wave-2026-09-11/forced-subtraction.md:30,48`). The `a0f4d02` deletion of the `rapid_feedback_annotations` fallback stays deleted.
- **No write-back `save()` on load.** `load()` (`:1056-1069`) contains no `save()` call; `save()` is called only from `persist()` `:1083` and `clear()` `:3138`. Probe, "no-mutation" arm: `pre` storage changed on load (write-back present), `head` storage was byte-identical after load (`storageUnchangedAfterLoad=true`). The comment's "the save itself re-emits the envelope" is therefore a claim about the *next mutation*, and it holds (`head` afterEdit = `envelope n=2`).
- **No other behavior change vs `a0f4d02`.** `git diff a0f4d02 HEAD -- rapid-feedback.user.js` has exactly four hunks: the remedy hunk at `:1063-1066`, and three in the popover region (`:1339`, `:1357-1365`, `:1438`) belonging to the *separate, already-approved* `922d147` (#40). `save()`/`persist()` bodies are byte-identical to `a0f4d02`. `git diff a0f4d02 HEAD -- test/` shows only `7eed262`'s (`common.js`/`run.js`, approved) and the remedy's `run5.js` seed revert. The remedy commit itself touches nothing but those two files.

## R3 — Comment accuracy and edge cases

Comment at `:1063-1065`: *"Installs from before v5.14 saved a bare array under this key — keep reading it so an upgrade's first save doesn't overwrite their annotations; the save itself re-emits the envelope."*

- "before v5.14" is accurate: `2afe902` ("v5.14: blind-plan improvements + draggable popover") introduced `STORAGE_VERSION` and the envelope writer, while v5.13's `daf6b0f:rapid-feedback.user.js:633` still wrote `JSON.stringify(annotations)` (a bare array).
- "the save itself re-emits the envelope" is accurate (`:1075`).
- The comment does **not** overclaim a migration; it says the read is kept, which is exactly what the code does. Minor scope note M2 below.

Edge cases, all measured by probing `head` with different seeds:

| seed under `STORAGE_KEY` | loaded | notes |
| --- | --- | --- |
| bare array, 2 valid + 1 corrupt (`null`, `"nope"`) | **2** | corrupt rows dropped by the `:1067` filter — the #29 acceptance ("degrades gracefully per the corrupt-row skip") is met |
| bare array, all corrupt | 0 | no crash, no load (nothing to preserve) |
| `null` / `"hello"` / `42` | 0 | same as `a0f4d02` (`Array.isArray` false, `typeof` not object → rows null) |
| object without `annotations` | 0 | same as `a0f4d02` |
| envelope `{version:1, annotations:[…]}` | 1 | **no regression** to envelope loading |
| envelope with a corrupt row | 1 | corrupt row filtered; envelope path unchanged |
| empty bare array | 0 | no load |

The remedy's `:1066` is equivalent to the pre-`a0f4d02` branch for shape selection (that branch required `Array.isArray(parsed.annotations)`; the remedy defers to the existing `Array.isArray(rows)` check at `:1067`). For a non-array `parsed.annotations` (e.g. a string) both the old branch and the remedy load nothing.

## R4 — Evidence

- `artifacts/wave-2026-09-16/suite-fix.log:176` → `8/8 suites passed`; the run5 compat checks are green at `:131-133` (`annotation from another page loads`, `editing an off-page annotation edits the comment in place`, `the off-page comment edit persists`).
- Independent reproduction: `cd test && npm test` at `fbaae75`, output captured outside the repo → `rc=0`, `8/8 suites passed`, zero `FAIL`/`HARNESS ERROR` lines, and `git rev-parse HEAD` identical before and after (`fbaae75…`). `git status` after the run shows only the pre-existing untracked files (no worktree dirt).

---

## Minor notes (no code change required to land)

- **M1 [test strength]** `test/run5.js:102-103` asserts only the *loaded count*; it does not assert that the first save re-emits the envelope and preserves all rows (the literal #29 acceptance). The re-deletion guard exists (`loaded===1` fails if the branch goes), and the remedy is proven by probe, so this is not a blocker — but a one-line storage-shape assertion here would make the suite express the acceptance directly. Consistent with the repo's "tests focused, not slop" rule.
- **M2 [comment scope, optional]** The comment explains why the *read* is kept; it could note the accepted trade-off that the bare-array payload now lingers in storage until the first mutation (no write-back). Not required — the sentence "the save itself re-emits the envelope" implies it.
- **M3 [pre-existing, from the prior review's X1]** `STORAGE_VERSION` is written (`:1075`) and never read (`load()` `:1056-1069`). Unchanged by this remedy; still worth deciding (honour the field or delete it).

## Tickets

Per the session's explicit read-only constraint, no tracker writes were made. Ready-to-file as the prior review left them: record the recovery caveat on #29 (R1 residual), and the pre-existing X1/`version` decision (M3). M1/M2 are optional test/comment tidy-ups.
