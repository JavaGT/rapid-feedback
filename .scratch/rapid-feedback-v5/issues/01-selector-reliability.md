# 01 — Selector reliability & scroll position

**What to build:** (Decision ticket — grilling.) Decide what a "complete" element selector means for Rapid Feedback, and whether scroll/anchoring position should join the annotation data model. The current `describeElement()` builds an ancestor chain but often misses the full path. We need to settle: what algorithm or heuristic produces the most useful selector for a non-technical annotator, and should `window.scrollX/Y` be captured alongside the bounding rect?

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Settle the selector-generation algorithm (how deep? which attributes? class filtering?)
- [x] Decide whether scroll position joins the annotation model and how it appears in exports
- [x] Decide whether the `rect` field should be relative to viewport, document, or both

## Resolution

1. **Depth:** dynamic — fewer segments on simple pages, deeper on dense ones.
2. **High-signal segments:** `id`, `aria-label`, `name`, `href` are the priority attributes; don't stop at the first ID — keep building the full chain regardless.
3. **Class filtering:** strip known utility-framework classes (Tailwind, UnoCSS, Bootstrap helpers) from segments, then cap remaining semantic classes at 3 per segment.
4. **Scroll & rect:** drop XY position from the annotation model. The selector chain is the locator. Rect stays as dimensions only (`width × height`). Scroll offset is not captured.
