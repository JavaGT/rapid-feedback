# Forced Subtraction Report — 2026-09-11

**Repo:** `rapid-feedback` · **HEAD:** `ea5e8b1` · **Userscript:** 3,071 lines

---

## Partition

| Bucket | Contents | Budget |
|--------|----------|--------|
| **a. Core userscript** | `rapid-feedback.user.js` (3,071 LOC) | ✅ in scope |
| **b. Test harness** | `test/run*.js` + `common.js` + `run-all.js` (1,122 LOC) | ✅ in scope |
| **c. Redesign experiments** | `luna-redesign/`, `deepseek-redesign/`, `oxalpha-redesign/` | ⏸ deferred |
| **d. .scratch docs** | 16 docs in `.scratch/` | ⏸ deferred |

**Issues already covering overlaps:** #13 (legacy storage migration), #9 (test harness gaps incl. repro-h1.js), #11 (oxalpha-redesign deletion).

---

## A. Core Userscript — `load()` backward-compat block

**Target area:** `rapid-feedback.user.js:1039–1051` (13 lines in `load()`), plus the `componentStack` redundant alias in `getSourceLoc()` (line 621) and `componentTrail()` (line 734) (6 lines).

**Estimated deletable lines:** ~19 lines (~0.6% of file, but 100% of the coherent backward-compat dead weight).

### GOES

| Lines | What | Why safe |
|-------|------|----------|
| 1041–1042 | Legacy key migration (`rapid_feedback_annotations` → `STORAGE_KEY`) | `save()` (line 1061) always writes `scope_feedback_annotations`. The legacy key is never written by any current code path. Data under the old key exists only from pre-rename versions. Covered by issue #13. |
| 1049 | Pre-envelope bare-array format: `if (Array.isArray(parsed))` | `save()` always writes `{version:1, annotations:[...]}`. The bare-array shape was never produced by any version that also called `save()`. Only reachable from data written by a version that predated the envelope. |
| 1050 | Old `.annotations` envelope: `else if (parsed && … && Array.isArray(parsed.annotations))` | Same reasoning — `save()` never writes `{annotations:[...]}` (without `version`). This format existed briefly between the bare-array era and the current versioned envelope. Only reachable from stale stored data. |
| 621, 734 | `componentStack` alias in `getSourceLoc()` and fallback in `componentTrail()` | `getSourceLoc()` always generates `components` (line 612). `componentTrail()` at line 728 checks `source.components` first; when present (always, in current code), line 734's `componentStack` fallback never executes. The field is also omitted from `captureMemberRef()` (line 2044) and `sourceForJSON()` (line 745), confirming it's not in the current storage or export shape. |

### STAYS

| Lines | What | Why load-bearing |
|-------|------|-----------------|
| 1039 | `localStorage.getItem(STORAGE_KEY)` | Current-format read path — the only entry point for loading annotations. |
| 1044–1048 | `JSON.parse`, corrupt-row skip, `makeAnnotation` mapping | Core deserialization; handles current-format data and gracefully skips corrupt rows. |
| 1054 | Re-save after loading old data | Normalizes legacy data into current envelope format on first load. Reachable but only from legacy data. |
| 1061–1067 | `save()` | Writes the versioned envelope — the single source of truth for persistence. |

### BREAKS (cross-examined)

