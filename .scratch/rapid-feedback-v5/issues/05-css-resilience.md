# 05 — Visual CSS resilience

**What to build:** (Decision ticket — task.) Rapid Feedback's UI breaks visually on some websites because its injected CSS conflicts with the host page's styles. Investigate the root causes and decide an approach:

- Audit: which sites break and why? (CSS specificity clashes, inherited properties, font-family bleed, colour contrast against page backgrounds)
- Options: CSS namespace prefix (`.rf-` is already used but may not be enough), Shadow DOM encapsulation, iframe isolation, CSS `all: initial` reset on the root element
- Decision: pick the approach that works across the broadest set of sites without breaking the userscript's ability to interact with the page DOM

**Blocked by:** None — can start immediately.

**Status:** closed

- [x] Audit sites where Rapid Feedback UI breaks visually
- [x] Evaluate CSS isolation approaches (namespace, Shadow DOM, iframe, reset)
- [x] Decide the approach and document the trade-off

## Resolution

**Shadow DOM for all isolation-critical elements.** Each UI surface (FAB, panel, popover, toast) renders inside its own open shadow root, providing complete CSS isolation from host page styles. The `.rf-overlay` stays in light DOM (it must overlay the page). Event handling is already compatible — the userscript uses `composedPath()` for target resolution.

Vulnerabilities addressed: font inheritance, box-model bleed, color-scheme override, background-visibility clashes. Trade-off: moderate one-time refactor cost for permanent isolation — eliminates the per-site bug chase class.
