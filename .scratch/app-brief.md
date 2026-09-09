# Rapid Feedback — App Summary & Rebuild Brief

> Status 2026-09-10: the rebuilds this brief seeded (`luna-redesign/`, `deepseek-redesign/`, `oxalpha-redesign/` pending #11) were deleted as delivered experiments in 86ce2e2 (#6, #10) — deliverable paths below are historical.

## What the app is

A Tampermonkey/Greasemonkey **userscript** (~2,100 lines of dependency-free vanilla JavaScript) that runs on every page (`@match *://*/*`). It lets a reviewer visually annotate any element on any web page and export that feedback as compact Markdown or structured JSON that a developer can act on. Think "leave Figma-style comments on a live web page, then copy the whole session into a ticket".

## Core user flows

1. **Annotate**: hold `Alt+⌘` (macOS) or `Alt+Ctrl` (Windows/Linux) and click any element → an annotation popover opens anchored to it.
2. **Describe**: type a comment, pick a category chip (General / Bug / Feature / Suggestion / Question), optionally tweak styles live, optionally pick a destination, submit (`⌘/Ctrl+Enter` or button).
3. **Review & export**: open the side panel, browse/edit/delete saved annotations, copy everything as Markdown or JSON to the clipboard.

## Feature inventory (the premises your rebuild must satisfy)

### Activation & targeting
- **Chord-click activation**: `Alt+⌘/Ctrl + click` opens the annotator; platform detected via `userAgentData.platform` with UA fallback. All other page interaction stays untouched.
- **Hover preview**: while the chord is held, a pulsing outline shows exactly which element a click would capture.
- **Overlay piercing**: clicks on common modal/drawer overlay layers resolve to the element underneath via `elementsFromPoint`.
- **Element zoom**: ▲▼◀▶ buttons retarget to parent / first child / previous sibling / next sibling; the popover header re-renders so you always see what you're capturing. Retargeting resets pending style edits (they belonged to the old element).

### Multi-select & grouping
- Multiple chord-clicks during one hold accumulate into a single group annotation (green markers show accumulating members); releasing the chord resolves them into one popover.
- Chord-clicking while a popover is already open **grows** the current selection instead of discarding the draft.
- The selection is an **editable list**: remove a member, promote a member to *primary* (the primary drives the header, zoom row, destination, and exported selector), `+ Add element` enters a click-pick mode, `⧉ Select similar` adds direct siblings sharing the primary's tag + semantic class signature (capped at 50, one-click undo).
- Missing-member disclosure: reopening a saved group whose elements no longer resolve shows "N of M still found" rows.

### Annotation popover
- Rendered inside a **Shadow DOM** root with an `all:initial` reset, immune to host-page CSS. ~320px wide, positioned below → above → right → left of the target, never covering it, clamped to viewport.
- Follows its target through scrolling and layout shifts via a requestAnimationFrame anchor loop.
- **Tabbed, comment-first UI**: Comment tab (textarea + category chips + destination row) by default; Styles tab behind one click.
- Actions: Cancel (revert everything), Cut (copy this one annotation as Markdown without saving), Submit.
- Tool chrome becomes **click-through** while the chord is held or a pick mode runs, so the tool can never swallow a click meant for the page; nothing the tool renders can itself be annotated.

### Live style tweaks
- Adjustable properties: padding, margin, font-size, color, background-color, border-radius, width, height, gap, line-height, opacity (range slider).
- Edits apply **live to every selected element** as you type; arrow keys on inputs increment/decrement values (shift = ×10 step).
- Original inline values are snapshotted so Cancel/Escape restores the page; Submit keeps the edits applied.
- Exported as a `Tweak:` block (CSS-declaration style lines).

### Relocation (destination)
- "Pick destination" enters a real pick mode: crosshair cursor, hint banner, plain click selects, `Esc` cancels, and the unsaved draft is preserved either way. Records where the annotated element should move to.

### Per-element capture
- **Shortest unique CSS selector**: filters out utility classes (Tailwind-style patterns), prefers high-signal attributes (`aria-label`, `name`, `href`, `src`, `placeholder`), walks ancestors only until the chain resolves uniquely, caps at 12 segments, strips Svelte scope hashes (`.svelte-xxxx`).
- Text snippet (≤150 chars), computed-style snapshot (~25 layout/typography props), bounding rect, accessibility info (explicit or implicit role, accessible name from aria-label/labelledby/alt/title, test id).
- **Svelte source mapping**: reads `__svelte_meta` off the nearest ancestor that has it → source file:line:column plus a component stack (up to 12 frames), shown in exports so developers can jump straight to code.

### Side panel
- Right-docked 380px panel: card per annotation (short selector label, category chip, group-size badge, source ref, comment, adjusted styles, URL).
- Edit reopens the full popover **only on the page the annotation was taken on** and only if its elements still resolve; anywhere else the comment stays editable inline in the card.
- Delete per card. Toolbar: Copy (Markdown), JSON, Cut All (copy + clear), Clear.
- Footer: quick-add box for general notes with category chips (`⌘/Ctrl+Enter` submits).

### Export formats
- **Markdown**: header with page title, URL, viewport size, browser + OS; numbered items `[CATEGORY] label`; quoted element text distinct from the reviewer's comment; Source + component stack; A11y line; Where (compact ancestor chain); Rect; Destination block; Group block listing every member with its own resolvable selector; Tweak block.
- **JSON**: `{ session: { pageTitle, url, route, viewport, browser, os }, items: [...] }` with category, comment, text, label, source, a11y, selector, where, tag, rect, adjustedStyles, destination, groupSize, targets[], hints.

### Persistence & discoverability
- Annotations persist in `localStorage` (key migrates from a legacy name). Annotations are scoped per origin: the floating action button (FAB) only reveals when the current origin has saved annotations, and hides otherwise, so it never clutters unrelated pages.
- FAB click toggles the panel; double-tapping the chord toggles the panel too.
- `Esc` layers: cancel pick mode → close popover → close panel.

### Robustness
- SPA-safe: patches `history.pushState`/`replaceState` and listens for `popstate`; on route change, unsaved drafts are closed with a toast rather than silently retargeted onto the new screen.
- Re-injection guard (`window.__SCOPE_FEEDBACK_LOADED__`).
- Public API on `window.__SCOPE_FEEDBACK_API__`: `markdown()`, `json()`, `annotations`, `clear()`, `openPanel()`.
- Hover hit-testing coalesced to one update per animation frame.

## Constraints for the rebuild

- Single-file userscript, zero dependencies, vanilla JS, must survive injection into arbitrary hostile pages.
- Must never alter host-page behavior except during explicit annotation gestures.
- Implement the full feature inventory above; where you deliberately simplify or deviate, say so explicitly in your design notes.

## Deliverables (write into `luna-redesign/`)

1. `rapid-feedback.user.js` — the working userscript (userscript header optional but welcome).
2. `DESIGN.md` — your architecture: module breakdown, state model, event flow, rendering approach, and anything you'd do differently from a naive first pass.
3. Code must pass `node --check`.

## Rules

- Design from **this brief only**. Do not open `rapid-feedback.user.js`, `README.md`, or `test/` — the point is an independent design for later comparison.
