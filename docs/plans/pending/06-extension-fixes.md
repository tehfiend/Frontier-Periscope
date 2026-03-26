# Plan: Turret and Gate Extension Bugs and Features
**Status:** Draft
**Created:** 2026-03-26
**Module:** periscope, chain-shared

## Overview

This plan addresses two bugs and two features across the turret and gate extension systems. The turret "Apply Configuration" button silently succeeds without executing any transaction because the turret branch in `StandingsExtensionPanel.handleApply()` skips the signing step entirely and goes straight to saving config to IndexedDB. Additionally, there is no mechanism to detect when a turret's baked-in standings have become stale relative to the current registry.

For gates, the toll currency is currently hardcoded to SUI -- the on-chain contract `buildSetGateStandingsConfig()` accepts a `tollFee` as a `u64` value but has no `typeArguments` or coin type parameter, meaning the smart contract itself only supports SUI for tolls. The UI label says "Toll Fee (SUI)" which is accurate to the contract's current capability. We also need to determine whether gate extensions suffer from the same staleness problem as turrets.

## Current State

### Turret Deploy Bug

The turret deploy flow uses `StandingsExtensionPanel` (lines 321-357 of `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx`). When `structureKind === "turret"`, the `handleApply()` function at line 351 hits the `else` branch which calls `saveConfigToDb()` and sets status to `"done"` -- no transaction is built or signed. This is by semi-intentional design: turret extensions use per-user published Move packages where the config is "baked in" at compile time (see `turret-standings.ts` lines 1-9). The config is stored locally in IndexedDB via `db.structureExtensionConfigs`, but the actual Move source generation, package publish, and extension authorization steps are completely missing from the UI flow.

The full turret deploy pipeline should be:
1. User selects a StandingsRegistry and configures weights/thresholds
2. System fetches registry entries via `queryRegistryStandings()`
3. System generates Move source via `generateTurretFromRegistry()` (in `packages/chain-shared/src/turret-standings.ts`)
4. User publishes the generated Move package (requires `sui client publish` or in-browser bytecode patching)
5. User authorizes the published extension on their turret via `buildAuthorizeExtension()`
6. Config is saved to IndexedDB for reference

Steps 2-5 are not implemented in the UI.

### Turret Extension Template + Witness Type Mismatch

The turret template in `EXTENSION_TEMPLATES` (`apps/periscope/src/chain/config.ts` line 272) declares `witnessType: "turret_standings::TurretStandingsAuth"`, but the source generator in `turret-priority.ts` line 129 hardcodes the auth struct as `TurretPriorityAuth` and the default module name is `turret_priority`. This means `buildAuthorizeExtension()` would construct the wrong witness type (`{pkg}::turret_standings::TurretStandingsAuth`) vs. what the published module actually exposes (`{pkg}::turret_priority::TurretPriorityAuth`).

Additionally, `buildAuthorizeExtension()` takes an `AuthorizeExtensionParams` object which requires a full `ExtensionTemplate` (with `packageIds` and `witnessType`), not just a raw package ID. The turret template has empty `packageIds: {}` since each user publishes their own package. The `TurretPublishFlow` must construct a synthetic template with the user's pasted package ID injected into `packageIds[tenant]` and a corrected `witnessType` matching the actual generated module name and auth struct.

### Turret Config UI vs. Generator Model Mismatch

The `TurretStandingsConfig` UI component (line 181 of `StandingsExtensionPanel.tsx`) collects `TurretConfigValues`:
- `standingWeights: Record<number, number>` -- per-standing-level priority weights (0-100)
- `aggressorBonus: number`

However, `generateTurretFromRegistry()` in `turret-standings.ts` requires a `TurretStandingsConfig` (from chain-shared `types.ts` line 256) which uses a fundamentally different model:
- `standingThresholds: { friendlyThreshold, kosThreshold }` -- binary classification thresholds that sort registry entries into friendly/neutral/KOS bins
- `defaultWeight`, `kosWeight`, `betrayalBonus`, `lowHpBonus`, `lowHpThreshold`, `classBonus`, `effectiveClasses` -- fixed Move-level constants baked into the generated source

The generator does NOT support per-standing priority weights. It classifies each registry entry as friendly (weight 0), KOS (kosWeight), or neutral (defaultWeight) based on thresholds, then applies fixed bonus constants. The UI's per-standing weight sliders have no equivalent in the generator.

