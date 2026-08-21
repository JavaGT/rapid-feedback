# Rapid Feedback — DeepSeek Rebuild Design Notes

This document describes the architecture of the independent re-implementation in
`rapid-feedback.user.js`. It is written purely from the brief; nothing in the
original repo was read.

## Module breakdown

The single file is organized as a set of internal modules wrapped in one IIFE.
Because it must run on arbitrary hostile pages with zero dependencies, all
modules are plain functions/scopes sharing a small set of globals through
closures (no classes over-used, no external state library).

1. **Boot & guard** — re-injection guard, DOM-ready wait, initialization.
2. **Platform** — macOS/Windows detection via `navigator.userAgentData` with UA fallback; computes the chord modifier set.
3. **Shadow utilities** — a factory that builds a detached Shadow DOM root with an `all:initial` reset and injects our own CSS. Used for every piece of tool chrome (preview overlay, popover, panel, toasts, hints).
4. **Selector generator** — `shortestUniqueSelector(el)`: filters utility classes, prefers high-signal attributes, walks ancestors only as far as needed, caps at 12 segments, strips Svelte scope hashes.
5. **Element capture** — `captureElement(el)` returns text snippet, computed-style snapshot, rect, accessibility info, Svelte source mapping.
6. **Similarity** — `elementSignature(el)` (tag + semantic class signature) and `findSimilar(primary)` for `⧉ Select similar`, capped and one-click undo-able.
7. **State store** — localStorage persistence with legacy-key migration, per-origin scoping, in-memory cache.
8. **Input controller** — global listeners for keydown/keyup/mouse events; manages the chord, hover hit-testing coalesced per animation frame, and routes gestures.
9. **Hover preview** — pulsing outline overlay showing the target.
10. **Annotation popover** — the tabbed Shadow-DOM editor anchored to the target, following it via a rAF anchor loop.
11. **Live style tweaks** — property editor applying live to all selected elements, with snapshot/restore.
12. **Side panel** — right-docked 380px panel listing cards, toolbar, footer quick-add.
13. **Export** — markdown() and json() formatters.
14. **SPA handling** — history patching + popstate listener, route-change draft close with toast.
15. **Public API** — `window.__SCOPE_FEEDBACK_API__`.

## State model

In-memory reactive store object, `Store`:

