# Plan: Remove Legacy Extension Templates and Classification Code

**Status:** Active
**Created:** 2026-03-25
**Module:** periscope, chain-shared

## Overview

The extension system has fully transitioned to standings-based templates (gate_standings, ssu_unified, turret_standings), but the codebase still carries a large amount of legacy extension code. This includes 7 deprecated extension templates in `EXTENSION_TEMPLATES`, a full classification and migration subsystem ("legacy" status, `LEGACY_TEMPLATE_IDS`, `LEGACY_MIGRATION_MAP`, `getLegacyMigrationInfo()`), a dedicated `LegacyExtensionBanner` component, legacy toggle UI in the deploy panel, and deprecated chain-shared modules (`acl-registry.ts`, `permissions.ts`, `gate-toll.ts`, `turret-priority.ts`, `ssu-market.ts`).

The user reports that when deploying a turret extension, legacy templates still appear in the picker. The root cause is `DeployExtensionPanel.tsx` which fetches legacy templates via `getTemplatesForAssemblyType(assembly.type, true)` and renders them behind a toggle. The `EXTENSION_TEMPLATES` array still contains 7 deprecated entries, and the entire classification system still routes through a "legacy" status path.

This plan removes all legacy extension concepts: deprecated templates, the legacy classification path, migration infrastructure, the `LegacyExtensionBanner` component, the `ConfigForm` legacy config UI, legacy transaction builders, and deprecated chain-shared modules that have zero consumers. The `classifyExtension()` function is simplified to only return "default", "periscope", "periscope-outdated", or "unknown". After this work, no code path should reference "legacy" in the context of extensions.

**Key constraint:** `turret-priority.ts` cannot be deleted because `turret-standings.ts` (active) imports `DEFAULT_TURRET_PRIORITY_CONFIG`, `generateTurretPrioritySource`, `generateTurretPriorityManifest`, and `TurretPriorityConfig` from it. Similarly, `gateUnified` and `gateToll` contract addresses must be kept because `getExtensionEventTypes()` in config.ts uses them for sonar event type construction. `SsuConfigInfo` must be kept because `ssu-market-standings.ts` (not deleted in this plan) imports it.

## Current State

### Extension Templates (`apps/periscope/src/chain/config.ts`)

Lines 250-418: `EXTENSION_TEMPLATES` array contains 10 entries -- 3 active (gate_standings, ssu_unified, turret_standings) and 7 deprecated:
- `turret_shoot_all` (L301-315, `deprecated: true`)
- `gate_tribe` (L316-333, `deprecated: true`)
- `gate_acl` (L334-351, `deprecated: true`)
- `turret_priority` (L352-366, `deprecated: true`)
- `gate_unified` (L367-384, `deprecated: true`)
- `gate_toll` (L385-402, `deprecated: true`)
- `ssu_market` (L403-417, `deprecated: true`)

### Extension Classification (`apps/periscope/src/chain/config.ts`)

Lines 433-491: `ExtensionClassification` type includes `"legacy"` variant. `classifyExtension()` checks `LEGACY_TEMPLATE_IDS` (a Set of 7 IDs) and returns `{ status: "legacy" }` for matches.

Lines 493-556: Full migration subsystem -- `LegacyMigrationInfo` interface, `LEGACY_MIGRATION_MAP` with 7 entries, `getLegacyMigrationInfo()` export.

### `ExtensionTemplate` Type (`apps/periscope/src/chain/config.ts`)

Line 240: `deprecated?: boolean` field on `ExtensionTemplate` interface (line 239 is the JSDoc comment above it).

Lines 420-427: `getTemplatesForAssemblyType()` has `includeDeprecated` parameter that filters on `deprecated` field.

### LegacyExtensionBanner (`apps/periscope/src/components/extensions/LegacyExtensionBanner.tsx`)

Entire file (66 lines): Dedicated component that renders an amber warning banner with migration info. Imported and used by `DeployExtensionPanel.tsx` (L12, L118-127).

### DeployExtensionPanel (`apps/periscope/src/components/extensions/DeployExtensionPanel.tsx`)

- L49-51: Fetches `legacyTemplates` via `getTemplatesForAssemblyType(assembly.type, true).filter(t => t.deprecated)`
- L54: `showLegacy` state variable
- L60-62: Checks for legacy extension via `classifyExtension()` and `hasLegacyExtension`
- L117-127: Renders `LegacyExtensionBanner` when `hasLegacyExtension`
- L199-222: Legacy template toggle UI -- "Show/Hide legacy templates" button with collapsible list
- L249: Comment "Legacy config form for non-standings templates"

