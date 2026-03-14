#!/usr/bin/env bash
# run-skillgraph-tests.sh — Automated test runner for SkillGraph resolve_skill routing
# Usage: run-resolve-tests.sh [--verbose] [--filter postiz|komodo|wix|image|summarize|writing]
set -uo pipefail
# Note: not using -e because grep returns 1 on no match

VERBOSE=false
FILTER=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --verbose|-v) VERBOSE=true; shift ;;
    --filter|-f) FILTER="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Each test: "ID|query|expected_skill_pattern|expected_script_pattern"
# Patterns are grep -i compatible (partial match OK)
TESTS=(
  # Postiz
  "P1|check social media queue|postiz|postiz-status"
  "P2|what's in the postiz queue|postiz|postiz-status"
  "P3|show me failed social media posts|postiz|postiz-list;postiz-status"
  "P4|list all error posts|postiz|postiz-list"
  "P5|delete all errored posts|postiz|postiz-delete-errors"
  "P6|clean up failed posts from postiz|postiz|postiz-delete-errors"
  "P7|retry failed social media posts|postiz|postiz-retry"
  "P8|requeue the error posts|postiz|postiz-retry"
  "P9|find next available posting time|postiz|postiz-next-slot"
  "P10|upload this image to postiz|postiz|postiz-upload"
  "P11|reschedule that post to tomorrow|postiz|postiz-reschedule"
  "P12|schedule a post to LinkedIn and X|postiz|postiz-schedule-post;post.py"
  # Komodo
  "K1|show all docker stacks|komodo|komodo-status"
  "K2|what containers are running|komodo|komodo-status"
  "K3|restart the postiz stack|komodo|komodo-deploy"
  "K4|deploy ollama|komodo|komodo-deploy"
  "K5|stop the n8n stack|komodo|komodo-stop"
  "K6|show me details on the monitoring stack|komodo|komodo-stack;monitoring;komodo-get-stack"
  "K7|show logs for postiz|komodo|komodo-logs"
  "K8|tail the ollama container logs|komodo|komodo-logs"
  "K9|restart all running stacks|komodo|komodo-restart-all"
  # Wix
  "W1|list all blog posts|wix|wix-list-posts"
  "W2|show me the draft posts on wix|wix|wix-list-posts"
  "W3|create a new blog post|lobster-blog-pipeline|lobster"
  "W4|wix create draft post|wix|wix-create-post"
  "W5|upload an image to wix|wix|wix-upload"
  "W6|update the SEO title on my blog post|wix|wix-update-seo"
  "W7|fix the meta description on this article|wix|wix-update-seo"
  "W8|delete wix blog post abc123|wix|wix-delete-post"
  "W9|list blog categories|wix|wix-list-categories"
  "W10|show me the wix contacts|wix|wix-contacts"
  # Image
  "I1|generate an image of a sunset|nano-banana|image-gen"
  "I2|make a blog header image|nano-banana|image-blog-header"
  "I3|generate a 1200x630 header|nano-banana|image-blog-header"
  "I4|edit this photo to change the sky|nano-banana|image-gen"
  # Summarize
  "S1|summarize this URL for me|summarize|summarize-url"
  "S2|give me the key points from this PDF|summarize|summarize"
  "S3|tldr this article|summarize|summarize"
  # Writing
  "Q1|run the writing quality check on this|writing-quality|writing-check"
  "Q2|check this article before publishing|writing-quality|writing-check"
  "Q3|does this text sound like AI|writing-quality|writing-check;detect"
  "Q4|clean up the AI language in this|writing-quality|writing-check;transform"
  "Q5|what's the readability score|writing-quality|writing-check;vale;readability"
  "Q6|check the Flesch-Kincaid grade|writing-quality|writing-check;vale;readability"
  # Reminders
  "R1|add milk to grocery list|apple-reminders|reminders"
  # Code search / grepai
  "G1|analyze code|grepai|grepai"
  "G2|analyze metabolism plugin code for optimization|grepai|grepai"
  "G3|audit plugin code|grepai|grepai"
  "G4|search code with grepai|grepai|grepai"
  "G5|search code for llamacppurl configuration|grepai|grepai"
  "G6|search code for embedding config|grepai|grepai"
  "G7|find in code where llama embeddings are configured|grepai|grepai"
  "G8|review stability plugin code for security concerns|grepai|grepai"
  "G9|search stability plugin code for refactoring|grepai|grepai"
  "G10|read plugin source|grepai|grepai"
  "G11|code review of the metabolism plugin|grepai|grepai"
  # Coding agent
  "C1|build a new feature|coding-agent|coding-agent"
  "C2|code review|grepai|grepai"
  "C3|review code|grepai|grepai"
  "C4|spawn a coder to review the pr|coding-agent|coding-agent"
  # Calendar
  "CA1|check calendar upcoming events|caldav|caldav"
  "CA2|check my calendar for tomorrow|caldav|caldav"
  "CA3|create a calendar event|caldav|caldav"
  "CA4|create an event on my calendar for tomorrow|caldav|caldav"
  # Email
  "E1|check email inbox for unread messages|himalaya|himalaya"
  "E2|read email from sascha|himalaya|himalaya"
  # Komodo extras
  "K10|check ollama status|komodo|komodo"
  "K11|check status of ollama|komodo|komodo"
  "K12|start ollama|komodo|komodo"
  "K13|stop ollama stack via komodo|komodo|komodo"
  # GSC / SEO
  "SE1|check gsc indexing status|gsc|gsc"
  "SE2|check seo performance google search console|gsc|gsc"
  # HealthKit
  "H1|check healthkit sleep data analysis|healthkit|healthkit"
  "H2|check sleep data from health tracking|healthkit|healthkit"
  # Postiz extras
  "P13|check postiz for posts in error state|postiz|postiz"
  "P14|schedule a post to linkedin|postiz|postiz"
  "P15|check linkedin analytics|postiz|analytics"
  "P16|how did my last post do|postiz|analytics"
  "P17|social media performance|postiz|analytics"
  # Image extras
  "I5|generate an image|nano-banana|image-gen"
  # Skill graph
  "SG1|check skill graph audit cron job|skill-graph|graph"
  "SG2|update skill graph database with new entities and attributes|skill-graph|graph"

  # Alias gap fixes (2026-02-26)
  "CA5|check my calendar for tomorrow|caldav-calendar|caldav-calendar"
  "CA6|delete calendar event|caldav-calendar|caldav-calendar"
  "K14|show all docker stacks|komodo|komodo"
  "K15|deploy ollama|komodo|komodo"
  "G12|find in codebase where embeddings are configured|grepai-search|grepai"
  "G13|search stability plugin code for refactoring|grepai-search|grepai"
  "G14|review integration code for optimization|grepai-search|grepai"
  "G15|check integration code|grepai-search|grepai"
  "RD1|query the 5-MeO-DMT research database|research-db|research-db"
  "RD2|search research vector database for reactivations|research-db|research-db"
  "RD3|what does the research say about ego dissolution|research-db|research-db"
  "RD4|query research database|research-db|research-db"
  "W11|list all Wix blog posts|wix-api|wix"
  "W12|list Wix blog drafts|wix-api|wix"
  "W13|list wix posts|wix-api|wix"
  "S4|tldr this article|summarize|summarize"
  "LB1|write a blog post about psychedelic integration|lobster-blog-pipeline|lobster"
  "LB2|publish a blog post|lobster-blog-pipeline|lobster"
  "LB3|run lobster blog pipeline|lobster-blog-pipeline|lobster"
  "LB4|write blog post about men and vulnerability|lobster-blog-pipeline|lobster"
  "LB5|new blog post for adult in training|lobster-blog-pipeline|lobster"
)

