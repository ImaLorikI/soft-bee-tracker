#!/usr/bin/env bash
# Scan JS/TS files changed between two git SHAs for supply-chain indicators.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <base-sha> <head-sha>" >&2
  exit 2
fi

BASE="$1"
HEAD="$2"
EXIT_CODE=0

function emit_error() {
  local file="$1"
  local message="$2"
  echo "❌ $file — $message"
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error file=${file}::${message}"
  fi
}

for sha in "$BASE" "$HEAD"; do
  if ! git rev-parse --verify --quiet "${sha}^{commit}" > /dev/null; then
    echo "Error: $sha is not a commit in this checkout (shallow clone, new branch, or force-push?)" >&2
    exit 2
  fi
done

CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE"..."$HEAD" -- \
  '*.js' '*.mjs' '*.cjs' '*.ts' '*.tsx' '*.jsx' ':!.yarn/**')

if [ -z "$CHANGED" ]; then
  echo "No JS/TS files changed."
  exit 0
fi

echo "Scanning $(echo "$CHANGED" | wc -l | tr -d ' ') changed JS/TS files..."

# shellcheck source=scripts/suspicious-code-patterns.sh
source "$(dirname "${BASH_SOURCE[0]}")/suspicious-code-patterns.sh"

while IFS= read -r f; do
  [ -f "$f" ] || continue
  for pat in "${MALICIOUS_PATTERNS[@]}"; do
    HITS=$(grep -En "$pat" "$f" 2>/dev/null || true)
    if [ -n "$HITS" ]; then
      emit_error "$f" "suspicious pattern: $pat"
      echo "$HITS"
      EXIT_CODE=1
    fi
  done

  LONG_LINES=$(awk 'length > 1000 { printf "  line %d: %d chars\n", NR, length }' "$f")
  if [ -n "$LONG_LINES" ]; then
    emit_error "$f" "lines exceed 1000 chars"
    echo "$LONG_LINES"
    EXIT_CODE=1
  fi
done <<< "$CHANGED"

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ No suspicious patterns in changed files."
fi
exit "$EXIT_CODE"
