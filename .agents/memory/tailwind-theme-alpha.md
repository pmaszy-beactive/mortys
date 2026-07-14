---
name: Tailwind theme colors lack alpha support
description: Opacity variants of theme colors don't compile; missing gradient from-* stops inherit dark gradient vars from ancestors.
---
Theme colors in `tailwind.config.ts` are plain `var(--x)` (full `hsl(...)` strings in index.css), so opacity variants like `bg-primary/5` or `from-primary/10` are NOT generated — they silently do nothing.

**Why:** Tailwind needs `<alpha-value>`-style color definitions (raw channel values) to build `/N` opacity classes.

**How to apply:**
- Don't use `/N` opacity modifiers with theme colors (primary, secondary, card, etc.) unless the config is migrated to `hsl(var(--x) / <alpha-value>)`.
- Danger: an element with `bg-gradient-*` whose `from-*` class doesn't compile inherits `--tw-gradient-from/stops` CSS variables from ancestors — e.g. a card header rendered with the page's dark background gradient, making near-black text invisible (the invite-page welcome heading bug).
- Also note `text-secondary` is near-black in light mode but dark gray in dark mode — prefer `text-foreground` / `text-primary-foreground` for readable text.
