# Plan: Structure Extensions Overhaul
**Status:** Active (revised 2026-03-25)
**Created:** 2026-03-24
**Module:** chain-shared, periscope

## Overview

The current extension system offers many different extension options per structure type -- gates have tribe gate, ACL gate, toll gate, unified gate, and gate standings; SSUs have ssu_market and ssu_standings; turrets have shoot-all and turret-priority. Each is a separate on-chain contract, separate TX builder in chain-shared, separate template in the config, and separate UI flow. This creates cognitive overhead for users (which extension do I pick?) and maintenance burden (duplicate code, many packages).

The overhaul simplifies this to a single standings-based extension per structure type. All access control, toll configuration, and market connectivity is driven by one StandingsRegistry per structure. A single configuration dApp replaces the current multi-template selection workflow.

The key insight: the StandingsRegistry already exists and supports standing values 0-6 (displayed as -3 to +3). By tying all extension behavior to standing thresholds on a single registry, the user configures one registry and all their structures reference it. This also means a single extension contract per structure type, drastically reducing the number of on-chain packages.

## Current State

### On-Chain Contracts (packages/chain-shared/)

**Gate extensions** -- 5 separate options:
- `gate-toll.ts` -- Toll gate with free-tribes/free-characters lists. Uses shared `GateTollConfig` with per-gate dynamic fields. Contract: `gateToll` in config.
- `gate-standings.ts` -- Standings-based gate with minAccess/freeAccess thresholds, toll, permit duration. Uses shared `GateStandingsConfig`. Contract: `gateStandings` in config.
- `acl-registry.ts` -- Shared ACL objects (allowlist/denylist by tribe/character). Referenced by gate_acl extension.
- Gate ACL template (`gate_acl`) and Gate Tribe template (`gate_tribe`) in `apps/periscope/src/chain/config.ts`.
- Gate Unified template (`gate_unified`) -- group-based access with optional toll.

**SSU extensions** -- 3 chain-shared modules across 2 app-side templates:
- `ssu-market.ts` -- SsuConfig with owner/delegates, optional Market<T> link, visibility. Escrow, listing, buying functions. Contract: `ssuMarket` in config.
- `ssu-market-standings.ts` -- Near-identical to ssu-market.ts but adds `registryId` to standings-gated trade functions. Contract: `ssuMarketStandings` in config.
- `ssu-standings.ts` -- Separate SSU standings config for deposit/withdraw thresholds. Contract: `ssuStandings` in config.

**Turret extensions** -- 2 separate options:
- `turret-priority.ts` -- Move source code generator for custom turret priority (friend/foe lists, weights). Compiled and published per user. Contract: `turretPriority` in config.
- Turret Shoot-All template (`turret_shoot_all`) -- targets everyone equally.

**Standings infrastructure** (already exists, reused):
- `standings-registry.ts` -- StandingsRegistry CRUD, standing values 0-6, tribe/character entries, batch operations, admin management.
- `standings.ts` -- Encrypted standings lists (legacy, pre-registry).

### App-Side Extension System

