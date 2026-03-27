# Plan: Turret and Gate Extension Fixes
**Status:** Ready
**Created:** 2026-03-26
**Updated:** 2026-03-26
**Module:** periscope, chain-shared

## Overview

This plan addresses the turret and gate extension systems. The turret "Apply Configuration" button silently succeeds without executing any transaction -- the turret branch in `StandingsExtensionPanel.handleApply()` skips the signing step and goes straight to saving config to IndexedDB. This plan replaces the original standings-based turret approach with a **simplified weights-only turret** that uses in-browser bytecode patching (same pattern as `token-factory-standings.ts`), removing the dependency on friend/foe lists and standings integration entirely.

This is a temporary simplification. The current EVE Frontier world contracts do not support runtime turret configuration (unlike gates, which read the registry at runtime). Baking friend/foe lists into bytecodes creates a staleness problem and requires a full republish cycle whenever standings change. Instead of shipping that complexity now, we ship a weights-only turret that lets users customize targeting behavior (weight constants + effective ship classes) via a simple UI, with one-click publish through the wallet. Standings-based turrets are deferred until CCP adds runtime config support to turret world contracts (see CCP Feature Request section below).

For gates, the toll currency is hardcoded to SUI -- the on-chain `set_gate_config` function has no `typeArguments` or coin type parameter. The UI correctly shows "Toll Fee (SUI)". This plan adds clarifying help text.

## Current State

### Turret Deploy Bug

The turret deploy flow uses `StandingsExtensionPanel` (line 351 of `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx`). When `structureKind === "turret"`, the `handleApply()` function hits the `else` branch which calls `saveConfigToDb()` and sets status to `"done"` -- no transaction is built or signed. Users see "Configuration applied successfully!" but nothing happens on-chain.

### Turret Config UI Model

The current `TurretConfigValues` type (line 265) collects per-standing weight sliders (`standingWeights: Record<number, number>`) and `aggressorBonus`. This model was designed for the standings-based approach where weights mapped to standing levels. With the weights-only approach, this UI is replaced entirely.

### Token Factory Bytecode Patching Pattern

`packages/chain-shared/src/token-factory-standings.ts` demonstrates the in-browser bytecode patching pattern:
1. Pre-compiled bytecodes are stored as a base64 string constant (`TEMPLATE_STANDINGS_BYTECODES_B64`)
2. `@mysten/move-bytecode-template` WASM module is loaded asynchronously via `ensureWasmReady()`
3. `mod.update_identifiers()` patches module/struct names
4. `mod.update_constants()` patches sentinel values (u8, u64, Vector(U8)) with actual values using BCS encoding
5. The patched bytecodes are published via `tx.publish()` with dependency package IDs
6. The UpgradeCap is transferred to the sender

Sentinel values used: string sentinels for names ("TMPL", "Template Token", "A faction token"), a 32-byte sentinel for registry ID (0x00...01), and u8 sentinels (251, 252, 253) for standing thresholds.

### Turret Priority Source Generator

`packages/chain-shared/src/turret-priority.ts` defines the `TurretPriorityConfig` interface with these weight constants (lines 44-71):
- `defaultWeight` (u64, default 30) -- base weight for unlisted targets
- `kosWeight` (u64, default 100) -- weight for KOS targets
- `aggressorBonus` (u64, default 40) -- bonus when target is attacking
- `betrayalBonus` (u64, default 50) -- bonus for friendly attacker
- `lowHpBonus` (u64, default 20) -- bonus when target HP is low
- `lowHpThreshold` (u64, default 40) -- HP percentage threshold
- `classBonus` (u64, default 25) -- bonus for effective ship class match
- `effectiveClasses` (number[]) -- ship class group IDs (max 2 slots, padded)

Plus the friend/foe lists (which we are removing):
- `friendlyTribes` / `friendlyCharacters` (max 8 slots each, padded)
- `kosTribes` / `kosCharacters` (max 4 slots each, padded)