### ConfigForm (`apps/periscope/src/components/extensions/ConfigForm.tsx`)

- L2-3: `allowedTribes` and `permitDurationMs` fields in `ConfigValues` for legacy tribe gate
- L27-29: `gate_tribe` template branch rendering `TribeGateConfig`
- L49-108: Entire `TribeGateConfig` component (legacy UI for tribe gate config)

### TemplateCard (`apps/periscope/src/components/extensions/TemplateCard.tsx`)

- L20: `isDeprecated` variable derived from `template.deprecated`
- L26-31, L37-38, L43-59: Deprecated styling throughout (dimmed icons, "Legacy" badge, reduced opacity)

### StructureDetailCard (`apps/periscope/src/components/StructureDetailCard.tsx`)

- L166-167: `"legacy"` branch in extension status display -- renders `"(legacy)"` label

### Deployables View (`apps/periscope/src/views/Deployables.tsx`)

- L708: `info.status === "legacy"` in `actionLabel` determination
- L732-739: `"legacy"` branch in extension cell renderer -- amber icon + "Legacy" badge

### useExtensionDeploy Hook (`apps/periscope/src/hooks/useExtensionDeploy.ts`)

- L6: Imports `buildConfigureTribeGate` from transactions
- L34-37: `config` parameter with legacy `allowedTribes` and `permitDurationMs` fields
- L61-76: Legacy branch: if template is `gate_tribe`, builds and submits tribe gate config TX
- L117-234: Entire `migrate()` function -- revokes old extension, authorizes new, configures standings

### Transactions (`apps/periscope/src/chain/transactions.ts`)

- L49-56: `ConfigureTribeGateParams` interface
- L104-110: `ssu_market` branch in `buildAuthorizeExtension()` -- creates SsuConfig
- L122-152: `buildConfigureTribeGate()` function (deprecated)

### Chain Index (`apps/periscope/src/chain/index.ts`)

- L8-9: Re-exports deprecated `MOVE_TYPES` and `EVENT_TYPES` constants

### Deprecated Config Constants (`apps/periscope/src/chain/config.ts`)

- L182-186: `MOVE_TYPES` and `EVENT_TYPES` -- deprecated static constants (not imported anywhere)

### chain-shared Deprecated Modules (`packages/chain-shared/src/`)

All fully deprecated, every export marked `@deprecated`:
- `acl-registry.ts` (354 lines) -- SharedAcl TX builders and queries
- `permissions.ts` (244 lines) -- ACL config TX builders and queries
- `gate-toll.ts` -- toll config queries and TX builders
- `turret-priority.ts` -- turret priority Move source generator (**cannot be deleted**: `turret-standings.ts` imports `DEFAULT_TURRET_PRIORITY_CONFIG`, `generateTurretPrioritySource`, `generateTurretPriorityManifest`, and `TurretPriorityConfig` from it)
- `ssu-market.ts` -- SSU market TX builders (not the event types -- those are separate)
- `standings.ts` -- encrypted standings contract (still used by `manifest.ts` for encrypted list sync)

### chain-shared Index (`packages/chain-shared/src/index.ts`)

Lines 4, 7-8, 11-12: Re-exports deprecated modules (`permissions`, `gate-toll`, `ssu-market`, `turret-priority`, `acl-registry`)

### chain-shared Types (`packages/chain-shared/src/types.ts`)

Legacy types still exported:
- `AclConfig` (L3-8)
- `AdminConfig` (L10-14)
- `TollInfo` (L113-119)
- `TurretPriorityDeployment` (L157-175)
- `SharedAclInfo` (L179-187)
- `SsuConfigInfo` (L96-103)

### chain-shared Config (`packages/chain-shared/src/config.ts`)

Legacy contract address entries in both `stillness` and `utopia` configs:
- `gateUnified` (L11-14, L93-96)
- `turretShootAll` (L15-17, L97-99)
- `turretPriority` (L18-20, L100-102)
- `gateAcl` (L21-24, L103-106)
- `gateTribe` (L25-28, L107-109)
- `gateToll` (L29-32, L110-113)
- `aclRegistry` (L57-59, L140-142)

### ContractAddresses Type (`packages/chain-shared/src/types.ts`)

