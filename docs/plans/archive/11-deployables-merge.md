# Plan: Merge Deployables & Assemblies into Unified Structure Grid

**Status:** Complete
**Created:** 2026-03-17
**Completed:** 2026-03-17
**Module:** periscope

## Overview

The Periscope app currently has two separate views for on-chain structures: **Deployables** (`/deployables`) shows the current character's owned assemblies with an Excel-style DataGrid, fuel tracking, and chain sync. **Assemblies** (`/assemblies`) shows structures discovered from Watchlist targets with a card-based layout, manual label/notes editing, and target sync. These two pages present overlapping data in different formats, creating a confusing UX where users aren't sure which page to check.

This plan merges both into a single **Deployables** page at `/deployables` that lists all structures -- both owned and observed -- in a unified filterable DataGrid. The grid will support inline editing of notes (stored locally in IndexedDB) and on-chain renaming of owned structures via the `update_metadata_name` Move function. An "ownership" column will distinguish between "mine" and "watched" structures, allowing users to filter by ownership.

The `/assemblies` route will redirect to `/deployables` for backward compatibility. The `assemblies` IndexedDB table and its `AssemblyIntel` type will remain for now (data migration is deferred) but the view will query both tables and merge results.

## Current State

### Deployables Page (`/deployables`)
- **File:** `apps/periscope/src/views/Deployables.tsx`
- Uses `DataGrid` component with Excel-style column filters (TanStack React Table)
- Queries `db.deployables` table (type `DeployableIntel`) filtered by `owner` field
- Syncs via `discoverCharacterAndAssemblies()` from `apps/periscope/src/chain/queries.ts`
- Fetches fuel data per assembly (fuel level, runtime remaining)
- Columns: Status, Name, Type, Fuel, Runtime, Notes, Updated
- Shows stat cards (Total, Online, Offline, Fuel Warnings)
- Notes column is display-only (no inline editing)
- No on-chain rename functionality

### Assemblies Page (`/assemblies`)
- **File:** `apps/periscope/src/views/Assemblies.tsx`
- Uses custom card-based layout (NOT the DataGrid component)
- Queries `db.assemblies` table (type `AssemblyIntel`) -- all owners, not just self
- Syncs via `syncTargetAssemblies()` from `apps/periscope/src/chain/sync.ts`
- Shows owner name (resolved from `db.players`)
- Has inline editing for label and notes (saves to IndexedDB)
- Has "remove from tracking" (soft delete via `_deleted` flag)
- Custom search bar and status/type pill filters
- No fuel data

### Data Model Differences

| Field | `DeployableIntel` | `AssemblyIntel` |
|-------|-------------------|-----------------|
| owner | Optional (`owner?`) | Required (`owner`) |
| label | Required (`label`) | Optional (`label?`) |
| fuelLevel | Yes | No |
| fuelExpiresAt | Yes | No |
| position | Yes | No |
| systemId | Yes (`systemId?`) | Yes (`systemId?`) |
| notes | Yes (`notes?`) | Yes (`notes?`) |
| tags | Yes | Yes |

### Routing & Navigation
- **Router:** `apps/periscope/src/router.tsx` -- both routes eagerly imported
- **Sidebar:** `apps/periscope/src/components/Sidebar.tsx` -- "Assets" group has both "Deployables" (Package icon) and "Assemblies" (Box icon)

### On-Chain Rename Support
- **World contracts reference** (`docs/world-contracts-reference.md`) shows `update_metadata_name` exists on:
  - `assembly::update_metadata_name(assembly, owner_cap, name)` (generic Assembly)
  - `turret::update_metadata_name(turret, owner_cap, name)`
  - `network_node::update_metadata_name(nwn, owner_cap, name)`
- **NOT available on:** `gate`, `storage_unit` (these modules lack `update_metadata_name` in the reference)
- All require `OwnerCap<T>` -- already discovered during sync (stored as `ownerCapId` on `OwnedAssembly`)
- **Transaction infrastructure:** `apps/periscope/src/hooks/useSignAndExecuteTransaction.ts` and `apps/periscope/src/hooks/useSponsoredTransaction.ts` both exist and work

### Character/Ownership Context
- `apps/periscope/src/hooks/useActiveCharacter.ts` provides `activeCharacter` with `suiAddress`
- `apps/periscope/src/hooks/useOwnedAssemblies.ts` discovers assemblies via OwnerCap lookup
- The `OwnedAssembly` type in `queries.ts` includes `ownerCapId` needed for rename transactions

## Target State

### Unified Deployables View

A single `/deployables` page that:
1. Queries both `db.deployables` (owned) and `db.assemblies` (observed) tables
2. Merges into a unified row type with an `ownership` discriminator ("mine" | "watched")
3. Displays all structures in the existing `DataGrid` component
4. Supports inline notes editing (click to edit, save to IndexedDB)
5. Supports on-chain rename for owned structures (where the Move module supports it)