The generated Move source (`generateTurretPrioritySource`) bakes these as `const` declarations (lines 137-158). The `is_friendly_*` and `is_kos_*` lookup functions use padded slot arrays.

### Turret Standings Generator

`packages/chain-shared/src/turret-standings.ts` wraps `turret-priority.ts` by deriving friend/foe arrays from a `StandingsRegistry`. The `TurretStandingsConfig` type (in `types.ts` lines 256-285) adds `registryId` and `standingThresholds` on top of the base weight constants. `DEFAULT_TURRET_STANDINGS_CONFIG` (line 21) provides defaults.

### Gate Standings Configuration

Gate config works correctly. `buildConfigureGateStandings()` wraps `buildSetGateStandingsConfig()` from `gate-standings.ts`. The on-chain `set_gate_config` takes `tollFee` as `u64` with no `typeArguments` -- toll is always SUI. Gates read the standings registry at runtime (no staleness problem).

### No-Op Transaction Stub

`buildGenerateTurretFromRegistry()` in `transactions.ts` (lines 233-260) creates an empty Transaction with no operations. It uses the old UI model (`standingWeights`, `aggressorBonus`). This is dead code.

## Target State

### 1. Weights-Only Turret with In-Browser Publish

Replace the broken turret flow with a complete, working one-click publish:

1. **Pre-compile** a "weights-only" turret Move package -- same source as `generateTurretPrioritySource` but with empty friend/foe lists and sentinel u64 values for the 7 weight constants + sentinel u64 values for the 2 effective class IDs
2. **Embed** the compiled bytecodes as a base64 constant in a new `turret-factory.ts` file in chain-shared
3. **Patch in-browser** using `@mysten/move-bytecode-template` (same WASM pattern as `token-factory-standings.ts`)
4. **Publish via wallet** -- one-click, user just configures weights and hits "Publish"
5. **Authorize** the published package on the turret assembly via `buildAuthorizeExtension()`

The friend/foe lists are hardcoded to empty (all slots = 0), so the lookup functions (`is_friendly_tribe`, etc.) always return false. Targeting is driven entirely by weights: all targets get `defaultWeight`, aggressors get `+aggressorBonus`, effective classes get `+classBonus`, etc.

### 2. Gate Toll Currency Documentation

Add help text to the gate toll fee input clarifying it is SUI-only. No contract changes needed.

### 3. App Notice About Temporary Limitation

Add a notice in the turret publish flow explaining that this is a simplified weights-only approach, and that standings-based targeting (friend/foe lists) will be available when CCP adds runtime turret configuration support.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Turret publish flow | In-browser bytecode patching (weights-only) | Reuses the proven pattern from `token-factory-standings.ts`. No CLI needed, no compile service, one-click UX. Friend/foe lists removed entirely -- all targets handled by weight constants. |
| Turret config UI | Weight configuration only (no threshold sliders) | `defaultWeight`, `kosWeight`, `aggressorBonus`, `betrayalBonus`, `lowHpBonus`, `lowHpThreshold`, `classBonus`, `effectiveClasses`. No per-standing sliders, no friendly/KOS lists. |
| TurretPublishFlow component | Separate component (`TurretPublishFlow.tsx`) | The turret flow is fundamentally different from gate/SSU config (multi-step with bytecode patching + publish). Clean separation of concerns. |
| Witness type handling | Baked into pre-compiled bytecodes | With bytecode patching, the witness type (`TurretPriorityAuth`) is part of the pre-compiled module. `update_identifiers` patches the module name. No mismatch to resolve at runtime. |
| Staleness detection | Deferred | Staleness was only a problem because standings were baked into bytecodes. With weights-only approach, the only "staleness" is if the user wants different weights -- which they can see directly in the UI. No automatic detection needed. |
| Gate toll currency | Keep SUI-only, add documentation | The on-chain contract has no typeArguments for coin type. Supporting custom currencies requires a contract upgrade. Out of scope. |
| Config storage | Extend StructureExtensionConfig with turret weight fields | Replace `standingWeights` with individual weight fields. Add `publishedPackageId` and `publishedAt`. No Dexie schema version bump needed (non-indexed optional fields). |
| Pre-compiled bytecodes | Ship as base64 constant in chain-shared | Same approach as `TEMPLATE_STANDINGS_BYTECODES_B64` in `token-factory-standings.ts`. Requires building the Move contract once and embedding the output. |

