# Forced-subtraction review — wave 2026-09-17 0730

Reviewed tickets #46 and #47 against the current `HEAD`, not the historical line
numbers in the tickets. No tests were run and no production files were changed.
The relevant current ranges are `rapid-feedback.user.js:1049-1062` for `load()` and
`rapid-feedback.user.js:1315-1358` for popover placement/fallback.

## Ticket #46 — centralize popover viewport inset/gap policy

### GOES

- The repeated viewport edge literal `8` can be replaced by one named geometry
  policy (for example, `pad`/`gap` returned by a small helper or constants).
  The same edge constraint currently appears in the persisted-offset clamp at
  `rapid-feedback.user.js:1319-1320`, in automatic placement at `:1342-1349`,
  and in the synthetic fallback rect at `:1355-1357`.
- A geometry helper can also centralize the repeated `clamp(..., pad,
  viewport - size - pad)` operation, provided it preserves the existing branch
  order and accepts the measured width/height. That removes policy duplication,
  rather than hiding unrelated placement decisions.
- This is safe only if `8` remains the same edge pad and gap in every existing
  path, the fallback’s fixed `top: 80` remains unchanged, and the helper does
  not turn `POPOVER_W` or the measured height into global state. The current
  functions are pure with respect to placement: they return coordinates or a
  rect and do not mutate annotations or draft state.

### STAYS

- `placePopoverAt` remains the load-bearing dispatcher at `:1315-1325`: a saved
  `popoverOffset` wins; otherwise it calls `placePopover` and applies the
  returned transform.
- The saved-offset path must continue clamping both axes to the viewport and
  must continue using the live measured height (`:1317-1320`). Dragging writes
  that offset at `:2203-2231`; `savePopoverOffset` persists/removes it at
  `:1090-1095` under `POPOVER_OFFSET_KEY` (`:122`).
- `placePopover`’s branch ordering is behavior: below, above, right, left,
  then the best vertical fallback (`:1344-1349`). Its callers are
  `placePopoverAt` (`:1323`), `currentAutoPosition` (`:2248`), and indirectly
  the reset/reposition paths.
- `centeredFallbackRect` is used when the selected element disappeared during
  `resetPopoverPosition` (`:1329-1337`). Its synthetic rect is intentionally
  centered and near `top: 80`; it must still feed `placePopoverAt` and wake the
  anchor loop.
- Direct `placePopoverAt` callers at `:1335`, `:1378`, `:1564`, and `:2045`
  cover reset, anchor movement, initial/open placement, and target replacement.
  `annotations` and `makeAnnotation` are unrelated data paths and must not be
  pulled into a geometry abstraction.

Focused coverage: `test/run.js` exercises the main multi-select/open/submit
popover path and uses `waitForPopover`/`waitForPopoverGone` from
`test/common.js`; `test/run3.js`, `run4.js`, `run7.js`, and `run8.js` exercise
additional reopen, target, and submit popover flows. `test/run6.js` explicitly
checks persisted-offset clearing. There is no focused assertion for every
viewport placement branch or the centered fallback rect.

### BREAKS

- If a shared helper changes `gap` as well as `pad` accidentally, the popover
  can move by pixels in below/above/side placement even though the edge clamp
  looks correct.
- If the refactor clamps the fallback rect itself, or changes its `top: 80`,
  the lost-target reset can stop returning the draft to its intended centered
  confirmation position.
- If a common clamp assumes a non-null measured height or uses the wrong width,
  initial placement, anchor re-projection, and drag placement can overlap the
  viewport edge or produce invalid coordinates.
- If `placePopover`’s branch order is “simplified,” targets near an edge can
  switch from below/above to a side placement, changing established behavior.
- If the proposed centralization is applied at all but leaves one caller on
  literal `8`, the code retains split policy and future changes can still drift;
  that is a subtraction failure, not an inherent runtime break.

### Cross-examination of BREAKS

`rg -n` caller evidence in the current file:

```text
placePopover: 1315, 1323, 1341, 1353, 1378, 1564, 2045, 2248
centeredFallbackRect: 1334, 1355
load: 1049, 3137
save: 1065, 1075, 3130
makeAnnotation: 857, 1060, 2004, 2005, 2006, 2023, 2402
annotations: 136, 1059, 1060, 1067, 1296, 1432, 1433, 2003-2006,
2282, 2301-2303, 2307, 2311, 2350, 2353, 2402, 2430-2439, 3127-3130
popoverOffset: 138, 1086, 1092, 1316, 1330, 2195, 2206, 2214, 2218
POPOVER_OFFSET_KEY: 122, 1083, 1092, 1093
```

These callers confirm the first three risks: placement is reused for normal,
anchor, opening, replacement, and drag-baseline paths; fallback has exactly one
runtime caller; and persisted offsets have separate load/save/reset/drag paths.
They also falsify any claim that geometry is isolated to `centeredFallbackRect`.
Conversely, no caller requires the literal `8` itself or accesses the helper
directly, so replacing the literal with a correctly parameterized policy does
not inherently break an API. The safe boundary is geometry-only; it must not
absorb `load`, `save`, `annotations`, or `makeAnnotation` behavior. The complete
caller scan shows those data/storage symbols are separate concerns, not hidden
geometry dependencies.

