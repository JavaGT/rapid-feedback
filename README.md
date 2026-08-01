# Rapid Feedback v5

Userscript for annotating web pages. Hold `Alt+⌘` (Mac) or `Alt+Ctrl` (Windows/Linux) and click any element to annotate it. Exports as compact Markdown or JSON.

## v5 highlights

- **Selector overhaul** — utility-class filtering (Tailwind etc.), high-signal attributes (aria-label, name, href), shortened to the smallest chain that still resolves uniquely
- **Chord-hold target preview** — pulsing border outline shows what you're about to click
- **Element zoom** — ▲/▼ for parent/child and ◀/▶ for siblings; the popover header re-renders so you always see what you're about to capture
- **Multi-select** — hold chord, click multiple elements (each marked green), release → one popover for the whole set. The selection is an editable list: drop a member, promote one to primary, or `+ Add element` to pick another without starting over. Markers stay on the page the whole time, and a style tweak previews across every selected element
- **Relocation** — "Pick destination" closes the popover and enters a click-to-select mode; your draft is preserved either way
- **Tabbed popover** — Comment tab open by default, Styles behind one click; 2-column grid layout for style controls
- **Live style preview** — edits apply to the page as you type and revert on Cancel/Escape, or stay put when you submit
- **Anchored positioning** — popover moves below → above → right → left to avoid covering its target, and follows it through scrolling and layout shifts
- **Shadow DOM isolation** — FAB, panel, popover, and toast rendered in shadow roots; immune to host page CSS
- **Export clarity** — element text first, comment follows, `Tweak:` block for style changes, and every selected element listed with its own resolvable selector

## Interactions

| Gesture | Result |
| --- | --- |
| Chord + click | Annotate that element |
| Chord + several clicks, then release | One annotation over all of them |
| `+ Add element`, then click | Add another element to the current selection |
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

Install from [rapid-feedback.user.js](https://gist.githubusercontent.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96/raw/rapid-feedback.user.js) into Tampermonkey.