## Implementation Phases

### Phase 1: Pre-Compiled Turret Bytecodes + Factory

**Goal:** Create a `turret-factory.ts` in chain-shared that patches pre-compiled turret bytecodes with user weight values, analogous to `token-factory-standings.ts`.

1. **Generate the weights-only Move source** -- Call `generateTurretPrioritySource()` from `turret-priority.ts` with sentinel values for all weight constants and empty friend/foe lists:
   - `defaultWeight: 1000001` (sentinel u64, chosen to be outside normal range 0-255)
   - `kosWeight: 1000002`
   - `aggressorBonus: 1000003`
   - `betrayalBonus: 1000004`
   - `lowHpBonus: 1000005`
   - `lowHpThreshold: 1000006`
   - `classBonus: 1000007`
   - `effectiveClasses: [1000008, 1000009]` (two slots)
   - `friendlyTribes: []`, `friendlyCharacters: []`, `kosTribes: []`, `kosCharacters: []` (all empty -- padded to zeros by `padSlots`)
   - `moduleName: "turret_priority"` (default)
   - Note: Sentinel values must be u64 values that won't collide with real config values. Since weight constants are typically 0-255 and effective classes are ship group IDs (25-420), values >= 1000000 are safe.

2. **Build the Move package** -- Use the generated source + manifest to create a Move project, compile it via `sui move build --build-env testnet`, and extract the bytecodes from the `build/` output. This is a one-time manual step (same as how `token-factory-standings` was prepared).

3. **Create `packages/chain-shared/src/turret-factory.ts`** modeled on `token-factory-standings.ts`:
   - Import and reuse `ensureWasmReady()` -- extract the WASM initialization into a shared utility in `packages/chain-shared/src/wasm-init.ts` (currently duplicated between `token-factory.ts` and `token-factory-standings.ts`; adding a third copy is not acceptable)
   - Define `TURRET_TEMPLATE_BYTECODES_B64` constant (initially empty placeholder, populated after step 2)
   - Define `TurretWeightsParams` interface:
     ```
     symbol: string          // Module name suffix, e.g. "ALPHA" -> "turret_priority_ALPHA"
     defaultWeight: number   // 0-255
     kosWeight: number       // 0-255
     aggressorBonus: number  // 0-255
     betrayalBonus: number   // 0-255
     lowHpBonus: number      // 0-255
     lowHpThreshold: number  // 0-100
     classBonus: number      // 0-255
     effectiveClasses: [number, number]  // Ship class group IDs (0 = disabled)
     ```
   - Export `buildPublishTurret(params: TurretWeightsParams): Promise<Transaction>`:
     - Load WASM via shared `ensureWasmReady()`
     - Get template bytecodes
     - Patch u64 sentinels: for each weight constant, call `mod.update_constants(bytecodes, bcsU64(actualValue), bcsU64(sentinelValue), "U64")` where `bcsU64` serializes a u64 via `bcs.u64().serialize(n).toBytes()`
     - Note: Unlike token-factory which patches u8 values, turret weights are u64 constants in Move source. The `update_constants` call uses "U64" type, and BCS encoding is `bcs.u64().serialize(n).toBytes()`
     - Optionally patch identifiers if user wants a custom module name (default: keep "turret_priority")
     - Build and return `Transaction` with `tx.publish()` and dependency on `0x1` (Move stdlib), `0x2` (Sui framework), and the world contracts package ID
     - Transfer UpgradeCap to sender
   - Export `parsePublishTurretResult()` to extract packageId from transaction object changes (simpler than token-factory -- no Market object to find, just the published package ID)

