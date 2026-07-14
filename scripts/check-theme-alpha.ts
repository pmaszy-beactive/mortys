/**
 * Guards against invisible brand-tint styling.
 *
 * Theme colors only support opacity variants (e.g. `bg-primary/10`) when:
 *   1. tailwind.config.ts defines them as `hsl(var(--x) / <alpha-value>)`, and
 *   2. the CSS variable in client/src/index.css stores raw HSL channels
 *      (`43 77% 65%`), NOT a full `hsl(...)` string.
 *
 * If either rule is broken, Tailwind silently emits no CSS for `/N` variants
 * and the element renders invisible (the exact bug that hid the invite-page
 * welcome heading).
 *
 * This script:
 *   A. Statically validates every theme color in tailwind.config.ts against
 *      the CSS variables in index.css.
 *   B. Greps the client source for theme-color opacity classes actually used,
 *      compiles the real Tailwind CSS, and asserts each class appears in the
 *      compiled output.
 *
 * Run with: npx tsx scripts/check-theme-alpha.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
// tailwind.config.ts uses CommonJS require() for plugins, so load it the same
// way Tailwind itself does (via jiti) instead of an ESM import.
const jiti = require("jiti")(__filename, { interopDefault: true });
const loadedConfig = jiti("../tailwind.config.ts");
const tailwindConfig = loadedConfig.default ?? loadedConfig;

const ROOT = resolve(dirname(__filename), "..");
const INDEX_CSS = join(ROOT, "client", "src", "index.css");
const CLIENT_DIR = join(ROOT, "client");

// ---------- Flatten theme colors to class tokens ----------
type ColorValue = string | { [key: string]: ColorValue };

function flattenColors(
  obj: { [key: string]: ColorValue },
  prefix = "",
): Array<{ token: string; value: string }> {
  const out: Array<{ token: string; value: string }> = [];
  for (const [key, value] of Object.entries(obj)) {
    const token =
      key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    if (typeof value === "string") {
      out.push({ token, value });
    } else {
      out.push(...flattenColors(value, token));
    }
  }
  return out;
}

const themeColors = flattenColors(
  ((tailwindConfig as any).theme?.extend?.colors ?? {}) as {
    [key: string]: ColorValue;
  },
);

const errors: string[] = [];

// ---------- A. Static validation of config values + CSS vars ----------
const cssText = readFileSync(INDEX_CSS, "utf8");

function cssVarValue(name: string): string | undefined {
  // first (root) declaration wins for this check
  const m = cssText.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m?.[1].trim();
}

for (const { token, value } of themeColors) {
  const varMatch = value.match(/var\(--([a-zA-Z0-9-]+)\)/);
  if (!varMatch) continue; // static color, nothing to check

  if (!/<alpha-value>/.test(value)) {
    errors.push(
      `tailwind.config.ts color "${token}" (${value}) does not use "<alpha-value>" — its /N opacity variants (e.g. bg-${token}/10) will produce no CSS.`,
    );
  }

  const varName = varMatch[1];
  const varValue = cssVarValue(varName);
  if (varValue === undefined) {
    errors.push(
      `CSS variable --${varName} (used by theme color "${token}") is not defined in client/src/index.css.`,
    );
  } else if (/hsl\s*\(/i.test(varValue)) {
    errors.push(
      `CSS variable --${varName} in client/src/index.css stores a full hsl() string ("${varValue}") but theme color "${token}" wraps it in hsl(... / <alpha-value>). Store raw HSL channels instead (e.g. "43 77% 65%"), or bg-${token}/10 will silently render invisible.`,
    );
  }
}

// ---------- B. Grep source for used opacity-variant classes ----------
function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?|html|css)$/.test(entry)) files.push(full);
  }
  return files;
}

const tokens = themeColors.map((c) => c.token);
// Longest-first so "sidebar-accent" matches before "sidebar", "accent"
tokens.sort((a, b) => b.length - a.length);
const tokenAlt = tokens
  .map((t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
  .join("|");
const utilPrefixes =
  "bg|text|border|border-[trblxy]|ring|ring-offset|outline|fill|stroke|from|via|to|divide|shadow|accent|caret|decoration|placeholder";
const classRe = new RegExp(
  `\\b(?:${utilPrefixes})-(?:${tokenAlt})/\\d+(?:\\.\\d+)?\\b`,
  "g",
);

const usedClasses = new Set<string>();
for (const file of walk(CLIENT_DIR)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(classRe)) usedClasses.add(m[0]);
}

// ---------- Compile Tailwind and verify each class emits CSS ----------
async function main() {
  if (usedClasses.size === 0) {
    console.log(
      "No theme-color opacity-variant classes found in client source.",
    );
  } else {
    const result = await postcss([tailwindcss(tailwindConfig as any)]).process(
      "@tailwind utilities;",
      { from: INDEX_CSS },
    );
    const compiled = result.css;

    for (const cls of Array.from(usedClasses).sort()) {
      // Match the escaped class anywhere in a selector so variant-prefixed
      // usages (e.g. `.hover\:bg-primary\/90:hover`) also count.
      const escaped = cls.replace(/[./]/g, (c) => `\\${c}`);
      if (!compiled.includes(escaped)) {
        errors.push(
          `Class "${cls}" is used in client source but produced NO CSS in the compiled Tailwind output — it will render invisible. Check that its theme color uses hsl(var(--x) / <alpha-value>) in tailwind.config.ts and that --x holds raw HSL channels in client/src/index.css.`,
        );
      }
    }
    console.log(
      `Checked ${usedClasses.size} theme-color opacity-variant class(es) against compiled CSS.`,
    );
  }

  if (errors.length > 0) {
    console.error("\nTheme alpha check FAILED:\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("Theme alpha check passed.");
}

main().catch((err) => {
  console.error("Theme alpha check errored:", err);
  process.exit(1);
});
