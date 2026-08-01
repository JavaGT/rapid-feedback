# 06 — Export format & comment clarity

**What to build:** (Decision ticket — grilling.) The current markdown/JSON export mixes concerns: the displayed element text, the user's comment, and CSS tweaks all blend together. Decide a clearer output format:

- How should the element's visible text be distinguished from the user's annotation comment?
- How should style tweaks be presented alongside prose feedback?
- If grouping/relocation (ticket 03) happens, how does it change the export structure?
- Should the JSON export follow a different structure from markdown, or mirror it?

**Blocked by:** None — can start immediately (but ticket 03's outcome may feed into this one).

**Status:** closed

- [x] Decide how comment vs element-text is distinguished in markdown export
- [x] Decide how style tweaks are presented in exports
- [x] Design the export structure to accommodate grouping/relocation (provisional, pending 03)

## Resolution

1. **Comment vs text:** Element text first (sets context), user comment follows as the body of the annotation. Distinct visual separation: the element's displayed text appears as a quoted/context line, the comment as a regular paragraph beneath it.

2. **Style tweaks:** Dedicated `Tweak:` block after the comment. If the comment is empty, tweaks appear as a compact CSS block. If both exist, tweaks are under the `Tweak:` header. Consistency: always use the `Tweak:` block — never embed CSS in the comment field.

3. **Grouping/relocation:** One `##` heading per annotation. Primary element gets full detail. Destination appears as `→ Destination: compact-selector` inline under the primary. Group members as `Group: a, b, c` with compact references (selector + a11y only, no rect/styles).
