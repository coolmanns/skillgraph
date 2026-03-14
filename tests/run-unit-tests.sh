#!/usr/bin/env bash
# run-unit-tests.sh — Run all SkillGraph unit tests
# Usage: bash tests/run-unit-tests.sh [--verbose]
#
# Test files:
#   test-resolve.js     — Core resolver unit tests (scoring, matching, structure)
#   test-plugin.js      — Plugin output layer tests (formatToolResult, vector logic)
#   test-known-issues.js — Known issues surfacing verification
#
# Integration tests (CLI routing): run-skillgraph-tests.sh (separate)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERBOSE=""

[[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]] && VERBOSE="--test-reporter=spec"

echo "🧪 SkillGraph Unit Test Suite"
echo "═══════════════════════════════════"
echo ""

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0
FAILED_SUITES=()

for test_file in "$SCRIPT_DIR"/test-*.js; do
  name=$(basename "$test_file" .js)
  echo "── $name ──"
  
  if node --test $VERBOSE "$test_file" 2>&1; then
    echo "  ✅ passed"
  else
    FAILED_SUITES+=("$name")
    echo "  ❌ failures detected"
  fi
  echo ""
done

echo "═══════════════════════════════════"
if [[ ${#FAILED_SUITES[@]} -eq 0 ]]; then
  echo "✅ All test suites passed"
  exit 0
else
  echo "❌ Failed suites: ${FAILED_SUITES[*]}"
  exit 1
fi
