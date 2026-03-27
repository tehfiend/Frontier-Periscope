# Plan: Misc Fixes -- Standings, Structure Columns, Entity Deletion
**Status:** Ready
**Created:** 2026-03-26
**Module:** periscope

## Overview

This plan covers a batch of bug fixes and feature improvements across three areas: Standings (contacts), Structures (Deployables datagrid), and on-chain entity management.

The Standings bug is a reactivity issue where newly added contacts don't appear until reload. The Deployables datagrid needs a category column, improved parent column behavior, a notes rendering fix, and repositioned actions. Finally, we need a strategy for "deleting" on-chain entities (markets, private maps, registries) that can't truly be destroyed on the Sui blockchain.

These items are grouped because they're all small-to-medium scope, span the same modules, and can be implemented in focused phases without conflicting file ownership.

## Current State

### Standings Bug
- `useContacts()` at `apps/periscope/src/hooks/useContacts.ts:19-22` uses `useLiveQuery(() => db.contacts.toArray())` which should be fully reactive to IndexedDB changes.
- `useAddContact()` at the same file (lines 25-54) calls `await db.contacts.add(contact)` which returns a Promise. The caller in `AddContactDialog` (Standings.tsx line 1182-1208) awaits `onAdd(...)` then immediately calls `onClose()`.
- The `ContactsTab` component (Standings.tsx line 215) gets contacts via `useContacts()`, and the `AddContactDialog` is conditionally rendered via `showAddDialog` state. When `onClose()` fires, `setShowAddDialog(false)` unmounts the dialog.
- **Root cause (confirmed via source analysis):**

  The issue is a race between Dexie's asynchronous liveQuery re-read and React 19's state update batching, caused by the event ordering in Dexie 4.3.0's transaction commit handler.

  In `node_modules/dexie/dist/dexie.mjs:2783-2788`, the IDB transaction `oncomplete` handler does two things in sequence:
  1. `_this._resolve()` -- resolves the DexiePromise (allowing `await db.contacts.add()` to continue)
  2. `globalEvents.storagemutated.fire(...)` -- notifies liveQuery subscribers

  Step 1 queues the Promise continuation (the code after `await onAdd(...)`) as a microtask. Step 2 fires synchronously and causes the `liveQuery` observable to schedule a re-read of `db.contacts.toArray()` -- but this re-read is itself an async IDB operation.

  The microtask from step 1 runs first: `onClose()` fires -> `setShowAddDialog(false)` -> React batches this state update and re-renders `ContactsTab`. During this render, `useLiveQuery` returns its cached (stale) value because the liveQuery IDB re-read hasn't completed yet. The component renders with the old contacts list and the dialog removed.

  The liveQuery re-read then completes and SHOULD trigger a second render via the `triggerUpdate()` dispatch in `dexie-react-hooks` 1.1.7's `useObservable` (line 86: `triggerUpdate()` from `useReducer`). However, `dexie-react-hooks` 1.1.7 uses a `useRef`+`useReducer` pattern instead of React 18+'s `useSyncExternalStore`, which doesn't properly integrate with React 19's concurrent rendering. The stale-while-rendering ref pattern can cause React to skip the pending update if it considers the component tree already consistent.

  **Summary:** `onClose()` wins the race against Dexie's async liveQuery re-read. The first render after dialog close has stale data. The second render (from liveQuery) may be dropped by React 19 due to the outdated `useRef`+`useReducer` subscription pattern in `dexie-react-hooks` 1.1.7.

### Structure Category Column
- `ASSEMBLY_TYPE_IDS` in `apps/periscope/src/chain/config.ts:184-200` maps numeric type IDs to specific names like "Heavy Storage", "Light Turret", "Stargate", etc.
- The `GameType` interface in `db/types.ts:50-63` has `groupName`, `groupId`, `categoryName`, `categoryId` fields. The `gameTypes` table is indexed on `name` and `categoryName` (db/index.ts line 160).
- The `assemblyType` field on `StructureRow` (Deployables.tsx line 59) contains the resolved type name string (e.g., "Light Turret", "Stargate", "Heavy Storage"). This name originates from `ASSEMBLY_TYPE_IDS[typeId]` -> `ASSEMBLY_KIND_NAMES[assembly.type]` -> `assembly.type.replace("_", " ")` fallback chain (Deployables.tsx lines 402-406).
- The `gameTypes` table stores all game item types fetched from the World API (`lib/worldApi.ts`). Each entry has `id` (numeric typeId), `name`, `categoryName`, and `categoryId`. Since `ASSEMBLY_TYPE_IDS` maps typeId -> name, we can reverse-lookup: for each assembly type name in the datagrid, find the matching `gameTypes` record by name and extract `categoryName`.
- Currently there is no "category" column in the datagrid. The "Type" column shows the specific type name.

