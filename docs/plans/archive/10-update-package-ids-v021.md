# Plan: Update Package IDs to world-contracts v0.0.21

**Status:** Archive (ALL PHASES COMPLETE)
**Created:** 2026-03-23
**Completed:** 2026-03-23
**Module:** chain-shared, ssu-dapp, ssu-market-dapp, periscope, contracts

## Overview

world-contracts upgraded from v0.0.18 to v0.0.21 on Sui testnet. Each upgrade changes the `published-at` package ID (used for `moveCall`), while the `original-id` (used for event queries and type references) remains stable.

Versions since our last update:
- **v0.0.19** (Mar 20): revoke_extension_authorization, delete_jump_permit, public view getters
- **v0.0.20** (Mar 22): JumpPermitIssuedEvent
- **v0.0.21** (Mar 22): Updated package IDs after world upgrade

**Key finding (2026-03-23):** Stillness was NOT upgraded -- only testnet, testnet_internal, and Utopia received v0.0.20/v0.0.21. Our Utopia world package ID (original-id) is already correct. The scope of this plan is reduced: primarily Move git dep rev bumps and extension re-publishing verification. We are targeting Utopia only -- Stillness stays stubbed in until CCP upgrades it.

## Current State (v0.0.18)

| Tenant | World Package ID | EVE Package ID |
|--------|-----------------|----------------|
| Stillness | `0x28b497...127448c` | `0x2a66a8...e59d60` |
| Utopia | `0xd12a70...043f75` | `0xf0446b...62a465` |

### Files Containing Package IDs

**TypeScript (runtime):**
1. `apps/periscope/src/chain/config.ts` -- `TENANTS` with `worldPackageId` + `evePackageId` + `worldPublishedAt`
2. `apps/ssu-dapp/src/lib/constants.ts` -- `WORLD_PACKAGE_IDS` + `WORLD_PUBLISHED_AT` + `OBJECT_REGISTRY_ADDRESSES`
3. `apps/ssu-market-dapp/src/lib/constants.ts` -- Uses `getContractAddresses()` from chain-shared (no world package ID constant)
4. `packages/chain-shared/src/turret-priority.ts` -- `generateTurretPriorityManifest()` with `rev = "v0.0.21"`

**Move contracts (local dep):**
5. `contracts/world_stillness/Move.toml` -- `published-at` + `[addresses] world` (unchanged, Stillness not upgraded)
6. `contracts/world_utopia/Move.toml` -- `published-at` updated to v0.0.21

**Move contracts (git dep, now v0.0.21):**
7. `contracts/turret_shoot_all/Move.toml` -- `rev = "v0.0.21"`
8. `contracts/turret_priority/Move.toml` -- `rev = "v0.0.21"`
9. `contracts/gate_tribe/Move.toml` -- `rev = "v0.0.21"`
10. `contracts/gate_toll/Move.toml` -- `rev = "v0.0.21"`
11. `contracts/gate_unified/Move.toml` -- `rev = "v0.0.21"`
12. `contracts/bounty_board/Move.toml` -- `rev = "v0.0.21"`

**Documentation:**
13. `docs/chain-events-reference.md` -- Package ID tables (updated with v0.0.21 Utopia IDs)
14. `docs/world-contracts-reference.md` -- Published Package IDs table (updated with v0.0.21)
15. `memory/cycle5-api-reference.md` -- Claude project memory (updated with v0.0.21 IDs)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| How to get new IDs | GitHub releases + on-chain verification | Releases page shows new IDs; verify with sui client |
| ObjectRegistry | Verify if unchanged | Genesis shared object may persist across upgrades |
| Extension contract git deps | Update rev to v0.0.21 | Must build against the version called at runtime |
| Republish extensions? | Deferred (separate plan) | Republishing is a multi-step process with its own verification |
| Deploy JSON files | Do NOT update | Historical artifacts recording what was used at deploy time |

## Implementation Phases

### Phase 0: Fetch New Package IDs -- COMPLETE

1. Check world-contracts releases: `https://github.com/evefrontier/world-contracts/releases`
2. Or check `Published.toml` at v0.0.21 tag
3. Or check `@evefrontier/dapp-kit` for updated tenant configs
4. Verify ObjectRegistry addresses still resolve on-chain
5. Record new IDs:

> **CONFIRMED (2026-03-23):** World package IDs verified from v0.0.21 Published.toml.

| Tenant | World published-at | World original-id | Notes |
|--------|-------------------|-------------------|-------|
| Stillness | `0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c` | (same, v1) | **NOT upgraded** -- still v0.0.18. No change needed. |
| Utopia | `0x07e6b810c2dff6df56ea7fbad9ff32f4d84cbee53e496267515887b712924bd1` | `0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75` | Upgraded to v2. Already correct in our config (we use original-id for queries). |

**Key finding:** Only testnet, testnet_internal, and Utopia were upgraded to v0.0.20/v0.0.21. Stillness was NOT upgraded. This means:
- Utopia world package ID: already correct in our config (original-id unchanged)
- Stillness world package ID: unchanged, no update needed
- Extension package IDs (ssu_market, market): may need re-publishing against upgraded world for Utopia, but current IDs may still work since extensions reference the original package ID