**Recommendation: evaluate-only.** The duplication is credible, but there is no
focused test for the placement matrix/fallback geometry; approve implementation
only with branch-preserving tests or an equivalent explicit proof.

## Ticket #47 — split `load()` storage decoding from annotation hydration

### GOES

- `load()` currently combines storage I/O, JSON parsing, legacy/envelope wire
  format selection, row filtering, and domain normalization in one procedure
  (`rapid-feedback.user.js:1049-1062`).
- Small internal bricks can remove the mixed-level code without changing the
  public behavior: a reader/parser, an `annotationRowsFromPayload(parsed)`
  selector, and a `hydrateAnnotations(rows)` mapper. The outer `load()` should
  remain orchestration and retain the broad `try/catch`.
- The one actual duplicated conceptual rule worth centralizing is the accepted
  storage shape: `Array.isArray(parsed)` means legacy bare-array rows, while an
  object’s `annotations` property means the v5.14 envelope. Filtering
  `a && typeof a === 'object'` before `makeAnnotation` must remain in the same
  effective order.

### STAYS

- `load()` has one initialization caller at `rapid-feedback.user.js:3137`,
  after the API object is installed and before `loadPopoverOffset`, `createFab`,
  and `hasAnnotations` (`:3125-3141`). It must synchronously finish before
  `hasAnnotations()` decides whether to reveal the FAB.
- Missing storage returns without replacing the initial `annotations = []`
  (`:1051-1052`). Corrupt JSON or storage failures are swallowed (`:1050,
  `:1061`), preserving startup rather than throwing.
- Both accepted formats must continue to hydrate every valid object with
  `makeAnnotation` (`:857-875`), which supplies defaults such as selector,
  category, URL, and optional fields. Invalid primitive/null rows are skipped
  at `:1060`.
- `save()` emits the envelope `{ annotations }` at `:1065-1071`; `persist()`
  calls `save()` after mutations (`:1073-1077`), and the API `clear()` calls it
  directly (`:3130`). The refactor must not make `load()` and `save()` share a
  lossy serializer or alter the quota toast.
- `annotations` is load-bearing throughout panel counts/rendering and exports
  (`:2282-2439`, `:3127-3130`), and mutation sites replace/push normalized
  objects through `makeAnnotation` at `:2003-2006`, `:2023`, and `:2402`.

Focused coverage: `test/run.js:104-114` parses the saved envelope while retaining
the compatibility comment for bare arrays and verifies saved annotation members;
`test/run5.js:90-103` seeds the legacy bare-array storage value and verifies it
loads. The save path is also exercised by the later submit/edit assertions in
`run.js` and `run5.js`.

### BREAKS

- If the envelope selector is extracted with the wrong precedence, existing
  v5.14 envelope data can load as empty, or legacy bare-array data can be lost
  on the next save.
- If filtering is moved after `makeAnnotation`, null/primitive rows can throw
  or become misleading annotations; if it is removed, corrupt rows can poison
  startup or panel rendering.
- If hydration becomes asynchronous or `load()` no longer completes before
  `hasAnnotations()`, the FAB can remain hidden despite stored annotations.
- If the outer catch is narrowed or removed, malformed local storage can abort
  script initialization instead of being ignored.
- If the extracted reader reuses `save()` or writes during load, an upgrade
  could overwrite legacy data before it has been successfully hydrated; the
  current code only re-emits the envelope on a later save.
- If `makeAnnotation` is bypassed, old rows with missing fields lose the default
  shape relied upon by panel/export/edit code.

### Cross-examination of BREAKS

`rg -n` caller evidence in the current file:

```text
placePopover: 1315, 1323, 1341, 1353, 1378, 1564, 2045, 2248
centeredFallbackRect: 1334, 1355
load: 1049, 3137
save: 1065, 1075, 3130
makeAnnotation: 857, 1060, 2004, 2005, 2006, 2023, 2402
annotations: 136, 1059, 1060, 1067, 1296, 1432, 1433, 2003-2006,
2282, 2301-2303, 2307, 2311, 2350, 2353, 2402, 2430-2439, 3127-3130
popoverOffset: 138, 1086, 1092, 1316, 1330, 2195, 2206, 2214, 2218
POPOVER_OFFSET_KEY: 122, 1083, 1092, 1093
```

`load`’s sole caller plus the immediate `hasAnnotations` call confirms the
synchronous-startup risk. `save`’s three callers confirm that persistence is a
separate write contract, so a read-only extraction cannot safely fold it into
 the reader. The `makeAnnotation` list confirms hydration is also used by live
create/edit paths, not only loading; changing that function while splitting
`load()` would expand the ticket and risk those paths. The `annotations` callers
confirm the array’s normalized shape is consumed broadly, supporting the
filter-then-map requirement.

The focused tests directly challenge the format risks: `run.js` accepts the
envelope and checks retained members, while `run5.js` seeds a bare array. Thus
the proposed split does not inherently break behavior if it preserves those
contracts. The tests do not directly cover malformed JSON, primitive rows, or
startup ordering, so those remain implementation obligations.

**Recommendation: implement-now.** This is a local, behavior-preserving seam
with existing envelope and bare-array coverage; keep synchronous orchestration,
the catch boundary, filtering, and `makeAnnotation` unchanged.