### Parent Node Column
- A "Parent" column already exists at Deployables.tsx line 862-878. It uses a `ParentSelect` component (line 1466-1548) which shows a dropdown of all other structures.
- The `parentId` field on `DeployableIntel` (db/types.ts line 116) and `AssemblyIntel` (line 133) stores the parent reference.
- During sync (Deployables.tsx line 435), `parentId` is set from `assembly.energySourceId` -- this links structures to their energy source (network node).
- The parent column's `accessorFn` (line 864) resolves the parent's label via `parentLabels` map. A node with no parent shows an em dash.
- **The request is for nodes to list themselves as their own parent.** Currently a node with `parentId === undefined` shows the em dash placeholder. The fix should auto-populate a node's parentId to itself, or handle the display logic so nodes show their own label.

### Notes Em Dash Bug
- The Notes column at Deployables.tsx line 980-996 uses `EditableCell` with `placeholder="\u2014"`.
- `EditableCell` (components/EditableCell.tsx line 29) defaults `placeholder` to `"\u2014"`.
- The display logic on line 105: `{children ?? (value || placeholder)}` -- when `value` is empty string, it falls through to `placeholder` which is the em dash character `\u2014`.
- The `handleSaveNotes` function (line 489-502) saves `notes: newNotes || undefined`. So saving an empty string stores `undefined`. The row creation (line 316) uses `notes: d.notes` which could be `undefined`. The column `accessorKey: "notes"` will return `undefined`, and `EditableCell` receives `value={r.notes ?? ""}`. This flow should work -- the placeholder em dash shows when `value` is empty.
- The user wants blank notes to show nothing (completely empty cell), not an em dash placeholder.

### Actions Column Position
- The "actions" column is defined last in the columns array at Deployables.tsx line 1009-1063 -- it's the rightmost column.
- The request is to move it to the first (leftmost) position.

### On-Chain Entity Deletion
- **Market<T>** (`packages/chain-shared/src/market.ts`): No `destroy` or `delete` function exists. `Market<T>` is a shared object containing TreasuryCap and order books. Sui shared objects cannot be deleted.
- **StandingsRegistry** (`packages/chain-shared/src/standings-registry.ts`): No destroy function. It's a shared object.
- **PrivateMap** (`packages/chain-shared/src/private-map.ts`): No destroy function. It's a shared object. Has `revoke_member` and `remove_location` operations.
- **Exchange** (`packages/chain-shared/src/exchange.ts`): No destroy function.
- Sui shared objects **cannot be deleted** -- once an object becomes shared (`transfer::share_object`), it cannot be transferred, wrapped, or destroyed. This is a fundamental Sui constraint.
- The `currencies` table in IndexedDB (db/index.ts line 501) stores local references. The `subscribedRegistries` table (line 526) stores subscriptions. These are the local representations.
- Best approach: **local-only archival** using a hidden/archived flag in IndexedDB. This hides entities from the UI without trying to destroy on-chain objects.

## Target State

