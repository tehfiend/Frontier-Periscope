# Claude Code Multi-Agent Development Methodology

A complete guide to the plan-first, coordinator-pattern development workflow used in Maestro. This document describes the methodology, the supporting skills, hooks, and settings so that it can be replicated in other projects.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Architecture Overview](#architecture-overview)
3. [The Coordinator Pattern](#the-coordinator-pattern)
4. [The Planning Agent](#the-planning-agent)
5. [Skills Reference](#skills-reference)
6. [Hooks Reference](#hooks-reference)
7. [Settings Reference](#settings-reference)
8. [Directory Structure](#directory-structure)
9. [Adapting to a New Project](#adapting-to-a-new-project)

---

## Philosophy

Three core ideas drive the workflow:

1. **Plan first, implement later.** Every non-trivial task starts as a plan document. Plans go through autonomous refinement passes until they are execution-ready. Only then does implementation begin.

2. **Coordinator owns shared files.** A single agent (the coordinator) owns all files that multiple modules touch - schema, navigation, permissions, dependencies. Sub-agents work in isolated git worktrees with clearly scoped file ownership.

3. **Fresh context for each pass.** Sub-agents are spawned as independent processes with clean context windows. This prevents token exhaustion during iterative refinement or large implementation tasks.

---

## Architecture Overview

The system has three layers:

```
Developer
    |
    +-- Coordinator Agent (main project dir, branch: dev)
    |       |
    |       +-- Worktree Agent 1 (../project-wt1, branch: wt1)
    |       +-- Worktree Agent 2 (../project-wt2, branch: wt2)
    |       +-- Satellite Agent  (../other-project, its own branch)
    |
    +-- Planning Agent (project/docs/ dir, separate Claude Code instance)
            |
            +-- Research Sub-agent (pass 1: draft)
            +-- Review Sub-agent  (pass 2: refine)
            +-- Review Sub-agent  (pass 3: refine)
            +-- ...until NO_CHANGES
```

**Coordinator Agent** - The main Claude Code session. Assesses scope, edits shared files, creates worktrees, spawns implementation agents, merges results. Never does implementation work itself.

**Planning Agent** - A separate Claude Code session running from the `docs/` subdirectory. Creates and refines plan files using iterative sub-agent passes. Never modifies source code.

**Worktree Agents** - Background sub-agents spawned by the coordinator. Each works in a git worktree with a scoped set of files it owns. Commits on its branch, never pushes.

**Satellite Agents** - For multi-repo projects. Each satellite project gets its own agent in its own directory. No worktrees needed.

---

## The Coordinator Pattern

### When the developer requests work, the coordinator:

1. **Assesses scope** - Which modules? Which shared files? Single or multi-module?
2. **Proposes a dispatch plan** - How many agents, worktree vs satellite, what each owns
3. **Prepares shared files** - Edits schema, navigation, permissions, etc. on `dev` and commits
4. **Spawns background agents** - Each gets a detailed prompt with write scope, read scope, context files, and rules
5. **Merges results** - When agents complete, merges branches sequentially, runs build verification

### Execution Decision Matrix

| Scenario | Decision |
|----------|----------|
| Single module, few files | Direct work on `dev` |
| Single module, many files | One worktree agent |
| Multiple independent modules | Parallel worktree agents |
| Multiple modules + shared files | Coordinator edits shared files first, then parallel agents |
| Satellite project | Direct agent in satellite project dir |
| Research/planning | Delegate to planning agent |

### File Ownership - The Cardinal Rule

> **Never assign the same file to multiple agents.**

The coordinator enforces this by:
1. Maintaining a module registry that maps modules to their file boundaries
2. Pre-editing all shared files before spawning agents
3. Including explicit "do NOT modify" lists in each agent prompt
4. Using a pre-commit hook that blocks shared file edits on worktree branches

### Module Registry

Define a table mapping each module to the files it owns:

```
| Module   | Pages              | API Routes         | Components           | Library          |
|----------|--------------------|--------------------|----------------------|------------------|
| sales    | (app)/sales/       | api/sales/         | components/sales/    | lib/sales.ts     |
| models   | (app)/models/      | api/models/        | components/model/    | lib/model.ts     |
| ...      | ...                | ...                | ...                  | ...              |
```

### Shared Files (Coordinator-Owned)

Identify which files in your project are touched by multiple modules. Only the coordinator edits these. Common examples:

- Database schema definition
- Navigation/sidebar configuration
- Permission/role definitions
- Deployment scripts
- Package manifest (package.json, requirements.txt, etc.)
- Global layout components
- Middleware/routing configuration

### Worktree Agent Prompt Template

```
## Working Directory
/path/to/project-wt{N}

## Your Domain: {Module Name}
You are scoped to the **{module}** domain. Focus your work here.

### Write scope (files you own and can modify):
- src/app/(app)/{module}/ -- pages and components
- src/app/api/{module}/ -- API routes
- src/lib/{module}.ts -- module library (create if needed)
- src/components/{module}/ -- module components (create if needed)

### Context files (read these first to understand your domain):
- CLAUDE.md -- project conventions
- src/db/schema.ts -- database tables (READ ONLY, do not modify)
- src/app/(app)/other-module/page.tsx -- reference for page patterns
- src/app/api/other-module/route.ts -- reference for API patterns

### Read scope (for reference only, do NOT modify):
- The entire project -- read anything you need for understanding patterns,
  imports, shared types, and how other modules work

## Your Task
{detailed task description or full plan contents}

## Rules
- Work ONLY in your worktree directory
- Do NOT switch branches
- Stay within your write scope -- do NOT modify files outside your domain
- Do NOT modify these shared files (coordinator owns them):
  {list of shared files}
- Read each file before editing it
- Run build verification when done
- Commit your work with a descriptive message
- Do NOT push
```

### Merge Process

```bash
# Review agent's work
git -C ../project-wt1 log --oneline dev..HEAD
git -C ../project-wt1 diff dev --stat

# Merge
cd /path/to/project
git merge wt1 && npm run build  # (or your build command)

# If agent added dependencies
npm install  # (or pip install, cargo build, etc.)

# Cleanup
git worktree remove ../project-wt1 && git branch -d wt1
```

---

## The Planning Agent

A separate Claude Code instance runs from the `docs/` subdirectory. It has its own `CLAUDE.md` that restricts it to only creating/editing files in `docs/`. It never touches source code.

### Why a Separate Instance?

1. **Different permissions** - No build hooks, no lint hooks, no auto-migrate. Just file editing.
2. **Different role** - Research and writing, not implementation.
3. **Clean separation** - The coordinator session keeps its context for implementation work. Plan work doesn't pollute it.

### Plan Directory Convention

```
docs/plans/
  pending/     -- has open questions or blockers (not ready for execution)
  active/      -- no open questions, ready for execution
  archive/     -- all phases complete
  superseded/  -- replaced by a newer plan
  deferred/    -- backlog items
```

### Plan Template

```markdown
# Plan: {Title}
**Status:** Draft
**Created:** YYYY-MM-DD
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
   - **Option A: {choice}** -- Pros: {benefits}. Cons: {drawbacks}.
   - **Option B: {choice}** -- Pros: {benefits}. Cons: {drawbacks}.
   - **Recommendation:** {which option and why}

## Deferred
- {item} -- {reason}
```

### Iterative Refinement Loop

The `/planfile` skill uses a loop pattern:

1. **Pass 1** (the planning agent itself): Research the codebase, draft the plan (or update status for existing plans), commit.
2. **Pass 2+** (fresh sub-agents): Each pass spawns a new sub-agent with a clean context window. The sub-agent reviews the plan against the codebase, fixes issues, and outputs either `CHANGES: {list}` or `NO_CHANGES`.
3. **Loop exits** when a sub-agent returns `NO_CHANGES`.
4. **Final sort**: Move the plan to `pending/` (has open questions) or `active/` (ready for execution).

The key insight is that **each review pass gets a fresh sub-agent**. This prevents token exhaustion and gives each pass full context capacity for deep codebase research.

### Planning Agent CLAUDE.md

```markdown
# CLAUDE.md - Planning Agent

You are the **planning agent** for {Project}. You create, review, and refine
implementation plans. You NEVER modify source code.

## Role
- Create and update plan files in `plans/` (relative to this directory)
- Research the codebase to inform plans (read-only)
- Never touch files outside `docs/` except to read them
- Never modify source code files

## What You Can Do
- Read ANY file in the project (for research)
- Create/edit files in `docs/` only
- Run git commands (status, log, diff, add, commit)
- Spawn sub-agents for plan research/refinement

## What You Cannot Do
- Edit source code
- Run build/test/lint commands
- Modify package manifests or config files
- Push to remote
```

---

## Skills Reference

Skills are Claude Code slash commands defined in `.claude/skills/{name}/SKILL.md`. They provide structured workflows that the agent follows when invoked.

### /coordinate

**Location:** `.claude/skills/coordinate/SKILL.md`
**Used by:** Coordinator agent (main project dir)
**Purpose:** Assess work scope and dispatch background sub-agents. Never does implementation work itself.

**Frontmatter:**
```yaml
---
name: coordinate
description: Assess work scope and dispatch to background sub-agents.
argument-hint: "[task description or plan file path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Task, Write, Edit, AskUserQuestion
---
```

**Workflow:**
1. Assess scope - identify affected modules and shared files
2. Propose dispatch plan - present strategy to user for confirmation
3. Prepare shared files (if needed) - edit on `dev`, commit
4. Spawn background agents - one per module/worktree
5. Report agent IDs and status
6. Handle merges when agents complete

**Key design points:**
- `disable-model-invocation: true` prevents the skill from being auto-triggered
- `allowed-tools` restricts what the coordinator can do (no Agent tool = uses Task tool for spawning)
- All agents use `run_in_background: true` so the developer can keep working
- Includes the full module registry and shared file list inline

### /planfile

**Location:** `docs/.claude/skills/planfile/SKILL.md`
**Used by:** Planning agent (docs/ dir)
**Purpose:** Create or update plan files with autonomous iterative refinement.

**Frontmatter:**
```yaml
---
name: planfile
description: Create or update plan files. Spawns an autonomous research agent that iteratively refines the plan.
argument-hint: "[module name, feature name, or plan file path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Agent, Edit, Write, AskUserQuestion
---
```

**Workflow:**
1. Resolve plan file - fuzzy-match input against existing plans or create new
2. Spawn background agent immediately (no confirmation needed)
3. Agent does pass 1 (research + draft or status update)
4. Agent spawns fresh sub-agents for pass 2+ until NO_CHANGES
5. Final sort to correct folder
6. Log dispatch to `dispatch-log.md`

**Key design points:**
- Spawns immediately without asking - invoking `/planfile` IS the go-ahead
- Each review pass uses a fresh sub-agent to avoid token exhaustion
- Sub-agents are spawned with `run_in_background: false` (synchronous within the loop)
- The outer agent is `run_in_background: true` (async from the user's perspective)
- Includes separate prompt templates for CREATE vs UPDATE scenarios

### /worktree-implement

**Location:** `.claude/skills/worktree-implement/SKILL.md`
**Used by:** Coordinator agent
**Purpose:** Implement a plan by spawning a sub-agent in a git worktree.

**Frontmatter:**
```yaml
---
name: worktree-implement
description: Implement a plan in a git worktree via a sub-agent.
argument-hint: "[plan-file-path] [worktree-path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, Task
---
```

**Workflow:**
1. Read the plan file
2. Select or create a worktree
3. Sync worktree with latest dev
4. Spawn implementation agent with full plan contents pasted into the prompt
5. Report agent ID for monitoring

**Key design point:** Always paste plan contents directly into the agent prompt - don't rely on the agent reading the file. This ensures the agent has all context from the start.

### /plan-review

**Location:** `docs/.claude/skills/plan-review/SKILL.md`
**Used by:** Planning agent
**Purpose:** Generate an HTML dashboard of all pending plans.

**Output:** `plans/pending-review.html` - Self-contained HTML with plan titles, modules, phase counts, open question counts. Plans with 0 open questions are highlighted as ready to move to active.

---

## Hooks Reference

Hooks are shell scripts that run automatically in response to Claude Code tool events. They enforce constraints and automate repetitive tasks.

### Hook Configuration (settings.json)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-shared-files.sh",
          "timeout": 5
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/changelog-reminder.sh",
          "timeout": 10
        }]
      },
      {
        "matcher": "Bash(git commit|git push)",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/verify-build.sh",
            "timeout": 300,
            "statusMessage": "Verifying build..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/auto-migrate.sh",
            "timeout": 60,
            "statusMessage": "Running auto-migrate..."
          },
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/lint-on-edit.sh",
            "timeout": 30,
            "statusMessage": "Linting..."
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/log-command.sh",
          "timeout": 5,
          "async": true
        }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [{
          "type": "command",
          "command": "cat \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/compact-context.md"
        }]
      }
    ]
  }
}
```

### protect-shared-files.sh (PreToolUse: Edit|Write)

Blocks agents on worktree branches from editing coordinator-owned files. Allows edits on `dev` and `main` (where the coordinator operates).

```bash
#!/usr/bin/env bash
# PreToolUse hook: Block edits to coordinator-owned files in worktree branches
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[ -z "$FILE_PATH" ] && exit 0

# Skip files outside the project directory
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -n "$PROJECT_DIR" ] && [ -n "$FILE_PATH" ]; then
  case "$FILE_PATH" in
    "$PROJECT_DIR"/*) ;;
    *) exit 0 ;;
  esac
fi

BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Allow edits on dev and main
case "$BRANCH" in
  dev|main|"") exit 0 ;;
esac

# Normalize path
FILE_PATH="${FILE_PATH#"${CLAUDE_PROJECT_DIR:-}"/}"
FILE_PATH="${FILE_PATH#./}"

# Protected coordinator-owned files -- CUSTOMIZE THIS LIST
PROTECTED_FILES=(
  "src/db/schema.ts"
  "src/lib/navigation.ts"
  "src/lib/default-permissions.ts"
  "scripts/migrate-prod.mjs"
  "package.json"
)

for PROTECTED in "${PROTECTED_FILES[@]}"; do
  if [ "$FILE_PATH" = "$PROTECTED" ]; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Cannot edit coordinator-owned file '$PROTECTED' from worktree branch '$BRANCH'. Request this change from the coordinator on dev."
  }
}
EOF
    exit 0
  fi
done

exit 0
```

### verify-build.sh (PreToolUse: git commit|git push)

Blocks commits and pushes if the build is broken. Skips if only docs/plan files changed.

```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)

cd "$CLAUDE_PROJECT_DIR"

# Skip if only docs files changed
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null || true)
ALL_FILES=$(printf "%s\n%s" "$CHANGED_FILES" "$UNTRACKED" | grep -E '\.(ts|tsx)$' || true)
[ -z "$ALL_FILES" ] && exit 0

echo "Verifying build..."
if ! npm run build 2>&1; then
  echo "BUILD FAILED - fix errors before committing."
  exit 2
fi

echo "Build verified successfully."
exit 0
```

### auto-migrate.sh (PostToolUse: Edit|Write)

Automatically runs migration generation and application when the schema file is edited. Adapt the trigger path and commands for your ORM.

```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

[ -z "$FILE_PATH" ] && exit 0
case "$FILE_PATH" in
  */src/db/schema.ts|src/db/schema.ts) ;;
  *) exit 0 ;;
