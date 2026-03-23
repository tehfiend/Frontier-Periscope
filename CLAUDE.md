# CLAUDE.md — Frontier Periscope

## Project Overview

EVE Frontier modding/building project for Cycle 5 (Sui testnet, Move smart contracts). Monorepo managed by Turborepo + pnpm.

## Tech Stack

- **Runtime:** Node.js 22+, pnpm 9.15.4
- **Build:** Turborepo
- **Lint/Format:** Biome (tabs, 100-char lines, double quotes, semicolons)
- **Blockchain:** Sui testnet, Move (edition 2024.beta)
- **SDK:** @mysten/sui ^1.45.2, @mysten/dapp-kit ^0.20.0

## Commands

```bash
pnpm build          # Build all packages/apps
pnpm dev            # Start all dev servers
pnpm lint           # Lint (biome check)
pnpm lint:fix       # Auto-fix lint issues
pnpm format         # Format all files
pnpm clean          # Clean all build artifacts
```

## Module Registry

| Module | Write Scope | Description |
|--------|-------------|-------------|
| periscope | `apps/periscope/` | Frontier Periscope intel tool (Vite + React SPA) |
| permissions-dapp | `apps/permissions-dapp/` | Permissions management dapp (Vite + React) |
| ssu-dapp | `apps/ssu-dapp/` | SSU inventory + transfer dapp (Vite + React) |
| ssu-market-dapp | `apps/ssu-market-dapp/` | SSU Market trading dapp (Vite + React) |
| shared | `packages/shared/` | Shared Zod validation schemas |
| chain-shared | `packages/chain-shared/` | Move contract types, addresses, turret generator |
| sui-client | `packages/sui-client/` | @mysten/sui gRPC wrapper |
| tsconfig | `packages/tsconfig/` | Shared TypeScript configs |
| contracts | `contracts/` | Move smart contracts (17 packages) |

## Shared Files (Coordinator-Owned)

These files are touched by multiple modules. **Only the coordinator agent edits them.** Sub-agents in worktrees must NOT modify these files:

- `package.json` (root)
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `turbo.json`
- `biome.json`
- `.npmrc`
- `.env.example`
- `.gitignore`
- `scripts/*` (deployment scripts)
- `docker/*` (Docker configs)
- `CLAUDE.md` (this file)

## Conventions

- **Indentation:** Tabs (biome enforced)
- **Quotes:** Double quotes (biome enforced)
- **Semicolons:** Always (biome enforced)
- **Line width:** 100 chars
- **Imports:** Auto-organized by biome
- **Package names:** `@tehfrontier/{name}`
- **Commit messages:** Concise, imperative mood, describe the "why"

## Workflow — Plan-First Coordinator Pattern

This project uses the **plan-first, coordinator-pattern** methodology:

1. **Plan first** — Non-trivial tasks start as plan documents in `docs/plans/`
2. **Coordinator owns shared files** — A single agent edits cross-module files
3. **Worktree agents for implementation** — Sub-agents work in isolated git worktrees with scoped file ownership
4. **Fresh context per pass** — Sub-agents get clean context windows to prevent token exhaustion

### Key Skills

- `/coordinate [task]` — Assess scope, dispatch background sub-agents
- `/worktree-implement [plan] [worktree]` — Implement a plan in a git worktree
- `/planfile [feature]` — Create/update plan files (run from `docs/` directory)
- `/plan-review` — Generate dashboard of pending plans (run from `docs/` directory)

### Cardinal Rule

> **Never assign the same file to multiple agents.**

The coordinator enforces this via the module registry above and the `protect-shared-files` hook.

## Plan Directory

```
docs/plans/
  active/      — ready for execution (no open questions)
  pending/     — has open questions or blockers
  archive/     — completed
  superseded/  — replaced by newer plan
  deferred/    — backlog
```
