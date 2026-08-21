# Comparison: OX Alpha's Independent Rebuild — fourth data point

Same protocol: OX Alpha Free got only `.scratch/app-brief.md`. Delivered `oxalpha-redesign/` (1,537-line userscript + 114-line DESIGN.md). **Verified working** in headless Chrome: group gesture → numbered markers → popover → submit → export → panel, zero page errors.

**Process note:** the free endpoint silently dropped long-form generations (4 attempts produced nothing), so the build was driven through one session in five small passes (design doc → core → chrome → panel → wiring). Two consequences for fairness: (a) I seeded the chord-release *latch* in the wiring pass after DeepSeek's fatal stuck-chord bug — so its correct gesture handling is instructed, not independently invented; (b) everything else (architecture, badges, selector engine) is its own work.

## Verdict up front

The most polished of the three rebuilds: it works end-to-end, has the deepest selector hygiene of any build including ours, and independently reinvented two things we shipped in v5.10/v5.11 (closed shadow root, numbered selection badges) plus several ideas we still haven't got. Its DESIGN.md is precise enough to be a spec.

## At a glance

| | Original | Luna | DeepSeek | OX Alpha |
| --- | --- | --- | --- | --- |
| Size | 2,104+ | 93 | 2,330 | 1,537 |
| Core flows work? | ✅ | ✅ | ❌ fatal bugs | ✅ verified |
| Shadow roots | many → closed (v5.10) | 1 closed | many open | **1 closed**, host on `documentElement` |
| Numbered selection badges | ✅ (v5.11, from DeepSeek) | ❌ | ✅ circles | ✅ independently |
| Chord release latch | ✅ | ⚠️ implicit | ❌ stuck | ✅ (seeded by me) |

## Ideas worth stealing (that we still don't have)

1. **Tailwind-variant-aware class filter.** Ours matches value-pattern utilities (`p-4`); OX Alpha additionally discards variant-prefixed classes (`hover:*`, `md:*`, `dark:*`), arbitrary values (`w-[37px]`), fractions (`w-1/2`), negative utilities (`-mt-2`), and treats camelCase/PascalCase classes as semantic signals. On a modern Tailwind codebase our selectors will carry junk classes theirs won't.
2. **Generic pick-mode driver.** One `picker` module powers both "+ Add element" and "Pick destination"; ours implements them as two paths.
3. **Pub-sub store + re-render-from-state.** Central mutable store with `emit()`; UI subtrees re-render from state on change. Cleaner than our imperative DOM updates scattered through popover code.
4. **Debounced persistence** — ours writes localStorage synchronously on every mutation.
5. **Host on `documentElement`, not `body`.** Immune to pages that wipe or reparent `body` children late in load. (Their DESIGN.md says `body`; the code says `documentElement` — trust the code, we verified.)

## Convergence scorecard (four builds)

Unanimous across all four: guarded IIFE · Shadow-DOM-isolated chrome with `all:initial` · explicit chrome marking · rAF-coalesced hover hit-testing · accumulate-clicks-resolve-on-release grouping · localStorage + legacy migration · identical public API · SPA history patching · Esc priority stack · shortest-unique selectors with utility filtering · Svelte `.loc` mapping (3 of 3 that attempted it correctly — Luna's miss looks like an outlier, not a trap).

Independent reinventions of our recent versions: closed root (Luna, OX Alpha), attribute-value escaping (all), testid-family attributes (DeepSeek, OX Alpha), numbered badges (DeepSeek, OX Alpha). Every v5.10/v5.11 improvement except the generated-id rejection was independently rediscovered at least once — strong evidence those changes are canonical, not taste.

## Weak spots found

- No Puppeteer-era testing culture: like the others, nothing verifies gesture lifecycles; only luck (and my seeded latch) avoids DeepSeek's fate.
- `documentElement` attachment is undocumented (doc says `body`) — small doc/code drift, the exact failure mode of DeepSeek's bigger one.
- Markdown header format diverges from ours (bullet meta lines vs. our compact `Page:/Env:` lines) — cosmetic.

## Bottom line

Three independent rebuilds, three distinct failure/completion profiles: Luna (minimal, works), DeepSeek (maximal, broken wiring), OX Alpha (structured, works, best-informed by modern CSS-framework reality). The original remains the most battle-hardened, but OX Alpha's class filter and picker unification are concrete upgrades worth a v5.12.
