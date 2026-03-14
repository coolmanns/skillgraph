# resolve_skill Test Cases

> Run these queries against `resolve_skill` and verify the expected skill + script are returned.
> Script: `~/clawd/projects/skillgraph/tests/run-resolve-tests.sh`

## Postiz (Social Media)

| # | Query | Expected Skill | Expected Script |
|---|-------|---------------|-----------------|
| P1 | "check social media queue" | postiz | `postiz-status.sh` |
| P2 | "what's in the postiz queue" | postiz | `postiz-status.sh` |
| P3 | "show me failed social media posts" | postiz | `postiz-list.sh` or `postiz-status.sh` |
| P4 | "list all error posts" | postiz | `postiz-list.sh` |
| P5 | "delete all errored posts" | postiz | `postiz-delete-errors.sh` |
| P6 | "clean up failed posts from postiz" | postiz | `postiz-delete-errors.sh` |
| P7 | "retry failed social media posts" | postiz | `postiz-retry.sh` |
| P8 | "requeue the error posts" | postiz | `postiz-retry.sh` |
| P9 | "delete post abc123 from postiz" | postiz | `postiz-delete.sh` |
| P10 | "when is the next open slot on X" | postiz | `postiz-next-slot.sh` |
| P11 | "find next available posting time" | postiz | `postiz-next-slot.sh` |
| P12 | "upload this image to postiz" | postiz | `postiz-upload.sh` |
| P13 | "reschedule that post to tomorrow" | postiz | `postiz-reschedule.sh` |
| P14 | "schedule a post to LinkedIn and X" | postiz | `post.py` |
| P15 | "check for duplicate posts" | postiz | `check_duplicates.py` |

## Komodo (Docker Infrastructure)

| # | Query | Expected Skill | Expected Script |
|---|-------|---------------|-----------------|
| K1 | "show all docker stacks" | komodo | `komodo-status.sh` |
| K2 | "what containers are running" | komodo | `komodo-status.sh` |
| K3 | "restart the postiz stack" | komodo | `komodo-deploy.sh` |
| K4 | "deploy ollama" | komodo | `komodo-deploy.sh` |
| K5 | "stop the n8n stack" | komodo | `komodo-stop.sh` |
| K6 | "show me details on the monitoring stack" | komodo | `komodo-stack.sh` |
| K7 | "inspect the ghost stack" | komodo | `komodo-stack.sh` |
| K8 | "show logs for postiz" | komodo | `komodo-logs.sh` |
| K9 | "tail the ollama container logs" | komodo | `komodo-logs.sh` |
| K10 | "destroy the scrapling stack" | komodo | `komodo-destroy.sh` |
| K11 | "restart all running stacks" | komodo | `komodo-restart-all.sh` |

## Wix (Blog & Site Management)

| # | Query | Expected Skill | Expected Script |
|---|-------|---------------|-----------------|
| W1 | "list all blog posts" | wix-api | `wix-list-posts.sh` |
| W2 | "show me the draft posts on wix" | wix-api | `wix-list-posts.sh --drafts` |
| W3 | "get details for blog post xyz" | wix-api | `wix-get-post.sh` |
| W4 | "create a new blog post" | wix-api | `wix-create-post.sh` |
| W5 | "create a draft on adultintraining" | wix-api | `wix-create-post.sh` |
| W6 | "publish a blog post on wix" | wix-api | `wix-create-post.sh --publish` |
| W7 | "upload an image to wix" | wix-api | `wix-upload.sh` |
| W8 | "upload blog header to wix CDN" | wix-api | `wix-upload.sh` |
| W9 | "update the SEO title on my blog post" | wix-api | `wix-update-seo.sh` |
| W10 | "fix the meta description on this article" | wix-api | `wix-update-seo.sh` |
| W11 | "delete blog post abc123" | wix-api | `wix-delete-post.sh` |
| W12 | "list blog categories" | wix-api | `wix-list-categories.sh` |
| W13 | "show me the wix contacts" | wix-api | `wix-contacts.sh` |
| W14 | "search for john in CRM contacts" | wix-api | `wix-contacts.sh` |

## Image Generation (Nano Banana Pro)

| # | Query | Expected Skill | Expected Script |
|---|-------|---------------|-----------------|
| I1 | "generate an image of a sunset" | nano-banana-pro | `image-gen.sh` |
| I2 | "create a picture for my blog" | nano-banana-pro | `image-gen.sh` or `image-blog-header.sh` |
| I3 | "make a blog header image" | nano-banana-pro | `image-blog-header.sh` |
| I4 | "generate a 1200x630 header" | nano-banana-pro | `image-blog-header.sh` |
| I5 | "edit this photo to change the sky" | nano-banana-pro | `image-gen.sh` |
| I6 | "generate an image at 4K resolution" | nano-banana-pro | `image-gen.sh` |

## Summarize

| # | Query | Expected Skill | Expected Script |
|---|-------|---------------|-----------------|
| S1 | "summarize this URL for me" | summarize | `summarize-url.sh` |
| S2 | "give me the key points from this PDF" | summarize | `summarize-url.sh` |
| S3 | "tldr this article" | summarize | `summarize-url.sh` |
| S4 | "summarize this YouTube video" | summarize | `summarize-url.sh` |
| S5 | "extract the text from this page" | summarize | `summarize-url.sh` |

## Writing Quality

| # | Query | Expected Skill | Expected Script |
|---|-------|---------------|-----------------|
| Q1 | "run the writing quality check on this" | writing-quality | `writing-check.sh` |
| Q2 | "check this article before publishing" | writing-quality | `writing-check.sh` |
| Q3 | "does this text sound like AI" | writing-quality | `writing-check.sh --detect-only` |
| Q4 | "what's the AI score on this draft" | writing-quality | `writing-check.sh --detect-only` |
| Q5 | "clean up the AI language in this" | writing-quality | `writing-check.sh --transform-only` |
| Q6 | "humanize this text" | writing-quality | `writing-check.sh --transform-only` |
| Q7 | "what's the readability score" | writing-quality | `writing-check.sh --vale-only` |
| Q8 | "check the Flesch-Kincaid grade" | writing-quality | `writing-check.sh --vale-only` |
| Q9 | "strip the AI vocabulary from this" | writing-quality | `writing-check.sh --transform-only` |

---

## Scoring

- **PASS**: Correct skill AND script returned (in instructions, matchedAction, or alternative)
- **SOFT PASS**: Correct skill, script in alternative but not primary
- **FAIL**: Wrong skill or no script reference

Target: >90% PASS rate

*Last updated: 2026-02-24*