Additionally, `generateTurretFromRegistry()` takes three parameters: `(config: TurretStandingsConfig, _registry: StandingsRegistryInfo, entries: RegistryStandingEntry[])`. The `_registry` parameter is unused but TypeScript requires it -- load from `db.subscribedRegistries`.

There is also a no-op placeholder `buildGenerateTurretFromRegistry()` in `transactions.ts` (lines 233-260) that creates an empty Transaction and accepts `standingWeights` + `aggressorBonus`. This stub uses the old UI model and should be removed or reworked.

### Gate Standings Configuration

Gate config is handled at `StandingsExtensionPanel.tsx` lines 330-341. The gate branch correctly calls `buildConfigureGateStandings()` which wraps `buildSetGateStandingsConfig()` from `chain-shared/src/gate-standings.ts`. The on-chain function `config::set_gate_config` takes parameters: configObjectId, gateId, registryId, minAccess, freeAccess, tollFee (u64), tollRecipient (address), permitDurationMs (u64). There is no `typeArguments` for coin type -- the toll is always paid in SUI (native Coin<SUI>). The `SetGateStandingsConfigParams` interface in `gate-standings.ts` (lines 19-30) confirms this: no `coinType` field.

### Gate vs. Turret Staleness Model

**Gates** store their config in a shared config object (`GateStandingsConfig`) as dynamic fields, referencing a `registryId`. When a character uses a gate, the on-chain extension reads the registry *at runtime* -- it does NOT bake in standing entries. This means gates automatically pick up registry changes. Gates do NOT have a staleness problem.

**Turrets** use a fundamentally different model. Turret config is baked into the Move module source as compile-time constants (see `turret-priority.ts` lines 137-158). The friendly/KOS lists are literal arrays in the generated Move code. When standings change, the published module still contains the old arrays. The turret must be: (1) regenerated from the updated registry, (2) republished, and (3) re-authorized on the turret assembly. Turrets DO have a staleness problem.

### Currency System

The app tracks custom currencies in `db.currencies` (synced from `Market<T>` objects via the Market view). Each currency has a `coinType` string (e.g., `0xabc::gold_token::GOLD_TOKEN`). The `GateStandingsConfig` form in `StandingsExtensionPanel.tsx` labels the toll as "Toll Fee (SUI)" at line 91. The on-chain gate standings contract does not currently support custom coin types for tolls.

### Extension Config Tracking

`StructureExtensionConfig` in `db/types.ts` (lines 240-261) stores per-structure config including `registryId`, `registryName`, and type-specific fields. For turrets, it stores `standingWeights` and `aggressorBonus`. There is no field tracking *when* the config was last synced to the registry, no hash of the registry entries, and no record of which specific registry entries were baked into the published package.

## Target State

### 1. Fix Turret "Apply Configuration" (Bug)

Display a clear informational panel explaining the turret deploy pipeline instead of a misleading success message. The turret branch should:
- Show an info panel explaining that turret extensions require a published Move package
- Generate and display the Move source code for the user to review
- Provide a "Copy Source" / "Download Package" button
- Explain the manual `sui client publish` step (or future in-browser publish)
- After manual publish, let the user paste the package ID and call `buildAuthorizeExtension()`
- Only show "Configuration applied successfully!" after the authorization TX completes
- Save the config to IndexedDB with a `publishedPackageId` and `publishedAt` timestamp

### 2. Turret Staleness Detection

Add a mechanism to detect when a turret's published config is outdated:
- Add `publishedAt` (ISO timestamp) and `registrySnapshotHash` (hash of registry entries used at publish time) fields to `StructureExtensionConfig`
- On the Deployables view, compare the stored snapshot hash against the current registry state
- Flag turrets with mismatched hashes as "stale" with a visual indicator (amber warning)
- Provide a "Regenerate" action that initiates the turret regeneration flow

### 3. Gate Toll Currency Selection

Since the on-chain gate standings contract only supports SUI for tolls (no `typeArguments` or `coinType` parameter in `set_gate_config`), the UI correctly shows "Toll Fee (SUI)". Custom currency tolls would require a contract upgrade. The current plan defers custom toll currency support to a future contract version and instead focuses on making the existing SUI-only limitation clear and well-documented in the UI.

### 4. Gate Staleness -- Not Applicable

