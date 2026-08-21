# Comparison: Original Rapid Feedback vs. Luna's Independent Redesign

Luna rebuilt the app from a written brief alone (`.scratch/app-brief.md`) without seeing the original code.
Original: `rapid-feedback.user.js` (2,104 lines, v5.9). Redesign: `luna-redesign/rapid-feedback.user.js` (93 lines) + `DESIGN.md`.

## Verdict up front

Luna produced a genuinely working userscript that covers roughly **80% of the feature set** in 4% of the lines — an impressive compression, and a few of its ideas are real improvements. But the missing 20% is exactly the hard 20%: edge-case safety, hostile-page robustness, and the polish that makes the original trustworthy on arbitrary pages. The original's 23× size is mostly *defensive engineering*, not bloat.

## At a glance

| | Original | Luna redesign |
| --- | --- | --- |
| Size | 2,104 lines | 93 lines (very dense) |
| Style | Heavily commented, one concern per function | Packed one-liners, single-letter vars |
| Shadow DOM | Many small open roots (FAB, panel, popover, toast…) | One **closed** root for everything |
| Multi-select model | Clicks accumulate silently during one chord hold, resolve on release | First click opens the popover immediately; later chord-clicks append |
| Tests | Puppeteer harness (`test/`) | None |
| Docs | README + per-version `@note` changelog | DESIGN.md (35 lines) |

## Feature coverage

| Brief item | Original | Luna | Notes |
| --- | --- | --- | --- |
| Chord activation + platform detect | ✅ | ✅ | Equivalent |
| Hover target preview | ✅ pulsing outline around element bounds | ⚠️ | Luna draws a 16px dot at the element's center — much weaker "what will I grab" signal |
| Accumulate-during-hold grouping | ✅ green markers build up, resolves on release | ❌ | Each click opens/appends instantly; similar end result, different feel |
| Editable selection list (promote/remove/add) | ✅ | ✅ | Both work |
| Select similar (cap 50) | ✅ with one-click undo | ⚠️ | Adds siblings but no undo (declared deviation) |
| Element zoom ▲▼◀▶ + tweak reset on retarget | ✅ | ✅ | Equivalent behavior |
| Tabbed comment-first popover, category chips | ✅ | ✅ | Luna re-renders the whole body on category click (focus loss) |
| Live style tweaks on all members, arrow-key steps, revert/keep semantics | ✅ | ✅ | Snapshot/restore logic is sound |
| Destination pick mode w/ draft preservation | ✅ | ✅ | Works |
| Shortest-unique selector, utility-class filter | ✅ scoped to element's own root (works inside shadow DOM) | ⚠️ | Luna checks uniqueness against `document` only — selectors silently degrade on pages using web components |
| Svelte source mapping | ✅ reads `__svelte_meta.loc` + component stack | ❌ | Luna reads `__svelte_meta.file` directly — that field doesn't exist in real Svelte output, so source refs come back empty in practice |
| A11y capture | ✅ | ✅ | Luna also treats `data-testid` as high-signal — nice touch |
| Panel: edit/delete/Copy/JSON/Cut All/Clear/quick note | ✅ | ✅ | Luna's cards show less detail (no source ref, no tweak list, no count badge) |
| Missing-member disclosure on reopen | ✅ "N of M still found" rows | ❌ | Worse: unresolved members misalign index-based splices and can crash positioning |
| Export Markdown / JSON | ✅ rich format (Env line, per-member text+Where, hints) | ⚠️ | Valid but lossier: Rect as raw JSON blob, group members listed as bare selectors |
| localStorage + legacy migration | ✅ | ✅ | Luna additionally drops corrupt rows instead of crashing — good |
| FAB only when origin has annotations | ✅ | ✅ | Luna hides it while panel is open too |
| Esc layering pick→popover→panel | ✅ | ✅ | |
| SPA route-change draft protection | ✅ | ✅ | |
| Public API | ✅ | ✅ | Same five methods |

## Where Luna's design is genuinely better

1. **One closed shadow root** for all chrome is simpler than the original's many open roots, and `closed` gives stronger isolation from page scripts.
2. **`CSS.escape()` everywhere** — the original hand-builds attribute selectors and just accepts failures on values containing quotes; Luna's selectors are robust to weird values by construction.
3. **`data-testid` as a high-signal selector attribute** — smart for a developer-feedback tool; the original only surfaces testids in the a11y block.
4. **Defensive storage load** — corrupt rows are filtered out rather than taking the whole annotation list down.

## Where the original earns its size (Luna's gaps and bugs)

1. **Keyboard isolation while typing** — Luna never stops event propagation from its textareas, so on hotkey-heavy pages (Gmail, Notion, editors) every letter typed into a comment can trigger page shortcuts. The original explicitly guards this.
2. **Clipboard fallback** — Luna calls `navigator.clipboard` and toasts "Copied" unconditionally; on non-secure pages or when the API rejects, the copy silently fails while claiming success. The original has an `execCommand` fallback and honest toasts.
3. **Click-through chrome** — the original toggles all tool chrome to `pointer-events:none` during chords/pick modes so it can never swallow a click meant for the page. Luna mostly gets there by deleting chrome in pick mode, but with a popover open, chord-clicks landing on the popover are simply eaten.
4. **Missing-member handling** — reopening a saved group whose elements changed can crash Luna's build (`place()` on an undefined element) and its remove/promote buttons splice two arrays of different lengths.
5. **Scroll-following popover** — the original re-projects the popover against its target every frame. Luna's code actually does have this rAF loop… contradicting its own DESIGN.md, which claims it deliberately doesn't. (The doc undersells the code.)
6. **Dead code** — an HTML-escape helper (`esc`) and `state.down` are defined and never used; symptoms of the compressed style.
7. **Maintainability** — 93 lines of semicolon-packed one-liners are impressive but hostile to change; the original reads like documentation. For a hobbyist maintaining this, the original's style matters more than the line count.

## Bottom line

As a **design exercise**, Luna's rebuild proves the brief was clear enough to reconstruct the app's shape independently — architecture, state model, and export design all landed in recognizable form, with four ideas worth stealing (single closed shadow root, `CSS.escape`, testid-as-selector-signal, tolerant storage load). As a **replacement**, it isn't: the Svelte mapping doesn't match real Svelte, typing comments is unsafe on hotkey-driven apps, and saved-group editing can crash. The original's bulk is the difference between "works on my test page" and "works on any page."