Legacy fields in `ContractAddresses` interface (L348-354):
- `gateUnified`
- `turretShootAll`
- `turretPriority`
- `gateAcl`
- `gateTribe`
- `gateToll`
- `aclRegistry`

## Target State

After this work:

1. **EXTENSION_TEMPLATES** contains only 3 active templates: `gate_standings`, `ssu_unified`, `turret_standings`.
2. **ExtensionTemplate** type no longer has a `deprecated` field.
3. **ExtensionClassification** no longer includes `"legacy"`.
4. **classifyExtension()** only returns `"default"`, `"periscope"`, `"periscope-outdated"`, or `"unknown"`.
5. **getTemplatesForAssemblyType()** no longer has an `includeDeprecated` parameter.
6. **LegacyExtensionBanner.tsx** is deleted.
7. **DeployExtensionPanel** shows only active templates -- no legacy toggle, no legacy banner, no legacy check.
8. **ConfigForm** has no tribe gate branch -- the entire `TribeGateConfig` component is removed. The `allowedTribes` and `permitDurationMs` fields are removed from `ConfigValues`.
9. **TemplateCard** has no deprecated styling path.
10. **StructureDetailCard** and **Deployables** have no `"legacy"` status branch.
11. **useExtensionDeploy** has no `migrate()` function and no `gate_tribe` config branch. The `config` parameter is removed.
12. **transactions.ts** has no `buildConfigureTribeGate()`, no `ConfigureTribeGateParams`, and no `ssu_market` branch in `buildAuthorizeExtension()`.
13. **chain/index.ts** no longer exports `MOVE_TYPES` or `EVENT_TYPES`.
14. **MOVE_TYPES** and **EVENT_TYPES** deprecated constants are removed from config.ts.
15. **chain-shared** no longer re-exports `acl-registry`, `permissions`, `gate-toll`, or `ssu-market` modules. Those 4 files are deleted. `turret-priority.ts` is **kept** (not re-exported from index.ts) because `turret-standings.ts` imports from it directly.
16. **chain-shared types** no longer include `AclConfig`, `AdminConfig`, `TollInfo`, `TurretPriorityDeployment`, or `SharedAclInfo`. `SsuConfigInfo` is **kept** because `ssu-market-standings.ts` imports it.
17. **chain-shared config** no longer includes legacy contract address entries that have zero consumers: `turretShootAll`, `turretPriority`, `gateAcl`, `gateTribe`, `aclRegistry`. The entries `gateUnified` and `gateToll` are **kept** because `getExtensionEventTypes()` uses them for sonar event type strings. The `ContractAddresses` type is updated accordingly.
18. **standings.ts** (encrypted standings) is NOT removed -- it is still used by `manifest.ts` for encrypted standings list sync. This is a separate concern from the extension legacy code.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Remove vs. hide legacy templates | Remove entirely | Legacy templates are on-chain contracts that can't be undeployed, but Periscope has no reason to display or deploy them. Users with legacy extensions will see "Custom" (unknown) status, which is accurate. |
| Keep classifyExtension() | Yes, simplified | Still needed to detect current Periscope extensions and outdated deployments. Only the "legacy" path is removed. |
| Keep `migrate()` function | Remove | Migration was never fully implemented (no UI trigger). Users can manually remove + redeploy via the existing revoke and deploy flows. |
| Keep `buildRemoveExtension()` | Yes | Still needed for revoking any extension (active or old). Not legacy-specific. |
| Delete deprecated chain-shared modules | 4 of 5 | `acl-registry.ts`, `permissions.ts`, `gate-toll.ts`, `ssu-market.ts` have zero consumers. `turret-priority.ts` is kept because `turret-standings.ts` (active) imports from it -- only its re-export from `index.ts` is removed. |
| Keep `standings.ts` (encrypted) | Yes | Still actively used by `manifest.ts` for encrypted standings list sync. Not part of the extension legacy system. |
| Keep `ssu-market` event handling in sonar | Yes | The sonar event handlers reference `ssu_market` event types for monitoring chain activity. These are live on-chain events, not legacy extension code. The event type string `ssu_market::BuyOrderFilledEvent` is a chain fact, not a Periscope extension concept. |
| Remove `ConfigForm.tsx` entirely vs. gut it | Gut it | The file still serves as the config form entry point for future non-standings templates. Remove only the legacy `gate_tribe` branch and `TribeGateConfig` component. Remove `allowedTribes` and `permitDurationMs` from `ConfigValues`. |
| Remove `SsuConfigInfo` type | No, keep | Also used by `ssu-market-standings.ts` (not deleted in this plan). Cannot remove without breaking active code. |
| Keep `gateUnified` / `gateToll` addresses | Yes | `getExtensionEventTypes()` in `config.ts` uses `addrs.gateUnified?.packageId` and `addrs.gateToll?.packageId` for sonar event type strings. These are live on-chain events still being monitored. |
| Remove other legacy contract addresses | Yes | `turretShootAll`, `turretPriority`, `gateAcl`, `gateTribe`, `aclRegistry` have zero consumers after module deletion. Recoverable from git history. |