Gates read the standings registry at runtime via the on-chain extension. They do NOT bake in standings at deploy time. When a user updates their registry, all gates referencing that registry automatically use the new standings on the next access check. No staleness detection is needed for gates.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Turret publish flow | Manual CLI publish with paste-back | In-browser Move publish via bytecode patching (like token-factory-standings.ts) would require pre-compiled turret bytecodes and WASM, adding significant complexity. The turret module is dynamically generated with user-specific constants, making template patching harder than token modules. Start with manual publish and add in-browser publish later. |
| Staleness detection mechanism | Hash of sorted registry entries | Comparing a hash of (tribeId, standing, characterId, standing) tuples is deterministic and cheap. Alternative: timestamp comparison, but timestamps don't catch rollbacks or unchanged re-saves. |
| Gate toll currency | Keep SUI-only, document limitation | The on-chain contract has no typeArguments for coin type. Supporting custom currencies requires a contract upgrade (new function signature with type parameter). Out of scope for this plan. |
| Turret witness type mismatch | Construct synthetic template in TurretPublishFlow | The turret template in `EXTENSION_TEMPLATES` has `witnessType: "turret_standings::TurretStandingsAuth"` but the source generator produces `TurretPriorityAuth`. Rather than fixing the template (which would break if module names vary), the `TurretPublishFlow` constructs a synthetic template with the correct `witnessType` based on the actual module name used during generation. |
| Turret config UI model | Replace per-standing weights with threshold sliders | The current `TurretConfigValues` UI collects per-standing weights (0-100), but the generator uses binary threshold classification (`friendlyThreshold`/`kosThreshold`). Replace the weight sliders with threshold sliders that match the generator's `TurretStandingsConfig` model. Use `DEFAULT_TURRET_STANDINGS_CONFIG` for Move-level constants (defaultWeight, kosWeight, betrayalBonus, lowHpBonus, lowHpThreshold, classBonus, effectiveClasses) with an optional "Advanced" section for overrides. The `advancedOverrides` type is narrowed via `Pick` to prevent accidental overlap with main config fields (`registryId`, `standingThresholds`, `aggressorBonus`). Remove the no-op `buildGenerateTurretFromRegistry()` stub from transactions.ts. |
| Config storage for turret publish state | Extend StructureExtensionConfig | Adding publishedPackageId, publishedAt, registrySnapshotHash as optional non-indexed fields to the existing type is simpler than creating a new table. No Dexie schema version bump needed since index definitions don't change. |

## Implementation Phases

### Phase 1: Fix Turret Apply Configuration Bug
1. Add `characterId` and `ownerCapId` props to `StandingsExtensionPanelProps` in `StandingsExtensionPanel.tsx` (needed by `buildAuthorizeExtension()` for the turret flow). These are only required when `structureKind === "turret"` -- make them optional with a runtime guard.
2. Update `DeployExtensionPanel.tsx` (line 179) to pass `characterId` and `assembly.ownerCapId` through to `StandingsExtensionPanel`. `DeployExtensionPanel` already receives `characterId` as a prop (line 11) and has access to `assembly.ownerCapId` (line 49).
3. Rework the `TurretStandingsConfig` UI component (lines 181-246 of `StandingsExtensionPanel.tsx`) and `TurretConfigValues` type (lines 265-268) to collect threshold-based config matching the chain-shared `TurretStandingsConfig` model:
   - Replace per-standing weight sliders with two `StandingSlider` controls: "Friendly Threshold" (`friendlyThreshold`, default 5) and "KOS Threshold" (`kosThreshold`, default 1)
   - Keep the `aggressorBonus` slider
   - Add an optional "Advanced" collapsible section for overrides: `defaultWeight`, `kosWeight`, `betrayalBonus`, `lowHpBonus`, `lowHpThreshold`, `classBonus`, `effectiveClasses` (all defaulting to `DEFAULT_TURRET_STANDINGS_CONFIG` values)
   - Update `TurretConfigValues` to: `{ friendlyThreshold: number; kosThreshold: number; aggressorBonus: number; advancedOverrides?: Partial<Pick<TurretStandingsConfig, 'defaultWeight' | 'kosWeight' | 'betrayalBonus' | 'lowHpBonus' | 'lowHpThreshold' | 'classBonus' | 'effectiveClasses'>> }`
   - Update `saveConfigToDb()` turret spread (line 397-400) to persist the new threshold fields
4. Update `StructureExtensionConfig` in `db/types.ts` to replace turret-specific fields:
   - Remove `standingWeights?: Record<number, number>`
   - Add `friendlyThreshold?: number`, `kosThreshold?: number`
   - Keep `aggressorBonus?: number`
   - (publishedPackageId, publishedAt, registrySnapshotHash are added in Phase 2)