PASS=0
SOFT=0
FAIL=0
TOTAL=0
FAILURES=()

echo "🧪 resolve_skill Test Runner"
echo "═══════════════════════════════════"
echo ""

for test in "${TESTS[@]}"; do
  IFS='|' read -r id query expected_skill expected_script <<< "$test"
  
  # Filter if specified
  if [[ -n "$FILTER" ]]; then
    case "$FILTER" in
      postiz) [[ "$id" != P* ]] && continue ;;
      komodo) [[ "$id" != K* ]] && continue ;;
      wix) [[ "$id" != W* ]] && continue ;;
      image) [[ "$id" != I* ]] && continue ;;
      summarize) [[ "$id" != S* ]] && continue ;;
      writing) [[ "$id" != Q* ]] && continue ;;
    esac
  fi
  
  TOTAL=$((TOTAL + 1))
  
  # Call graph-resolve (plain text output, --no-log to avoid flooding resolve-skill.jsonl)
  RESULT=$(graph-resolve "$query" --no-log 2>/dev/null || echo "NO_MATCH")
  
  # Check skill match (entity name or parent skill in output)
  SKILL_MATCH=false
  SCRIPT_MATCH=false
  
  if echo "$RESULT" | grep -qi "$expected_skill"; then
    SKILL_MATCH=true
  fi
  
  # Check script match — look for script name in SCRIPT: line or anywhere in output
  # Convert ; to | for grep OR (can't use | in test data — it's the IFS delimiter)
  script_pattern="${expected_script//;/|}"
  if echo "$RESULT" | grep -qiE "$script_pattern"; then
    SCRIPT_MATCH=true
  fi
  
  # Determine result
  if $SKILL_MATCH && $SCRIPT_MATCH; then
    STATUS="✅ PASS"
    PASS=$((PASS + 1))
  elif $SKILL_MATCH; then
    STATUS="⚠️  SOFT"
    SOFT=$((SOFT + 1))
    FAILURES+=("$id: $query → skill OK, script missing (expected: $expected_script)")
  else
    STATUS="❌ FAIL"
    FAIL=$((FAIL + 1))
    GOT_ENTITY=$(echo "$RESULT" | grep "^ENTITY:" | head -1 | sed 's/ENTITY: //' | cut -c1-50)
    GOT_SCRIPT=$(echo "$RESULT" | grep "^SCRIPT:" | head -1 | sed 's/SCRIPT: //' | cut -c1-50)
    FAILURES+=("$id: $query → got entity=$GOT_ENTITY script=$GOT_SCRIPT (expected: $expected_skill / $expected_script)")
  fi
  
  if [[ "$VERBOSE" == "true" ]]; then
    echo "$STATUS  $id: \"$query\""
    if [[ "$STATUS" != "✅ PASS" ]]; then
      echo "         Expected: skill=$expected_skill script=$expected_script"
      echo "         Got: $(echo "$RESULT" | head -2 | tr '\n' ' ')"
    fi
  else
    printf "%s  %-4s %s\n" "$STATUS" "$id" "$query"
  fi
done

echo ""
echo "═══════════════════════════════════"
echo "Results: $PASS pass / $SOFT soft / $FAIL fail (of $TOTAL tests)"

PASS_RATE=0
if [[ $TOTAL -gt 0 ]]; then
  PASS_RATE=$(( (PASS * 100) / TOTAL ))
fi
echo "Pass rate: ${PASS_RATE}% (target: >90%)"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo ""
  echo "Issues:"
  for f in "${FAILURES[@]}"; do
    echo "  • $f"
  done
fi

# Exit code: 0 if >90% pass, 1 otherwise
[[ $PASS_RATE -ge 90 ]] && exit 0 || exit 1