### Unified Row Type

```ts
interface StructureRow {
  id: string;                   // DB record id
  objectId: string;             // Sui object ID
  ownership: "mine" | "watched"; // Discriminator
  assemblyType: string;         // Human-readable type name
  status: AssemblyStatus;
  label: string;                // On-chain name or local label
  owner: string;                // Sui address
  ownerName?: string;           // Resolved from players table
  systemId?: number;
  fuelLevel?: number;           // Only for owned structures
  fuelExpiresAt?: string;       // Only for owned structures
  notes?: string;               // Local notes
  tags: string[];
  source: "deployables" | "assemblies"; // Which DB table this came from
  ownerCapId?: string;          // Needed for rename tx (owned only)
  assemblyModule?: string;      // Move module name for rename target
  updatedAt: string;
}
```

### DataGrid Columns

| Column | Filter | Sortable | Notes |
|--------|--------|----------|-------|
| Status | Excel filter | Yes | Colored dot + label |
| Name | Excel filter | Yes | Clickable to edit (owned), shows object ID |
| Type | Excel filter | Yes | Assembly type name |
| Ownership | Excel filter | Yes | "Mine" / "Watched" badge |
| Owner | Excel filter | Yes | Player name + truncated address |
| Fuel | No | Yes | Level + runtime (owned only, dash for watched) |
| Notes | Excel filter | Yes | Click to edit inline, saves to IndexedDB |
| Updated | No | Yes | Relative timestamp |
| Actions | No | No | Rename (chain), Explorer link, Remove |

### Inline Notes Editing

Click the notes cell to enter edit mode. Save on blur or Enter. Cancel on Escape. Writes to the appropriate DB table (`db.deployables` or `db.assemblies`) based on `source` field.

### On-Chain Rename Flow

1. User clicks the name cell on an owned structure
2. Inline text input appears with current name
3. User edits and presses Enter (or clicks save)
4. If different from current label, build a PTB:
   - `character::borrow_owner_cap<T>(character, ownerCapTicket)` -> (ownerCap, receipt)
   - `{module}::update_metadata_name(assembly, ownerCap, newName)`
   - `character::return_owner_cap<T>(character, ownerCap, receipt)`
5. Execute via `useSponsoredTransaction` (if gas station available) or `useSignAndExecuteTransaction`
6. On success, update `db.deployables` label and show toast
7. Disabled for `gate` and `storage_unit` types (no `update_metadata_name` on chain)

### Route Changes

- `/deployables` -- unified view (merged component)
- `/assemblies` -- redirect to `/deployables`
- Sidebar: remove "Assemblies" entry, keep "Deployables" (rename label to "Structures" for clarity)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Keep both DB tables | Yes, query both and merge in-memory | Avoids a DB migration; assemblies table is also used by Radar and Watchlist sync. Can consolidate tables in a future plan. |
| Rename sidebar entry | "Deployables" -> "Structures" | More inclusive term covering both owned and observed structures |
| Inline editing vs modal | Inline (click cell to edit) | Faster workflow, consistent with spreadsheet metaphor of DataGrid |
| Sponsored vs direct rename TX | Prefer sponsored, fallback to direct | Gas station already supports arbitrary TX sponsoring; saves user SUI |
| Rename disabled for gate/storage_unit | Yes, show tooltip explaining why | World contracts don't expose `update_metadata_name` for these types |
| Fuel columns for watched structures | Show dash | Fuel data requires separate RPC call per structure; only fetch for owned |
| Row actions column | Add as last column | Keep rename/explorer/remove actions in a consistent location |

## Implementation Phases