5. Remove the no-op `buildGenerateTurretFromRegistry()` stub and its `GenerateTurretFromRegistryParams` interface from `transactions.ts` (lines 233-260). This placeholder uses the old weight model and serves no purpose.
6. In `StandingsExtensionPanel.tsx`, replace the turret `else` branch (lines 351-356) with a render of the new `TurretPublishFlow` component (step 7)
7. Add a `TurretPublishFlow` sub-component to `apps/periscope/src/components/extensions/TurretPublishFlow.tsx` to encapsulate the multi-step turret publish UI. Props: `characterId`, `ownerCapId`, `assemblyId`, `assemblyType`, `tenant`, `registryId`, and the turret config values (thresholds + aggressorBonus + optional advanced overrides). The component:
   - Constructs a full `TurretStandingsConfig` by merging `DEFAULT_TURRET_STANDINGS_CONFIG` with user overrides (thresholds, aggressorBonus, advanced settings) and the `registryId`
   - Loads `StandingsRegistryInfo` from `db.subscribedRegistries` (needed as second arg to `generateTurretFromRegistry`, though currently unused)
   - Calls `queryRegistryStandings(client, registryId)` to fetch current registry entries (client from `useSuiClient()` hook)
   - Calls `generateTurretFromRegistry(config, registryInfo, entries)` to produce `{ source, manifest, priorityConfig }`
   - Displays the generated source in a read-only code block with copy/download buttons
   - Shows instructions for `sui client publish --build-env testnet`
   - Provides a text input for the user to paste their published package ID
   - On paste, validates it looks like a Sui address (0x... hex, 64 chars)
   - Constructs a synthetic `ExtensionTemplate` from the turret standings template, injecting the pasted package ID into `packageIds[tenant]` and setting `witnessType` to `${moduleName}::TurretPriorityAuth` (where `moduleName` comes from `priorityConfig.moduleName ?? "turret_priority"`, matching the generated source)
   - Builds a TX via `buildAuthorizeExtension()` (from `@/chain/transactions`) with the synthetic template, then signs/executes via `signAndExecute()` from dApp kit
   - Only then saves config to IndexedDB and shows success
8. Verify `generateTurretFromRegistry` and `queryRegistryStandings` are exported from chain-shared (already confirmed: `turret-standings.ts` via line 22 and `standings-registry.ts` via line 13 of `packages/chain-shared/src/index.ts`). Also verify `DEFAULT_TURRET_STANDINGS_CONFIG` is exported (`turret-standings.ts` line 21, re-exported via index.ts line 22).

### Phase 2: Turret Staleness Detection
1. Add publish-tracking fields to `StructureExtensionConfig` in `apps/periscope/src/db/types.ts` (the threshold field changes were already made in Phase 1 Step 4):
   - `publishedPackageId?: string` -- the published turret package ID
   - `publishedAt?: string` -- ISO timestamp of last publish
   - `registrySnapshotHash?: string` -- hash of registry entries at publish time
   - Note: no Dexie schema version bump needed -- these are non-indexed optional fields added to an existing table. Dexie only requires version bumps when index definitions change.
2. Create a utility function `computeRegistryHash(entries: { kind: string; tribeId?: number; characterId?: number; standing: number }[]): string` in `apps/periscope/src/lib/registry-hash.ts` that:
   - Accepts a common subset type that works for both `RegistryStandingEntry` (chain-shared, used at publish time from `queryRegistryStandings`) and `RegistryStanding` (db type, used for comparison from `db.registryStandings` -- has extra fields `id`, `registryId`, `cachedAt` which are ignored)
   - Sorts entries deterministically by (kind, tribeId/characterId)
   - JSON-stringifies the sorted array (only the kind, tribeId, characterId, standing fields)
   - Returns a SHA-256 hex digest (use Web Crypto API)
3. In `TurretPublishFlow`, after successful publish + authorize, save the `registrySnapshotHash` computed from the entries used during generation
4. Create a hook `useStaleExtensions(configMap, tenant)` in `apps/periscope/src/hooks/useStaleExtensions.ts` that:
   - For each turret config with a `registrySnapshotHash`, reads current registry entries from `db.registryStandings` (already synced by `useRegistrySubscriptions`)
   - Computes current hash via `computeRegistryHash()` (which accepts both `RegistryStandingEntry` and `RegistryStanding` due to the common subset type) and compares to stored hash
   - Returns a `Set<assemblyId>` of stale turrets
   - Note: this depends on the registry standings cache being up-to-date -- staleness detection is only as fresh as the last registry sync
