---
name: Tailwind theme colors alpha support
description: Theme colors now support /N opacity variants; keep raw HSL channel format when adding new theme vars.
---
Theme colors in `tailwind.config.ts` are defined as `hsl(var(--x) / <alpha-value>)`, with the CSS vars in `client/src/index.css` stored as raw space-separated HSL channels (e.g. `--primary: 43 77% 65%;`). Opacity variants like `bg-primary/5`, `from-primary/10`, `border-primary/20` now compile correctly.

**Why:** Tailwind needs `<alpha-value>`-style color definitions (raw channel values) to build `/N` opacity classes; previously vars held full `hsl(...)` strings and these classes silently did nothing.

**How to apply:**
- When adding a NEW theme color var, store raw channels (`H S% L%`) and register it in tailwind config with `hsl(var(--x) / <alpha-value>)` — a full `hsl(...)` value would break the pattern.
- Non-Tailwind vars (`--success`, `--warning`, `--error`, `--brand-*`) remain full `hsl(...)` values — don't reference them via Tailwind color utilities.
- Danger (still true for non-compiling classes): an element with `bg-gradient-*` whose `from-*` class doesn't compile inherits `--tw-gradient-from/stops` from ancestors — near-invisible text bugs.
- Also note `text-secondary` is near-black in light mode but dark gray in dark mode — prefer `text-foreground` / `text-primary-foreground` for readable text.
