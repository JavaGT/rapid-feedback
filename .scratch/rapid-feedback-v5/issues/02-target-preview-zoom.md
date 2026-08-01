# 02 — Target preview & element zoom

**What to build:** (Decision ticket — prototype.) Design two interactions:

1. **Chord-hold outline:** when the user holds Alt+⌘/Alt+Ctrl, show a visual outline on the element under the cursor before they click — so they know what will be annotated and can adjust.

2. **Element zoom in/out:** on the annotation popover, add buttons to walk up to the parent element or down to a child — because the specific element clicked isn't always the right granularity.

The prototype should explore: how the outline looks (border? backdrop? pulse?), whether the zoom buttons are on the popover or keyboard-driven, and how zoom state survives (does the popover re-resolve? does the annotation update in place?).

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Prototype chord-hold outline interaction (visual, performance, click-conflict handling)
- [x] Prototype zoom-in/out buttons on the popover (parent walk, child walk)
- [x] Decide whether zoom updates the annotation in place or re-opens the popover

## Resolution

Variant B selected from three-option prototype ([view](https://agentplans.javagrant.ac.nz/p/rapid-feedback-target-preview-zoom)):

1. **Chord-hold outline:** A pulsing border ring (`2px solid #4a5568`, with pulse animation on `border-color` and `box-shadow`) appears on the element under the cursor while the chord is held. It tracks the element's bounding rect in real-time.
2. **Element zoom:** ▲ Parent / ▼ Child buttons in the popover header, with the current tag name displayed between them. Clicking walks the selected element up to its parent or down to its first child. The zoom updates the selected element in place without reopening the popover.
3. **Prototype on throwaway branch:** `prototype/target-preview-zoom`.