5. In `Deployables.tsx`, use `useStaleExtensions()` to add an amber "Stale" badge on turret rows where the extension config is outdated
6. In `StructureDetailCard.tsx`, show a "Standings have changed since last publish" warning for stale turrets with a "Regenerate" button

### Phase 3: Gate Toll Currency Documentation
1. In `StandingsExtensionPanel.tsx` `GateStandingsConfig` component (lines 68-136), update the toll fee label from "Toll Fee (SUI)" to include a tooltip or help text explaining this is always in SUI (native token)
2. Add a small info note below the toll fee input: "Gate tolls are paid in SUI. Custom currency tolls require a contract upgrade."
3. No changes to chain-shared -- the contract limitation is upstream

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify | Add characterId/ownerCapId props; rework TurretStandingsConfig UI from weight sliders to threshold sliders; replace turret else branch with TurretPublishFlow render; add gate toll info text |
| `apps/periscope/src/components/extensions/DeployExtensionPanel.tsx` | Modify | Pass characterId and assembly.ownerCapId through to StandingsExtensionPanel (line 179) |
| `apps/periscope/src/components/extensions/TurretPublishFlow.tsx` | Create | New component for multi-step turret publish (generate -> publish -> authorize) |
| `apps/periscope/src/chain/transactions.ts` | Modify | Remove no-op `buildGenerateTurretFromRegistry()` stub and `GenerateTurretFromRegistryParams` (lines 233-260) |
| `apps/periscope/src/db/types.ts` | Modify | Replace turret `standingWeights` with `friendlyThreshold`/`kosThreshold`; add publishedPackageId, publishedAt, registrySnapshotHash (Phase 2) |
| `apps/periscope/src/lib/registry-hash.ts` | Create | Utility to compute deterministic hash of registry entries (common subset type for both RegistryStandingEntry and RegistryStanding) |
| `apps/periscope/src/hooks/useStaleExtensions.ts` | Create | Hook to detect stale turret extension configs |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Add stale turret indicator in extension column |
| `apps/periscope/src/components/StructureDetailCard.tsx` | Modify | Add stale turret warning with regenerate button |
| `apps/periscope/src/components/extensions/ConfigForm.tsx` | No change | `ConfigValues` interface references `standingWeights` (line 13) but is not imported anywhere -- dead code. Can be cleaned up separately. |
| `packages/chain-shared/src/index.ts` | Verify | generateTurretFromRegistry, queryRegistryStandings, and DEFAULT_TURRET_STANDINGS_CONFIG are already exported (no changes needed) |
| `apps/periscope/src/chain/config.ts` | Review | Turret template has mismatched `witnessType` -- resolved by constructing synthetic template in TurretPublishFlow (see Open Question 5). Existing template serves as UI classifier only. |

## Open Questions

1. **Should the turret publish flow support in-browser bytecode patching (like token-factory-standings.ts)?**
   - **Option A: Manual CLI publish only** -- Pros: Much simpler implementation, no WASM dependency, no pre-compiled bytecodes needed. Cons: Worse UX -- user must have `sui` CLI installed and run a terminal command.
   - **Option B: In-browser publish via bytecode patching** -- Pros: Seamless one-click experience. Cons: Turret modules are dynamically generated (not template-patched), so we'd need to either compile Move in-browser (not feasible) or ship pre-compiled bytecodes with sentinel values (like token-factory does). The turret module has variable-length arrays (friendly/KOS lists) that make sentinel-based patching harder than fixed-field tokens.
   - **Option C: Hybrid -- manual publish now, in-browser later** -- Pros: Ship the fix quickly, plan the improved UX as a follow-up. Cons: Two implementation passes.
   - **Recommendation:** Option C. The bug fix is urgent (users see false success). Manual CLI publish is functional and matches what power users expect. In-browser publish can be a separate plan when the bytecode template approach is worked out.

2. **How aggressively should staleness be checked?**
   - **Option A: On-demand only** -- Check staleness when the user opens the Deployables view or clicks a "Check staleness" button. Pros: No background polling, simpler. Cons: User might not notice stale turrets.
   - **Option B: Periodic background poll (every 5 min)** -- Pros: Proactive notification. Cons: Extra chain queries; if user has many turrets with different registries, this could be expensive.
   - **Option C: Reactive via Dexie live query** -- Watch `db.registryStandings` table for changes and recompute hashes when local data changes. Pros: Instant detection when user modifies standings. Cons: Only catches local changes, not changes made by other admins directly on-chain.
   - **Recommendation:** Option A for initial implementation. The Deployables view already loads extension configs -- adding a staleness check there is low overhead. Background polling can be added later if users request it.

