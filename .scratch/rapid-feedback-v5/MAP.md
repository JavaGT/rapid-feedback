# Rapid Feedback v5 — design exploration & prioritised backlog

## Destination

A prioritised backlog of features and UI improvements for Rapid Feedback (Tampermonkey userscript), shaped by design exploration. Audience: designers, PMs, and QA annotating any web page. Ship as a userscript — no browser extension.

## Notes

- **Domain:** single-file Tampermonkey userscript (`rapid-feedback.user.js`), currently v4.8
- **Skills:** grilling, prototype, domain-modeling, make-interfaces-feel-better
- **Prefs:** subtract before adding; keep the single-file constraint unless there's a compelling reason to break it
- **Standing decision:** stays a userscript (no extension build pipeline)

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [01 — Selector reliability & scroll position](issues/01-selector-reliability.md) — dynamic depth, ID/aria-label/name/href priority, strip utility classes + cap at 3, drop XY from model
- [02 — Target preview & element zoom](issues/02-target-preview-zoom.md) — pulsing border outline on chord-hold, ▲/▼ parent/child buttons in popover
- [03 — Grouping & relocation annotations](issues/03-grouping-relocation.md) — Pick destination button + multi-click grouping with merged popover, compact export for group members
- [04 — Live-styles UX redesign](issues/04-live-styles-ux.md) — auto-reposition below→above→right→left, tabbed comment-first popover with collapsible 2-col style grid
- [05 — Visual CSS resilience](issues/05-css-resilience.md) — Shadow DOM isolation for FAB/panel/popover/toast, overlay stays light DOM
- [06 — Export format & comment clarity](issues/06-export-format-clarity.md) — text-first-then-comment, Tweak: block for styles, compact inline refs for grouped/relocated elements

## Not yet specified

- Whether grouping implies a session-naming model (low priority — only matters if groups need to persist across page reloads)

## Out of scope

- Browser extension packaging (decided: userscript only)
- Collaboration / multi-user annotations
- Backend persistence / cloud sync
- Screenshot capture
