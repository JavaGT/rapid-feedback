# 03 — Grouping & relocation annotations

**What to build:** (Decision ticket — grilling.) Design how "this element should move over there" works as a first-class annotation type. A user often wants to say not just "this button is wrong" but "this button should be over there instead." This needs:

- A grouping model: how do two annotations (source + destination) link together?
- A targeting interaction: after annotating the source element, how does the user select the destination?
- Representation in exports: how does a relocation appear in markdown and JSON?

Also consider: does grouping generalise beyond relocation (e.g., "these three things belong together")?

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Decide the grouping data model (linked annotations? a composite annotation type?)
- [x] Design the destination-targeting interaction (second chord-click? button on existing popover?)
- [x] Design the export representation for grouped/relocation annotations

## Resolution

1. **Relocation:** A "Pick destination" button on the popover. Click it, the popover enters destination mode, then chord-click the target element. The annotation stores a `destination` sub-object (selector, a11y, rect).

2. **Grouping:** Hold chord and click multiple elements; releasing the chord opens one merged popover with all targets listed. The annotation stores them in a `targets[]` array. Works for general grouping beyond relocation.

3. **Export:** Full detail for the primary/source element, compact reference (selector + a11y only, no rect/styles) for destination and grouped elements. One `##` heading per annotation; grouped annotations list members inline under the primary.