4. **Extract shared WASM init** -- Create `packages/chain-shared/src/wasm-init.ts`:
   - Move the `ensureWasmReady()` function and related state (`wasmReady`, `wasmMod`) from `token-factory-standings.ts`
   - Update `token-factory-standings.ts` to import from `wasm-init.ts`
   - Update `token-factory.ts` if it also has the same pattern (verify -- it likely does)
   - Export from `index.ts`

5. **Verify sentinel approach** -- The sentinel values must be unique within the compiled bytecodes so `update_constants` matches exactly one constant. Since all 7 weight sentinels are distinct u64 values (1000001-1000007) and the 2 effective class sentinels are also distinct (1000008-1000009), and no other constants in the module will have these values, uniqueness is guaranteed. The padded friend/foe slots are all 0 (from `padSlots`) which is the same as "disabled" in the lookup functions.

6. **Add world contracts dependency** -- The turret module depends on `world::turret` and `world::character`. Determine the correct world contracts package ID for testnet. Check `apps/periscope/src/chain/config.ts` for the world contracts address used by other extensions (likely in the contract addresses config). This must be passed as a dependency to `tx.publish()`.

7. **Export from `packages/chain-shared/src/index.ts`** -- Add `export * from "./turret-factory";` and `export * from "./wasm-init";`

**Files:**
| File | Action |
|------|--------|
| `packages/chain-shared/src/turret-factory.ts` | Create |
| `packages/chain-shared/src/wasm-init.ts` | Create |
| `packages/chain-shared/src/token-factory-standings.ts` | Modify (import shared WASM init) |
| `packages/chain-shared/src/token-factory.ts` | Modify (import shared WASM init, if applicable) |
| `packages/chain-shared/src/index.ts` | Modify (add exports) |

### Phase 2: Simplified TurretPublishFlow Component

**Goal:** Replace the broken turret `else` branch with a working publish flow using weights-only bytecode patching.

1. **Create `apps/periscope/src/components/extensions/TurretPublishFlow.tsx`**:
   - Props: `assemblyId: string`, `assemblyType: string`, `characterId: string`, `ownerCapId: string`, `tenant: TenantId`, `existingConfig?: StructureExtensionConfig`, `onConfigured?: () => void`
   - Multi-step state machine: `"configure" | "publishing" | "authorizing" | "done" | "error"`
   - **Step 1 (Configure):** Weight configuration form with:
     - `defaultWeight` (slider 0-255, default 30)
     - `kosWeight` (slider 0-255, default 100)
     - `aggressorBonus` (slider 0-255, default 40)
     - `betrayalBonus` (slider 0-255, default 50)
     - `lowHpBonus` (slider 0-255, default 20)
     - `lowHpThreshold` (slider 0-100, default 40)
     - `classBonus` (slider 0-255, default 25)
     - `effectiveClasses` -- two dropdowns from `SHIP_CLASSES` (imported from `@tehfrontier/chain-shared`) with group IDs, default empty (0)
     - Note: `SHIP_CLASSES` is exported from `turret-priority.ts` (lines 17-24) and contains `{ shuttle: { groupId: 31 }, corvette: { groupId: 237 }, ... }`
   - **App notice** (rendered at top of configure step):
     - Amber info banner: "This is a simplified weights-only turret configuration. Standings-based targeting (friend/foe lists derived from your registry) requires runtime config support in the world contracts, which is not yet available. We've submitted a feature request to CCP for this capability."
   - **Step 2 (Publish):** On "Publish Turret" button click:
     - Call `buildPublishTurret()` from `@tehfrontier/chain-shared` with the configured weights
     - Sign and execute via `signAndExecuteTransaction` from dApp kit
     - Parse result via `parsePublishTurretResult()` to get `packageId`
   - **Step 3 (Authorize):** Automatically after publish succeeds:
     - Construct a synthetic `ExtensionTemplate` from the turret template in `EXTENSION_TEMPLATES`, injecting the published `packageId` into `packageIds[tenant]` and setting `witnessType` to `"turret_priority::TurretPriorityAuth"` (the pre-compiled module uses default name "turret_priority")
     - Build TX via `buildAuthorizeExtension()` from `@/chain/transactions`
     - Sign and execute
   - **Step 4 (Done):** Save config to IndexedDB, show success with Suiscan link