3. **Should the turret TurretPublishFlow be a separate panel or inline in StandingsExtensionPanel?**
   - **Option A: Inline in StandingsExtensionPanel** -- Replace the turret else branch with the multi-step flow directly. Pros: No navigation changes. Cons: StandingsExtensionPanel becomes large and complex.
   - **Option B: Separate TurretPublishFlow component** -- StandingsExtensionPanel renders TurretPublishFlow for turrets. Pros: Clean separation of concerns, easier to test. Cons: Another file.
   - **Recommendation:** Option B. The turret flow is fundamentally different (multi-step with code generation) and deserves its own component. StandingsExtensionPanel can delegate to it.

4. **How should the turret config UI model be reworked?**
   - **Option A: Replace weight sliders with threshold sliders** -- Replace the 7 per-standing weight sliders with two `StandingSlider` controls (Friendly Threshold, KOS Threshold) that directly map to `TurretStandingsConfig.standingThresholds`. Use `DEFAULT_TURRET_STANDINGS_CONFIG` for Move-level constants with an optional "Advanced" collapsible section. Pros: Clean 1:1 mapping to the generator model, no lossy translation. Cons: Loses the granular per-standing weight UX; existing `standingWeights` data in IndexedDB becomes orphaned.
   - **Option B: Keep weight sliders and derive thresholds** -- Keep the current per-standing weight UI and programmatically derive thresholds: find the lowest standing where weight = 0 -> friendlyThreshold, find the highest standing where weight >= some cutoff -> kosThreshold. Pros: Preserves the familiar UI, backwards compatible with saved configs. Cons: Lossy mapping -- the generator only supports binary classification, so intermediate weights (e.g., 30, 50) are lost. Users may expect per-standing granularity that doesn't exist in the published module.
   - **Option C: Dual mode** -- Show threshold sliders by default (simple mode), with a toggle to show per-standing weight preview (read-only, computed from thresholds). Pros: Clean model + visual feedback. Cons: More UI complexity.
   - **Recommendation:** Option A. The generator fundamentally uses binary classification, so the UI should match that model. The per-standing weights gave a false impression of granularity that the generated Move code doesn't support. Existing saved configs with `standingWeights` can be migrated on load by deriving thresholds (weight 0 -> friendly, weight >= kosWeight -> KOS).

5. **How should the turret witness type mismatch be resolved?**
   - **Option A: Fix the EXTENSION_TEMPLATES turret entry** -- Change `witnessType` to `"turret_priority::TurretPriorityAuth"` (matching default module name and actual struct). Pros: Simple, single-line fix. Cons: Breaks if user picks a custom module name; the template would need to be parameterized.
   - **Option B: Fix the source generator** -- Change `turret-priority.ts` to use a configurable auth struct name and module name in the `witnessType`. Pros: Template and generated code agree. Cons: More invasive change to chain-shared; the struct name in Move source becomes dynamic.
   - **Option C: Construct synthetic template in TurretPublishFlow** -- Don't fix either side; instead, the TurretPublishFlow reads the actual module name from config and constructs the correct witnessType dynamically (`${moduleName}::TurretPriorityAuth`). Pros: Works for any module name without touching chain-shared or template registry. Cons: Authorization logic is spread across two locations.
   - **Recommendation:** Option C. The turret publish is fundamentally user-driven (custom package per user), so the flow already needs to build a synthetic template with the pasted package ID. Adding the correct witnessType is natural. The existing template entry serves as a classifier for the UI, not as the authorization source.

## Deferred

- **In-browser turret package publishing** -- Requires pre-compiled turret bytecodes with sentinel values, WASM bytecode-template integration, and a way to handle variable-length arrays. Significant research needed. Track as a separate plan.
- **Custom toll currency for gates** -- Requires an on-chain contract upgrade to accept `typeArguments` for coin type. Out of scope for the Periscope app layer.
- **Turret priority weight editing post-publish** -- Currently weights are baked at compile time. Editing requires full regenerate + republish cycle. A future contract could store weights in a shared config object (like gates do) for live updates.
- **Batch staleness check across all registries** -- Querying every registry for every turret config is expensive at scale. Could be optimized with a registry version counter on-chain.