1. **Standings reactivity fix:** New contacts appear immediately in the list after adding, without requiring a page reload.
2. **Category column:** A new "Category" column in the Deployables datagrid derived from the `gameTypes` DB table, with Excel-style filtering.
3. **Parent node column:** Network nodes (and any structure without a parent) show themselves as their own parent, enabling "filter by node" workflows.
4. **Notes placeholder fix:** Blank notes show a completely empty cell (no placeholder character).
5. **Actions column first:** The actions column moves to the leftmost position in the datagrid.
6. **Entity archival:** A local "archived" flag on currencies, subscribed registries, and private maps, with view-level filtering and a "show archived" toggle.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Standings reactivity fix | Defer `onClose()` with `setTimeout(..., 0)` | Root cause is a race between the dialog-close state update and Dexie's async liveQuery re-read. Deferring `onClose()` to a macrotask lets the liveQuery microtask/IDB re-read complete and `triggerUpdate()` fire first, so React batches both updates into one render with fresh data. |
| Category derivation | Derive from `gameTypes` DB table, build name->category map via `useLiveQuery` | Game types change with updates, so a hardcoded map would go stale. The `gameTypes` table has `name` and `categoryName` fields. Build a `Map<string, string>` from `gameTypes.name` -> `gameTypes.categoryName` on load. Falls back to "Other" for unknown types. |
| Notes placeholder | Completely empty, no placeholder | An em dash for "no notes" is confusing -- it looks like data. Show nothing for empty notes; the pencil-on-hover already signals editability. |
| Parent self-reference | Display-side only (don't mutate DB) | Show the structure's own label when `parentId` is undefined and the structure is a network node. Avoids polluting the DB with self-referential IDs. |
| On-chain deletion | Local-only archival with `_archived` flag | Sui shared objects cannot be destroyed. A local `_archived: boolean` flag in IndexedDB is the only viable approach. Keeps chain state honest while letting users declutter their UI. |
| Entity archive scope | currencies, subscribedRegistries, manifestPrivateMaps, manifestPrivateMapsV2 | These are the user-created/subscribed on-chain entities that accumulate over time and need cleanup. |
| Entity archive filtering | View-level filtering (not DB-level) | The number of archived entities will be small (tens, not thousands). View-level filtering in `useMemo` makes the "show archived" toggle trivial without modifying every query site. |

## Implementation Phases

### Phase 1: Bug Fixes -- Standings Reactivity, Notes Placeholder, Actions Reorder

**Standings reactivity fix:**
1. **Root cause:** In `AddContactDialog.handleAdd()` (Standings.tsx lines 1182-1208), `onClose()` fires immediately after `await onAdd(...)`. The IDB transaction's `oncomplete` handler resolves the Promise AND fires `storagemutated` in sequence (Dexie 4.3.0 `dexie.mjs:2783-2788`), but the Promise microtask runs before the liveQuery's async IDB re-read completes. React 19 processes the `setShowAddDialog(false)` state update and renders with stale contacts data. The subsequent liveQuery `triggerUpdate()` may be dropped by React 19 because `dexie-react-hooks` 1.1.7 uses a `useRef`+`useReducer` pattern that doesn't integrate with concurrent rendering.

2. **Fix:** In `AddContactDialog.handleAdd()` (line 1203), replace `onClose()` with `setTimeout(() => onClose(), 0)`. The `setTimeout` defers the dialog-close state update to a macrotask, giving Dexie's liveQuery re-read (which runs as microtasks + IDB async callbacks) time to complete and fire `triggerUpdate()` before React processes the dialog close. This ensures React batches both updates into one render with fresh data.

3. **Cleanup:** Move `setIsPending(false)` before `onClose()` inside the try block (after the `if/else if` calls to `onAdd`). Currently it's in the `finally` block and runs on the unmounted dialog after `onClose()`. This is harmless in React 19 but is misleading. The revised flow:
   ```
   try {
       await onAdd(...);
       setIsPending(false);
       setTimeout(() => onClose(), 0);
   } catch {
       setIsPending(false);
   }
   ```
   Note: remove the `finally` block entirely.

**Notes placeholder fix:**
4. In `apps/periscope/src/views/Deployables.tsx` line 992, change `placeholder="\u2014"` to `placeholder=""` (empty string) so blank notes show nothing.
5. In `apps/periscope/src/components/EditableCell.tsx` line 29, change the default placeholder from `"\u2014"` to `""`.
6. Other `EditableCell` usages are unaffected: the Name column (Deployables.tsx line 698) uses `children` prop which bypasses the placeholder mechanism; `StructureDetailCard.tsx` line 277 uses a custom `placeholder="Click to add notes..."`. Neither is impacted by changing the default.

**Actions column reorder:**
7. In `apps/periscope/src/views/Deployables.tsx`, move the `actions` column definition (lines 1009-1063) from the end of the `columns` array to the beginning (before the `status` column definition at line 647).

**Files changed:**
- `apps/periscope/src/views/Standings.tsx` -- fix add contact reactivity
- `apps/periscope/src/views/Deployables.tsx` -- notes placeholder, actions column order
- `apps/periscope/src/components/EditableCell.tsx` -- default placeholder change

### Phase 2: Structure Columns -- Category Column, Parent Self-Reference

**Category column (derived from gameTypes DB):**
1. In `apps/periscope/src/views/Deployables.tsx`, add a `useLiveQuery` call to load assembly-relevant game types and build a category lookup map:
   ```ts
   // Load category mapping from gameTypes DB
   const assemblyCategoryMap = useLiveQuery(async () => {
       // Get all game types that correspond to known assembly type IDs
       const typeIds = Object.keys(ASSEMBLY_TYPE_IDS).map(Number);
       const types = await db.gameTypes.where("id").anyOf(typeIds).toArray();
       const map = new Map<string, string>();
       for (const t of types) {
           map.set(t.name, t.categoryName);
       }
       return map;
   }) ?? new Map<string, string>();
   ```
   This query loads only the ~15 game types that match `ASSEMBLY_TYPE_IDS` keys. The `useLiveQuery` ensures the map updates if `gameTypes` data is refreshed. The `categoryName` field on each `GameType` record provides the canonical category from the World API.

2. Add a helper function to resolve category for a given `assemblyType` string, with a fallback chain:
   ```ts
   function resolveCategory(assemblyType: string, catMap: Map<string, string>): string {
       // Direct match (e.g. "Heavy Storage" -> "Ship / Drone / Structure Equipment")
       const direct = catMap.get(assemblyType);
       if (direct) return direct;
       // Fallback: check if assemblyType contains a known keyword
       const lower = assemblyType.toLowerCase();
       if (lower.includes("turret")) return "Turret";
       if (lower.includes("gate") || lower.includes("jumpgate") || lower.includes("stargate")) return "Gate";
       if (lower.includes("storage") || lower.includes("depot") || lower.includes("gatekeeper")) return "Storage";
       if (lower.includes("node")) return "Node";
       if (lower.includes("refinery") || lower.includes("printer") || lower.includes("manufacturing")) return "Production";
       if (lower.includes("refuge")) return "Habitat";
       return "Other";
   }
   ```
   **Note:** The `categoryName` from the World API may be too generic (e.g., all structures may share the same API category like "Structure" or "Ship / Drone / Structure Equipment"). If so, the `categoryName` won't provide useful per-type differentiation. In that case, fall back to the keyword-based classification above. The implementation agent should check the actual `categoryName` values at runtime -- if they're all identical or unhelpful, use the keyword fallback as the primary resolver and skip the DB lookup entirely.

3. Add a new column definition after the "type" column:
   ```ts
   {
       id: "category",
       accessorFn: (d) => resolveCategory(d.assemblyType, assemblyCategoryMap),
       header: "Category",
       size: 110,
       filterFn: excelFilterFn,
   }
   ```

**Parent self-reference:**
4. In the "parent" column `accessorFn` (line 864), modify the logic so that when `parentId` is undefined, network nodes return their own label. Detect nodes via keyword check on `assemblyType`: `d.assemblyType.toLowerCase().includes("node")`. Do NOT rely on `assemblyModule` since that field is absent on watched assemblies from the `assemblies` table (Deployables.tsx lines 339-356).
5. In the `ParentSelect` cell renderer, update to show the structure's own label when it's a node without an explicit parent. When `assemblyType` indicates a node and `parentId` is undefined, render the node's own label as a static span instead of the em dash.

**Files changed:**
- `apps/periscope/src/views/Deployables.tsx` -- gameTypes-based category lookup, category column, parent self-reference logic

### Phase 3: Entity Archival -- Local Hidden Flag

**DB schema:**
1. In `apps/periscope/src/db/index.ts`, add V30 after V29 (line 550). Re-declare each table's schema with `_archived` added:
   ```
   this.version(30).stores({
     currencies: "id, symbol, coinType, packageId, marketId, _archived",
     subscribedRegistries: "id, name, ticker, creator, tenant, subscribedAt, _archived",
     manifestPrivateMaps: "id, name, creator, tenant, cachedAt, _archived",
     manifestPrivateMapsV2: "id, name, creator, mode, registryId, tenant, cachedAt, _archived",
   });
   ```
2. In `apps/periscope/src/db/types.ts`, add `_archived?: boolean` field to `CurrencyRecord` (line 717), `SubscribedRegistry` (line 633), `ManifestPrivateMap` (line 472), and `ManifestPrivateMapV2` (line 522).

**Hook / helper:**
3. Create a `useArchive` hook (or add functions to existing hooks) that sets `_archived = true` on a record.
4. Add a `notArchived` filter predicate similar to `notDeleted` in `db/index.ts`.

**UI integration (view-level filtering):**
5. In `apps/periscope/src/views/Market.tsx` (currencies list), add view-level filtering: add a `showArchived` state toggle, filter currencies in `useMemo` with `!c._archived || showArchived`, and add an "Archive" action button on each currency row.
6. In `apps/periscope/src/views/Standings.tsx` (subscribed registries in `RegistriesTab`), add the same pattern: `showArchived` toggle + `useMemo` filter + "Archive" action per registry.
7. In `apps/periscope/src/views/PrivateMaps.tsx` (private maps management), add archive support for both V1 and V2 maps with the same view-level filter pattern.

**Files changed:**
- `apps/periscope/src/db/index.ts` -- V30 migration adding `_archived` indexes
- `apps/periscope/src/db/types.ts` -- add `_archived` field to 4 interfaces
- `apps/periscope/src/views/Market.tsx` -- archive button + filter toggle for currencies
- `apps/periscope/src/views/Standings.tsx` -- archive button for subscribed registries
- `apps/periscope/src/views/PrivateMaps.tsx` -- archive button for V1 and V2 private maps
- `apps/periscope/src/hooks/useRegistrySubscriptions.ts` -- archive function for subscribed registries

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/views/Standings.tsx` | Modify | Fix add-contact reactivity via `setTimeout` (Phase 1); add archive for subscribed registries (Phase 3) |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Add gameTypes-derived category column + parent self-ref (Phase 2); fix notes placeholder + reorder actions column (Phase 1) |
| `apps/periscope/src/components/EditableCell.tsx` | Modify | Change default placeholder from em dash to empty string (Phase 1) |
| `apps/periscope/src/db/index.ts` | Modify | V30 migration for `_archived` indexes (Phase 3) |
| `apps/periscope/src/db/types.ts` | Modify | Add `_archived` to CurrencyRecord, SubscribedRegistry, ManifestPrivateMap, ManifestPrivateMapV2 (Phase 3) |
| `apps/periscope/src/views/Market.tsx` | Modify | Archive/unarchive currencies, show/hide toggle with view-level filter (Phase 3) |
| `apps/periscope/src/views/PrivateMaps.tsx` | Modify | Archive/unarchive private maps V1 + V2, show/hide toggle with view-level filter (Phase 3) |
| `apps/periscope/src/hooks/useRegistrySubscriptions.ts` | Modify | Add archive function for subscribed registries (Phase 3) |

## Resolved Decisions

1. **Standings reactivity root cause:** The root cause is a race between Dexie's async liveQuery re-read and React 19's state update batching. Dexie 4.3.0 resolves the `db.contacts.add()` Promise BEFORE the liveQuery re-read completes, so `onClose()` triggers a React re-render with stale data. The `dexie-react-hooks` 1.1.7 `useRef`+`useReducer` subscription pattern may cause React 19 to drop the subsequent liveQuery update. Fix: wrap `onClose()` in `setTimeout(..., 0)`.

2. **Notes placeholder:** Completely empty -- no placeholder character. The pencil-on-hover icon is sufficient to signal editability.

3. **Category map:** Derive from `gameTypes` DB table using `useLiveQuery` to load assembly type IDs and build a `Map<string, string>` from name -> categoryName. Falls back to keyword-based classification if the World API categories are too generic.

4. **Entity archival filtering:** View-level filtering via `useMemo` in each view component. Each view has its own `showArchived` toggle and filters `_archived` records locally. This keeps queries simple and makes the toggle trivial.

## Deferred

- **On-chain destruction of shared objects** -- Not possible in Sui's current object model. If EVE Frontier adds a `deactivate` or `disable` entry point to their contracts in future cycles, we can revisit. For now, local archival is the only option.
- **Bulk archive/unarchive** -- Could add "Archive All" functionality later if the list gets long.
- **Category column icons** -- Could add per-category icons (turret icon, gate icon, etc.) to the category cells. Low priority, purely cosmetic.

## Coordination Notes

- **Plan 03 (Storage Datagrid)** also modifies `Deployables.tsx` (location formatting, extension column, datagrid data source). This plan's changes (category column, actions reorder, notes fix) are independent but must be merged carefully. Execute Phase 1 + 2 of this plan either before or after Plan 03's Deployables changes, not concurrently.
- **Plan 04 (Manifest Expansion)** also modifies `db/index.ts` and `db/types.ts`. Phase 3 of this plan (V30 migration) must be sequenced after Plan 04's DB version additions, or the version numbers must be coordinated by the coordinator.
