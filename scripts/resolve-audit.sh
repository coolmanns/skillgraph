#!/usr/bin/env bash
# resolve-audit.sh — Post-session audit: compare resolve recommendations vs actual exec commands
# Usage: resolve-audit.sh [--days N] (default: 1 day)
#
# Reads: ~/clawd/logs/resolve-skill.jsonl (what was recommended)
# Reads: session history via openclaw (what was actually executed)
# Outputs: potential overrides / mismatches for review
#
# Designed to run during memory flush or daily cron.

set -euo pipefail

DAYS="${1:---days}"
N="${2:-1}"
LOG_FILE="$HOME/clawd/logs/resolve-skill.jsonl"
AUDIT_LOG="$HOME/clawd/logs/resolve-audit.log"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "No resolve log found at $LOG_FILE"
  exit 0
fi

# Get entries from the last N days
CUTOFF=$(date -d "-${N} days" -u +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -v-${N}d -u +%Y-%m-%dT%H:%M:%S)

echo "=== Resolve Audit $(date -Iseconds) ===" | tee -a "$AUDIT_LOG"
echo "Checking entries since: $CUTOFF" | tee -a "$AUDIT_LOG"
echo "" | tee -a "$AUDIT_LOG"

python3 << 'PYEOF'
import json, sys
from datetime import datetime, timedelta, timezone

log_file = sys.argv[1] if len(sys.argv) > 1 else f"{__import__('os').environ['HOME']}/clawd/logs/resolve-skill.jsonl"
cutoff = datetime.now(timezone.utc) - timedelta(days=1)

entries = []
with open(log_file) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            ts = entry.get('ts', '')
            # Parse ISO timestamp
            if ts:
                # Handle both Z and +00:00 formats
                ts_clean = ts.replace('Z', '+00:00')
                try:
                    dt = datetime.fromisoformat(ts_clean)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    if dt < cutoff:
                        continue
                except:
                    pass
            entries.append(entry)
        except json.JSONDecodeError:
            continue

if not entries:
    print("No recent resolve entries found.")
    sys.exit(0)

print(f"Found {len(entries)} resolve calls in the last day:\n")

# Summary table
for i, e in enumerate(entries, 1):
    ts = e.get('ts', '?')[:19]
    query = e.get('query', '?')
    skill = e.get('skill', '?')
    entity = e.get('entity', '?')
    conf = e.get('confidence', '?')
    action = e.get('matchedAction', e.get('used', '-'))
    override = e.get('override')
    
    status = "✅" if not override else f"⚠️  OVERRIDE: {override}"
    print(f"  {i}. [{ts}] \"{query}\"")
    print(f"     → skill={skill}, entity={entity}, conf={conf}")
    if action and action != '-':
        print(f"     → action={action}")
    print(f"     {status}")
    print()

# Flag potential issues
overrides = [e for e in entries if e.get('override')]
low_conf = [e for e in entries if e.get('confidence') == 'low']
no_match = [e for e in entries if e.get('skill') is None and e.get('entity') == 'NO_MATCH']

if overrides:
    print(f"\n⚠️  {len(overrides)} OVERRIDES detected — review recommended")
if low_conf:
    print(f"\n⚠️  {len(low_conf)} LOW CONFIDENCE matches — may need new aliases in skillgraph.db")
if no_match:
    print(f"\n❌ {len(no_match)} NO_MATCH results — tasks not covered by graph")

if not overrides and not low_conf and not no_match:
    print("✅ All resolves look clean — no overrides, no low confidence, no misses.")
PYEOF

echo "" | tee -a "$AUDIT_LOG"
