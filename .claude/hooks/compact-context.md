# Critical Workflow Rules (Context Compaction Reminder)

You are working on the **TehFrontier** project. This information MUST be preserved across context compaction.

## Coordinator Pattern

- **NEVER assign the same file to multiple agents**
- The coordinator (main session) owns all shared files listed below
- Sub-agents work in git worktrees (`.claude/worktrees/agent-*`) with scoped file ownership
- Plans go through iterative refinement before implementation

## Shared Files — Coordinator-Owned (DO NOT modify from worktree branches)

- `package.json` (root), `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `turbo.json`, `biome.json`, `.npmrc`, `.env.example`, `.gitignore`
- `scripts/*`, `docker/*`, `CLAUDE.md`

## Module Registry

| Module | Write Scope |
|--------|-------------|
| web | `apps/web/` |
| api | `apps/api/` |
| periscope | `apps/periscope/` |
| gas-station | `apps/gas-station/` |
| permissions-dapp | `apps/permissions-dapp/` |
| ssu-market-dapp | `apps/ssu-market-dapp/` |
| shared | `packages/shared/` |
| chain-shared | `packages/chain-shared/` |
| sui-client | `packages/sui-client/` |
| db | `packages/db/` |
| tsconfig | `packages/tsconfig/` |
| contracts | `contracts/` |

## Key Commands

- `pnpm build` — Build all
- `pnpm lint` — Lint all
- `/coordinate [task]` — Dispatch work
- `/planfile [feature]` — Create/update plans (from docs/)

## Merge Process

1. Review: `git log --oneline main..worktree-branch`
2. Merge: `git merge worktree-branch && pnpm build`
3. Cleanup: `git worktree remove .claude/worktrees/agent-XXXX && git branch -d worktree-agent-XXXX`
