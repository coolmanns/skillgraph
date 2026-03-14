#!/usr/bin/env bash
# graph-resolve-miss.sh — Log a missed/overridden resolve_skill result
# Usage: graph-resolve-miss.sh "original query" "what I actually used" ["reason"]
#   Appends to ~/clawd/logs/resolve-skill-misses.jsonl
set -uo pipefail

QUERY="${1:-}"
ACTUAL="${2:-}"
REASON="${3:-}"
LOG_FILE="$HOME/clawd/logs/resolve-skill-misses.jsonl"

if [[ -z "$QUERY" || -z "$ACTUAL" ]]; then
  echo "Usage: graph-resolve-miss.sh \"original query\" \"actual skill/script used\" [\"reason\"]"
  exit 1
fi

# Get what graph-resolve would have returned
RESULT=$(graph-resolve "$QUERY" 2>/dev/null)
SUGGESTED_SKILL=$(echo "$RESULT" | grep "^SKILL:" | head -1 | sed 's/^SKILL: //' | cut -d'→' -f1 | xargs)
SUGGESTED_SCRIPT=$(echo "$RESULT" | grep "^SCRIPT:" | head -1 | sed 's/^SCRIPT: //')

python3 -c "
import json, datetime
entry = {
    'ts': datetime.datetime.now().isoformat(),
    'query': '''$QUERY''',
    'suggested_skill': '''$SUGGESTED_SKILL''',
    'suggested_script': '''$SUGGESTED_SCRIPT''',
    'actual_used': '''$ACTUAL''',
    'reason': '''$REASON''',
    'fixed': False
}
print(json.dumps(entry))
" >> "$LOG_FILE"

echo "📝 Logged miss: \"$QUERY\" → suggested $SUGGESTED_SKILL, used $ACTUAL"