2. **Update `StructureExtensionPanel.tsx`**:
   - Add `characterId?: string` and `ownerCapId?: string` to `StandingsExtensionPanelProps` (optional, only needed for turrets)
   - Replace the turret rendering section (lines 426-428) and the turret `else` branch in `handleApply` (lines 351-356):
     - When `structureKind === "turret"`, render `TurretPublishFlow` instead of `TurretStandingsConfig` + the apply button
     - `TurretPublishFlow` handles its own apply/publish flow, so the turret code path is fully delegated
   - Remove `TurretStandingsConfig` component (lines 181-247) and `TurretConfigValues` interface (lines 265-268) -- no longer needed
   - Remove `turretConfig` state (lines 303-314) -- no longer needed
   - Remove turret spread from `saveConfigToDb` (lines 397-400) -- `TurretPublishFlow` handles its own persistence

3. **Update `DeployExtensionPanel.tsx`** (line 179):
   - Pass `characterId` and `assembly.ownerCapId` through to `StandingsExtensionPanel`:
     ```
     <StandingsExtensionPanel
       assemblyId={assembly.objectId}
       assemblyType={assembly.type}
       structureKind={getStructureKind(assembly.type)}
       tenant={tenant}
       characterId={characterId}
       ownerCapId={assembly.ownerCapId}
     />
     ```

4. **Update `StructureExtensionConfig` in `db/types.ts`** (lines 240-261):
   - Remove `standingWeights?: Record<number, number>`
   - Add turret weight fields (all optional):
     - `defaultWeight?: number`
     - `kosWeight?: number`
     - `aggressorBonus?: number` (already exists)
     - `betrayalBonus?: number`
     - `lowHpBonus?: number`
     - `lowHpThreshold?: number`
     - `classBonus?: number`
     - `effectiveClasses?: number[]`
   - Add publish tracking fields:
     - `publishedPackageId?: string`
     - `publishedAt?: string` (ISO timestamp)
   - Note: No Dexie schema version bump needed -- these are non-indexed optional fields

5. **Remove the no-op `buildGenerateTurretFromRegistry()` stub** and `GenerateTurretFromRegistryParams` from `apps/periscope/src/chain/transactions.ts` (lines 233-260). Dead code.

6. **Update `EXTENSION_TEMPLATES` in `apps/periscope/src/chain/config.ts`** (line 271-283):
   - Update the turret_standings template description to reflect weights-only approach
   - Update `witnessType` to `"turret_priority::TurretPriorityAuth"` (matches the pre-compiled module)
   - Keep `packageIds: {}` since each user still publishes their own package

**Files:**
| File | Action |
|------|--------|
| `apps/periscope/src/components/extensions/TurretPublishFlow.tsx` | Create |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify (delegate turret to TurretPublishFlow, remove old turret UI) |
| `apps/periscope/src/components/extensions/DeployExtensionPanel.tsx` | Modify (pass characterId, ownerCapId) |
| `apps/periscope/src/db/types.ts` | Modify (replace standingWeights with weight fields + publish tracking) |
| `apps/periscope/src/chain/transactions.ts` | Modify (remove no-op stub) |
| `apps/periscope/src/chain/config.ts` | Modify (update turret template) |

### Phase 3: Gate Documentation

**Goal:** Clarify gate toll SUI-only limitation in the UI.

1. In `StandingsExtensionPanel.tsx` `GateStandingsConfig` component (line 91), update the toll fee section:
   - Change the `<p>` help text below the toll fee input (line 99-101) to: "Gate tolls are always paid in SUI. Custom currency tolls require a world contract upgrade."
   - Optionally add a small info icon next to the "Toll Fee (SUI)" label with a tooltip

