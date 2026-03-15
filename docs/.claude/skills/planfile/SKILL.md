---
name: planfile
description: Create or update plan files. Spawns an autonomous research agent that iteratively refines the plan.
argument-hint: "[module name, feature name, or plan file path]"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Agent, Edit, Write, AskUserQuestion
---

# /planfile — Plan Creation & Refinement Skill

Creates or updates plan files with autonomous iterative refinement. Each review pass uses a fresh sub-agent to avoid token exhaustion.

## Step 1: Resolve Plan File

Parse the argument to determine if this is a CREATE or UPDATE:

- If argument is a file path → UPDATE that plan
- If argument matches an existing plan name (fuzzy) → UPDATE it
- Otherwise → CREATE a new plan

For CREATE, the plan goes to `plans/pending/{NN}-{feature-name}.md` where NN is the next sequence number.

## Step 2: Spawn Background Agent (Immediately)

Invoking `/planfile` IS the go-ahead. Spawn the agent immediately without asking for confirmation.

Use the Agent tool with `run_in_background: true`.

### CREATE Prompt

```
You are a planning agent for TehFrontier. Create a new implementation plan.

## Your Task
Research the codebase and create a plan for: {argument}

## Plan File
Write to: docs/plans/pending/{NN}-{feature-name}.md

## Plan Template
Use this exact structure:

---
# Plan: {Title}
**Status:** Draft
**Created:** {today's date}
**Module:** {primary module}

## Overview
{What and why. 2-3 paragraphs.}

## Current State
{What exists today. Reference specific files and routes.}

## Target State
{What we're building. Data models, routes, components.}

## Design Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|

## Implementation Phases
### Phase 1: {name}
1. Step
2. Step

### Phase 2: {name}
1. Step
2. Step

## File Summary
| File | Action | Description |
|------|--------|-------------|

## Open Questions
1. {question}
   - **Option A: {choice}** — Pros: {benefits}. Cons: {drawbacks}.
   - **Option B: {choice}** — Pros: {benefits}. Cons: {drawbacks}.
   - **Recommendation:** {which option and why}

## Deferred
- {item} — {reason}
---

## Research Instructions
- Read CLAUDE.md for project structure and module registry
- Explore the relevant module directories
- Check existing patterns in similar modules
- Reference specific file paths in Current State and File Summary

## After Drafting
Commit your draft, then proceed to iterative refinement (see below).
```

### UPDATE Prompt

```
You are a planning agent for TehFrontier. Update an existing plan.

## Plan File
{plan file path}

## Instructions
1. Read the plan file
2. Read the codebase to check current state against plan
3. Update status fields, phase completion, open questions
4. If phases are complete, move the plan:
   - All done → plans/archive/
   - New blockers → plans/pending/
   - Superseded → plans/superseded/
5. Commit changes

After updating, proceed to iterative refinement (see below).
```

## Step 3: Iterative Refinement Loop

After the initial draft/update, the agent runs this loop:

```
PASS_NUMBER = 2
MAX_PASSES = 5

while PASS_NUMBER <= MAX_PASSES:
    Spawn a NEW sub-agent (fresh context) with this prompt:

    ---
    You are reviewing a plan for TehFrontier.

    ## Plan File
    {path to plan file}

    ## Instructions
    1. Read the plan file carefully
    2. Read CLAUDE.md for project context
    3. Research the codebase to verify:
       - File paths are correct
       - Current state description matches reality
       - Proposed changes are feasible
       - No missing dependencies or conflicts
       - Phase steps are specific enough for implementation
    4. Fix any issues you find by editing the plan file
    5. If you made changes: output "CHANGES: {brief list}"
       If no changes needed: output "NO_CHANGES"

    Be thorough but focused. This is review pass {PASS_NUMBER}.
    ---

    Wait for result.
    If result contains "NO_CHANGES" → break
    PASS_NUMBER += 1
```

## Step 4: Final Sort

After refinement completes:

- If plan has items in "Open Questions" → move to `plans/pending/`
- If no open questions → move to `plans/active/`

```bash
# Move plan to correct directory
git mv docs/plans/pending/{file} docs/plans/active/{file}  # or keep in pending
git commit -m "plan: finalize {feature-name}"
```

## Step 5: Log Dispatch

Append to `docs/dispatch-log.md`:

```
## {date} — {feature-name}
- **Action:** {CREATE|UPDATE}
- **File:** {plan path}
- **Passes:** {number of refinement passes}
- **Result:** {active|pending} — {brief summary}
```
