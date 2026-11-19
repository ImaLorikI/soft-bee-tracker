#!/usr/bin/env bash
# Scan repo files for supply-chain attack indicators:
# - Anomalously long lines (obfuscated payloads)
# - Known malicious code patterns
# - Root package.json install scripts
# - Git protocol dependencies in yarn.lock

set -euo pipefail

MAX_LENGTH=500
EXIT_CODE=0

function emit_error() {
  local file="$1"
  local message="$2"
  echo "❌ $file — $message"
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "::error file=${file}::${message}"
  fi
}

CONFIG_GLOBS=(
  "postcss.config.*"
  "tailwind.config.*"
  "next.config.*"
  "eslint.config.*"
  ".eslintrc*"
  "tsconfig*.json"
  "prettier.config.*"
  ".prettierrc*"
  ".yarnrc.yml"
  "package.json"
)

MATCHED_FILES=""
for pattern in "${CONFIG_GLOBS[@]}"; do
  for f in $pattern; do
    [ -f "$f" ] && MATCHED_FILES="$MATCHED_FILES $f"
  done
done

WORKFLOW_FILES=""
for f in .github/workflows/*.yaml .github/workflows/*.yml; do
  if [ -f "$f" ]; then
    WORKFLOW_FILES="$WORKFLOW_FILES $f"
    MATCHED_FILES="$MATCHED_FILES $f"
  fi
done

if [ -d .husky ]; then
  for f in .husky/*; do
    [ -f "$f" ] && MATCHED_FILES="$MATCHED_FILES $f"
  done
fi

if [ -z "${MATCHED_FILES// /}" ]; then
  echo "No files found to scan."
  exit 0
fi

# Long-line check
for f in $MATCHED_FILES; do
  LONG_LINES=$(awk -v max="$MAX_LENGTH" 'length > max { printf "  line %d: %d chars\n", NR, length }' "$f")
  if [ -n "$LONG_LINES" ]; then
    emit_error "$f" "lines exceed $MAX_LENGTH chars"
    echo "$LONG_LINES"
    EXIT_CODE=1
  fi
done

# shellcheck source=scripts/suspicious-code-patterns.sh
source "$(dirname "${BASH_SOURCE[0]}")/suspicious-code-patterns.sh"

for f in $MATCHED_FILES; do
  case "$f" in
    .github/workflows/*)
      continue
      ;;
  esac
  for pat in "${MALICIOUS_PATTERNS[@]}"; do
    HITS=$(grep -En "$pat" "$f" 2>/dev/null || true)
    if [ -n "$HITS" ]; then
      emit_error "$f" "suspicious pattern: $pat"
      echo "$HITS"
      EXIT_CODE=1
    fi
  done
done

WORKFLOW_PATTERNS=(
  'pull_request_target'
  "global\['!'\]"
  "global\[\"!\"\]"
  "global\['_V'\]"
  "global\[\"_V\"\]"
)

for f in $WORKFLOW_FILES; do
  for pat in "${WORKFLOW_PATTERNS[@]}"; do
    HITS=$(grep -En "$pat" "$f" 2>/dev/null || true)
    if [ -n "$HITS" ]; then
      emit_error "$f" "suspicious pattern: $pat"
      echo "$HITS"
      EXIT_CODE=1
    fi
  done
done

if [ -f package.json ]; then
  SCRIPT_HITS=$(python3 - <<'PY'
import json, sys
with open("package.json", encoding="utf-8") as f:
    data = json.load(f)
scripts = data.get("scripts") or {}
blocked = []
for name in ("preinstall", "install", "postinstall"):
    if name in scripts:
        blocked.append(f"{name}={scripts[name]!r}")
prepare = scripts.get("prepare")
if prepare is not None and prepare.strip() != "husky":
    blocked.append(f"prepare={prepare!r} (only 'husky' is allowed)")
if blocked:
    print("\n".join(blocked))
PY
)
  if [ -n "$SCRIPT_HITS" ]; then
    emit_error "package.json" "forbidden lifecycle scripts (only prepare: husky is allowed)"
    echo "$SCRIPT_HITS"
    EXIT_CODE=1
  fi
fi

if [ -f yarn.lock ]; then
  LOCK_HITS=$(python3 - <<'PY'
import re
from pathlib import Path

text = Path("yarn.lock").read_text(encoding="utf-8")
patterns = [
    r"resolver:\s*git",
    r"@git\+",
    r'resolution:\s*".*@git',
    r"git\+https?://",
    r"git\+ssh://",
    r"git://",
    r'resolution:\s*".*https://github\.com/',
    r'resolution:\s*".*https://gitlab\.com/',
    r'resolution:\s*".*https://bitbucket\.org/',
    r'resolution:\s*".*\.git#',
]
compiled = [re.compile(p, re.IGNORECASE) for p in patterns]
hits = []
for i, line in enumerate(text.splitlines(), 1):
    if any(p.search(line) for p in compiled):
        hits.append(f"{i}:{line}")
print("\n".join(hits))
PY
)
  if [ -n "$LOCK_HITS" ]; then
    emit_error "yarn.lock" "git protocol or git-host resolution detected"
    echo "$LOCK_HITS"
    EXIT_CODE=1
  fi
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ Config and lockfile security scan clean."
fi
exit "$EXIT_CODE"
