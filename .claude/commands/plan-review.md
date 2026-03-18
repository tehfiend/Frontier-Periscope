---
name: plan-review
description: Generate an HTML dashboard of all pending and active plans.
argument-hint: ""
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Write
---

# /plan-review — Plan Dashboard Generator

Generates a self-contained HTML dashboard showing all plans and their status.

## Instructions

1. Scan `plans/` recursively for all `.md` files
2. For each plan, extract:
   - Title (first `# Plan:` heading)
   - Status (from `**Status:**` field)
   - Module (from `**Module:**` field)
   - Created date (from `**Created:**` field)
   - Number of phases (count `### Phase` headings)
   - Number of open questions (count items under `## Open Questions`)
   - Current directory (pending, active, archive, etc.)
3. Generate `plans/pending-review.html` with:
   - Plans grouped by directory (pending, active, deferred)
   - Table columns: Title, Module, Status, Phases, Open Questions, Created
   - Plans with 0 open questions highlighted green (ready for active/)
   - Plans in pending/ with open questions highlighted yellow
   - Dark theme matching the project aesthetic
   - Self-contained (inline CSS, no external dependencies)
   - Sortable columns (inline JS)

## Output

Write the HTML file to `docs/plans/pending-review.html`.

Report: "Dashboard generated at docs/plans/pending-review.html — {N} plans total, {M} ready for active."