### Phase 1: Merge Views & Unified Grid [COMPLETE]
1. Create `StructureRow` type in `apps/periscope/src/views/Deployables.tsx` (or extract to a shared types file)
2. Query both `db.deployables` (filtered by active character's addresses) and `db.assemblies` (all non-deleted) tables
3. Map `DeployableIntel` records to `StructureRow` with `ownership: "mine"`, `source: "deployables"`
4. Map `AssemblyIntel` records to `StructureRow` with `ownership: "watched"`, `source: "assemblies"`
5. Deduplicate by `objectId` -- if the same structure exists in both tables, prefer the deployables (owned) record since it has richer data (fuel, etc.)
6. Resolve owner names from `db.players` table (same pattern as current Assemblies view)
7. Update column definitions to include Ownership, Owner, and Actions columns
8. Add stat cards for ownership breakdown (Mine vs Watched, plus Online/Offline/Fuel Warnings)
9. Wire up "Sync Chain" button (own structures) and "Sync Targets" button (watched structures) as dual actions in the toolbar

### Phase 2: Inline Notes Editing [COMPLETE]
1. Create an `EditableCell` component that toggles between display and input on click
2. Wire notes column to use `EditableCell`, saving to the correct DB table based on `source`
3. Support Enter to save, Escape to cancel, blur to save
4. Show a subtle pencil icon on hover to indicate editability

### Phase 3: On-Chain Rename [COMPLETE]
1. Update Deployables sync to persist `ownerCapId` and `assemblyModule` (from `OwnedAssembly.type`) on `DeployableIntel` records. The `discoverCharacterAndAssemblies()` call already returns these values but they are not saved.
2. Also store the Character Sui object ID (`characterObjectId`) in the `DeployableIntel` record during sync. This is needed for the `borrow_owner_cap` PTB step. Available from `discovery.character.characterObjectId`.
3. Add `buildRenameTx` function to `apps/periscope/src/chain/transactions.ts` that builds the borrow-rename-return PTB. Reuse the `assemblyModuleMap` pattern from `buildAuthorizeExtension`.
4. The PTB requires: `tenant`, `assemblyModule` (e.g., "turret"), `assemblyMoveType` (e.g., "Turret"), `assemblyId`, `characterId` (Sui object ID, NOT item_id), `ownerCapId`, `newName`, `senderAddress`.
5. Wire the Name column to be editable for owned structures (ownership === "mine") using the same `EditableCell` component from Phase 2.
6. On save, if name changed, execute the rename TX (prefer sponsored via `useSponsoredTransaction.available`, fallback to `useSignAndExecuteTransaction`).
7. Update local DB label on TX success and re-sync the assembly to confirm the on-chain name.
8. Disable rename for `gate` and `storage_unit` types (show tooltip: "On-chain rename not supported for this structure type"). These modules do not expose `update_metadata_name` in world-contracts v0.0.18.
9. Require wallet connection for rename (use existing `useCurrentAccount` from dapp-kit-react). Show "Connect wallet to rename" if disconnected.
10. Handle error code 7 (`EMetadataNotSet`) gracefully -- assemblies may not have metadata initialized. Show user-friendly error: "This structure has no metadata set on-chain. Contact support or deploy a new one."
11. The Move `name` parameter is `String` -- use `tx.pure.string(newName)` in the PTB.

### Phase 4: Route Cleanup & Navigation [COMPLETE]
1. Change `/assemblies` route to redirect to `/deployables`
2. Remove `Assemblies` import from router
3. Update Sidebar: remove "Assemblies" entry, rename "Deployables" to "Structures"
4. Update Sidebar icon from `Package` to something more inclusive (keep `Package` -- it works)

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/views/Deployables.tsx` | Modify | Rewrite to query both tables, merge rows, add ownership/owner/actions columns, inline editing |
| `apps/periscope/src/views/Assemblies.tsx` | Delete | No longer needed; functionality merged into Deployables |
| `apps/periscope/src/chain/transactions.ts` | Modify | Add `buildRenameTx()` function for `update_metadata_name` PTB |
| `apps/periscope/src/router.tsx` | Modify | Change assembliesRoute to redirect, remove Assemblies import |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | Remove Assemblies nav item, rename Deployables label to "Structures" |
| `apps/periscope/src/components/EditableCell.tsx` | Create | Reusable inline-edit cell component for DataGrid |
| `apps/periscope/src/chain/queries.ts` | Modify | Ensure `ownerCapId` is propagated through to DeployableIntel during sync |
| `apps/periscope/src/db/types.ts` | Modify | Add `ownerCapId`, `assemblyModule`, and `characterObjectId` fields to `DeployableIntel` |
| `apps/periscope/src/db/index.ts` | Modify | New DB version (V15) adding `ownerCapId` index to deployables table |

## Open Questions (all resolved)

1. **Should the `assemblies` DB table be migrated into `deployables`?**
   - **Resolved:** Option A -- keep both tables, merge at query time. Implemented as planned.

2. **Should on-chain rename be sponsored or direct wallet sign?**
   - **Resolved:** Option B -- prefer sponsored, fallback to direct. Implemented via `sponsorAvailable` flag.

3. **Should "Structures" be the new label or keep "Deployables"?**
   - **Resolved:** Option A -- renamed to "Structures" in sidebar and page heading.

## Deferred

- **DB table consolidation** -- Merging `assemblies` into `deployables` at the DB level requires careful migration and updating all consumers: `chain/sync.ts` (target assembly sync), `views/Targets.tsx` (per-target assembly listing + deletion), `views/OPSEC.tsx` (assembly count in OPSEC audit), `components/CommandPalette.tsx` (global search). Better as a separate plan.
- **Fuel data for watched structures** -- Would require per-structure RPC calls for non-owned assemblies. Expensive and low priority.
- **Bulk rename** -- Select multiple structures and rename in batch. Complex PTB construction, defer to future.
- **System name resolution** -- Show system name instead of ID. Requires joining with `solarSystems` table. Useful but orthogonal.
- **Column persistence** -- Remember column widths, sort order, filter state in settings. Nice-to-have.