**Files:**
| File | Action |
|------|--------|
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify (add gate toll info text) |

### Phase 4: CCP Feature Request Documentation

**Goal:** Document the desired runtime turret config capability for submission to CCP.

1. Create `docs/ccp-feature-request-turret-runtime-config.md` with a clear description of:
   - Current limitation: turret config is baked at compile time, requiring republish for any change
   - Desired capability: runtime-configurable turret targeting (like gates, which read registry at runtime)
   - Specific request: add a shared config object for turrets (similar to `GateStandingsConfig`) that stores targeting weights and a registry reference, readable by the turret extension at runtime
   - Reference: gates already work this way -- `set_gate_config` stores config in a shared object, and the gate extension reads it per-access
   - Benefits: no republish needed when standings change, simpler client integration, consistent model across extension types

**Files:**
| File | Action |
|------|--------|
| `docs/ccp-feature-request-turret-runtime-config.md` | Create |

## File Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `packages/chain-shared/src/turret-factory.ts` | Create | 1 | Bytecode patcher for weights-only turret (analogous to token-factory-standings.ts) |
| `packages/chain-shared/src/wasm-init.ts` | Create | 1 | Shared WASM initialization for @mysten/move-bytecode-template |
| `packages/chain-shared/src/token-factory-standings.ts` | Modify | 1 | Import shared WASM init instead of local copy |
| `packages/chain-shared/src/token-factory.ts` | Modify | 1 | Import shared WASM init if it has a local copy |
| `packages/chain-shared/src/index.ts` | Modify | 1 | Add turret-factory and wasm-init exports |
| `apps/periscope/src/components/extensions/TurretPublishFlow.tsx` | Create | 2 | Weights-only turret config UI + bytecode patch + wallet publish + authorize |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify | 2, 3 | Delegate turret to TurretPublishFlow, remove old turret UI; add gate toll info |
| `apps/periscope/src/components/extensions/DeployExtensionPanel.tsx` | Modify | 2 | Pass characterId and ownerCapId to StandingsExtensionPanel |
| `apps/periscope/src/db/types.ts` | Modify | 2 | Replace standingWeights with individual weight fields + publish tracking |
| `apps/periscope/src/chain/transactions.ts` | Modify | 2 | Remove no-op buildGenerateTurretFromRegistry stub |
| `apps/periscope/src/chain/config.ts` | Modify | 2 | Update turret template description and witnessType |
| `docs/ccp-feature-request-turret-runtime-config.md` | Create | 4 | Feature request document for CCP: runtime turret config |

## Resolved Questions

1. **Should the turret publish flow support in-browser bytecode patching?**
   - **Resolution:** YES -- weights-only turret with in-browser bytecode patching. The simplification to weights-only (removing friend/foe lists) makes the template approach straightforward. All sentinel values are fixed-position u64 constants, no variable-length arrays to patch. Same proven pattern as `token-factory-standings.ts`.

2. **How aggressively should staleness be checked?**
   - **Resolution:** DEFERRED. Staleness detection was needed because standings entries were baked into turret bytecodes. With weights-only approach, there are no standings entries in the bytecodes. The only "staleness" is if the user wants different weights, which they can see and update directly. Staleness detection is deferred along with standings-based turrets.

3. **Should TurretPublishFlow be a separate component?**
   - **Resolution:** Option B (separate component). The turret flow is fundamentally different from gate/SSU config (multi-step with bytecode patching + publish + authorize). `StandingsExtensionPanel` delegates to `TurretPublishFlow` for turrets.

4. **How should the turret config UI model be reworked?**
   - **Resolution:** SIMPLIFIED. No threshold sliders needed. Just weight configuration: `defaultWeight`, `kosWeight`, `aggressorBonus`, `betrayalBonus`, `lowHpBonus`, `lowHpThreshold`, `classBonus`, `effectiveClasses`. No friendly/KOS lists. Each weight gets a slider with the default value from `DEFAULT_TURRET_PRIORITY_CONFIG`.

