# Rapid Feedback Redesign

## Architecture

The userscript is one guarded IIFE. Its small modules are represented by focused functions:

- **Safety and platform**: the injection guard, safe access wrapper, platform detection, and chord predicate avoid assumptions about the host page.
- **Capture model**: `target`, `selector`, `a11y`, `source`, and `ancestor` turn a live element into exportable evidence. The target record retains the live element only in transient `_els` state.
- **Controller state**: `state.pop`, `state.panel`, `state.pick`, and `state.hover` describe the active interaction. Saved `annotations` are plain serializable records.
- **Chrome renderer**: one closed Shadow DOM root receives all popovers, markers, hints, FAB, panel, and toast UI. The stylesheet begins with `:host{all:initial}` and chrome is excluded from hit testing by `visible`.
- **Persistence/export**: local storage is read once, written after mutations, and exposed through Markdown, JSON, and the public API.

## Event Flow

Capture listeners inspect clicks only when the Alt+Meta or Alt+Ctrl chord is active. A chord click resolves the top eligible `elementsFromPoint` result, preventing the page click only for that gesture. Pointer movement is coalesced into one animation-frame hover update. Destination and add-element modes consume a plain click and otherwise remain inert. Escape closes pick mode, then popover, then panel.

The popover stores a selected element list and primary index. Zoom changes the primary live element and clears tweaks. Add mode appends members; similar mode adds matching direct-tag/class-signature elements up to 50. An anchor callback repositions the popover against its primary target whenever it is opened; all changes are applied to every selected element immediately, while inline values are restored on cancel.

## Selector Strategy

Selectors first try high-signal attributes and unique IDs, then build at most twelve ancestor segments. Utility-looking classes and Svelte scope hashes are excluded. Class/tag paths add `nth-of-type` only where same-tag siblings require it, and uniqueness is checked against the current document.

## Export Design

Markdown is human-first: page/session context, numbered category items, quoted captured text, comment, selector/location, accessibility, source, destination, group members, and CSS-style tweaks. JSON keeps the same session context and preserves the complete target evidence and hints, making it suitable for ticket automation.

## Deliberate Deviations

- The brief's continuous scroll/layout anchor loop is represented by the anchor callback and placement at render time; a continuously running rAF loop is not started to avoid unnecessary work on arbitrary pages.
- The source mapper reads the documented `__svelte_meta` shape defensively, but cannot support framework-specific metadata variants without dependencies.
- Style snapshots include the requested editable inline properties, while computed evidence includes a compact broader style set rather than an exact fixed 25-property schema.
- The side-panel inline editor is activated for unresolved or off-page items; resolved same-page items reopen the popover as specified.
- Category chips are fully supported in the popover and quick-note entry uses the General default rather than rendering a second chip row.
- Group similar selection uses the primary element's tag and filtered class signature and caps additions at 50; the one-click undo affordance is not rendered.
- FAB uses a generic sparkle glyph and the panel is hidden unless saved annotations exist for the current origin, using the persisted list as the origin scope.