esac

# Generate migration
GEN_OUTPUT=$(cd "$CLAUDE_PROJECT_DIR" && npm run db:generate 2>&1) || {
  # Report failure via hook output
  exit 0
}

# Apply migration
MIG_OUTPUT=$(cd "$CLAUDE_PROJECT_DIR" && npm run db:migrate 2>&1) || {
  # Report failure via hook output
  exit 0
}

# Report success via hook output JSON
```

### lint-on-edit.sh (PostToolUse: Edit|Write)

Runs the linter on any edited source file and reports errors via hook output.

### changelog-reminder.sh (PreToolUse: Bash)

Blocks `git push` if source code changed in unpushed commits but no changelog entry was added. Skips docs-only changes.

### log-command.sh (PostToolUse: Bash, async)

Asynchronously logs all Bash commands to `.claude/command-log.jsonl` with timestamps and session IDs. Useful for auditing agent activity.

### compact-context.md (SessionStart: compact)

Injected when Claude Code compresses conversation context. Contains critical workflow rules that must survive compaction (coordinator-owned files list, key patterns, workflow constraints).

---

## Settings Reference

### Project Settings (.claude/settings.json)

Contains hook definitions (see Hooks Reference above). This file is checked into version control and applies to all agents working on the project.

### Local Settings (.claude/settings.local.json)

Contains permission allowlists for commonly used tools. Not checked into version control.

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run build:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git checkout:*)",
      "Bash(git merge:*)",
      "Bash(git stash:*)",
      "Bash(git pull:*)"
    ]
  }
}
```

