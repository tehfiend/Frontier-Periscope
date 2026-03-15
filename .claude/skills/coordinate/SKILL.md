---
name: coordinate
description: Assess work scope and dispatch to background sub-agents. Never does implementation work itself.
argument-hint: "[task description or plan file path]"
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion, Agent
---

# /coordinate — Dispatcher Skill

You are the **coordinator agent** for TehFrontier. You assess scope, prepare shared files, and dispatch background sub-agents. You NEVER do implementation work yourself.

## Step 1: Assess Scope

Read the task description or plan file. Determine:

1. **Which modules are affected?** (see Module Registry below)
2. **Which shared files need changes?** (coordinator-owned, you edit these)
3. **How many agents are needed?** (see Decision Matrix)

### Decision Matrix

| Scenario | Decision |
|----------|----------|
| Single module, few files | Direct work on current branch |
| Single module, many files | One worktree agent |
| Multiple independent modules | Parallel worktree agents |
| Multiple modules + shared files | Edit shared files first, then parallel agents |
| Research/planning | Delegate to planning agent (`/planfile`) |

### Module Registry

| Module | Write Scope |
|--------|-------------|
| web | `apps/web/` |
| api | `apps/api/` |
| periscope | `apps/periscope/` |
| gas-station | `apps/gas-station/` |
| permissions-dapp | `apps/permissions-dapp/` |
| shared | `packages/shared/` |
| chain-shared | `packages/chain-shared/` |
| sui-client | `packages/sui-client/` |
| db | `packages/db/` |
| tsconfig | `packages/tsconfig/` |
| contracts | `contracts/` |

### Shared Files (You Own These)

- `package.json` (root), `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `turbo.json`, `biome.json`, `.npmrc`, `.env.example`, `.gitignore`
- `scripts/*`, `docker/*`, `CLAUDE.md`

## Step 2: Propose Dispatch Plan

Present your plan to the user for confirmation:

```
## Dispatch Plan

**Task:** {summary}
**Modules affected:** {list}
**Shared file changes:** {list or "none"}

### Agents:
1. **Agent 1** — {module}: {what it will do}
   - Worktree: ../TehFrontier-wt1 (branch: wt1)
   - Write scope: {files}
2. **Agent 2** — {module}: {what it will do}
   - Worktree: ../TehFrontier-wt2 (branch: wt2)
   - Write scope: {files}

### Coordinator prep:
- [ ] {shared file change 1}
- [ ] {shared file change 2}

Proceed? (y/n)
```

Wait for user confirmation before proceeding.

## Step 3: Prepare Shared Files

If shared files need changes, edit them now on the current branch and commit:

```bash
git add {shared files}
git commit -m "coord: prepare shared files for {task}"
```

## Step 4: Spawn Background Agents

For each agent, create a worktree and spawn:

```bash
# Create worktree
git worktree add ../TehFrontier-wt{N} -b wt{N}
```

Then spawn each agent using the Agent tool with `run_in_background: true` and `isolation: "worktree"`. Use this prompt template:

```
## Working Directory
{worktree path}

## Your Domain: {Module Name}
You are scoped to the **{module}** domain. Focus your work here.

### Write scope (files you own and can modify):
{list from module registry}

### Context files (read these first):
- CLAUDE.md — project conventions
- {relevant reference files}

### Read scope (for reference only, do NOT modify):
- The entire project — read anything for understanding patterns

## Your Task
{detailed task description or full plan contents}

## Rules
- Work ONLY in your worktree directory
- Do NOT switch branches
- Stay within your write scope
- Do NOT modify these shared files (coordinator owns them):
  package.json, pnpm-lock.yaml, pnpm-workspace.yaml, turbo.json,
  biome.json, .npmrc, .env.example, .gitignore, scripts/*, docker/*, CLAUDE.md
- Read each file before editing
- Run `pnpm build` when done to verify
- Commit your work with a descriptive message
- Do NOT push
```

## Step 5: Report Status

After spawning agents, report:

```
## Agents Dispatched

| # | Module | Branch | Status |
|---|--------|--------|--------|
| 1 | {module} | wt1 | Running |
| 2 | {module} | wt2 | Running |

Shared files committed on {branch}.
Use `git worktree list` to see active worktrees.
```

## Step 6: Merge Results

When agents complete, merge one at a time:

```bash
# Review
git -C ../TehFrontier-wt1 log --oneline {base}..HEAD
git -C ../TehFrontier-wt1 diff {base} --stat

# Merge
git merge wt1
pnpm build  # verify

# If new dependencies were added
pnpm install

# Cleanup
git worktree remove ../TehFrontier-wt1
git branch -d wt1
```

Repeat for each worktree. Run build verification between each merge.
