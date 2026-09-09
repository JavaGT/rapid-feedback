> Status 2026-09-10: the compared build `deepseek-redesign/` was deleted as a delivered experiment in 86ce2e2 (#6, #10) — paths below are historical.

# Comparison: DeepSeek Flash's Independent Rebuild — vs. the Original and Luna's

Same exercise as Luna: DeepSeek v4 Flash got only `.scratch/app-brief.md` (never saw the original, the tests, or `luna-redesign/`). It delivered `deepseek-redesign/rapid-feedback.user.js` (2,330 lines) plus a 147-line DESIGN.md.

**Testing note:** beyond `node --check`, I ran its build in headless Chrome against `test/page.html` with real chord gestures and inspected the failure paths in code. Findings below are verified behavior, not just reading.

## Verdict up front

DeepSeek Flash produced the **most complete and best-documented** rebuild of the three — nearly the original's size, every module from the brief present, honest deviations, and two genuinely novel ideas. But it shipped **two fatal wiring bugs**: the core annotation gesture can never fire for a real human, and the panel breaks permanently after first use. It is the inverse of Luna: breadth without integration. The parts are good; the machine doesn't run.

## At a glance

| | Original | Luna | DeepSeek |
| --- | --- | --- | --- |
| Size | 2,104 lines | 93 lines | 2,330 lines |
| Design doc | README + changelog | 35 lines | 147 lines, the best of the three |
| Core gesture works? | ✅ | ✅ | ❌ never resolves (bug A) |
| Panel works? | ✅ | ✅ | ❌ self-destructs (bug B) |
| Svelte mapping correct? | ✅ | ❌ wrong field | ✅ reads `.loc` |
| Selector attr escaping | ✅ (as of v5.10) | ✅ CSS.escape | ✅ quotes only |

## Bug A (fatal): the chord gesture can never resolve

`chordUp()` decrements its `chordsHeld` counter only when `chordMatches(e)` is true **on that exact keyup event**. But releasing either modifier key of a two-key chord means that key's own keyup no longer has both modifiers held — so the counter never reaches zero and `endGrab()` never runs. Verified empirically: real Puppeteer press/click/release sequences produce zero annotations; only a synthetic keyup carrying an impossible "both keys released simultaneously" state got past it.

Worse than "nothing happens": after the first chord press, `grabbing` stays true forever, so **every subsequent page click is swallowed**, piled into the selection accumulator, and marked with green overlay boxes. On a hostile page this is runaway interference — precisely what the brief forbids.

The original solved this with a `chordWasActive` latch ("was the chord ever held during this gesture") rather than "is it still fully held on this event" — a lesson written into its own evolution.

## Bug B (fatal): the panel destroys itself

In the Panel module:

```js
function open() {
  ensure();
  open = true;   // ← overwrites the function named `open`; there is no boolean variable
  render();
}
function toggle() {
  if (open) close(); else open();   // second call: open() is now `false` → TypeError
}
```

`open = true` shadows the function declaration itself. First `toggle()` "closes" (clobbering `open` to `false`), and every later toggle throws `open is not a function`. Verified: `window.__SCOPE_FEEDBACK_API__.openPanel()` throws; the panel is unreachable via FAB, double-tap, or API. This is a classic `var`-era shadowing mistake — `let open = false` state separate from the method would have prevented it.

## What genuinely works, and works well

- **Selector generator** — builds the full chain, then tries increasing tail lengths until unique, with a `:nth-of-type` fallback. Escapes quotes in attribute values, filters utility/hash/Svelte classes, and adds two ideas nobody else had:
  - `isMeaningfulId`: rejects machine-generated-looking ids (`/^[a-z0-9]{8,}$/i`) so `#f3a1b2c4` never becomes the selector anchor
  - `data-cy` / `data-test` alongside `data-testid` as high-signal attributes
- **Svelte mapping** reads `__svelte_meta.loc` correctly — Luna's failure mode, avoided.
- **Structure & docs** — 15 clearly separated modules, honest Deviations section (its "Cut restores tweaks" choice matches the original's actual behavior), sensible schema with `createdAt`/`updatedAt`.
- Chrome marking, rAF-coalesced hover, overlay piercing, SPA draft protection, Esc priority stack: all present and structurally sound.

## Three-way convergence (the intuition signal)

All three designs independently chose: guarded IIFE · Shadow DOM chrome with `all:initial` · explicit chrome marking so tools can't annotate themselves · accumulate-clicks-then-resolve-on-release grouping · localStorage with legacy migration · the same five-method public API · history patching for SPAs · the same Esc priority order. When three independent implementations converge, that's the brief communicating well and the design being canonical — worth trusting.

Divergence is where the models' *intuitions* differ:

| Decision | Original | Luna | DeepSeek |
| --- | --- | --- | --- |
| Instinct | harden against hostile pages | compress to essentials | mirror the full inventory |
| Selector algorithm | walk up until unique | flat attribute probe first | build all, shrink tail |
| Id handling | emit `#id` always | unique-check `#id` | reject generated-looking ids |
| Failure mode | none shipped | under-features edge cases | untested lifecycles |

## Lessons for our tool

1. **Steal `isMeaningfulId`** — refusing auto-generated ids as selector anchors is a real improvement over emitting `#id` unconditionally.
2. **Steal `data-cy`/`data-test`** as additional high-signal attributes.
3. **The lifecycle bugs are the same class the original's `@note` history shows it fixing over nine versions** (stuck states, chrome swallowing clicks). Independent rebuilds re-committing them confirms those notes encode earned knowledge, not paranoia — keep regression-testing gesture release paths specifically.