### Planning Agent Settings (docs/.claude/settings.json)

Empty hooks - the planning agent has no build/lint/migrate automation:

```json
{
  "hooks": {}
}
```

---

## Directory Structure

```
project/
  .claude/
    settings.json           -- hook definitions (checked in)
    settings.local.json     -- permission allowlists (gitignored)
    command-log.jsonl       -- async command log (gitignored)
    hooks/
      protect-shared-files.sh
      verify-build.sh
      auto-migrate.sh
      lint-on-edit.sh
      changelog-reminder.sh
      log-command.sh
      compact-context.md
    skills/
      coordinate/
        SKILL.md            -- /coordinate dispatcher skill
      worktree-implement/
        SKILL.md            -- /worktree-implement skill
    worktrees/              -- worktree metadata (gitignored)
  docs/
    .claude/
      settings.json         -- empty hooks for planning agent
      skills/
        planfile/
          SKILL.md          -- /planfile skill
        plan-review/
          SKILL.md          -- /plan-review dashboard skill
    plans/
      active/               -- plans ready for execution
      pending/              -- plans with open questions
      archive/              -- completed plans
      superseded/           -- replaced plans
      deferred/             -- backlog items
    dispatch-log.md         -- agent dispatch history
  CLAUDE.md                 -- root project instructions
```