- `apps/periscope/src/chain/config.ts` -- `EXTENSION_TEMPLATES` array with 10 templates (3 active standings-based + 7 deprecated legacy), `getTemplatesForAssemblyType()`, `classifyExtension()`, `ExtensionTemplate` type.
- `apps/periscope/src/chain/transactions.ts` -- `buildAuthorizeExtension()` (generic PTB for any template), `buildConfigureTribeGate()`, `buildRemoveExtension()`, `buildConfigureGateStandings()`, `buildConfigureSsuStandings()`, `buildGenerateTurretFromRegistry()` (stub).
- `apps/periscope/src/components/extensions/DeployExtensionPanel.tsx` -- Template selection UI, deploy flow, standings panel integration.
- `apps/periscope/src/components/extensions/ConfigForm.tsx` -- Only handles `gate_tribe` template config (stubs for standings types).
- `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` -- Standings-based config UI (exists).
- `apps/periscope/src/components/extensions/RegistrySelector.tsx` -- Registry picker (exists).
- `apps/periscope/src/components/extensions/LegacyExtensionBanner.tsx` -- Legacy migration banner (to be deleted).
- `apps/periscope/src/components/extensions/TemplateCard.tsx` -- Template display card with deprecated badge.
- `apps/periscope/src/hooks/useExtensionDeploy.ts` -- Deploy hook with status tracking, writes to `db.extensions` and `db.structureExtensionConfigs`.
- `apps/periscope/src/hooks/useExtensionRevoke.ts` -- Revoke extension hook.
- `apps/periscope/src/hooks/useStructureExtensions.ts` -- Extension config fetch/cache hook (exists).
- `apps/periscope/src/db/types.ts` -- `ExtensionRecord`, `StructureExtensionConfig`, plus deprecated ACL types still present.
- `apps/periscope/src/db/index.ts` -- Schema v29: `structureExtensionConfigs` added, permission tables dropped.
- `apps/periscope/src/views/Deployables.tsx` -- Structure list with extension status display, deploy panel trigger.
- `apps/periscope/src/views/Permissions.tsx` -- Already deleted.
- `apps/periscope/src/components/permissions/` -- Already deleted (13 components).
- `apps/periscope/src/hooks/usePermissionSync.ts`, `usePermissionGroups.ts`, `useAssemblyPolicies.ts`, `useBetrayalResponse.ts` -- Already deleted.
- `apps/periscope/src/chain/permissions.ts` -- Already deleted.

### Contract Addresses (config.ts)

`ContractAddresses` in `packages/chain-shared/src/types.ts` includes: `gateUnified`, `turretShootAll`, `turretPriority`, `gateAcl`, `gateTribe`, `gateToll`, `ssuMarket`, `gateStandings`, `ssuStandings`, `ssuMarketStandings`, `standingsRegistry`, and more -- 15+ extension-related entries.

## Target State

### Single Extension Per Structure Type

**Gate Standings Extension** (replaces gate_toll, gate_acl, gate_tribe, gate_unified):
- One shared `GateStandingsConfig` object with per-gate dynamic fields.
- Each gate references a StandingsRegistry by ID.
- Config per gate: `registryId`, `minAccess` (standing threshold to pass), `freeAccess` (standing threshold for free passage), `tollFee` (string-serialized bigint, "0" = no toll), `tollRecipient`, `permitDurationMs`.
- Characters with standing >= `freeAccess` pass for free. Characters with standing >= `minAccess` but < `freeAccess` pay the toll. Characters below `minAccess` are blocked.
- This already exists as `gate-standings.ts` -- it becomes THE gate extension.

**SSU Standings Extension** (replaces ssu_market + ssu_standings + ssu_market_standings):
- One contract combining SsuConfig (owner, delegates, market link, visibility) + standings thresholds (minDeposit, minWithdraw) + optional Market connection.
- References a StandingsRegistry for access control.
- Config per SSU: `registryId`, `minDeposit` (standing to deposit items), `minWithdraw` (standing to withdraw from ownercap/escrow), `marketId` (optional Market<T> link for market orders), `delegates` (wallet addresses that can manage).
- People with high enough standing can access owner and escrow storage.
- Can connect to a standings-based Market for market orders.