5. **How should the turret witness type mismatch be resolved?**
   - **Resolution:** SIMPLIFIED. With bytecode patching, the witness type (`TurretPriorityAuth`) is part of the pre-compiled bytecodes. The module name is "turret_priority" by default. The synthetic `ExtensionTemplate` constructed in `TurretPublishFlow` uses `witnessType: "turret_priority::TurretPriorityAuth"` which matches the compiled module exactly. The `update_identifiers` step can optionally rename the module if a custom name is desired.

## CCP Feature Request: Runtime Turret Configuration

### Summary

Request runtime-configurable turret targeting behavior, analogous to how gates handle standings configuration today.

### Current Behavior (Turrets)

Turret extensions use Move modules with **compile-time constants** for all targeting parameters. When a turret owner wants to change targeting rules (weights, friend/foe lists), they must:

1. Generate new Move source code with updated constants
2. Compile the new package
3. Publish the new package (paying gas + storage fees)
4. Authorize the new extension on the turret (revoking the old one)

This makes standings-based targeting impractical -- every time a registry entry changes, every turret referencing that registry needs a full republish cycle.

### Current Behavior (Gates -- the model to follow)

Gate extensions use a **shared config object** (`GateStandingsConfig`) stored on-chain. The gate extension reads this config at runtime via `config::get_gate_config()`. When standings change, the gate automatically picks up the new values on the next access check. Gate owners can update config via `config::set_gate_config()` without republishing anything.

### Requested Behavior (Turrets)

Add a shared config object for turrets (e.g., `TurretPriorityConfig`) that the turret extension reads at runtime, containing:

- **Weight constants:** `defaultWeight`, `kosWeight`, `aggressorBonus`, `betrayalBonus`, `lowHpBonus`, `lowHpThreshold`, `classBonus`
- **Effective classes:** ship class group IDs the turret is effective against
- **Registry reference:** `registryId` pointing to a `StandingsRegistry` object
- **Standing thresholds:** `friendlyThreshold` and `kosThreshold` for classifying registry entries

The turret extension would read the config + registry at runtime (like gates do), eliminating the need for republishing when standings or weights change.

### Benefits

1. **No republish cycle** -- changing targeting rules is a single config transaction
2. **Live standings integration** -- turrets automatically pick up registry changes
3. **Consistent model** -- turrets work the same way as gates (runtime config object)
4. **Lower cost** -- config updates are cheap transactions vs. full package publish
5. **Better UX** -- one-click config changes vs. multi-step compile/publish/authorize flow

### Reference Implementation

The gate standings system (`gate-standings` package) provides a working reference:
- `set_gate_config()` stores config in a shared object
- The gate extension reads config + registry at runtime per access check
- Config updates are instant, no republish needed

A similar pattern for turrets would store targeting weights + registry reference in a shared config object, and the turret extension would read this config when computing priority lists.

## Deferred

- **Standings-based turret targeting** -- Requires runtime config support in world contracts (see CCP Feature Request above). The current compile-time approach creates a staleness problem when registry entries change. Deferred until CCP adds a shared config object for turrets. When available, Phase 1 of re-implementation would add a `turret-standings-runtime.ts` that calls the config update transaction instead of bytecode patching.
- **Turret staleness detection** -- Only relevant when standings are baked into bytecodes. Deferred along with standings-based turrets.
- **Custom toll currency for gates** -- Requires an on-chain contract upgrade to accept `typeArguments` for coin type. Out of scope for the Periscope app layer.
- **Turret priority weight editing post-publish** -- Currently weights are baked at compile time. Editing requires full regenerate + republish cycle. Runtime config (CCP feature request) would solve this.
- **In-browser Move compilation** -- Not needed with the bytecode patching approach. Deferred indefinitely.