---

## Adapting to a New Project

### Step 1: Define Your Modules and Shared Files

Create a module registry that maps your project's modules to the files they own. Identify which files are shared across modules - these become coordinator-owned.

### Step 2: Create CLAUDE.md Files

- **Root CLAUDE.md** - Project overview, tech stack, key patterns, commands, module registry, commit conventions. This is loaded into every agent's context.
- **docs/CLAUDE.md** - Planning agent constraints (read-only access to source, write-only to docs/).

### Step 3: Set Up Skills

Copy and adapt the skill files:

1. **`/coordinate`** - Update the module registry, shared file list, worktree path conventions, and satellite project list.
2. **`/planfile`** - Update the working directory path, plan template, and any project-specific commit conventions (e.g., PATH fix for pre-commit hooks).
3. **`/worktree-implement`** - Update worktree path conventions.
4. **`/plan-review`** - Minimal changes needed.

### Step 4: Set Up Hooks

Copy and adapt the hook scripts:

1. **`protect-shared-files.sh`** - Update the `PROTECTED_FILES` array with your shared files.
2. **`verify-build.sh`** - Update the build command and file extension filters.
3. **`auto-migrate.sh`** - Update the schema file path and migration commands for your ORM.
4. **`lint-on-edit.sh`** - Update the lint command and file extensions.
5. **`compact-context.md`** - Summarize the critical workflow rules for your project.

