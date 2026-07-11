# Stage 1 — Design system & signature UI

Part of the [build plan](../build-plan.md) · Context to load: [overview](../architecture/overview.md) *(Tailwind 4, React, renderer structure)*

Goal: a small, low-churn design layer every later stage composes — so features ship polished, not restyled twice.

- [x] 1.1 `@theme` design tokens in Tailwind 4: color scales (neutral + one brand accent + four STAR-beat accents S/T/A/R), spacing, radius, type scale, elevation, and a semantic layer (surface/text/border/focus, light + dark) — all consumed only via tokens, never raw values.
- [x] 1.2 ~10 reusable primitives (typed, forwarded refs, controlled): Button, IconButton, Input, Textarea, Select, Checkbox/Toggle, Badge/Tag, Card, Dialog/Sheet, Toast — each with hover/focus/active/disabled and dark-mode states.
- [x] 1.3 State primitives every feature reuses: EmptyState, Skeleton/loading, ErrorState, and an inline-spinner — so downstream stages compose these instead of hand-rolling.
- [x] 1.4 Signature motif — the **STAR 4-beat rail**: a `StarRail` component rendering four capsule segments (S/T/A/R) that fill with each beat's accent as content lands, empty beats as faint outlines; vertical (card gutter), horizontal (headers), and an abstracted 4-capsule app mark/favicon.
- [x] 1.5 Motion + a11y floor: a small tokenized transition set (duration/easing), a `prefers-reduced-motion` kill switch that all motifs and primitives honor, visible focus rings, AA contrast, full keyboard operability, and correct ARIA/roles on Dialog/Toast/Select.
- [x] 1.6 One tasteful cadence nudge primitive (a streak/"logged this week" indicator built on the tokens) — quiet, on-concept, no XP/leaderboard/mascot/confetti.
- [x] 1.7 Dev-only `/preview` route (renderer, dev-build only): renders every primitive, every state (empty/loading/error/disabled), light+dark, and the StarRail variants — the visual test surface and living reference.
- [x] 1.8 Retrofit Stage 0's throwaway spike screens (settings, LLM stream, voice, embedding demos) onto the tokens + primitives so the shell reads as one designed app before feature work begins.

**Checkpoint 1**: `/preview` shows every primitive and state in light and dark with reduced-motion honored; the Stage 0 spike screens are fully re-skinned onto tokens + primitives with zero raw color/spacing values and full keyboard focus; the STAR 4-beat rail renders in card, header, and app-mark form. From here, **every feature stage composes this library and meets the empty/loading/error/keyboard bar — hand-rolling a primitive or skipping a state fails review.**

## Direction (chosen — "Bright & encouraging")

The most Duolingo-like of the offered directions (owner pick): warm, bright, habit-forming, minus the arcade.

- **Palette:** base near-white `#FBFBFE` (light) / soft dark `#191A2E` (violet-tinted, not black). Brand violet `#7C5CFC`; lime pop `#A3E635` reserved for positive/"win" moments. STAR-beat hues (encouraging cool→success arc): S `#38BDF8` sky · T `#A78BFA` violet · A `#FBBF24` amber · R `#34D399` emerald (result = "you did it"). Semantic: success emerald/lime, warning amber, danger `#FB7185`, info sky.
- **Type:** rounded-geometric display + clean body via self-hosted **Nunito** (`@fontsource-variable/nunito`, offline-safe); **JetBrains Mono** for metrics/keyboard hints. No CDN (packaged app is offline).
- **Signature:** the STAR 4-beat rail as **four rounded pills** that spring-fill when a beat gains content (reduced-motion → instant, no transform). Variants: inline (header), gutter (card left edge), app-mark.
- **Feel:** friendly, optimistic, encouraging copy (active voice, sentence case); delight lives in the pill fill + a quiet cadence nudge ("logged N this week", lime) — no XP/leaderboard/mascot/confetti.
