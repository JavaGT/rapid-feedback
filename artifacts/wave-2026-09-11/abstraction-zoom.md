# Abstraction-Level Zoom — HEAD snapshot (2026-09-11)

Analysis target: `rapid-feedback.user.js` (HEAD, 3071 lines) and `test/*.js` at HEAD.
Excluded: luna-redesign, deepseek-redesign, oxalpha-redesign, .scratch.

## Already ticketed (superseded by open issues — NOT re-reported)

| Issue | What it covers |
|-------|---------------|
| #16 | showPopover monolith — 635-line closure state ball (lines 1401-2035) |
| #19 | componentFramesFor — 3 inline dedupers + O(n²·m) index merge (lines 544-600) |
| #20 | Panel shell monolith + data-idx index fragility (lines 2211-2469) |
| #21 | chord-listener guard prologues, hand-rolled dedupe (line 2854), composedPath extraction (lines 2620, 2686, 2745, 2917) |

---

## New findings

### F1 — Triple-duplicate element-capture functions [STRONG]

**Three functions** build nearly identical annotation-shape objects from a live DOM element, differing only in which fields they include:

| Function | Location | Fields captured |
|----------|----------|----------------|
| `captureMemberRef(el)` | lines 2045-2057 | selector, framePath, tag, text, a11y, rect, source, looks |
| `captureDestination(el)` | lines 2629-2641 | selector, framePath, tag, text, a11y, rect, source, looks |
| `capturableEl(el)` | lines 2717-2731 | selector, framePath, tag, text, styles, looks, rect, source, a11y |

`captureMemberRef` and `captureDestination` are **functionally identical** — same 8 fields, same getter calls, same shape. `capturableEl` adds `styles` (via `getComputedStyles`) and wraps `{ el, data }`. Every call site that needs "element → annotation blob" calls one of these three by name; callers cannot tell from the API which fields are present.

**Proposed:** a single `captureElementMeta(el, { includeStyles })` that returns the union shape. `capturableEl` becomes `captureElementMeta(el, { includeStyles: true })` plus the `.el` wrapper. Eliminates ~30 lines of duplicated mapping and guarantees the three consumers never drift.

**Leverage:** any new annotation field (e.g., upcoming `framePath` enrichment in v5.18) currently requires editing three functions in lockstep.

---

### F2 — Category bar built verbatim twice [STRONG]

The identical "create N category buttons, arm click-to-toggle-active" pattern appears in two places:

- Popover category bar: lines 1758-1769
- Panel footer category bar: lines 2331-2341

Both iterate `CATEGORIES`, create `<button class="rf-cat-btn">`, wire a click handler that queries siblings to strip `.active`, adds `.active` to self, and writes the selected id. The DOM shape is identical; the only difference is the variable the selected id is written to (`selCat` vs `activeCategory`).

**Proposed:** `buildCategoryBar(getCurrent, setCurrent)` returns a `<div>` with armed buttons. Eliminates ~20 duplicated lines and the risk that one bar gains a new category while the other does not.

---

### F3 — Route-change teardown duplicated in ESC handler [MEDIUM]

`handleRouteChange` (lines 3035-3040) runs:
```
pickMode = null; setFeedbackCursor(''); hidePickBanner();
clearChordGesture(); hidePopover();
```

The ESC keydown handler (lines 2988-2990) runs a subset:
```
exitPick(null)  // which does: pickMode = null; setFeedbackCursor(''); syncChromeClickThrough(); hidePickBanner();
cancelPopover() // which does: popoverOffset = null; savePopoverOffset(); hidePopover();
```

Both paths perform the same logical state reset — "abort whatever is in flight" — but through different function chains with subtly different side effects (ESC saves the dragged offset; route change discards it). The code comment at line 3026-3029 already acknowledges this tension.

**Proposed:** a single `abortAllDrafts({ preserveDragOffset })` that both ESC and route-change call with the appropriate flag. Prevents the two teardown paths from diverging when new in-flight state is added (v5.18 is adding more).

---

### F4 — Test shadow-root scan IIFE repeated across suites [MEDIUM]

At least three test files contain the same inline IIFE to find elements inside shadow roots:

```js
[...document.body.children, ...document.documentElement.children]
  .find(h => h.shadowRoot?.querySelector('.rf-panel'))
```

Locations (representative):
- `test/run3.js:12`
- `test/run6.js` (repeated ~5 times)
- `test/run.js:81` (slightly different shape for banner)

Each test file rewrites this traversal independently. The common.js module already exports `POP` (for popover) and `MARKERS` (for marker count) as pre-baked IIFEs, but the panel-root scan was never promoted there.

**Proposed:** add `PANEL` and `BANNER` string constants to `common.js` following the `POP`/`MARKERS` pattern. Eliminates ~15 lines of per-suite duplication and ensures all suites stay consistent when shadow DOM structure changes.

---

### F5 — Clipboard functions couple feedback to copy [LOW]

`fallbackCopy(text)` (lines 1018-1027) creates a textarea, runs `document.execCommand('copy')`, and calls `showToast('Copied')` or `showToast('Failed')` inline. `copyText(text)` (lines 1029-1035) tries `navigator.clipboard.writeText` with the same toast coupling, then falls back to `fallbackCopy`.

Every caller that wants to copy text to the clipboard also implicitly triggers a toast. There is no way to silently copy or to show a custom message after the copy. The coupling is small (6 lines), but it means the clipboard API and the UI feedback layer are entangled at the utility level.

**Proposed (low priority):** separate `copyToClipboard(text)` (returns a Promise<boolean>) from the toast callsite. Callers that want feedback call `copyToClipboard(text).then(ok => showToast(ok ? 'Copied' : 'Failed'))` explicitly.

---

### F6 — Export field expansion overlaps between toMarkdown and toFeedbackJSON [LOW]

`toMarkdown` (lines 867-958) and `toFeedbackJSON` (lines 960-1016) both iterate `annotations` and expand each item's nested fields (destination, targets, source, looks, adjustedStyles) using parallel inline logic. The destination block in toMarkdown (lines 910-923) and the destination block in toFeedbackJSON (lines 990-998) are structurally identical — they read the same fields from `a.destination` and produce equivalent output shapes.

**Proposed (low priority):** a shared `expandAnnotation(a)` or per-field helpers (`destinationShape(a)`, `targetShape(t)`) that both export functions call. Eliminates ~20 lines of parallel mapping. Lower urgency because the two functions intentionally produce different output formats, so some duplication is inherent.

---

## Summary

| ID | Strength | File:line | One-liner |
|----|----------|-----------|-----------|
| F1 | STRONG | user.js:2045, 2629, 2717 | Triple-duplicate element→annotation capture (captureMemberRef / captureDestination / capturableEl) |
| F2 | STRONG | user.js:1758, 2331 | Category bar construction duplicated verbatim in popover and panel |
| F3 | MEDIUM | user.js:3035, 2988 | Route-change teardown and ESC teardown are parallel, subtly divergent state resets |
| F4 | MEDIUM | test/run3.js:12, test/run6.js (×5), test/run.js:81 | Test shadow-root scan IIFE repeated; PANEL/BANNER not promoted to common.js |
| F5 | LOW | user.js:1018, 1029 | Clipboard helpers couple copy feedback (toast) to copy action |
| F6 | LOW | user.js:867, 960 | Export field expansion (destination/targets/source) parallel in toMarkdown and toFeedbackJSON |
