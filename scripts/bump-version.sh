#!/usr/bin/env bash
# Bump the patch version in version.ini and version.json
# Usage: bash scripts/bump-version.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_INI="$ROOT/version.ini"
VERSION_JSON="$ROOT/version.json"

current=$(grep '^version' "$VERSION_INI" | sed 's/version = //')
IFS='.' read -r major minor patch <<< "$current"
new_patch=$((patch + 1))
new_version="${major}.${minor}.${new_patch}"
now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$VERSION_INI" << EOF
[version]
version = ${new_version}
updated_at = ${now}
EOF

cat > "$VERSION_JSON" << EOF
{
  "version": "${new_version}",
  "updated_at": "${now}"
}
EOF

echo "Version bumped: ${current} → ${new_version}"
