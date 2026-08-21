# Rapid Feedback rebuild — architecture plan (oxalpha)

Single-file Tampermonkey userscript, vanilla JS, zero dependencies. Everything the user sees lives
inside **one** fixed-position host element (`<div>` appended to `document.body`) whose shadow root
(`mode:'closed'`, `all:initial` reset) contains all chrome: hover outline, popover, side panel, FAB,
pick-mode banner, toast. Host pages can't style it, and `pointer-events` on the chrome root is
flipped to `none` whenever the chord is held or a pick mode runs, so tool UI can never swallow page
clicks nor be annotated itself.

## Module breakdown (ordered sections inside one IIFE)

1. **Guards & platform** — `window.__SCOPE_FEEDBACK_LOADED__` bail-out; platform via
   `navigator.userAgentData?.platform` with UA regex fallback (mac ⇒ Alt+⌘, else Alt+Ctrl).
2. **store** — central mutable state + tiny `emit(event)` pub-sub; the only place mutation happens.
3. **selector** — shortest-unique-selector engine (below).
4. **capture** — element ⇒ descriptor: text snippet (≤150 chars), ~25 computed layout/typography
   props, bounding rect, a11y (explicit/implicit role, accessible name from aria-label /
   aria-labelledby / alt / title, test id), Svelte meta from nearest `__svelte_meta` ancestor
   (file:line:col + component stack, ≤12 frames).
5. **tweaks** — live style editor: applies values to every live target element, snapshots original
   inline styles per element on first touch, restores on cancel.
6. **overlay** — creates the shadow root; sub-renderers: `outline`, `popover`, `panel`, `fab`,
   `banner`, `toast`. All rendering is full re-render of the affected subtree from state (no vdom,
   sizes are small); event delegation on the shadow root.
7. **chord** — keyboard listeners tracking chord state; double-tap detection (~400 ms) toggles panel.
8. **picker** — generic pick-mode driver (crosshair cursor, hint banner, Esc cancel) used for both
   "+ Add element" and "Pick destination".
9. **hitTest** — `elementsFromPoint` walker that pierces common overlay layers (full-viewport
   fixed elements with transparent/near-transparent background) to find the real target; coalesced
   to one update per animation frame.
10. **group** — selection-list operations: add, remove, promotePrimary, selectSimilar (siblings
    sharing tag + filtered class signature, cap 50, one-slot undo).
11. **exporters** — pure functions `toMarkdown(session, items)` / `toJson(session, items)`.
12. **persist** — localStorage load/save (debounced), legacy-key migration (read old key, write new,
    delete old), per-origin filtering.
13. **spa** — patch `history.pushState`/`replaceState` + `popstate`; on route change close any open
    draft/popover with a toast instead of retargeting.
14. **api** — `window.__SCOPE_FEEDBACK_API__` = `{ markdown, json, annotations, clear, openPanel }`.

## State model

```
mode: 'idle' | 'chord' | 'pickElement' | 'pickDestination'
draft: null | {
  targets: [{ el, desc }],        // el = live ref for edits; desc = captured descriptor
  primaryIdx,                      // drives header, zoom row, destination, exported selector
  comment, category,               // General|Bug|Feature|Suggestion|Question
  tweaks: { prop: value },         // pending style edits
  originals: Map<el, {prop:val}>,  // pre-tweak inline styles (Cancel/Escape restores)
  destination: { el, desc } | null
}
annotations: Item[]                // serializable saved records (no live refs)
ui: { panelOpen, popoverTab, hoverEl, missingReport }
```

Saved `Item`: `{ id, ts, url, origin, category, comment, text, label, selector, where, tag, rect,
a11y, source, adjustedStyles, destination, groupSize, targets[], hints }`. Live element refs exist
only inside an active draft; everything persisted is plain data, so panels survive reloads.

## Event flow

- **Chord down** → `mode='chord'`; mousemove (rAF-coalesced) → hitTest → pulsing outline on would-be
  target. Chrome goes click-through.
- **Chord-click** → resolve target through overlays → append to `draft.targets` (create draft if
  none; if a popover is already open, grow it). Green markers mark accumulating members.
- **Chord up** → if targets accumulated, open popover anchored to primary; zoom ▲▼◀▶ retargets
  primary (parent / first child / prev / next sibling) and **clears pending tweaks** (they belonged
  to the old element).
- **Submit** (⌘/Ctrl+Enter or button) → freeze descriptors, apply tweaks stay, push `Item`,
  persist, close popover. **Cut** = copy single-item Markdown without saving. **Cancel/Escape** =
  restore original inline styles, discard draft.
- **Esc layering**: pick mode → popover → panel (one layer per press).
- **Route change** (SPA patch): close draft + popover, toast "draft discarded".

## Rendering & anchoring

Popover/panel are re-rendered from state on `emit`. A single `requestAnimationFrame` anchor loop
runs only while the popover is open: repositions it below → above → right → left of the primary
target, clamped to viewport, never covering it, and follows scroll/layout shifts.

## Selector-generation strategy

For element `el`: build candidate segments walking ancestors (≤12):
1. Segment = `tag` + kept classes + optional `[attr="value"]` predicate. Attributes tried in order:
   `id`, `data-testid`, `aria-label`, `name`, `href`, `src`, `placeholder`.
2. Class filter drops utility noise: Tailwind-ish patterns (`hover:`, `md:`, `dark:` prefixes,
   bracket-arbitrary values `[...]`), `.svelte-xxxx` scope hashes, and single/double-letter junk.
3. Compose path bottom-up; after each ancestor step check
   `document.querySelectorAll(path).length === 1 && matches el` — return the **first** (shortest)
   unique path. Final fallback: `nth-of-type` disambiguation on the last ambiguous level.
4. `where` = compact ancestor chain (tag + kept classes, 3–4 levels) for human reading; group
   members each carry their own selector so "N of M still found" can be recomputed on reopen.

## Export format design

- **Markdown**: H1 title, meta lines (URL, viewport, browser+OS), then numbered items:
  `[CATEGORY] label`, `> element text` (quoted, distinct from reviewer comment), body comment,
  `Source:` file:line:col (+ indented component stack), `A11y:` role/name, `Where:` chain, `Rect:`,
  optional `Destination:` block, `Group:` list of member selectors, `Tweak:` CSS-declaration lines.
- **JSON**: `{ session: { pageTitle, url, route, viewport, browser, os }, items: [...] }` — item
  fields mirror the saved `Item` above 1:1, so exporters are straight projections of persistence.

## Deviations (deliberate simplifications)

- **Live refs in drafts only**: active drafts hold strong element references (fine for a gesture-
  scoped lifetime); persistence is fully serializable. Reopening relies on selector re-resolution.
- **Select-similar undo** is a single one-shot slot, not a history stack.
- **Overlay piercing** uses heuristics (large fixed-position, sparse-content layers), not a
  framework-specific modal registry.
- **Computed-style snapshot** is a fixed curated list (~25 props), not exhaustive.
- **No drag-repositioning** of the popover; placement is automatic only.
- **Toast/banner copy** is minimal English-only; no theming/i18n infrastructure.
- **Persistence writes** are debounced whole-array saves (no incremental diffs) — annotation volume
  makes this a non-issue.
