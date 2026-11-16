#!/usr/bin/env bash
# Shared grep -E patterns for supply-chain indicators in JS/TS and config files.
# Sourced by scan-configs.sh and scan-changed-files.sh so both scans stay in sync.

# shellcheck disable=SC2034
MALICIOUS_PATTERNS=(
  "global\['!'\]"
  "global\[\"!\"\]"
  "global\['_V'\]"
  "global\[\"_V\"\]"
  '\beval[[:space:]]*\('
  '\bFunction[[:space:]]*\('
  'child_process'
  "require[[:space:]]*\([[:space:]]*[\"']https?"
  'fromCharCode'
  '\batob[[:space:]]*\('
)
