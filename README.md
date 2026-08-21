# Rapid Feedback v5

Userscript for annotating web pages. Hold `Alt+⌘` (Mac) or `Alt+Ctrl` (Windows/Linux) and click any element to annotate it. Exports as compact Markdown or JSON.

## v5 highlights

- **Selector overhaul** — utility-class filtering (Tailwind etc.), high-signal attributes (aria-label, name, href), shortened to the smallest chain that still resolves uniquely
- **Chord-hold target preview** — pulsing blue glow outline shows what you're about to click
- **Element zoom** — ▲/▼ for parent/child and ◀/▶ for siblings; the popover header re-renders so you always see what you're about to capture
- **Multi-select** — hold chord, click multiple elements (each marked with a numbered green badge showing its order), release → one popover for the whole set. The selection is an editable list: drop a member, promote one to primary, `⧉ Select similar` to grab the repeated siblings, or `+ Add element` to pick another. Chord-clicking again with the popover open grows the selection rather than starting over, so the draft survives. Markers stay on the page throughout, and a style tweak previews across every selected element
- **Chrome that gets out of the way** — while the chord is held or a pick mode is running, everything the tool renders becomes click-through, so the FAB, panel or popover can never swallow a click meant for the element beneath. Nothing the tool renders can itself be annotated
- **Relocation** — "Pick destination" closes the popover and enters a click-to-select mode; your draft is preserved either way
- **Tabbed popover** — Comment tab open by default, Styles behind one click; 2-column grid layout for style controls
- **Live style preview** — edits apply to the page as you type and revert on Cancel/Escape, or stay put when you submit
- **Anchored positioning** — popover moves below → above → right → left to avoid covering its target, and follows it through scrolling and layout shifts
- **Shadow DOM isolation** — FAB, panel, popover, and toast rendered in shadow roots; immune to host page CSS
- **Export clarity** — element text first, comment follows, `Tweak:` block for style changes, and every selected element listed with its own resolvable selector
- **Hardened selectors** — attribute values are escaped so quotes/backslashes can't break them; the `data-testid` / `data-test` / `data-cy` family outranks generic attributes; machine-generated ids (hashes, React uids) are skipped; and Tailwind noise (variant prefixes, arbitrary values, fractions, negatives, Svelte hashes) never reaches a selector
- **Closed shadow roots** — host-page scripts can't reach into the feedback UI, and chrome lives on `<html>` so hydration wipes can't remove it; a corrupt saved row is skipped instead of wiping the session
- **Refreshed theme** — green accent, rounded cards, pill category chips, softer shadows
- **Svelte-aware feedback** — component name in the popover header, route-disambiguated refs (`projects/+page.svelte:15`), per-member Source lines in group exports, `setProjectRoot()` for clickable `vscode://file/…:line:col` links, "Select similar" grouped by component file, and an explicit note when a production build hides source mapping

## Interactions

| Gesture | Result |
| --- | --- |
| Chord + click | Annotate that element |
| Chord + several clicks, then release | One annotation over all of them |
| Chord + click, popover already open | Add that element to the current selection |
| `⧉ Select similar` | Add the primary's repeated siblings (capped at 50, one-click undo) |
| `+ Add element`, then click | Add another element to the current selection |
| ✎ in the panel | Reopen the selection on the page it came from; edit the comment in place anywhere else |
| Chord, double-tap | Open/close the panel |
| `Pick destination`, then click | Record where the element should move to |
| `Esc` | Cancel destination mode, then close the popover, then close the panel |
| `⌘/Ctrl + Enter` | Submit from the comment box |

## Export format

```markdown
# Feedback — Scope
Page: /app/projects/example
Env: 1440×900 · Chrome on macOS

## 1. [GENERAL] Files
> This is the displayed text on the element
The user's comment goes here — clearly distinguished from the element text above.

A11y: role=link name="Files"
Where: div.sections > a.section-link[href="/app/projects/.../files"] > div.link-main
Rect: 434×21

→ Destination: div.other-section > a.other-link
  Text: “Grades”
Group: 3 elements (this + 2)
  • a#first-link "First"
    Where: div.sections > a#first-link
  • a#second-link "Second"
    Where: div.sections > a#second-link

Tweak (all 3 elements):
  padding: 12px;
  font-size: 14px;
```

## Install

Install from [rapid-feedback.user.js](https://raw.githubusercontent.com/JavaGT/rapid-feedback/main/rapid-feedback.user.js) into Tampermonkey. Tampermonkey tracks that URL for updates.

This repository is the single source of truth. The script was previously distributed from [a gist](https://gist.github.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96), which is frozen at the v5.7 cutover build and only exists so installs predating the move can still find their way here.

## Tests

The dev-only Puppeteer harness runs the userscript against `test/page.html` in headless Chrome:

```sh
cd test
npm install
npm test
```

It defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Set `RAPID_FEEDBACK_CHROME` to use another Chrome-compatible executable.
