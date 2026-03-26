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
| Config storage for turret publish state | Extend StructureExtensionConfig | Adding publishedPackageId, publishedAt, registrySnapshotHash to the existing type is simpler than creating a new table. The IndexedDB schema version bump is minimal. |

## Implementation Phases

### Phase 1: Fix Turret Apply Configuration Bug
1. In `StandingsExtensionPanel.tsx`, replace the turret `else` branch (lines 351-356) with a new flow that:
   - Calls `queryRegistryStandings()` to fetch current registry entries
   - Calls `generateTurretFromRegistry()` to produce Move source and manifest
   - Displays the generated source in a read-only code block with copy/download buttons
   - Shows instructions for `sui client publish --build-env testnet`
   - Provides a text input for the user to paste their published package ID
   - On paste, validates it looks like a Sui address (0x... hex, 64 chars)
   - Builds and executes `buildAuthorizeExtension()` with the pasted package ID
   - Only then saves config to IndexedDB and shows success
2. Add a `TurretPublishFlow` sub-component to `apps/periscope/src/components/extensions/TurretPublishFlow.tsx` to encapsulate the multi-step turret publish UI (source generation -> manual publish -> authorize)
3. Update `StandingsExtensionPanel.tsx` to render `TurretPublishFlow` when `structureKind === "turret"` instead of the current broken branch
4. Add `generateTurretFromRegistry` and `queryRegistryStandings` to the chain-shared re-exports used by the app (check `packages/chain-shared/src/index.ts`)

### Phase 2: Turret Staleness Detection
1. Add fields to `StructureExtensionConfig` in `apps/periscope/src/db/types.ts`:
   - `publishedPackageId?: string` -- the published turret package ID
   - `publishedAt?: string` -- ISO timestamp of last publish
   - `registrySnapshotHash?: string` -- hash of registry entries at publish time
2. Bump the Dexie schema version in `apps/periscope/src/db/index.ts` (add new version after current latest)
3. Create a utility function `computeRegistryHash(entries: RegistryStandingEntry[]): string` in `apps/periscope/src/lib/registry-hash.ts` that:
   - Sorts entries deterministically by (kind, tribeId/characterId)
   - JSON-stringifies the sorted array
   - Returns a SHA-256 hex digest (use Web Crypto API)
4. In `TurretPublishFlow`, after successful publish + authorize, save the `registrySnapshotHash` computed from the entries used during generation
5. Create a hook `useStaleExtensions(configMap, tenant)` in `apps/periscope/src/hooks/useStaleExtensions.ts` that:
   - For each turret config with a `registrySnapshotHash`, fetches current registry entries
   - Computes current hash and compares to stored hash
   - Returns a `Set<assemblyId>` of stale turrets
   - Caches results and refreshes periodically (every 5 minutes)
6. In `Deployables.tsx`, use `useStaleExtensions()` to add an amber "Stale" badge on turret rows where the extension config is outdated
7. In `StructureDetailCard.tsx`, show a "Standings have changed since last publish" warning for stale turrets with a "Regenerate" button

### Phase 3: Gate Toll Currency Documentation
1. In `StandingsExtensionPanel.tsx` `GateStandingsConfig` component (lines 68-136), update the toll fee label from "Toll Fee (SUI)" to include a tooltip or help text explaining this is always in SUI (native token)
2. Add a small info note below the toll fee input: "Gate tolls are paid in SUI. Custom currency tolls require a contract upgrade."
3. No changes to chain-shared -- the contract limitation is upstream

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify | Replace turret else branch with TurretPublishFlow integration; add gate toll info text |
| `apps/periscope/src/components/extensions/TurretPublishFlow.tsx` | Create | New component for multi-step turret publish (generate -> publish -> authorize) |
| `apps/periscope/src/db/types.ts` | Modify | Add publishedPackageId, publishedAt, registrySnapshotHash to StructureExtensionConfig |
| `apps/periscope/src/db/index.ts` | Modify | Add new Dexie schema version for extended StructureExtensionConfig fields |
| `apps/periscope/src/lib/registry-hash.ts` | Create | Utility to compute deterministic hash of registry entries |
| `apps/periscope/src/hooks/useStaleExtensions.ts` | Create | Hook to detect stale turret extension configs |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Add stale turret indicator in extension column |
| `apps/periscope/src/components/StructureDetailCard.tsx` | Modify | Add stale turret warning with regenerate button |
| `packages/chain-shared/src/index.ts` | Modify | Ensure generateTurretFromRegistry and queryRegistryStandings are exported |

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

## Deferred

- **In-browser turret package publishing** -- Requires pre-compiled turret bytecodes with sentinel values, WASM bytecode-template integration, and a way to handle variable-length arrays. Significant research needed. Track as a separate plan.
- **Custom toll currency for gates** -- Requires an on-chain contract upgrade to accept `typeArguments` for coin type. Out of scope for the Periscope app layer.
- **Turret priority weight editing post-publish** -- Currently weights are baked at compile time. Editing requires full regenerate + republish cycle. A future contract could store weights in a shared config object (like gates do) for live updates.
- **Batch staleness check across all registries** -- Querying every registry for every turret config is expensive at scale. Could be optimized with a registry version counter on-chain.
