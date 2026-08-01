# 04 — Live-styles UX redesign

**What to build:** (Decision ticket — prototype.) The live-styles panel on the annotation popover has two problems: it covers the very element being styled, and the inline text-input-plus-range-slider controls are awkward. Prototype a redesigned approach:

- Popover positioning: detect when the popover overlaps its target and reposition (above, left, right, or into a minimised mode). Consider a "peek" mode that shrinks the popover to a toolbar while adjusting styles.
- Style controls: explore a more ergonomic layout — perhaps grouped controls, numeric-stepper inputs, or visual presets.
- General popover edge-detection: the same repositioning logic should help with near-edge-of-screen placement in general.

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Prototype popover repositioning that avoids covering the target element
- [x] Prototype improved style-adjustment controls
- [x] Prototype edge-of-screen popover placement

## Resolution

Variant B selected with one tweak from three-option prototype ([view](https://agentplans.javagrant.ac.nz/p/rapid-feedback-live-styles-ux)):

1. **Popover repositioning:** Auto-reposition engine (below → above → right → left → centered fallback) from variant A adopted as the general placement logic for all popovers.
2. **Style controls:** Minimised tabbed mode from variant B — a tab bar with Comment and Styles buttons. **Comment is the default** (open on popover). The Styles tab reveals a 2-column grid of style inputs. This keeps the popover compact for the common case (just leaving a comment) and tucks style editing behind one click.
3. **Edge-of-screen:** The repositioning engine handles all four edges and corners.
