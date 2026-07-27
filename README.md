# Rapid Feedback v5

Userscript for annotating web pages. Hold `Alt+⌘` (Mac) or `Alt+Ctrl` (Windows/Linux) and click any element to annotate it. Exports as compact Markdown or JSON.

## v5 highlights

- **Selector overhaul** — utility-class filtering (Tailwind etc.), high-signal attributes (id, aria-label, name, href), dynamic depth
- **Chord-hold target preview** — pulsing border outline shows what you're about to click
- **Element zoom** — ▲/▼ buttons on the popover to walk parent/child elements
- **Grouping** — hold chord, click multiple elements, release → merged popover for group feedback
- **Relocation** — "Pick destination" button to annotate where an element should move to
- **Tabbed popover** — Comment tab open by default, Styles behind one click; 2-column grid layout for style controls
- **Auto-reposition** — popover moves below → above → right → left to avoid covering its target
- **Shadow DOM isolation** — FAB, panel, popover, and toast rendered in shadow roots; immune to host page CSS
- **Export clarity** — element text first, comment follows, `Tweak:` block for style changes, compact inline refs for groups/relocation

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
Group: a.first-link, a.second-link

Tweak:
  padding: 12px;
  font-size: 14px;
```

## Install

Install from [rapid-feedback.user.js](https://gist.githubusercontent.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96/raw/rapid-feedback.user.js) into Tampermonkey.