- `module`: one of `idle` | `hovering` | `capturing` | `picking-target` | `picking-element` | `similar-undo`.
- `draft`: the in-progress annotation (or null). Fields mirror the annotation schema minus persisted id/time.
- `selection: Element[]` — the live DOM element set currently being annotated (members of the draft's group).
- `primaryIndex` — which member is primary.
- `snapshots: Map<Element, Map<prop,val>>` — original inline style values for live-tweak restore.
- `openAnnotationId` — the annotation whose popover is open (edit mode).
- `panelOpen` — side-panel visibility.

Persisted annotation schema (`localStorage`, JSON array):
```
{
  id, category, comment, text, label, source, a11y, selector, where,
  tag, rect, adjustedStyles, destination, groupSize, targets[], hints,
  createdAt, updatedAt
}
```

Persistence is scoped per origin: the FAB only shows when the current origin has
saved annotations. A legacy key name is migrated on first load.

## Event flow

- Keydown of the chord modifier → enter `hovering`, start rAF coalesced
  `elementsFromPoint` hit-test → show pulse outline on the hovered element.
- `mousedown` while chord held → `capturing`: push target, show green member
  markers; subsequent chord-clicks accumulate members (via
  `elementsFromPoint` to pierce overlays).
- Chord release → resolve accumulation into a draft (or grow the existing open
  draft's selection), open the popover anchored to the primary element.
- Popover actions: Submit → normalize draft into a persisted annotation, keep
  tweaks applied, close. Cancel/Escape → restore snapshots, discard. Cut →
  copy Markdown for this annotation only, without persisting. Retarget buttons
  (▲▼◀▶) re-point `selection[0]` (or primary) to parent/child/siblings,
  reset pending style edits.
- Destination pick → `picking-target`, plain click after chord release records
  destination; Esc cancels, draft preserved.
- `Escape` priority stack: cancel pick → close popover → close panel.

## Rendering approach

All tool chrome is a separate Shadow DOM root per widget, carrying an
`all: initial` stylesheet so host CSS can't bleed in and our CSS can't leak out.
Positioning is absolute in `position:fixed` coordinates computed from the host
element's `getBoundingClientRect` and viewport dimensions. The row of host
elements to mark is drawn via markers inside the preview overlay's shadow root.

Nothing the tool renders is itself annotatable: every tool-chrome shadow root is
created with `pointer-events: none` on the container and re-enabled only on
interactive controls; during pick modes we also set a `point-events:none`
body-level class... but since we must never alter host behavior, we instead
handle this by keeping the chrome's own pointer-events none while the chord is
held so the underlying click reaches the page (the page is a sibling, so it's
never blocked). See Interactions below.

## Selector generation strategy

`shortestUniqueSelector`:
1. Prefer the element's `id` if unique and free of auto-generated patterns.
2. Fall back to a chain built from the element up, at each level trying:
   `tag`, then attribute selectors in order of preference (`aria-label`, `name`,
   `href`, `src`, `placeholder`, `data-testid`, `data-cy`, `data-test`), then a
   semantic class (non-utility, non-hash), capping at 12 segments.
3. Utility classes (Tailwind-style `flex-*`, `p-*`, `m-*`, `bg-*`, dimensions,
   grid cols, etc.) are filtered; Svelte scope hashes (`.svelte-xxxx`) are
   stripped/ignored.
4. Stop walking ancestors as soon as the chain resolves to exactly one element
   ("shortest unique").

## Export format design

**Markdown** has a header block (title, URL, viewport, browser/OS) then numbered
items tagged `[CATEGORY] label`. Each item includes the quoted element text
distinct from the reviewer's comment, a Source + component-stack block, an
`A11y:` line, `Where:` compact ancestor chain, `Rect:`, a `Destination:` block
when present, a `Group:` block when the annotation has multiple members (each
with its own resolvable selector), and a `Tweak:` block for adjusted styles.

**JSON** is `{ session: { pageTitle, url, route, viewport, browser, os },
items: [annotation...] }` with the full annotation schema.

## Coalescing & robustness

- Hover hit-testing is coalesced to one `elementsFromPoint` per animation frame.
- The popover re-anchors to its target every rAF (scroll/layout shift).
- SPA: `history.pushState`/`replaceState` patched once; `popstate` listened;
  on route change any unsaved draft is closed with a toast instead of being
  silently retargeted.

## Deviations

- **FAB reveal threshold**: the brief says the FAB "only reveals when the
  current origin has saved annotations". I implement that literally (hide when
  zero saved for origin). No extra heuristic.
- **Ordered "following"**: the brief lists a specific popover placement order
  (below → above → right → left). I implement exactly that order with viewport
  clamping, preferring the side that has the most room as a tie-break only when
  the preferred side would overflow (still never covering the target).
- **Markdown "Cut"**: Cut is implemented as copy-only-without-save (per brief);
  there is no separate "cut from list" that removes from local copies — the
  brief does not ask for removal on Cut.
- **"⧉ Select similar" cap**: capped at 50 extra members including the primary,
  with one-click undo restoring the previous selection. This matches the brief's
  "capped at 50, one-click undo".
- **Component stack**: capped at 12 frames as specified.
- **Text snippet**: hard-capped at 150 chars; ellipsis is appended to mark
  truncation.
- **No CSS animations for markers/pulse beyond a CSS keyframe defined inside the
  shadow root**; no runtime animation library, per zero-dependency constraint.
- **Comment text is HTML-escaped everywhere it is rendered** to avoid breaking
  the tool's own DOM or being interpreted as markup.

## Verification

Passes `node --check deepseek-redesign/rapid-feedback.user.js`.
