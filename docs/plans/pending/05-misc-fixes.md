# Plan: Misc Fixes -- Standings, Structure Columns, Entity Deletion
**Status:** Pending
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
- The issue: `onAdd` is passed directly as `addContact` from `useAddContact()`. The dialog calls `await onAdd(...)` then `onClose()`. Dexie's `useLiveQuery` should pick up the new record. However, the dialog closes synchronously after the await -- this should work because `db.contacts.add()` completes before the dialog closes, and `useLiveQuery` is on the parent `ContactsTab` component which remains mounted.
- **Root cause hypothesis:** The `useLiveQuery` dependency array is empty (`[]` implicit default), so Dexie should auto-subscribe. However, the `contacts` value defaults to `?? []` on line 20 -- `useLiveQuery` returns `undefined` on first render and during query re-execution. If there's a timing issue where the query re-fires but the component doesn't re-render, the new contact won't appear. More likely: the `useMemo` on line 225-235 depends on `[contacts, filterKind]` -- if `contacts` reference doesn't change (same array object), the memo won't recompute. But Dexie `useLiveQuery` returns a new array reference on each change, so this should work. Need to test and verify the actual cause during implementation.

### Structure Category Column
- `ASSEMBLY_TYPE_IDS` in `apps/periscope/src/chain/config.ts:184-200` maps numeric type IDs to specific names like "Heavy Storage", "Light Turret", "Stargate", etc.
- The `GameType` interface in `db/types.ts:50-63` has `groupName`, `groupId`, `categoryName`, `categoryId` fields. The `gameTypes` table is indexed on these (db/index.ts line 160).
- The `assemblyType` field on `StructureRow` (Deployables.tsx line 59) contains the resolved type name string (e.g., "Light Turret", "Stargate", "Heavy Storage").
- Currently there is no "category" column in the datagrid. The "Type" column shows the specific type name.
- Category derivation: The `ASSEMBLY_TYPE_IDS` map already groups items by comment (Gates, Turrets, SSU). A static lookup map from type name to category ("Turret", "Gate", "Storage", "Node", etc.) is the simplest approach since assembly types are a small, known set.

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
- **This should render a real em dash character**, not the literal string `\u2014`. The `\u2014` in a JavaScript string literal IS the em dash character (Unicode code point U+2014). So if users see the literal text `\u2014`, the issue is likely in how the value was stored (the notes field might contain the literal string `\u2014` instead of being empty/undefined).
- Actually, re-reading the issue: "Notes shows `\u2014` for blank entries." Looking at the code, `placeholder="\u2014"` in JSX renders the em dash character correctly. The user might be reporting that blank entries show an em dash character (which is the designed placeholder behavior) rather than being truly blank. OR the `\u2014` is being displayed as a literal escaped string somewhere. Need to verify during implementation.
- Looking more carefully: the `handleSaveNotes` function (line 489-502) saves `notes: newNotes || undefined`. So saving an empty string stores `undefined`. The row creation (line 316) uses `notes: d.notes` which could be `undefined`. The column `accessorKey: "notes"` will return `undefined`, and `EditableCell` receives `value={r.notes ?? ""}`. This flow should work -- the placeholder em dash shows when `value` is empty. The reported bug might be that users want blank notes to show nothing (empty space) rather than an em dash placeholder.

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
2. **Category column:** A new "Category" column in the Deployables datagrid that groups structures by general type (Turret, Gate, Storage, Node, etc.) with Excel-style filtering.
3. **Parent node column:** Network nodes (and any structure without a parent) show themselves as their own parent, enabling "filter by node" workflows.
4. **Notes placeholder fix:** Blank notes show an empty cell (no placeholder character) or show a subtle placeholder only on hover.
5. **Actions column first:** The actions column moves to the leftmost position in the datagrid.
6. **Entity archival:** A local "archived" flag on currencies, subscribed registries, and private maps, with UI to hide/show archived items.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Category derivation | Static map from assembly type name to category | The set of structure types is small and known (~15 entries in `ASSEMBLY_TYPE_IDS`). A static map is simpler than joining against `gameTypes` table and doesn't require the types data to be loaded. |
| Parent self-reference | Display-side only (don't mutate DB) | Show the structure's own label when `parentId` is undefined and the structure is a network node. Avoids polluting the DB with self-referential IDs. |
| Notes placeholder | Remove em dash placeholder, show empty | An em dash for "no notes" is confusing -- it looks like data. Show nothing for empty notes; the pencil-on-hover still signals editability. |
| On-chain deletion | Local-only archival with `_archived` flag | Sui shared objects cannot be destroyed. A local `_archived: boolean` flag in IndexedDB is the only viable approach. Keeps chain state honest while letting users declutter their UI. |
| Entity archive scope | currencies, subscribedRegistries, manifestPrivateMaps, manifestPrivateMapsV2 | These are the user-created/subscribed on-chain entities that accumulate over time and need cleanup. |

## Implementation Phases

### Phase 1: Bug Fixes -- Standings Reactivity, Notes Placeholder, Actions Reorder

**Standings reactivity fix:**
1. **Root cause analysis:** In `apps/periscope/src/views/Standings.tsx` line 1182-1208, the `handleAdd` flow is: `await onAdd(...)` -> `onClose()` -> `setIsPending(false)` in `finally`. The `onClose()` calls `setShowAddDialog(false)` which unmounts the dialog. The `finally` block then calls `setIsPending(false)` on an unmounted component (harmless in React 19 but a sign of lifecycle confusion). The `ContactsTab` parent remains mounted and has `useLiveQuery(() => db.contacts.toArray())` at line 216.

   The likely cause: `db.contacts.add()` completes (IDB transaction commits), then `onClose()` triggers a synchronous React re-render. Dexie's observation system fires the `useLiveQuery` callback asynchronously (via microtask or IDB event). If React 19 batches the `setShowAddDialog(false)` re-render and processes it before Dexie's notification arrives, the first render after dialog close still has stale data. The Dexie notification then triggers a second re-render -- but depending on React's scheduling, this may be deferred or lost.

2. **Fix approach:** In `AddContactDialog.handleAdd()` (line 1182), wrap `onClose()` in a `queueMicrotask()` or `setTimeout(() => onClose(), 0)` to let Dexie's observation fire before the dialog unmounts. This gives `useLiveQuery` a chance to process the IDB change notification before the React tree re-renders.

3. **Alternative fix (if microtask doesn't help):** Move the contact list to a Zustand store with manual `set()` calls, making it synchronously reactive. This is heavier but guaranteed to work. Only do this if approach 2 fails.

4. **Cleanup:** Move `setIsPending(false)` before `onClose()` to avoid setting state on unmounted component.

**Notes placeholder fix:**
5. In `apps/periscope/src/views/Deployables.tsx` line 992, change `placeholder="\u2014"` to `placeholder=""` (empty string) so blank notes show nothing.
6. In `apps/periscope/src/components/EditableCell.tsx` line 29, change the default placeholder from `"\u2014"` to `""`.
7. Other `EditableCell` usages are unaffected: the Name column (Deployables.tsx line 698) uses `children` prop which bypasses the placeholder mechanism; `StructureDetailCard.tsx` line 277 uses a custom `placeholder="Click to add notes..."`. Neither is impacted by changing the default.

**Actions column reorder:**
8. In `apps/periscope/src/views/Deployables.tsx`, move the `actions` column definition (lines 1009-1063) from the end of the `columns` array to the beginning (before the `status` column definition at line 647).

**Files changed:**
- `apps/periscope/src/views/Standings.tsx` -- fix add contact reactivity
- `apps/periscope/src/views/Deployables.tsx` -- notes placeholder, actions column order
- `apps/periscope/src/components/EditableCell.tsx` -- default placeholder change

### Phase 2: Structure Columns -- Category Column, Parent Self-Reference

**Category column:**
1. In `apps/periscope/src/views/Deployables.tsx`, add a `CATEGORY_MAP` constant that maps assembly type names to category strings. Must cover values from `ASSEMBLY_TYPE_IDS` (config.ts:184-200), `ASSEMBLY_KIND_NAMES` (Deployables.tsx:121-128), and fallback strings from `assembly.type.replace("_", " ")`:
   ```
   const CATEGORY_MAP: Record<string, string> = {
     // From ASSEMBLY_TYPE_IDS
     "Heavy Storage": "Storage",
     "Protocol Depot": "Storage",
     "Portable Storage": "Storage",
     "Gatekeeper": "Storage",
     "Stargate": "Gate",
     "Jumpgate": "Gate",
     "Light Turret": "Turret",
     "Medium Turret": "Turret",
     "Heavy Turret": "Turret",
     "Network Node": "Node",
     "Portable Refinery": "Production",
     "Portable Printer": "Production",
     "Refuge": "Habitat",
     // From ASSEMBLY_KIND_NAMES (fallback when type ID not in ASSEMBLY_TYPE_IDS)
     "Smart Storage Unit": "Storage",
     "Turret": "Turret",
     // From assembly.type.replace("_", " ") fallback
     "storage unit": "Storage",
     "smart storage unit": "Storage",
     "gate": "Gate",
     "turret": "Turret",
     "network node": "Node",
     "protocol depot": "Storage",
     // Legacy/other names from AUTO_TYPE_NAMES
     "Gate": "Gate",
     "Assembly": "Other",
     "Manufacturing": "Production",
     "Refinery": "Production",
   };
   ```
2. Add a new column definition after the "type" column:
   ```
   {
     id: "category",
     accessorFn: (d) => CATEGORY_MAP[d.assemblyType] ?? "Other",
     header: "Category",
     size: 110,
     filterFn: excelFilterFn,
   }
   ```

**Parent self-reference:**
3. In the "parent" column `accessorFn` (line 864), modify the logic so that when `parentId` is undefined, network nodes return their own label. Check via `CATEGORY_MAP[d.assemblyType] === "Node"` (not `assemblyModule` since that field is absent on watched assemblies from the `assemblies` table -- see Deployables.tsx lines 339-356 where watched rows omit `assemblyModule`).
4. In the `ParentSelect` cell renderer, update to show the structure's own label when it's a node without an explicit parent. When the category is "Node" and `parentId` is undefined, render the node's own label instead of the em dash.

**Files changed:**
- `apps/periscope/src/views/Deployables.tsx` -- category map, category column, parent self-reference logic

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

**UI integration:**
5. In `apps/periscope/src/views/Market.tsx` (currencies list), add an "Archive" action button and a "Show Archived" toggle.
6. In `apps/periscope/src/views/Standings.tsx` (subscribed registries in `RegistriesTab`), add an "Archive" action and toggle.
7. In `apps/periscope/src/views/PrivateMaps.tsx` (private maps management), add archive support for both V1 and V2 maps.

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
| `apps/periscope/src/views/Standings.tsx` | Modify | Fix add-contact reactivity (Phase 1); add archive for subscribed registries (Phase 3) |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Add category column + parent self-ref (Phase 2); fix notes placeholder + reorder actions column (Phase 1) |
| `apps/periscope/src/components/EditableCell.tsx` | Modify | Change default placeholder from em dash to empty string (Phase 1) |
| `apps/periscope/src/db/index.ts` | Modify | V30 migration for `_archived` indexes (Phase 3) |
| `apps/periscope/src/db/types.ts` | Modify | Add `_archived` to CurrencyRecord, SubscribedRegistry, ManifestPrivateMap, ManifestPrivateMapV2 (Phase 3) |
| `apps/periscope/src/views/Market.tsx` | Modify | Archive/unarchive currencies, show/hide toggle (Phase 3) |
| `apps/periscope/src/views/PrivateMaps.tsx` | Modify | Archive/unarchive private maps V1 + V2, show/hide toggle (Phase 3) |
| `apps/periscope/src/hooks/useRegistrySubscriptions.ts` | Modify | Add archive function for subscribed registries (Phase 3) |

## Open Questions

1. **Standings reactivity root cause -- is it a Dexie live query timing issue or a React rendering issue?**
   - **Option A: Race condition in dialog close** -- The dialog closes before Dexie's live query subscription fires. Pros: Simple to test, fix with `requestAnimationFrame`. Cons: May not be the actual cause.
   - **Option B: `useLiveQuery` subscription stale** -- Dexie's observation system might miss the add due to a subscription timing gap. Pros: Would explain "works after reload" behavior. Cons: Would be a Dexie bug, less likely.
   - **Option C: React batching** -- React 19's automatic batching might delay the re-render. Pros: Fits the symptom. Cons: `useLiveQuery` should trigger outside React's batching.
   - **Recommendation:** Investigate all three during implementation. Start with Option A (add `requestAnimationFrame` wrapper around `onClose`). If that doesn't work, try adding a force-update counter as a `useLiveQuery` dependency.

2. **Notes placeholder: empty vs subtle indicator?**
   - **Option A: Completely empty** -- Blank notes show nothing at all. Pros: Clean, no confusion. Cons: Harder to discover that the cell is editable.
   - **Option B: Subtle "Add note..." text on hover** -- Show faint placeholder text only on hover. Pros: Discoverable, clean when not interacting. Cons: Slightly more complex CSS.
   - **Recommendation:** Option A. The pencil icon on hover (already in EditableCell) is sufficient to signal editability. Em dash or text placeholders add visual noise.

3. **Category map: hardcoded vs derived from gameTypes DB?**
   - **Option A: Hardcoded static map** -- Map `ASSEMBLY_TYPE_IDS` values to categories manually. Pros: No async data dependency, works immediately. Cons: Must update when new structure types are added.
   - **Option B: Derive from gameTypes table** -- Look up each type's `categoryName` from the DB. Pros: Automatically correct. Cons: Requires gameTypes data to be loaded, async complexity, the game data categories may not match the user-friendly groupings desired.
   - **Recommendation:** Option A. The structure type set changes rarely (game updates), and the user wants custom categories ("Turret" for all turret variants) that may not match the game's own category hierarchy.

4. **Entity archival: DB-level filter vs view-level filter?**
   - **Option A: DB-level -- always filter `_archived` in queries** -- Add `.filter(r => !r._archived)` to all relevant queries. Pros: Consistent, archived items never leak into UI. Cons: Must update every query site.
   - **Option B: View-level -- filter in the React component** -- Let queries return all records, filter in `useMemo`. Pros: Easy to add "show archived" toggle. Cons: Slightly more data loaded.
   - **Recommendation:** Option B. The number of archived entities will be small (tens, not thousands). View-level filtering makes the "show archived" toggle trivial.

## Deferred

- **On-chain destruction of shared objects** -- Not possible in Sui's current object model. If EVE Frontier adds a `deactivate` or `disable` entry point to their contracts in future cycles, we can revisit. For now, local archival is the only option.
- **Bulk archive/unarchive** -- Could add "Archive All" functionality later if the list gets long.
- **Category column icons** -- Could add per-category icons (turret icon, gate icon, etc.) to the category cells. Low priority, purely cosmetic.

## Coordination Notes

- **Plan 03 (Storage Datagrid)** also modifies `Deployables.tsx` (location formatting, extension column, datagrid data source). This plan's changes (category column, actions reorder, notes fix) are independent but must be merged carefully. Execute Phase 1 + 2 of this plan either before or after Plan 03's Deployables changes, not concurrently.
- **Plan 04 (Manifest Expansion)** also modifies `db/index.ts` and `db/types.ts`. Phase 3 of this plan (V30 migration) must be sequenced after Plan 04's DB version additions, or the version numbers must be coordinated by the coordinator.