**Turret Standings Extension** (replaces turret_shoot_all, turret_priority):
- Derives friend/foe lists from a StandingsRegistry at **publish time** (baked into Move constants). The turret interface (`get_target_priority_list`) does not accept additional objects, so runtime registry reads are impossible.
- Standing determines targeting behavior:
  - High standing (friendly/ally) -> weight 0 (don't shoot)
  - Low standing (hostile/opposition) -> high weight (shoot first)
  - Middle standing (neutral) -> default weight
- Betrayal bonus: friendly who attacks gets maximum priority.
- Config (derived from registry at generation time): `registryId` (source of truth), weight mappings per standing level, aggressor bonus, low-HP bonus, class bonus.
- When registry standings change, the UI prompts "Turret config out of sync" and offers to regenerate and republish. This is the same pattern as `turret-priority.ts` but with registry as the data source instead of manual friend/foe lists.

### Unified Configuration dApp

A single view/page in Periscope (replacing the multi-template deploy panel) that:
1. Lets the user select/create a StandingsRegistry.
2. Shows all owned structures grouped by type.
3. For each structure, configures its standings extension (gate thresholds, SSU access levels, turret weights).
4. One-click "apply registry to all" for quick setup.

### New Data Model

The `EXTENSION_TEMPLATES` array shrinks from 10 entries to 3 (old templates deleted, not deprecated):
- `gate_standings` -- for all gates
- `ssu_unified` -- for all SSUs (combined market + standings)
- `turret_standings` -- for all turrets

The `ContractAddresses` type keeps the standings entries and adds the unified SSU entry:
- `gateStandings` (already exists, becomes the sole gate extension)
- `ssuUnified` (new entry for the combined SSU standings + market contract; old entries like `ssuStandings` and `ssuMarketStandings` deleted)
- No `turretStandings` needed -- turrets use per-user published packages (same as current `turretPriority`)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Single registry per owner vs. per structure | Single registry per owner, referenced by multiple structures | Less management overhead. Owner sets standings once, all structures follow. Structures can still reference different registries if needed. |
| Turret standings approach | Generate turret source from registry standings at publish time | The turret interface is fixed (`Turret, Character, candidate_list, receipt`) -- no way to pass a StandingsRegistry. Reuse existing turret_priority generator but derive friend/foe lists from registry standings instead of manual input. Republish when standings change. |
| Single dApp implementation | Enhanced slide-over panel from Deployables view | Keep current DeployExtensionPanel pattern but with richer standings config. Contextual to the selected structure. Batch configure via modal dialog. |
| SSU combined contract | New on-chain package (ssu_unified) | Fresh contract combining all SSU functionality (standings + market). Clean design. |
| Config persistence | Use existing `db.extensions` table + new `db.structureExtensionConfigs` | ExtensionRecord stays for deployment tracking. New table for per-structure standings config cache. |
| Old extension code | Delete entirely | No users, hackathon project. Old templates, ACL system, Permissions view, and all related code are deleted outright -- no deprecation annotations or migration paths. |

## Implementation Phases

### Phase 1: Contract Layer Cleanup (chain-shared) -- DONE

All chain-shared work is already implemented.

- `gate-standings.ts` -- `queryGateStandingsConfig()` exists
- `ssu-unified.ts` -- all TX builders exist (`buildCreateSsuUnifiedConfig`, `buildSetSsuUnifiedConfig`, `buildSetSsuMarketLink`, `buildAddSsuDelegate`, `buildRemoveSsuDelegate`, `buildSetSsuVisibility`, `buildUnifiedDepositWithStandings`, `buildUnifiedWithdrawWithStandings`, `buildEscrowAndListWithStandings`, `buildBuyFromListingWithStandings`, `querySsuUnifiedConfig`, `discoverSsuUnifiedConfig`)
- `turret-standings.ts` -- `generateTurretFromRegistry()` exists, maps standings to friend/foe lists via `generateTurretPrioritySource()` and `generateTurretPriorityManifest()`
- `types.ts` -- `ssuUnified` in `ContractAddresses`, `SsuUnifiedConfigInfo`, `TurretStandingsConfig` all present
- `index.ts` -- exports `ssu-unified` and `turret-standings`

### Phase 2: App Config and Template Consolidation -- MOSTLY DONE

Remaining work marked with **TODO**.

1. `apps/periscope/src/chain/config.ts` -- DONE:
   - 3 active standings templates exist (`gate_standings`, `ssu_unified`, `turret_standings`)
   - 7 deprecated templates exist with `deprecated: true` flag
   - `getTemplatesForAssemblyType()` filters deprecated by default
   - `classifyExtension()` recognizes standings types
   - **TODO:** Delete the 7 deprecated templates entirely instead of keeping them. Remove `deprecated` field from `ExtensionTemplate` interface. Remove `LEGACY_TEMPLATE_IDS`, `getLegacyMigrationInfo()`, and legacy classification from `classifyExtension()`.
2. `apps/periscope/src/components/extensions/TemplateCard.tsx` -- DONE but **TODO:** Remove deprecated badge logic (no deprecated templates to display).
3. `apps/periscope/src/chain/transactions.ts` -- MOSTLY DONE:
   - `buildAuthorizeExtension()` handles `ssu_unified`
   - `buildConfigureGateStandings()` and `buildConfigureSsuStandings()` exist
   - **TODO:** `buildGenerateTurretFromRegistry()` is a **stub** -- returns empty transaction. Needs implementation: should call `generateTurretFromRegistry()` from chain-shared and return the generated Move source + manifest.
   - **TODO:** Delete `buildConfigureTribeGate()` (marked @deprecated).
4. `apps/periscope/src/db/types.ts` -- DONE:
   - `StructureExtensionConfig` exists with correct fields (note: `tollFee` stored as `string`, not `bigint`)
   - **TODO:** Delete deprecated ACL types: `PermissionGroup`, `GroupMember`, `MemberKind`, `AssemblyPolicy`, `PolicyMode`, `SyncStatus`, `BetrayalAlert`, `AlertStatus`.
5. `apps/periscope/src/db/index.ts` -- DONE:
   - Schema v29 adds `structureExtensionConfigs`, drops permission tables
   - **TODO:** Remove the deprecated table property declarations (`permissionGroups!`, `groupMembers!`, `assemblyPolicies!`, `betrayalAlerts!`).

### Phase 3: Unified Extension Configuration UI -- MOSTLY DONE

1. `StandingsExtensionPanel.tsx` -- DONE: Registry selector, gate/SSU/turret config sections, apply button, status display.
2. `RegistrySelector.tsx` -- DONE: Dropdown, registry info, link to Standings view.
3. `ConfigForm.tsx` -- DONE: Has standings stubs. **TODO:** Delete old `TribeGateConfig` code path (gate_tribe template no longer exists).
4. `DeployExtensionPanel.tsx` -- DONE: Shows `StandingsExtensionPanel` for standings types. **TODO:** Remove legacy template toggle and `LegacyExtensionBanner` integration.
5. `useExtensionDeploy.ts` -- DONE: Standings deploy flow, writes to `structureExtensionConfigs`, reconfigure support. **TODO:** Delete `migrate()` function (no legacy to migrate from).

### Phase 4: Deployables View Integration -- MOSTLY DONE

1. `Deployables.tsx` -- DONE: Extension status display, configure button, registry badges. **TODO:** Remove "Legacy (gate_acl)" status display. Batch configure not yet implemented.
2. `StructureDetailCard.tsx` -- DONE: Shows standings config details.
3. `useStructureExtensions.ts` -- DONE: Fetch/cache hook with `useLiveQuery`.

### Phase 5: Delete Old Extension Code

Focus: Delete all old extension templates, ACL system, Permissions code, and legacy handling. No backward compatibility needed.

1. Delete old chain-shared modules entirely:
   - Delete `packages/chain-shared/src/gate-toll.ts`
   - Delete `packages/chain-shared/src/ssu-market.ts`
   - Delete `packages/chain-shared/src/ssu-market-standings.ts`
   - Delete `packages/chain-shared/src/ssu-standings.ts`
   - Delete `packages/chain-shared/src/acl-registry.ts`
   - Delete `packages/chain-shared/src/permissions.ts`
   - Update `packages/chain-shared/src/index.ts` -- remove exports for deleted modules
   - Remove old contract address entries from `ContractAddresses` in `types.ts` (`gateToll`, `gateAcl`, `gateTribe`, `gateUnified`, `ssuMarket`, `ssuMarketStandings`, `turretShootAll`)
2. Delete old app-side code:
   - Delete `apps/periscope/src/components/extensions/LegacyExtensionBanner.tsx`
   - Delete deprecated types from `apps/periscope/src/db/types.ts`: `PermissionGroup`, `GroupMember`, `MemberKind`, `AssemblyPolicy`, `PolicyMode`, `SyncStatus`, `BetrayalAlert`, `AlertStatus`
   - Remove deprecated table declarations from `apps/periscope/src/db/index.ts`
   - Remove `EXPORT_TABLES` entries for `"permissionGroups"`, `"groupMembers"`, `"assemblyPolicies"`, `"betrayalAlerts"` from `apps/periscope/src/lib/constants.ts`
3. Clean up config and transactions:
   - Delete 7 deprecated templates from `EXTENSION_TEMPLATES` in `apps/periscope/src/chain/config.ts`
   - Remove `deprecated` field from `ExtensionTemplate` interface
   - Remove `LEGACY_TEMPLATE_IDS`, `getLegacyMigrationInfo()`, legacy classification from `classifyExtension()`
   - Delete `buildConfigureTribeGate()` from `apps/periscope/src/chain/transactions.ts`
4. Clean up UI:
   - Remove deprecated badge logic from `TemplateCard.tsx`
   - Remove legacy template toggle and LegacyExtensionBanner references from `DeployExtensionPanel.tsx`
   - Remove legacy status display from `Deployables.tsx`
   - Delete `migrate()` function from `useExtensionDeploy.ts`
   - Remove old `TribeGateConfig` code path from `ConfigForm.tsx`

### Remaining TODO (not yet implemented)

1. **`buildGenerateTurretFromRegistry()` is a stub** in `transactions.ts` -- needs real implementation that calls `generateTurretFromRegistry()` and returns Move source + manifest for compilation/publishing.
2. **Batch configure** in Deployables -- select multiple structures and apply same registry + config. UI not yet built.
3. **Turret "out of sync" prompt** -- when registry standings change, detect that turret config is stale and prompt regeneration. Not yet implemented.

## File Summary

### Already Done (no further changes needed)

| File | Status | Description |
|------|--------|-------------|
| `packages/chain-shared/src/gate-standings.ts` | DONE | `queryGateStandingsConfig()` exists |
| `packages/chain-shared/src/ssu-unified.ts` | DONE | All TX builders implemented |
| `packages/chain-shared/src/turret-standings.ts` | DONE | `generateTurretFromRegistry()` implemented |
| `packages/chain-shared/src/types.ts` | DONE | `ssuUnified`, `SsuUnifiedConfigInfo`, `TurretStandingsConfig` present |
| `packages/chain-shared/src/index.ts` | DONE | Exports ssu-unified and turret-standings |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | DONE | Standings config UI |
| `apps/periscope/src/components/extensions/RegistrySelector.tsx` | DONE | Registry picker |
| `apps/periscope/src/hooks/useStructureExtensions.ts` | DONE | Extension config fetch/cache hook |
| `apps/periscope/src/components/StructureDetailCard.tsx` | DONE | Shows standings config details |
| `apps/periscope/src/db/index.ts` | DONE | v29 schema with structureExtensionConfigs, permission tables dropped |
| `apps/periscope/src/views/Permissions.tsx` | DONE | Already deleted |
| `apps/periscope/src/components/permissions/` | DONE | Already deleted (13 components) |
| `apps/periscope/src/hooks/usePermissionSync.ts` | DONE | Already deleted |
| `apps/periscope/src/hooks/usePermissionGroups.ts` | DONE | Already deleted |
| `apps/periscope/src/hooks/useAssemblyPolicies.ts` | DONE | Already deleted |
| `apps/periscope/src/hooks/useBetrayalResponse.ts` | DONE | Already deleted |
| `apps/periscope/src/chain/permissions.ts` | DONE | Already deleted |
| `apps/periscope/src/router.tsx` | DONE | /permissions route already removed |
| `apps/periscope/src/components/CommandPalette.tsx` | DONE | Permissions entry already removed |

### Remaining Work

| File | Action | Description |
|------|--------|-------------|
| `packages/chain-shared/src/gate-toll.ts` | Delete | Old gate toll extension |
| `packages/chain-shared/src/ssu-market.ts` | Delete | Old SSU market extension |
| `packages/chain-shared/src/ssu-market-standings.ts` | Delete | Old SSU market+standings extension |
| `packages/chain-shared/src/ssu-standings.ts` | Delete | Old SSU standings extension |
| `packages/chain-shared/src/acl-registry.ts` | Delete | Old ACL system |
| `packages/chain-shared/src/permissions.ts` | Delete | Old ACL query/TX builders |
| `packages/chain-shared/src/index.ts` | Modify | Remove exports for deleted modules |
| `packages/chain-shared/src/types.ts` | Modify | Remove old contract address entries from ContractAddresses |
| `apps/periscope/src/chain/config.ts` | Modify | Delete 7 deprecated templates, remove deprecated field, remove legacy helpers |
| `apps/periscope/src/chain/transactions.ts` | Modify | Implement `buildGenerateTurretFromRegistry()` (currently a stub), delete `buildConfigureTribeGate()` |
| `apps/periscope/src/db/types.ts` | Modify | Delete deprecated ACL types (PermissionGroup, GroupMember, MemberKind, AssemblyPolicy, PolicyMode, SyncStatus, BetrayalAlert, AlertStatus) |
| `apps/periscope/src/db/index.ts` | Modify | Remove deprecated table property declarations |
| `apps/periscope/src/lib/constants.ts` | Modify | Remove permission table entries from EXPORT_TABLES |
| `apps/periscope/src/components/extensions/LegacyExtensionBanner.tsx` | Delete | No legacy handling needed |
| `apps/periscope/src/components/extensions/TemplateCard.tsx` | Modify | Remove deprecated badge logic |
| `apps/periscope/src/components/extensions/DeployExtensionPanel.tsx` | Modify | Remove legacy template toggle and LegacyExtensionBanner refs |
| `apps/periscope/src/components/extensions/ConfigForm.tsx` | Modify | Remove old TribeGateConfig code path |
| `apps/periscope/src/hooks/useExtensionDeploy.ts` | Modify | Delete migrate() function |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Remove legacy status display |

## Open Questions

1. ~~**Should the turret standings extension read the registry at runtime or bake config at publish time?**~~
   - **Resolved: Option B (bake at publish time).** Confirmed 2026-03-24 that world-contracts `v0.0.21` turret interface is still fixed at `(turret: &Turret, character: &Character, target_candidate_list: vector<u8>, receipt: OnlineReceipt)`. No way to pass a StandingsRegistry reference. Runtime reads are impossible. The approach: derive friend/foe lists from registry at publish time, and prompt the user to regenerate when standings change.
   - **Feature request for CCP/EVE Frontier devs:** Extend `get_target_priority_list` to accept an optional generic type parameter or additional object references so turret extensions can read on-chain state (e.g., StandingsRegistry) at runtime. This would eliminate the need to republish turret packages when standings change and enable truly dynamic turret behavior.

2. ~~**Should the unified SSU contract be a new on-chain package or a modification of the existing ssu_market_standings?**~~
   - **Resolved: Option A (new package).** Fresh contract combining all SSU functionality (standings + market). Clean design with no backward compatibility constraints. The old ssu_market_standings contract stays deployed for existing users.

3. ~~**Where should the unified extension configuration dApp live in the navigation?**~~
   - **Resolved: Option C (slide-over panel from Deployables).** Enhance the current DeployExtensionPanel slide-over pattern with standings config instead of adding new routes. For "batch configure" scenarios, use a modal dialog.

4. ~~**How to handle the Permissions view's dependency on ACL extensions?**~~
   - **Resolved: Deprecate both ACL extension and Permissions view entirely.** The ACL extension is made obsolete by standings -- every ACL use case (allowlist/denylist) maps to standings thresholds on a StandingsRegistry. The Permissions view, all ACL components, and `usePermissionSync` are removed. Standings view handles all on-chain access control.

## Deferred

- **On-chain contract development** -- This plan covers the client-side (Periscope) changes only. The actual Move contracts for the unified SSU and turret standings extensions need separate plan documents. The TX builders in Phase 1 are written to match the expected contract interfaces.
- **Batch configure UI** -- Select multiple structures in Deployables and apply the same registry + config. Not yet built.
- **Turret "out of sync" detection** -- When registry standings change, detect stale turret config and prompt regeneration. Not yet implemented.
- **Betrayal detection on standings** -- Reimplementing betrayal detection on top of standings (e.g., "friendly-standing entity attacks -> auto-lower standing") is a separate feature.