## Implementation Phases

### Phase 1: Clean `apps/periscope/src/chain/config.ts`

1. Remove the 7 deprecated template entries from `EXTENSION_TEMPLATES` (lines 300-417 -- `turret_shoot_all`, `gate_tribe`, `gate_acl`, `turret_priority`, `gate_unified`, `gate_toll`, `ssu_market`).
2. Remove the `deprecated?: boolean` field from the `ExtensionTemplate` interface (line 239).
3. Remove the `includeDeprecated` parameter from `getTemplatesForAssemblyType()` -- always return all templates (which are now all active). Simplify the filter to just `t.assemblyTypes.includes(kind)`.
4. Remove `"legacy"` from the `ExtensionClassification` union type.
5. Remove `LEGACY_TEMPLATE_IDS` constant (lines 448-456).
6. Simplify `classifyExtension()` -- remove the `LEGACY_TEMPLATE_IDS.has()` check and the `return { status: "legacy" }` branch.
7. Remove the entire Legacy Migration Info section: `LegacyMigrationInfo` interface, `LEGACY_MIGRATION_MAP`, `getLegacyMigrationInfo()` export (lines 493-556).
8. Remove the legacy comment block above `EXTENSION_TEMPLATES` that references legacy templates (line 247-248).
9. Remove deprecated `MOVE_TYPES` and `EVENT_TYPES` constants and their `@deprecated` JSDoc comments (lines 182-186).

### Phase 2: Clean `apps/periscope/src/components/extensions/`

1. **Delete** `LegacyExtensionBanner.tsx` entirely.
2. **Edit** `DeployExtensionPanel.tsx`:
   - Remove import of `LegacyExtensionBanner` (line 12).
   - Remove import of `classifyExtension` (line 4) since it's only used for the legacy check.
   - Remove `legacyTemplates` variable (lines 49-51).
   - Remove `config` state variable (line 53), `ConfigForm` and `ConfigValues` import (line 11).
   - Remove `showLegacy` state (line 54).
   - Remove `extensionInfo` and `hasLegacyExtension` (lines 61-62).
   - Simplify `handleDeploy()` (lines 64-81): remove the `config` field from the `deploy()` call (the `config` property with `allowedTribes`/`permitDurationMs` is legacy).
   - Remove the legacy extension banner JSX block (lines 117-127).
   - Remove the legacy toggle UI JSX block (lines 199-222).
   - Remove the "Legacy config form" comment and the non-standings config form block (lines 249-254) since all remaining templates are standings-based.
3. **Edit** `ConfigForm.tsx`:
   - Remove `allowedTribes` and `permitDurationMs` from `ConfigValues` interface (lines 3-4).
   - Remove the `gate_tribe` branch from `ConfigForm()` (lines 27-29).
   - Remove the entire `TribeGateConfig` component and its section comment (lines 49-108).
4. **Edit** `TemplateCard.tsx`:
   - Remove `isDeprecated` variable (line 20).
   - Remove all deprecated conditional styling: the dimmed border/bg/opacity class (lines 28-29), the dimmed icon class (lines 37-38), the dimmed text class (line 43), the "Legacy" badge span (lines 48-50), the deprecated check on config hint (line 63).

### Phase 3: Clean `apps/periscope/src/` consumers

1. **Edit** `StructureDetailCard.tsx`:
   - Remove the `"legacy"` branch from the extension status display (lines 166-167). Unknown on-chain extensions now show as "Custom".
2. **Edit** `Deployables.tsx`:
   - Remove `"legacy"` from `actionLabel` ternary (line 708).
   - Remove the `info.status === "legacy"` JSX block (lines 732-739).
3. **Edit** `useExtensionDeploy.ts`:
   - Remove `buildConfigureTribeGate` import (line 6).
   - Remove the `config` parameter from `deploy()` (lines 34-37).
   - Remove the legacy `gate_tribe` config TX branch (lines 61-76).
   - Remove the `configuration` field from the db.extensions.put() call (line 93) or keep it as undefined.
   - Remove the entire `migrate()` function (lines 117-234).
   - Remove `migrate` from the return object (line 243).
