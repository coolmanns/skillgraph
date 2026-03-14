# resolve_skill Tool Description A/B Test Results
**Date:** 2026-02-28
**Method:** 20 task prompts × 4 description variants, each as a fresh sub-agent (mode=run)
**Model:** anthropic/claude-sonnet-4-6
**System prompt:** Full agent config (AGENTS.md etc.) — constant across all variants

## Descriptions Tested

### Old (baseline)
```
Resolve a task to the correct skill/tool BEFORE executing it. Call this before any exec, API call, or tool use involving managed resources (Docker, services, content, devices, infra). Returns the skill name, action, attrs (commands/scripts), and instructions — use them directly without reading any skill files. Saves thousands of tokens per task.
```

### Variation B — Decision-gate framing
```
Your first step before executing any infrastructure, service, or content task. Queries the skill graph to find the exact script, command, or workflow — preventing guesswork and wrong commands. Covers: Docker, Komodo, Postiz, blogs, social media, monitoring, backups, home automation, and 40+ managed workflows. If unsure whether a task is managed, call this — a miss costs nothing, a wrong command costs recovery time.
```

### Variation C — Minimal + high-signal triggers (WINNER)
```
Finds the right skill/script for managed tasks. Call before: docker, komodo, ollama, postiz, blog, social media, n8n, home assistant, backup, cron, caddy, monitoring, or any service operation. Returns ready-to-use commands and instructions. Skip for: conversation, memory, file ops, web search.
```

### Variation D — Cost-framing
```
Resolves managed tasks to exact commands in one call — saves re-reading SKILL.md files and guessing scripts. Covers 40+ skills across infrastructure (Docker, Komodo, Caddy, Ollama), content (blog, social media, Postiz, LinkedIn), services (n8n, Home Assistant, monitoring), and automation (cron, backups). Always cheaper to resolve first than to debug a wrong command. Pass a brief task description, get back the skill name, action, attrs, and step-by-step instructions.
```

## Test Prompts

### Category A — Should resolve (managed infrastructure)
1. Restart the Ollama container
2. Check if Postiz has any failed posts
3. Deploy the latest microdose-tracker build
4. Add a new Caddy reverse proxy entry
5. Check n8n workflow status

### Category B — Should resolve (content/automation)
6. Write a new blog post about psilocybin research
7. Schedule a LinkedIn post for Monday
8. Run the backup script
9. Check the cron logs for errors
10. Post to social media about the new article

### Category C — Should NOT resolve (general tasks)
11. What's the weather tomorrow?
12. Search the web for Johns Hopkins psilocybin trials
13. Edit MEMORY.md to add a new section
14. Read today's daily notes
15. Send Sascha a message about the calendar

### Category D — Ambiguous
16. Set up a new Docker container for testing
17. Check disk space on the server
18. Update the SSL certificate
19. Look at the Home Assistant logs
20. Create a new automation for morning alerts

## Results

| # | Prompt | Cat | Old | B | C | D |
|---|--------|-----|:---:|:---:|:---:|:---:|
| 1 | Restart Ollama | A | ✅ | ✅ | ✅ | ✅ |
| 2 | Check Postiz failed | A | ✅ | ✅ | ✅ | ✅ |
| 3 | Deploy microdose-tracker | A | ✅ | ✅ | ✅ | ✅ |
| 4 | Add Caddy reverse proxy | A | ✅ | ✅ | ✅ | ✅ |
| 5 | Check n8n status | A | ✅ | ✅ | ✅ | ✅ |
| 6 | Blog post psilocybin | B | ✅ | ✅ | ✅ | ✅ |
| 7 | Schedule LinkedIn | B | ✅ | ✅ | ✅ | ✅ |
| 8 | Run backup | B | ✅ | ✅ | ✅ | ✅ |
| 9 | Check cron logs | B | ❌ | ❌ | ❌ | ❌ |
| 10 | Post social media | B | ✅ | ✅ | ✅ | ✅ |
| 11 | Weather | C | ❌ | ❌ | ❌ | ❌ |
| 12 | Web search | C | ❌ | ❌ | ❌ | ❌ |
| 13 | Edit MEMORY.md | C | ❌ | ❌ | ❌ | ❌ |
| 14 | Read daily notes | C | ❌ | ❌ | ❌ | ❌ |
| 15 | Send message | C | ❌ | ❌ | ❌ | ❌ |
| 16 | Docker container | D | ❌ | ❌ | ❌ | ❌ |
| 17 | Disk space | D | ❌ | ❌ | ❌ | ❌ |
| 18 | SSL cert | D | ❌ | ✅ | ✅ | ✅ |
| 19 | HA logs | D | ❌ | ✅ | ✅ | ✅ |
| 20 | Morning automation | D | ✅ | ✅ | ✅ | ✅ |

## Summary

| Variant | A (5) | B (5) | C (5) | D (5) | Total |
|---------|:-----:|:-----:|:-----:|:-----:|:-----:|
| Old     | 5/5   | 4/5   | 0/5 ✅ | 1/5   | **10/20** |
| B       | 5/5   | 4/5   | 0/5 ✅ | 3/5   | **12/20** |
| C       | 5/5   | 4/5   | 0/5 ✅ | 3/5   | **12/20** |
| D       | 5/5   | 4/5   | 0/5 ✅ | 3/5   | **12/20** |

## Decision
**Shipped Variation C** — same score as B and D but:
- Shortest description (fewer tokens per session)
- Clearest negative triggers ("Skip for: conversation, memory, file ops, web search")
- Explicit keyword list serves as scannable trigger inventory
- Already includes "cron" keyword (priming for when graph alias is added)

## Known Gaps
- "Check cron logs" missed across ALL variants — graph DB has no `cron-logs` alias (not a description issue)
- "Docker container" and "disk space" missed across all — genuinely ambiguous / not managed tasks
- Sub-agents inherit full AGENTS.md — can't fully isolate description effect, but the mandate is constant so delta is valid

## Cost
~80 sub-agent runs total (~14K tokens each on claude-sonnet-4-6)