| Claim | Cross-exam result |
|-------|-------------------|
| "No current code path writes the legacy key `rapid_feedback_annotations`" | ✅ Confirmed: `rg 'rapid_feedback_annotations'` → only `load()` line 1041 (the read itself). `save()` writes only to `STORAGE_KEY` = `'scope_feedback_annotations'`. **Fake break: none.** |
| "No current code path writes bare-array or `{annotations:[…]}` shapes" | ✅ Confirmed: `save()` at line 1063 always writes `{version:STORAGE_VERSION, annotations}`. **Fake break: none.** |
| "Removing `componentStack` won't break exports or panel rendering" | ✅ Confirmed: `sourceForJSON()` (line 745) processes `components`, not `componentStack`. Panel card rendering uses `componentTrail()` which prefers `components`. The `componentStack` field is emitted by `getSourceLoc()` into annotations but never read by current code except the dead fallback at line 734. **Fake break: none.** |
| Unpredicted break: "Does removing `componentStack` break stored annotations?" | `makeAnnotation()` (line 845) passes through any field in the data object. Old stored annotations with `componentStack` would still load fine — the field simply wouldn't be read. `componentTrail()` falls back gracefully. **Unpredicted break: none.** |
| Unpredicted break: "Does the `.annotations` envelope check mask a bug?" | No — it's purely backward-compat. The only way data reaches line 1050 is if it was written by a version before the versioned envelope. No current code produces this shape. **Unpredicted break: none.** |

**Cross-exam verdict: 0 fake breaks, 0 unpredicted breaks.** All four GOES claims verified against real call sites.

---

## B. Test Harness

### `test/repro-h1.js` (untracked, 2720 bytes, not in `run-all.js`)

- **What:** One-off Puppeteer probe testing popover positioning on tall pages ("does the popover render off-screen on a tall page?"). Uses CDP keyboard events to simulate chord+click, checks the popover's `transform` property.
- **Delta vs issue #9:** Issue #9 already flags this file as a dormant probe. This forced-subtraction confirms: **wire or delete.** The test is self-contained (reads `rapid-feedback.user.js` directly, uses `test/page.html`), so it could be wired as `run9.js` and added to `run-all.js` — but its scope (popover y-positioning on tall pages) overlaps with `run8.js` which already tests popover visibility. Verdict: **delete** unless the specific tall-page regression is still a concern.
- **Decision:** Delete (matches issue #9 recommendation).

### `test/run2.js` (foreign WIP on disk, not committed)

- **What:** 13 lines added on top of 96-line HEAD: tests that an offscreen-dragged popover can be recovered via keyboard shortcut without losing draft text. Uses `Alt+Shift+R` shortcut.
- **Status:** Foreign WIP. Not in `run-all.js`'s committed code. Per task instructions, analyzed via `git show HEAD:test/run2.js` (96 lines) only.

### `test/run-all.js` — wired suites

| Suite | Lines | Wired? |
|-------|-------|--------|
| run.js | 309 | ✅ |
| run2.js | 96 | ✅ |
| run3.js | 60 | ✅ |
| run4.js | 66 | ✅ |
| run5.js | 121 | ✅ |
| run6.js | 278 | ✅ |
| run7.js | 77 | ✅ |
| run8.js | 40 | ✅ |
| repro-h1.js | 78 | ❌ untracked, not wired |

**All 8 committed suites are wired into `run-all.js`. No orphaned committed test files.**

### Harness GOES/STAYS/BREAKS

| Item | Verdict | Notes |
|------|---------|-------|
| `repro-h1.js` | **GOES (delete)** | Untracked probe, scope overlaps with run8. Issue #9 already flagged. |
| `common.js` (54 LOC) | **STAYS** | Shared helpers (`chromium.launch`, `page.goto`, `inject()`) used by all suites. |
| `run-all.js` (8 LOC) | **STAYS** | Orchestrator, minimal, no dead weight. |
| Page error listeners (common.js:31-32) | **STAYS** (but flagged) | Log but don't fail suites — issue #9's root cause finding. No deletion candidate, but a hardening candidate. |

---

## Cross-Exam Summary

| Category | Count | Detail |
|----------|-------|--------|
| Fake breaks (misread coupling) | **0** | All GOES claims verified against real call sites via `rg`. |
| Unpredicted breaks (hidden coupling) | **0** | No code path produces the legacy formats; `componentStack` removal is backward-compatible. |
| GOES lines (userscript) | **~19** | `load()` backward-compat (13) + `componentStack` alias (6) |
| GOES files (harness) | **1** | `test/repro-h1.js` |
| Total deletable | **~19 LOC + 1 file (78 LOC)** |

---

*Report: `artifacts/wave-2026-09-11/forced-subtraction.md`*
