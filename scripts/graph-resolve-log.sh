#!/usr/bin/env bash
# graph-resolve-log.sh — Wrapper around graph-resolve that logs every query + result
# Usage: graph-resolve-log.sh "query"
#   Logs to ~/clawd/logs/resolve-skill.jsonl
#   Same output as graph-resolve, just adds logging
set -uo pipefail

QUERY="${1:-}"
LOG_FILE="$HOME/clawd/logs/resolve-skill.jsonl"

if [[ -z "$QUERY" ]]; then
  echo "Usage: graph-resolve-log.sh \"query\""
  exit 1
fi

# Run graph-resolve and capture output
RESULT=$(graph-resolve "$QUERY" 2>/dev/null)
EXIT_CODE=$?

# Extract key fields from output
SCRIPT=$(echo "$RESULT" | grep "^SCRIPT:" | head -1 | sed 's/^SCRIPT: //')
ENTITY=$(echo "$RESULT" | grep "^ENTITY:" | head -1 | sed 's/^ENTITY: //' | cut -d'(' -f1 | xargs)
SKILL=$(echo "$RESULT" | grep "^SKILL:" | head -1 | sed 's/^SKILL: //' | cut -d'→' -f1 | xargs)
CONFIDENCE=$(echo "$RESULT" | grep "^CONFIDENCE:" | head -1 | sed 's/^CONFIDENCE: //')

# Log as JSONL
python3 -c "
import json, datetime
entry = {
    'ts': datetime.datetime.now().isoformat(),
    'query': '''$QUERY''',
    'skill': '''$SKILL''',
    'entity': '''$ENTITY''',
    'script': '''$SCRIPT''',
    'confidence': '''$CONFIDENCE''',
    'used': None,
    'override': None
}
print(json.dumps(entry))
" >> "$LOG_FILE"

# Output original result
echo "$RESULT"
