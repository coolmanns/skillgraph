#!/usr/bin/env bash
# graph-resolve-review.sh — Review resolve_skill misses and suggest fixes
# Usage: graph-resolve-review.sh [--days N] [--unfixed-only]
set -uo pipefail

MISS_LOG="$HOME/clawd/logs/resolve-skill-misses.jsonl"
DAYS=7
UNFIXED_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --days) DAYS="$2"; shift 2 ;;
    --unfixed-only) UNFIXED_ONLY=true; shift ;;
    *) shift ;;
  esac
done

if [[ ! -f "$MISS_LOG" ]]; then
  echo "No misses logged yet. File: $MISS_LOG"
  exit 0
fi

python3 -c "
import json, sys
from datetime import datetime, timedelta
from collections import Counter

days = int('$DAYS')
unfixed_only = '$UNFIXED_ONLY' == 'true'
cutoff = (datetime.now() - timedelta(days=days)).isoformat()

misses = []
with open('$MISS_LOG') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            if entry.get('ts', '') >= cutoff:
                if unfixed_only and entry.get('fixed', False):
                    continue
                misses.append(entry)
        except:
            continue

if not misses:
    print(f'✅ No misses in the last {days} days.')
    sys.exit(0)

print(f'📊 Resolve Skill Misses (last {days} days): {len(misses)}')
print()

# Group by suggested skill
by_skill = Counter(m.get('suggested_skill', '?') for m in misses)
print('By suggested (wrong) skill:')
for skill, count in by_skill.most_common():
    print(f'  {skill}: {count}')

print()

# Group by actual used
by_actual = Counter(m.get('actual_used', '?') for m in misses)
print('Should have routed to:')
for actual, count in by_actual.most_common():
    print(f'  {actual}: {count}')

print()
print('Details:')
for m in misses:
    fixed = '✅' if m.get('fixed') else '❌'
    print(f'  {fixed} \"{m.get(\"query\", \"?\")}\"')
    print(f'     Suggested: {m.get(\"suggested_skill\", \"?\")} ({m.get(\"suggested_script\", \"?\")})')
    print(f'     Actual:    {m.get(\"actual_used\", \"?\")}')
    if m.get('reason'):
        print(f'     Reason:    {m.get(\"reason\")}')
    print()

# Suggest fixes
print('Suggested fixes:')
for m in misses:
    if not m.get('fixed'):
        query = m.get('query', '')
        actual = m.get('actual_used', '')
        print(f'  • Add alias \"{query}\" → {actual}')
"
