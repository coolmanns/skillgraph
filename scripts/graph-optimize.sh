#!/usr/bin/env bash
# graph-optimize.sh — Skill graph audit (analyze-only)
# Reviews resolve_skill misses, reports gaps, suggests fixes + test cases
# Does NOT modify skillgraph.db — all changes are manual during sessions
# Designed to run as a daily cron job
#
# Usage: graph-optimize.sh [--days N]
#   --days N   Look back N days for misses (default: 1)
set -uo pipefail

MISS_LOG="$HOME/clawd/logs/resolve-skill-misses.jsonl"
RESOLVE_LOG="$HOME/clawd/logs/resolve-skill.jsonl"
DB="$HOME/clawd/projects/skillgraph/skillgraph.db"
TEST_SCRIPT="$HOME/clawd/projects/skillgraph/tests/run-skillgraph-tests.sh"
LOG_FILE="$HOME/clawd/logs/graph-optimize.log"
DAYS=1

while [[ $# -gt 0 ]]; do
  case $1 in
    --days) DAYS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

log() { echo "[$(date '+%Y-%m-%d %H:%M')] $1" | tee -a "$LOG_FILE"; }

log "=== Graph Audit Run ==="
log "Lookback: ${DAYS}d"

# Step 1: Run test suite baseline
if [[ -f "$TEST_SCRIPT" ]]; then
  log "Running test suite..."
  TEST_OUTPUT=$(bash "$TEST_SCRIPT" 2>/dev/null)
  TEST_SUMMARY=$(echo "$TEST_OUTPUT" | grep "^Results:" || echo "test failed")
  PASS_RATE=$(echo "$TEST_OUTPUT" | grep "^Pass rate:" || echo "unknown")
  log "Test: $TEST_SUMMARY"
  log "Test: $PASS_RATE"

  FAIL_COUNT=$(echo "$TEST_OUTPUT" | grep -c "^❌" || true)
  FAIL_COUNT=${FAIL_COUNT:-0}
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    log "⚠️ TEST FAILURES DETECTED — review needed"
    echo "$TEST_OUTPUT" | grep "^❌" | tee -a "$LOG_FILE"
  fi
fi

# Step 2: Analyze misses
if [[ ! -f "$MISS_LOG" ]]; then
  log "No miss log found. Nothing to analyze."
  log "=== Done (clean) ==="
  exit 0
fi

OPT_DAYS=$DAYS python3 << 'PYEOF'
import json, os
from datetime import datetime, timedelta
from collections import Counter

MISS_LOG = os.path.expanduser("~/clawd/logs/resolve-skill-misses.jsonl")
RESOLVE_LOG = os.path.expanduser("~/clawd/logs/resolve-skill.jsonl")
DAYS = int(os.environ.get('OPT_DAYS', '1'))

cutoff = (datetime.now() - timedelta(days=DAYS)).isoformat()

# Load unfixed misses
misses = []
with open(MISS_LOG) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            e = json.loads(line)
            if e.get('ts','') >= cutoff and not e.get('fixed', False):
                misses.append(e)
        except: pass

if not misses:
    print("No unfixed misses in the lookback period.")
    exit()

print(f"\n📋 UNFIXED MISSES ({len(misses)} in last {DAYS}d):")
print("=" * 70)

# Group by actual_used target
by_target = {}
for m in misses:
    target = m.get('actual_used', 'unknown')
    by_target.setdefault(target, []).append(m)

for target, items in sorted(by_target.items()):
    print(f"\n  → {target} ({len(items)} misses)")
    for m in items:
        print(f"    Q: \"{m.get('query', '?')}\"")

# Suggest aliases (generalized, not verbatim)
print(f"\n📝 SUGGESTED FIXES (add during next session):")
print("=" * 70)
for target, items in sorted(by_target.items()):
    for m in items:
        q = m.get('query', '')
        # Extract key words (rough suggestion)
        words = [w for w in q.lower().split() if len(w) > 3]
        short = ' '.join(words[:4])
        print(f"  alias: \"{short}\" → {target}")

# Suggest test cases
print(f"\n🧪 SUGGESTED TEST CASES (add to run-skillgraph-tests.sh):")
print("=" * 70)
for target, items in sorted(by_target.items()):
    for i, m in enumerate(items):
        q = m.get('query', '')
        # Generate test ID from target
        prefix = target[:3].upper().replace('-','')
        tid = f"NEW{i+1}"
        print(f'  "{tid}|{q}|{target}|{target}"')

# Analyze low-confidence resolves from main log
if os.path.exists(RESOLVE_LOG):
    low_conf = []
    with open(RESOLVE_LOG) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                e = json.loads(line)
                if e.get('ts','') >= cutoff and e.get('confidence') in ('low', 'medium'):
                    low_conf.append(e)
            except: pass

    if low_conf:
        # Deduplicate by query
        seen = set()
        unique_low = []
        for e in low_conf:
            q = e['query']
            if q not in seen:
                seen.add(q)
                unique_low.append(e)

        print(f"\n⚠️  LOW/MEDIUM CONFIDENCE RESOLVES ({len(unique_low)} unique):")
        print("=" * 70)
        for e in sorted(unique_low, key=lambda x: x.get('score', 0)):
            conf = e.get('confidence', '?')
            marker = '🔴' if conf == 'low' else '🟡'
            print(f"  {marker} score={e.get('score',0):3d} | \"{e['query'][:55]}\" → {e.get('entity','?')}")

PYEOF

log "Review these findings during the next morning session."
log "=== Done ==="
