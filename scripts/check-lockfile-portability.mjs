import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmMetadataNames = new Set([
  ".npmrc",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
]);
const ignoredDirectories = new Set([".cache", ".git", "node_modules"]);
const replitPackageUrl =
  /https?:\/\/[^/"\s]*package-firewall\.replit\.[^/"\s]+/gi;
const failures = [];

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await checkDirectory(path.join(directory, entry.name));
      }
      continue;
    }

    if (!npmMetadataNames.has(entry.name)) continue;

    const filePath = path.join(directory, entry.name);
    const contents = await readFile(filePath, "utf8");
    const matches = [...new Set(contents.match(replitPackageUrl) ?? [])];
    if (matches.length > 0) {
      failures.push({
        file: path.relative(projectRoot, filePath),
        matches,
      });
    }
  }
}

await checkDirectory(projectRoot);

if (failures.length > 0) {
  console.error(
    "Portable npm metadata check failed: Replit-only package URLs were found:",
  );
  for (const failure of failures) {
    for (const match of failure.matches) {
      console.error(`  - ${failure.file}: ${match}`);
    }
  }
  console.error(
    "Regenerate the lockfile with registry-specific resolved URLs omitted.",
  );
  process.exit(1);
}

console.log("Portable npm metadata check passed.");