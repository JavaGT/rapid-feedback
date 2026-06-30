# Rapid Feedback

Userscript for annotating web pages. Hold `Alt+⌘` (Mac) or `Alt+Ctrl` (Windows/Linux) and click any element to annotate it. Exports as compact Markdown or JSON.

## Export format (compact)

```markdown
# Feedback — Scope
Page: /app/projects/cmq8t88nd00iy7ko5wge59amw
Env: 1440×900 · Chrome on macOS

## 1. [GENERAL] Files
This is an example of what the user is providing as feedback.

Where: div.app-shell > main.app-main > div.page > div.sections > div.link-grid > a.section-link.card[href="/app/projects/.../files"] > div.link-main
Text: "Files"
Href: /app/projects/.../files
Rect: 434×21 @ 549,391
```

Intent leads; partial ancestor chains show where in the app (Svelte scope hashes stripped). Session context appears once at the top.

## Install

Install from [rapid-feedback.user.js](https://gist.githubusercontent.com/JavaGT/6ca097d0ded9b16e69549e0648a50f96/raw/rapid-feedback.user.js) into Tampermonkey.
