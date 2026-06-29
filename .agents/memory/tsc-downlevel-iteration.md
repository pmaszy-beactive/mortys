---
name: tsc downlevel iteration
description: New TS in this repo can't for..of over Set/Map directly — tsc errors TS2802.
---

# tsc downlevel iteration (TS2802)

Iterating a `Set` / `Map` (or their `.entries()`/`.values()`) directly with
`for (const x of set)` fails `tsc --noEmit` with TS2802 ("can only be iterated
through when using the '--downlevelIteration' flag or with a '--target' of
'es2015' or higher").

**Why:** the repo's tsconfig does not enable `downlevelIteration` and the
effective target trips this check for Set/Map iteration (array `for..of` is
fine). `tsx` runs the code fine at runtime, so this only shows up in `tsc`.

**How to apply:** when writing new server TS, wrap Set/Map iteration in
`Array.from(...)` — e.g. `for (const id of Array.from(mySet))`,
`for (const [k, v] of Array.from(myMap.entries()))`. Don't touch tsconfig.