4. **Edit** `chain/transactions.ts`:
   - Remove `ConfigureTribeGateParams` interface (lines 49-56).
   - Remove the `ssu_market` branch from `buildAuthorizeExtension()` (lines 104-110).
   - Remove `buildConfigureTribeGate()` function and its `@deprecated` JSDoc (lines 122-152).
5. **Edit** `chain/index.ts`:
   - Remove `MOVE_TYPES` and `EVENT_TYPES` from the re-export list (lines 8-9).

### Phase 4: Clean `packages/chain-shared/`

1. **Delete** deprecated modules (4 files):
   - `acl-registry.ts` (354 lines)
   - `permissions.ts` (244 lines)
   - `gate-toll.ts`
   - `ssu-market.ts`
   - **Keep** `turret-priority.ts` -- `turret-standings.ts` imports `DEFAULT_TURRET_PRIORITY_CONFIG`, `generateTurretPrioritySource`, `generateTurretPriorityManifest`, and `TurretPriorityConfig` from it.
2. **Edit** `index.ts` -- remove re-export lines for deleted/internal modules:
   - Remove `export * from "./permissions"` (line 4)
   - Remove `export * from "./gate-toll"` (line 7)
   - Remove `export * from "./ssu-market"` (line 8)
   - Remove `export * from "./turret-priority"` (line 11) -- the module is kept but no longer publicly exported; `turret-standings.ts` imports from it via relative path.
   - Remove `export * from "./acl-registry"` (line 12)
3. **Edit** `types.ts` -- remove legacy type definitions:
   - Remove `AclConfig` interface (lines 3-8)
   - Remove `AdminConfig` interface (lines 10-14)
   - **Keep** `SsuConfigInfo` interface (lines 96-103) -- still used by `ssu-market-standings.ts`
   - Remove `TollInfo` interface (lines 113-119)
   - Remove `TurretPriorityDeployment` interface (lines 157-175)
   - Remove `SharedAclInfo` interface (lines 179-187)
   - Remove legacy fields from `ContractAddresses` interface: `turretShootAll`, `turretPriority`, `gateAcl`, `gateTribe`, `aclRegistry`
   - **Keep** `gateUnified` and `gateToll` in `ContractAddresses` -- used by `getExtensionEventTypes()` for sonar event strings
4. **Edit** `config.ts` -- remove legacy contract address entries from both `stillness` and `utopia`:
   - **Keep** `gateUnified` (used by `getExtensionEventTypes()`)
   - Remove `turretShootAll` (stillness L15-17, utopia L97-99)
   - Remove `turretPriority` (stillness L18-20, utopia L100-102)
   - Remove `gateAcl` (stillness L21-24, utopia L103-106)
   - Remove `gateTribe` (stillness L25-28, utopia L107-109)
   - **Keep** `gateToll` (used by `getExtensionEventTypes()`)
   - Remove `aclRegistry` (stillness L57-59, utopia L140-142)

### Phase 5: Verify and build

