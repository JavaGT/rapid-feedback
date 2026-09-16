# Forced-subtraction review — 2026-09-17

Scope was limited to issues #44 and #41. Verification used the worktree and
`git show HEAD:<file>`; no implementation was made.

## A. Userscript `@note` changelog

**GOES.** A roughly 30% cut is safe: remove the six oldest notes (v5.0,
v5.1, v5.2, v5.3, v5.3.1, v5.4) from `rapid-feedback.user.js:6-31`.
Those lines are free-form prose, duplicate history, and have no runtime
consumer. The deletion must be by version, not by physical position: the
header is not chronological (`v5.16` is line 6, `v5.18` line 7, `v5.17`
line 8, while `v5.0` is line 31).

**STAYS.** The structured metadata at `rapid-feedback.user.js:2-5,24-30`
(`@name`, `@namespace`, `@version`, `@description`, matching, grants, and
URLs) stays. Keeping the remaining notes is only a human-readable archaeology
choice, not a loader requirement.

**BREAKS.** No runtime or installation behavior breaks. `rg` found no parser
or reader in `test/`, README, package tooling, or the userscript. The
Tampermonkey documentation lists supported header keys and does not list
`@note`; removing it leaves all supported keys unchanged. The only loss is
the convenience of seeing old prose in the installed source/editor; git
history is the replacement, though it is not a perfect version-tagged changelog.

**Cross-examination.** `test/*.js` reads/executes the whole script but never
parses header fields; `README.md` does not quote `@note`. The prior claim that
new notes appear in Tampermonkey update prompts is not supported: `@note` is
not a documented metadata field. No fake break found; no hidden coupling found.

**Recommendation: implement-now** — prune the oldest six by version, while
retaining supported metadata and any desired recent human notes.

## B. Storage envelope `version`

**GOES (for deletion).** `STORAGE_VERSION` is declared at
`rapid-feedback.user.js:128` and used only by the write at `:1075`.
Repository-wide search found no read of `parsed.version`, `STORAGE_VERSION`,
or an equivalent envelope version check. `load()` at `:1056-1068` selects
`parsed` by shape and ignores the field. The field and its promise comment at
`:1071-1072` are therefore dormant code and misleading contract surface.

**STAYS.** The envelope's `annotations` property stays: `load()` reads it at
`:1066`, and tests inspect it (`test/run.js:106-109`). The pre-v5.14 bare-array
compatibility branch also stays. `test/run5.js:93-103` deliberately seeds a
bare array and verifies it loads.

**BREAKS if the field is deleted.** A future migration cannot branch on a
stored version number. That is a prospective design capability, not a current
call site or behavior. Deleting the field must also delete the comment that
promises migration; otherwise the code would still advertise a false guarantee.

**Cross-examination and #29 history.** HEAD writes only
`{version: STORAGE_VERSION, annotations}` (`:1075`) and has no version read.
Commit `0be14c2` restored the bare-array branch after `a0f4d02` caused the
v5.13-to-v5.14 upgrade data-loss class; the fix's safety comes from
`Array.isArray(parsed)` at `:1066`, not from `version`. Deleting the field does
not remove that protection. `test/run.js:107` documents the envelope shape but
does not assert or consume its version. No fake break found; the unpredicted
break risk is only a future, undefined format migration.

**Recommendation: implement-now** — remove `STORAGE_VERSION`, omit `version`
from the write, and remove the migration promise comment. Keep the envelope
shape and #29 bare-array compatibility. If versioned migration becomes a real
feature, add it with a defined schema transition and focused test first.

## Deferred

- `test/` suites and harness structure — outside this admitted budget; existing
  tickets cover harness work.
- Popover/panel chrome — already ticketed and not a subtraction target here.
- Chord system — already ticketed; interaction-heavy and needs its own pass.
- Storage rows — separate data-model surface; not the envelope field.
- Migration logic beyond `version` — #29 compatibility is retained, but deeper
  migration design needs a dedicated ticket/pass.