Optional hooks:
- **`changelog-reminder.sh`** - Only if your project uses changelogs.
- **`log-command.sh`** - Always useful for auditing.
- **`auto-seed.sh`** - Only if your project has seed files.

### Step 5: Configure Settings

- **`.claude/settings.json`** - Wire up hooks with appropriate matchers and timeouts.
- **`.claude/settings.local.json`** - Add permission allowlists for common operations.
- **`docs/.claude/settings.json`** - Empty hooks for the planning agent.

### Step 6: Create Plan Directories

```bash
mkdir -p docs/plans/{active,pending,archive,superseded,deferred}
touch docs/dispatch-log.md
```

### Step 7: Test the Workflow

1. Open Claude Code in `docs/` and run `/planfile {feature-name}` to test plan creation
2. Open Claude Code in the project root and run `/coordinate {task}` to test dispatch
3. Verify hooks fire correctly (shared file protection, build verification, auto-migration)

### Key Principles to Preserve

- **File ownership is non-negotiable.** Every file has exactly one owner. Shared files belong to the coordinator.
- **Plans are execution-ready.** A plan in `active/` should contain enough detail for an agent to implement without further research.
- **Fresh context per pass.** Review passes spawn new sub-agents. Never let a single agent exhaust its context on iterative refinement.
- **Background by default.** Implementation agents run in the background. The developer keeps working.
- **Merge sequentially.** Even if agents run in parallel, merge one at a time with build verification between each.
