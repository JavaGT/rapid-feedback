# Converged goal: draft safety (Muse × Omen hostile reviews, 2026-09-06)

Both reviews independently flagged **silent loss/corruption of in-progress work** as the top fix-first theme:

- Omen P1-1 + Muse P1-6/P2: Escape in the comment textarea destroys the whole draft
  (document-capture handler runs before the textarea's dead stopPropagation guards).
- Omen P1-4 + Muse P0-5: Submit replaces by raw array index; a panel delete while the
  edit popover is open shifts indices and Submit overwrites an unrelated record
  (old code) or duplicates (stale slot → push).

## Fix (in `rapid-feedback.user.js`, uncommitted — sits atop the in-flight v5.18 lane)

1. `eventFromEditable(e)` helper (uses `composedPath()` — e.target is retargeted to the
   shadow host at document level). Global Escape handler blurs out of editable fields
   instead of cancel/close. Second Escape (focus now outside any input) still closes
   and clears the dragged offset — two-stage Esc, standard dialog behavior.
2. Edit-by-identity: `showPopover` pins `initial.editRef` to the live annotation object;
   `currentDraft()` carries it through pick modes; Submit uses `indexOf(ref)` and only
   falls back to push. A mid-edit delete can no longer redirect Submit.

## Verification

- Ad-hoc probe (since removed): Escape-in-textarea preserves draft; submit after
  mid-edit delete replaces by identity — 5/5 PASS.
- `test/run6.js` updated for two-stage Esc (first blurs, second closes): 22/22 PASS.
- Rest of suite unchanged by this fix: run2/run3/run5/run7/run8 PASS; run.js has 1
  pre-existing Svelte-disclosure FAIL and run4 a harness-level undo-button error —
  both in code paths this diff does not touch (verified via `git diff` grep).
