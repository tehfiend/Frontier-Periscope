---
name: worktree-implement
description: Implement a plan in a git worktree via a sub-agent.
argument-hint: "[plan-file-path] [worktree-path]"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Agent
---

# /worktree-implement — Worktree Implementation Skill

Implements a plan by spawning a sub-agent in a git worktree.

## Step 1: Read the Plan

Read the plan file specified in the argument. If no plan file is given, ask the user.

The plan should be in `docs/plans/active/` (execution-ready). If the plan is in `pending/`, warn the user that it has open questions.

## Step 2: Select or Create Worktree

If a worktree path is specified, use it. Otherwise, derive one:

```bash
# Check existing worktrees
git worktree list

# Create new worktree
BRANCH_NAME="wt-{module}-{feature}"
git worktree add ../TehFrontier-{module} -b $BRANCH_NAME
```

## Step 3: Sync Worktree

Ensure the worktree is up to date:

```bash
cd ../TehFrontier-{module}
git merge {base-branch} --no-edit
```

## Step 4: Spawn Implementation Agent

Use the Agent tool with `run_in_background: true`. **Paste the full plan contents into the prompt** — don't rely on the agent reading the file.

Prompt template:

```
## Working Directory
{worktree absolute path}

## Your Domain: {Module from plan}

### Write scope:
{files from plan's File Summary table}

### Context files (read first):
- CLAUDE.md
{any files referenced in plan's Current State section}

### Read scope:
- Entire project (read-only reference)

## Implementation Plan

{PASTE FULL PLAN CONTENTS HERE}

## Rules
- Work ONLY in your worktree directory
- Do NOT switch branches
- Stay within your write scope
- Do NOT modify coordinator-owned files:
  package.json, pnpm-lock.yaml, pnpm-workspace.yaml, turbo.json,
  biome.json, .npmrc, .env.example, .gitignore, scripts/*, docker/*, CLAUDE.md
- Implement each phase sequentially
- Read each file before editing
- Run `pnpm build` after each phase to catch errors early
- Commit after each phase with a descriptive message
- Run final `pnpm build` verification
- Do NOT push
```

## Step 5: Report

```
## Agent Dispatched

- **Plan:** {plan file path}
- **Module:** {module}
- **Worktree:** {worktree path}
- **Branch:** {branch name}
- **Agent ID:** {id}

Monitor with: `git -C {worktree} log --oneline {base}..HEAD`
```
