#!/bin/bash
# Test whether resolve_skill gets called for each prompt
# Usage: ./run-description-test.sh <variant_name>
# Spawns 20 sub-agents sequentially, checks resolve-skill.jsonl for new entries

VARIANT="${1:-unknown}"
LOG="/home/coolmann/clawd/logs/resolve-skill.jsonl"
RESULTS="/home/coolmann/clawd/projects/skillgraph/tests/results-${VARIANT}.json"
PROMPTS="/home/coolmann/clawd/projects/skillgraph/tests/description-test-prompts.json"

echo "=== Running description test: variant=$VARIANT ==="
echo "Started: $(date)"

# Read prompts into arrays
declare -a categories=("A_should_resolve" "B_should_resolve" "C_should_not_resolve" "D_ambiguous")
declare -a all_prompts
declare -a all_categories

for cat in "${categories[@]}"; do
  while IFS= read -r prompt; do
    all_prompts+=("$prompt")
    all_categories+=("$cat")
  done < <(python3 -c "import json; [print(p) for p in json.load(open('$PROMPTS'))['$cat']]")
done

echo "{\"variant\": \"$VARIANT\", \"timestamp\": \"$(date -Iseconds)\", \"results\": [" > "$RESULTS"

first=true
for i in "${!all_prompts[@]}"; do
  prompt="${all_prompts[$i]}"
  category="${all_categories[$i]}"
  
  # Snapshot log line count before
  if [ -f "$LOG" ]; then
    before=$(wc -l < "$LOG")
  else
    before=0
  fi
  
  echo "[$((i+1))/20] Category=$category Prompt=\"$prompt\""
  
  # Run as sub-agent with minimal task - just ask it to do the thing
  # The sub-agent will either call resolve_skill or not
  openclaw run --timeout 30 --message "You are an infrastructure assistant. Do this task (just plan the first step, don't actually execute): $prompt" 2>/dev/null
  
  # Wait a moment for log flush
  sleep 1
  
  # Check if new log entries appeared
  if [ -f "$LOG" ]; then
    after=$(wc -l < "$LOG")
  else
    after=0
  fi
  
  new_entries=$((after - before))
  called_resolve=$( [ "$new_entries" -gt 0 ] && echo "true" || echo "false" )
  
  # Get the matched skill if any
  matched_skill="null"
  if [ "$new_entries" -gt 0 ]; then
    matched_skill=$(tail -1 "$LOG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('skill','unknown')))" 2>/dev/null || echo "null")
  fi
  
  if [ "$first" = true ]; then
    first=false
  else
    echo "," >> "$RESULTS"
  fi
  
  echo "  {\"prompt\": $(python3 -c "import json; print(json.dumps('$prompt'))"), \"category\": \"$category\", \"called_resolve\": $called_resolve, \"matched_skill\": $matched_skill}" >> "$RESULTS"
  
  echo "  → called_resolve=$called_resolve (new_entries=$new_entries)"
done

echo "]}" >> "$RESULTS"
echo ""
echo "=== Done. Results: $RESULTS ==="
echo "Finished: $(date)"