1. Run `pnpm lint` to catch any broken imports or unused variables.
2. Run `pnpm build` to verify clean compilation across all packages.
3. Run a global search for "legacy" in `.ts`/`.tsx` files to verify no extension-related legacy references remain (note: non-extension uses of "legacy" like "legacy suiAddress" in DataInitializer.tsx and "legacy BFS" in pathfinder.ts are unrelated and should remain).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/chain/config.ts` | Edit | Remove 7 deprecated templates, `deprecated` field, `LEGACY_TEMPLATE_IDS`, `LEGACY_MIGRATION_MAP`, `getLegacyMigrationInfo()`, `"legacy"` classification, simplify `getTemplatesForAssemblyType()`, remove `MOVE_TYPES`/`EVENT_TYPES` |
| `apps/periscope/src/chain/transactions.ts` | Edit | Remove `ConfigureTribeGateParams`, `buildConfigureTribeGate()`, `ssu_market` branch in `buildAuthorizeExtension()` |
| `apps/periscope/src/chain/index.ts` | Edit | Remove `MOVE_TYPES`, `EVENT_TYPES` re-exports |
| `apps/periscope/src/components/extensions/LegacyExtensionBanner.tsx` | Delete | Entire file removed |
| `apps/periscope/src/components/extensions/DeployExtensionPanel.tsx` | Edit | Remove legacy imports, legacy template fetching, legacy banner, legacy toggle UI |
| `apps/periscope/src/components/extensions/ConfigForm.tsx` | Edit | Remove `gate_tribe` branch, `TribeGateConfig` component, legacy `ConfigValues` fields |
| `apps/periscope/src/components/extensions/TemplateCard.tsx` | Edit | Remove all deprecated styling and "Legacy" badge |
| `apps/periscope/src/components/StructureDetailCard.tsx` | Edit | Remove `"legacy"` status branch from extension display |
| `apps/periscope/src/views/Deployables.tsx` | Edit | Remove `"legacy"` action label and cell renderer branch |
| `apps/periscope/src/hooks/useExtensionDeploy.ts` | Edit | Remove `buildConfigureTribeGate` import, legacy config param, `gate_tribe` branch, `migrate()` function |
| `packages/chain-shared/src/acl-registry.ts` | Delete | Entire deprecated module |
| `packages/chain-shared/src/permissions.ts` | Delete | Entire deprecated module |
| `packages/chain-shared/src/gate-toll.ts` | Delete | Entire deprecated module |
| `packages/chain-shared/src/turret-priority.ts` | Keep (internal) | NOT deleted -- `turret-standings.ts` imports from it. Only its re-export from `index.ts` is removed. |
| `packages/chain-shared/src/ssu-market.ts` | Delete | Entire deprecated module |
| `packages/chain-shared/src/index.ts` | Edit | Remove re-exports for 4 deleted modules + `turret-priority` (kept as internal) |
| `packages/chain-shared/src/types.ts` | Edit | Remove `AclConfig`, `AdminConfig`, `TollInfo`, `TurretPriorityDeployment`, `SharedAclInfo`, and legacy `ContractAddresses` fields (`turretShootAll`, `turretPriority`, `gateAcl`, `gateTribe`, `aclRegistry`). Keep `SsuConfigInfo`, `gateUnified`, `gateToll`. |
| `packages/chain-shared/src/config.ts` | Edit | Remove `turretShootAll`, `turretPriority`, `gateAcl`, `gateTribe`, `aclRegistry` from both tenants. Keep `gateUnified` and `gateToll`. |

## Open Questions

None -- all questions resolved during refinement.

### Resolved During Refinement

1. **`standings.ts` (encrypted standings) scope** -- Deferred to a separate plan. The encrypted standings module is actively used by `manifest.ts` for encrypted standings list sync. It is not part of the extension legacy system and requires its own migration plan.

2. **Which legacy contract address entries can be removed** -- `gateUnified` and `gateToll` must be kept (used by `getExtensionEventTypes()` for sonar event type construction). The rest (`turretShootAll`, `turretPriority`, `gateAcl`, `gateTribe`, `aclRegistry`) have zero consumers after module deletion and are removed.

3. **`turret-priority.ts` cannot be deleted** -- `turret-standings.ts` imports from it. The file is kept as an internal module; only its re-export from `index.ts` is removed.

4. **`SsuConfigInfo` type must be kept** -- Used by `ssu-market-standings.ts` which is not being deleted in this plan.

## Deferred

- **Encrypted standings (`standings.ts`) removal** -- Still used by `manifest.ts`. Requires a separate migration plan to move encrypted standings sync to the registry-based system.
- **`ssu_market` sonar event types** -- The sonar system monitors `ssu_market::BuyOrderFilledEvent` etc. These are live on-chain events from the old SSU market contract. They should remain until the sonar system is updated to also track `ssu_unified` events, which is a separate feature.
- **`STANDING_LABELS` from `standings.ts`** -- Exported constant used alongside `REGISTRY_STANDING_LABELS`. The encrypted standings module exports this; if `standings.ts` is eventually removed, this constant would need to move or be removed.
- **`ssu-market-standings.ts` cleanup** -- This module references `SsuConfigInfo` from types.ts. Once the SSU market standings system is fully replaced by `ssu-unified`, this module can be deleted and `SsuConfigInfo` removed.
- **`gateUnified` / `gateToll` contract address cleanup** -- These are kept because sonar event handlers use them. Once sonar is migrated to use only standings-based event types, these addresses and their `ContractAddresses` fields can be removed.
- **`turret-priority.ts` public API removal** -- The file is kept as an internal dependency of `turret-standings.ts`, but its re-export is removed. Consider inlining the needed exports into `turret-standings.ts` in a future refactor.