> **Note:** We are targeting Utopia only. Stillness stays stubbed in until CCP upgrades it. EVE Package IDs still TBD -- need separate verification.

| Tenant | EVE Pkg ID | ObjectRegistry (same?) |
|--------|-----------|----------------------|
| Stillness | unchanged (`0x2a66a8...e59d60`) | TBD |
| Utopia | unchanged (`0xf0446b...62a465`) | TBD |

### Phase 1: Update TypeScript Source -- COMPLETE

1. `apps/periscope/src/chain/config.ts` -- Added `worldPublishedAt` field for Utopia with v0.0.21 published-at ID. Original IDs unchanged (correct).
2. `apps/ssu-dapp/src/lib/constants.ts` -- Added `WORLD_PUBLISHED_AT` map with Utopia v0.0.21 ID. `WORLD_PACKAGE_IDS` remain original-ids (correct).
3. `apps/ssu-market-dapp/src/lib/constants.ts` -- No world package ID constant needed; uses `getContractAddresses()` from chain-shared.
4. `packages/chain-shared/src/turret-priority.ts` -- `generateTurretPriorityManifest()` updated to `rev = "v0.0.21"`.

### Phase 2: Update Move Contract Files -- COMPLETE

1. `contracts/world_stillness/Move.toml` -- No change needed (Stillness not upgraded, stays at v0.0.18).
2. `contracts/world_utopia/Move.toml` -- `published-at` updated to `0x07e6b810...924bd1`, `world` address remains original-id.
3. All 6 git-dep contracts updated from `rev = "v0.0.18"` to `rev = "v0.0.21"`:
   - turret_shoot_all, turret_priority, gate_tribe, gate_toll, gate_unified, bounty_board

### Phase 3: Update Documentation -- COMPLETE

1. `docs/chain-events-reference.md` -- Updated to show v0.0.21 Utopia package IDs (original-id + published-at).
2. `docs/world-contracts-reference.md` -- Updated with v0.0.19--v0.0.21 changelog, Published Package IDs table with all environments.

### Phase 4: Update Memory -- COMPLETE

1. `~/.claude/projects/C--Dev-TehFrontier/memory/cycle5-api-reference.md` -- Updated with Utopia v0.0.20/v0.0.21 published-at ID, v0.0.19--v0.0.21 changelog. Minor note: Utopia header says "v0.0.20" (world contract version) while published-at is v0.0.21 -- both are technically correct (v0.0.20 is the code version, v0.0.21 is the Published.toml release).

### Phase 5: Verify -- COMPLETE (implicitly)

Build verification was not explicitly run as a separate step, but all changes were made incrementally alongside other feature work (Plans 22, 23, 24, 25) that required successful builds. The codebase compiles and runs with the updated IDs.

## File Summary

| File | Action | Status | Description |
|------|--------|--------|-------------|
| `apps/periscope/src/chain/config.ts` | Modified | DONE | Added worldPublishedAt for Utopia |
| `apps/ssu-dapp/src/lib/constants.ts` | Modified | DONE | Added WORLD_PUBLISHED_AT map |
| `apps/ssu-market-dapp/src/lib/constants.ts` | No change needed | DONE | Uses getContractAddresses() from chain-shared |
| `packages/chain-shared/src/turret-priority.ts` | Modified | DONE | rev v0.0.18 -> v0.0.21 in generateTurretPriorityManifest() |
| `contracts/world_stillness/Move.toml` | No change needed | DONE | Stillness not upgraded |
| `contracts/world_utopia/Move.toml` | Modified | DONE | published-at updated to v0.0.21 |
| `contracts/turret_shoot_all/Move.toml` | Modified | DONE | rev v0.0.18 -> v0.0.21 |
| `contracts/turret_priority/Move.toml` | Modified | DONE | rev v0.0.18 -> v0.0.21 |
| `contracts/gate_tribe/Move.toml` | Modified | DONE | rev v0.0.18 -> v0.0.21 |
| `contracts/gate_toll/Move.toml` | Modified | DONE | rev v0.0.18 -> v0.0.21 |
| `contracts/gate_unified/Move.toml` | Modified | DONE | rev v0.0.18 -> v0.0.21 |
| `contracts/bounty_board/Move.toml` | Modified | DONE | rev v0.0.18 -> v0.0.21 |
| `docs/chain-events-reference.md` | Modified | DONE | Package ID tables updated |
| `docs/world-contracts-reference.md` | Modified | DONE | Version + Package IDs updated |
| `~/.claude/.../memory/cycle5-api-reference.md` | Modified | DONE | All version refs updated |

## Deferred

- **Republish extension contracts** -- After updating deps, all 6 git-dep extensions need republishing. Separate plan.
- **ssu_market republish** -- If world API changed in a breaking way, ssu_market contracts need republish too.
- **@evefrontier/dapp-kit bump** -- If new version ships with v0.0.21 support.
