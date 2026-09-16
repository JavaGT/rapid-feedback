# Abstraction-zoom review — 2026-09-17

Scope is limited to the 2026-09-16 changes: the pre-envelope load branch, `centeredFallbackRect`, and the `waitFor` helper slice. Existing major sites are not re-reported.

## Outlines

- **Pre-envelope load (`rapid-feedback.user.js:1056-1069`):** read the storage key; return if absent; parse JSON; choose bare-array versus envelope rows; retain object rows; hydrate each row with `makeAnnotation`; swallow load errors.
- **Centered fallback (`rapid-feedback.user.js:1337-1366`):** clear persisted drag offset; read the live anchor if connected; otherwise construct a centered synthetic rect; place the popover; wake anchoring; show confirmation. The new helper computes the synthetic rect from viewport width and the 8px edge pad.
- **Wait helpers (`test/common.js:54-71`, used by `test/run.js`):** describe the polling contract; delay; repeatedly evaluate a page expression until truthy or deadline; throw a diagnostic timeout; specialize for open/closed popover; export the helpers.

## Findings

1. **`load()` spans persistence, wire-format discrimination, row validation, and domain hydration.** Evidence: `rapid-feedback.user.js:1056-1068` performs `localStorage` access, `JSON.parse`, array/envelope selection, filtering, and `makeAnnotation` mapping in one procedure, with the format distinction embedded in a ternary. This is a real level boundary, not a correctness defect. Proposed behavior-preserving bricks: `readStoredAnnotations()` (storage + parse), `annotationRowsFromPayload(parsed)` (format selection), and `hydrateAnnotations(rows)` (filter + `makeAnnotation`). Keep the outer `load()` as orchestration; preserve the existing catch-and-ignore behavior. (Related envelope-version question remains #41; this finding is the broader seam, not a duplicate of that ticket. Tracker: #47.)

2. **Popover geometry policy is still mirrored as literals around the new fallback brick.** Evidence: `rapid-feedback.user.js:1327-1328` clamps with literal `8`, `1350-1357` separately defines `gap = 8, pad = 8`, and `1363-1365` defines another local `pad = 8` plus the fallback rect. The helper is one-level, but edge/gap policy is conventionally duplicated. Proposed behavior-preserving bricks: `popoverViewportInsets()` (pad/gap), `centeredFallbackRect(insets)` (synthetic target), and `clampPopoverPosition(...)` (shared bounds). Preserve current 80px top and all placement branch ordering. Tracker: #46.

The `waitFor` slice is coherent as a bounded-polling primitive. Its page-expression string boundary and exported-but-unused generic helper are already represented by #35 and #43; no new finding is filed here.

## Deferred (already ticketed)

- `showPopover` body — #16.
- panel — #20.
- `componentFramesFor` — #19.
- chord listeners — #21.
- category-bar construction — #26.
- element-capture trio — #27.
