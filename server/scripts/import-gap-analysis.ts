/**
 * import-gap-analysis.ts (CLI)
 *
 * Read-only gap-analysis report over the legacy scrape files the importer
 * consumes. It NEVER writes to the database and NEVER mutates the import files.
 *
 * Usage:
 *   tsx server/scripts/import-gap-analysis.ts            # uses IMPORT_DATA_DIR / default
 *   IMPORT_DATA_DIR=./import-seed tsx server/scripts/import-gap-analysis.ts
 *   tsx server/scripts/import-gap-analysis.ts --dir ./import-seed
 *   tsx server/scripts/import-gap-analysis.ts --out custom.json --samples 20
 *
 * Prints a readable per-dimension summary to the console and writes the full
 * structured result to `<dataDir>/_gap_analysis.json` (overridable via --out).
 */

import * as fs from "fs";
import * as path from "path";
import { analyzeImportGaps } from "../services/import-gap-analysis";
import { getImportDataDir } from "../services/json-importer";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const dataDir = arg("dir") || getImportDataDir();
  const sampleLimit = arg("samples") ? parseInt(arg("samples")!, 10) : 10;
  const outPath = arg("out") || path.join(dataDir, "_gap_analysis.json");

  if (!fs.existsSync(dataDir)) {
    console.error(`Data dir does not exist: ${dataDir}`);
    console.error(`Set IMPORT_DATA_DIR or pass --dir <path>.`);
    process.exit(1);
  }

  console.log(`Import gap analysis (read-only)`);
  console.log(`Data dir: ${dataDir}`);
  console.log(`Scanning files…\n`);

  const result = await analyzeImportGaps({
    dataDir,
    sampleLimit,
    onProgress: (p, t) => process.stdout.write(`\r  scanned ${p}/${t}…   `),
  });
  process.stdout.write("\r" + " ".repeat(40) + "\r");

  // ---- Dimension 1 ----
  console.log("=".repeat(72));
  console.log("1. PAGE-TYPE COVERAGE");
  console.log("=".repeat(72));
  console.log(`Total files: ${result.totalFiles} (source: ${result.source})`);
  console.log(
    `Recognized (has a parser): ${result.pageTypeCoverage.recognizedTotal} ` +
      `(${pct(result.pageTypeCoverage.recognizedTotal, result.totalFiles)})`,
  );
  console.log(
    `Unrecognized "other" (DROPPED — no parser): ${result.pageTypeCoverage.otherTotal} ` +
      `(${pct(result.pageTypeCoverage.otherTotal, result.totalFiles)})\n`,
  );
  const sortedTypes = Object.entries(result.pageTypeCoverage.byType).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type.padEnd(22)} ${String(count).padStart(7)}`);
  }
  if (result.pageTypeCoverage.otherGroups.length) {
    console.log(`\n  "other" grouped by normalized URL path (no parser):`);
    for (const g of result.pageTypeCoverage.otherGroups) {
      console.log(`    ${String(g.fileCount).padStart(6)}  ${g.pathPattern}`);
      console.log(`            e.g. ${g.sampleUrls[0] ?? ""}`);
    }
  }

  // ---- Dimension 2 ----
  console.log("\n" + "=".repeat(72));
  console.log("2. FIELD-LEVEL COVERAGE (keys present in files but never read)");
  console.log("=".repeat(72));
  for (const [type, cov] of Object.entries(result.fieldCoverage)) {
    const groups: [string, typeof cov.label_values][] = [
      ["label_values", cov.label_values],
      ["field_data", cov.field_data],
      ["field_names", cov.field_names],
      ["table_headers/cols", cov.table_headers],
    ];
    const hasGaps = groups.some(([, g]) => g.unconsumed.length > 0);
    if (!hasGaps && cov.filesScanned > 0) {
      console.log(`\n  ${type} (${cov.filesScanned} files): no unconsumed keys`);
      continue;
    }
    console.log(`\n  ${type} (${cov.filesScanned} files):`);
    for (const [label, g] of groups) {
      if (g.unconsumed.length === 0) continue;
      const list = g.unconsumed
        .slice(0, 15)
        .map((u) => `${u.key} (${u.fileCount})`)
        .join(", ");
      console.log(`    unread ${label}: ${list}`);
    }
    for (const [label, g] of groups) {
      if (g.consumedButUnseen.length) {
        console.log(
          `    ⚠ parser reads but NEVER seen in ${label}: ${g.consumedButUnseen.join(", ")}`,
        );
      }
    }
  }

  // ---- Dimension 3 ----
  console.log("\n" + "=".repeat(72));
  console.log("3. REFERENTIAL GAPS");
  console.log("=".repeat(72));
  console.log(
    `Student file pages: ${result.referentialGaps.studentFilePages} ` +
      `(${result.referentialGaps.distinctStudentFileIds} distinct studentUserIds)\n`,
  );
  console.log(`  Child pages whose studentUserId has NO studentfile page:`);
  for (const o of result.referentialGaps.orphansByType) {
    console.log(
      `    ${o.pageType.padEnd(20)} ${String(o.orphanStudentIds).padStart(5)} orphan / ` +
        `${o.totalWithStudentId} distinct ids` +
        (o.sampleOrphanIds.length ? `  e.g. ${o.sampleOrphanIds.slice(0, 5).join(", ")}` : ""),
    );
  }
  console.log(
    `\n  Student files with NO contract source (no printcontracts & no money table): ` +
      `${result.referentialGaps.studentsWithoutContractSource.total}` +
      (result.referentialGaps.studentsWithoutContractSource.sampleIds.length
        ? `  e.g. ${result.referentialGaps.studentsWithoutContractSource.sampleIds.slice(0, 5).join(", ")}`
        : ""),
  );

  // ---- Dimension 4 ----
  console.log("\n" + "=".repeat(72));
  console.log("4. PARSE-SUCCESS / EMPTY EXTRACTION");
  console.log("=".repeat(72));
  for (const e of result.emptyExtraction) {
    if (e.filesScanned === 0) continue;
    const flag = e.emptyFiles > 0 ? " ⚠" : "";
    console.log(
      `  ${e.pageType.padEnd(20)} ${String(e.emptyFiles).padStart(6)}/${e.filesScanned} empty ` +
        `(${pct(e.emptyFiles, e.filesScanned)})${flag}`,
    );
    if (e.emptyFiles > 0) {
      console.log(`        reason: ${e.reason}`);
      if (e.missingStudentId > 0) {
        console.log(`        of which missing studentUserId: ${e.missingStudentId}`);
      }
    }
  }

  // ---- Dimension 5 ----
  console.log("\n" + "=".repeat(72));
  console.log("5. VALUE / ENUM MISMATCHES (silent defaults)");
  console.log("=".repeat(72));
  for (const v of result.valueMismatches) {
    console.log(`\n  ${v.field}`);
    console.log(`    ${v.description}`);
    if (v.defaultValue) {
      console.log(`    fell to default '${v.defaultValue}': ${v.fellToDefault}`);
    }
    for (const item of v.values.slice(0, 20)) {
      const mark = item.matched ? " " : "✗";
      console.log(`      ${mark} ${String(item.count).padStart(6)}  ${item.value}`);
    }
    if (v.values.length > 20) {
      console.log(`      … ${v.values.length - 20} more`);
    }
  }

  // ---- Write JSON ----
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log("\n" + "=".repeat(72));
  console.log(`Full machine-readable report written to:\n  ${outPath}`);
  console.log("=".repeat(72));
}

main().catch((err) => {
  console.error("\nGap analysis failed:", err);
  process.exit(1);
});
