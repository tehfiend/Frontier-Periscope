# Plan: Structures UX v2 + Private Map Defaults

**Status:** Draft
**Created:** 2026-03-27
**Module:** periscope

## Overview

This plan covers a batch of UX improvements to the Structures (Deployables) view and a supporting feature for Private Maps. The primary goals are: (1) streamline the "Add to Map" workflow so users can add a structure's location to a private map directly from the Structures view instead of navigating away, (2) introduce CSV export for the datagrid, (3) clean up the extension column and contract display names, (4) surface the market currency as its own filterable column, (5) make the parent column filterable by ID, and (6) add Deploy/Configure buttons to the detail card.

These changes reduce friction in common workflows (adding map locations, exporting data, deploying extensions) and improve information density by giving market currency and parent IDs their own dedicated columns.

The private map default selection (item #1) is a prerequisite for item #8 (the inline "Add to Map" dialog) because the dialog should pre-select a sensible default map.

## Current State

### Private Maps
- Private maps are managed in `apps/periscope/src/views/PrivateMaps.tsx`. Maps are stored in IndexedDB (`db.manifestPrivateMaps` for V1, `db.manifestPrivateMapsV2` for V2).
- There is no concept of a "default" private map. The user must navigate to `/private-maps`, select a map, and manually add locations.
- The `appStore` (`apps/periscope/src/stores/appStore.ts`) uses Zustand with localStorage + IndexedDB hydration for persisted settings like `activeCharacterId`. This is the natural place for a `defaultMapId` setting.

### Structures / Deployables
- The main view is `apps/periscope/src/views/Deployables.tsx` (~1400 lines). It defines `StructureRow` (line 52), column definitions (line 585), and several inline sub-components (`LocationEditor`, `ParentSelect`, `FilterButton`, `StatCard`).
- **Extension column** (line 725): When `info.status === "default"`, it shows `<span className="text-xs text-zinc-600">None</span>` (line 757). The column also contains both a Configure icon button (line 793, `<Settings2>`) and a text action button (line 802, showing "Deploy", "Configure", or "Update").
- **Market currency**: The currency ticker is shown as a badge inside the extension column cell (lines 769-773). It's extracted from `extensionConfigMap` -> `extConfig.marketId` -> `currencyByMarketId`. There is no dedicated column.
- **Parent column** (line 837): Uses `parentLabels.get(d.parentId)` as the accessor, returning the parent's label (name). Network nodes with no explicit parent show their own label. The accessor returns a name string, not an ID, so filtering by object ID is impossible.
- **"Add to Map" link**: In `LocationEditor` (line 1291), when a structure has no location, it shows `<Link to="/private-maps">Add to map</Link>` -- this navigates away entirely. The `StructureDetailCard` (line 297-301) has a similar `<Link to="/private-maps">Add via Private Map</Link>`.
- **Detail card** (`apps/periscope/src/components/StructureDetailCard.tsx`): Shows structure details including extension info, fuel, location, notes, and dApp URL. It has an `onConfigure` callback but it's only rendered inside the Standings Config section (line 231). There are no standalone Deploy or Configure buttons.
- **CSV export**: No export infrastructure exists. No `papaparse` or similar dependency.

### Extension Display Names
- Extension templates are defined in `apps/periscope/src/chain/config.ts` starting at line 236:
  - `gate_standings` -> name: `"Gate Standings"` (line 239)
  - `ssu_unified` -> name: `"SSU Unified"` (line 256)
  - `turret_standings` -> name: `"Turret Priority"` (line 273)
- These names appear in the extension column cell (line 762: `info.template?.name ?? "Standings"`) and in the detail card (line 172).

### DataGrid Component
- `apps/periscope/src/components/DataGrid.tsx`: A generic TanStack Table wrapper. It accepts `actions` as a ReactNode prop rendered in the toolbar (line 112). The `table` instance with `getFilteredRowModel()` is internal to DataGrid -- not exposed to consumers. CSV export will need either a callback prop or a way to access filtered rows.

## Target State

### 1. Default Private Map Selection
- Add `defaultMapId: string | null` and `setDefaultMapId` to `appStore` with localStorage + IndexedDB persistence (same pattern as `activeCharacterId`).
- Add a "Set as Default" button or star icon next to each map in the PrivateMaps view's map list.
- The default map ID is consumed by the new inline "Add to Map" dialog (item #8).

### 2. CSV Export
- Add an "Export CSV" button to the DataGrid toolbar area (via the `actions` prop in Deployables).
- Use a zero-dependency approach: build CSV in-memory from the currently filtered `data` array (the `filteredData` passed to DataGrid), then trigger a browser download via `Blob` + `URL.createObjectURL`. No library needed for simple tabular data.
- Export columns: Status, Name, Object ID, Type, Category, Extension, Location, Parent, Standing, Owner, Runtime (hours), Notes, Updated.
- The export operates on the `filteredData` array that Deployables already computes -- this avoids needing to reach into DataGrid's internal TanStack Table state.

### 3. Extension Column -- "Deploy" Link Instead of "None"
- When `info.status === "default"` and `r.ownership === "mine"`, replace the `"None"` text with a `"Deploy"` button that opens the deploy panel (same as the existing deploy action).
- When `info.status === "default"` and `r.ownership !== "mine"`, show a dash (`--`) instead of "None".

### 4. Remove Redundant Configure Link + Add Buttons to Detail Card
- In the extension column cell (lines 789-809): remove the separate `<Settings2>` icon button (lines 792-800) since the text action button already opens the same deploy/configure panel. Keep only the text button ("Deploy", "Configure", or "Update").
- In `StructureDetailCard.tsx`: add a row of action buttons below the extension info section. Show "Deploy" if extension status is "default", "Configure" if status is "periscope", "Update" if "periscope-outdated". These call the existing `onConfigure` callback (rename parameter to `onDeploy` for clarity, or add `onDeploy` alongside `onConfigure`).

### 5. Market Currency Column
- Add a new column "Currency" after the Extension column.
- Accessor: `extConfig.marketId ? currencyByMarketId.get(extConfig.marketId) : ""`.
- Remove the currency ticker badge from the extension column cell.
- The new column uses `excelFilterFn` for filtering.

### 6. Rename Extension Contracts
- Update `EXTENSION_TEMPLATES` in `apps/periscope/src/chain/config.ts`:
  - `"Gate Standings"` -> `"Periscope Gate"`
  - `"SSU Unified"` -> `"Periscope SSU"`
  - `"Turret Priority"` -> `"Periscope Turret"`
- Update corresponding description text to use "Periscope" branding.

### 7. Parent Node as Filterable ID
- Change the parent column accessor to return a composite string that includes the parent's object ID (truncated) along with the label, enabling filtering by ID.
- Accessor: for a row with `parentId`, return `parentLabels.get(parentId) ?? "" + " " + truncateId(parentId)`. For nodes self-referencing, return `row.label + " " + truncateId(row.objectId)`.
- The cell renderer continues to show the label and a truncated ID visually.
- A node should list itself as its own parent in the accessor so it groups with its children when filtering.

### 8. "Add to Map" Inline Dialog
- Replace the `<Link to="/private-maps">Add to map</Link>` in `LocationEditor` (line 1291) and `StructureDetailCard` (line 297) with a button that opens a new `AddToMapDialog` component.
- The dialog contains:
  - A map selector dropdown listing all V1 maps (with `decryptedMapKey`) and V2 maps, defaulting to `appStore.defaultMapId`.
  - Structure name pre-filled as description.
  - System ID, Planet, and L-Point inputs pre-filled from the structure's current local location data (if any).
  - Structure Object ID pre-filled.
  - "Add Location" button that builds the TX and signs it.
- The dialog reuses the encryption/TX-building logic from `AddLocationDialog` in `PrivateMaps.tsx` (lines 1346-1495). Extract that logic into a shared utility or component that both views can import.
- After successful addition, also update the structure's local systemId/lPoint in the DB if they were empty, and trigger a map location sync.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default map storage | appStore (Zustand) + localStorage + IndexedDB | Matches existing pattern for `activeCharacterId`. Fast synchronous read on startup. |
| CSV export approach | Zero-dependency Blob download from `filteredData` | Simple tabular data does not warrant a library. The filtered data array is already available in the Deployables component. |
| CSV trigger location | Button in DataGrid `actions` prop area | Keeps export co-located with other toolbar actions. No DataGrid internal changes needed. |
| Extension "None" replacement | "Deploy" button for owned, dash for watched | More actionable than passive "None" text. Watched structures cannot be deployed to. |
| Detail card buttons | New `onDeploy` prop + existing `onConfigure` | Separates deploy (create new extension) from configure (modify existing). The deploy panel handles both cases already. |
| Contract rename scope | `EXTENSION_TEMPLATES[].name` in config.ts only | Single source of truth. Name propagates everywhere through `classifyExtension` -> `info.template.name`. |
| Parent accessor format | Label + truncated objectId in accessor string | Enables TanStack Table's filter to match against both name and ID fragments. |
| AddToMapDialog location | New component in `apps/periscope/src/components/AddToMapDialog.tsx` | Shared between Deployables and StructureDetailCard. Keeps PrivateMaps.tsx from growing. |
| Encryption key requirement | Dialog uses `useStoredEncryptionKey` hook | Same pattern as PrivateMaps. Key auto-derives on first use. For V2 standings-gated maps with `mode === 1`, no encryption needed. |

## Implementation Phases

### Phase 1: Foundation -- Default Map + Contract Renames
1. Add `defaultMapId: string | null`, `setDefaultMapId` action to `appStore.ts` with localStorage key `"periscope:defaultMapId"` and IndexedDB setting key `"defaultMapId"`. Follow the same hydration pattern as `activeCharacterId` (lines 36-44, 72-80).
2. In `PrivateMaps.tsx`, add a "Set Default" star/button to each `MapCard` and `MapCardV2`. When clicked, call `useAppStore.getState().setDefaultMapId(mapId)`. Highlight the default map visually (e.g., a star icon or border change).
3. Rename extension templates in `apps/periscope/src/chain/config.ts`:
   - Line 239: `"Gate Standings"` -> `"Periscope Gate"`
   - Line 256: `"SSU Unified"` -> `"Periscope SSU"`
   - Line 273: `"Turret Priority"` -> `"Periscope Turret"`
4. Update descriptions to reference "Periscope" branding (lines 240-242, 257-258, 274-276).

### Phase 2: Column Cleanup -- Extension, Currency, Parent
1. **Extension column "None" -> "Deploy"**: In `Deployables.tsx` line 757, replace `<span className="text-xs text-zinc-600">None</span>` with a conditional: if `r.ownership === "mine"`, show a "Deploy" button that calls `setDeployTarget(r)`; otherwise show a dash.
2. **Remove redundant Configure icon**: Delete the `<Settings2>` icon button block at lines 792-800 in the extension column cell.
3. **Market currency column**: Add a new column definition after the extension column (after line 813). Accessor: `extensionConfigMap.get(d.objectId)?.marketId ? currencyByMarketId.get(extensionConfigMap.get(d.objectId)!.marketId!) ?? "" : ""`. Header: "Currency". Size: 100. filterFn: `excelFilterFn`. Remove the ticker badge from the extension column cell (delete lines 769-773).
4. **Parent column -> filterable by ID**: Change the accessor at line 838-842 to include the objectId. For rows with `parentId`, return `(parentLabels.get(d.parentId) ?? "") + " " + (d.parentId?.slice(0, 10) ?? "")`. For self-referencing nodes, return `d.label + " " + d.objectId.slice(0, 10)`. Update the cell renderer to display the truncated ID next to the label (e.g., as a faint mono-spaced suffix).

### Phase 3: Detail Card Buttons + CSV Export
1. **Detail card Deploy/Configure buttons**: In `StructureDetailCard.tsx`, add a new prop `onDeploy?: (row: StructureRow) => void`. Add a button row after the extension info section (after line 219, before the Location section at line 290). Show:
   - "Deploy Extension" button when `extensionInfo.status === "default"` and `row.ownership === "mine"` -> calls `onDeploy`.
   - "Configure" button when `extensionInfo.status === "periscope"` and `row.ownership === "mine"` -> calls `onConfigure`.
   - "Update Extension" button when `extensionInfo.status === "periscope-outdated"` and `row.ownership === "mine"` -> calls `onDeploy`.
2. Wire up `onDeploy` in `Deployables.tsx` where `StructureDetailCard` is rendered (line 1127). Set `onDeploy={(row) => setDeployTarget(row)}` and `onConfigure={(row) => setDeployTarget(row)}`.
3. **CSV export**: Create a `exportToCsv` utility function in `apps/periscope/src/lib/csv.ts`. It accepts an array of objects and column definitions (header + accessor key), builds a CSV string with proper escaping (quotes around fields containing commas/quotes/newlines), and triggers a browser download.
4. Add an "Export CSV" button to the Deployables toolbar `actions` area (after the "Sync Chain" button, around line 1121). On click, call `exportToCsv` with `filteredData` and the relevant column accessors. File name: `structures-{ISO date}.csv`.

### Phase 4: Inline "Add to Map" Dialog
1. Create `apps/periscope/src/components/AddToMapDialog.tsx`. Props: `structureRow: StructureRow`, `onClose`, `onAdded?`. The component:
   - Reads all V1 and V2 maps from IndexedDB via `useLiveQuery`.
   - Uses `useStoredEncryptionKey` for encryption.
   - Shows a map selector dropdown, defaulting to `useAppStore(s => s.defaultMapId)`.
   - Pre-fills description with `structureRow.label`, structureId with `structureRow.objectId`.
   - Pre-fills system ID from `structureRow.systemId`, derives planet/lPoint from `structureRow.lPoint` if available.
   - On submit: encrypts location data (for V1 and V2 mode=0 maps) or sends cleartext (for V2 mode=1), builds the appropriate TX (`buildAddLocation` for V1, `buildAddLocationEncrypted`/`buildAddLocationStandings` for V2), signs and executes.
   - On success: updates the structure's local systemId/lPoint if they were previously empty, syncs map locations.
2. In `Deployables.tsx`, add state `const [addToMapTarget, setAddToMapTarget] = useState<StructureRow | null>(null)`. Replace `<Link to="/private-maps">Add to map</Link>` at line 1291 with `<button onClick={() => setAddToMapTarget(r)}>Add to map</button>`. Render `AddToMapDialog` when `addToMapTarget` is set.
3. In `StructureDetailCard.tsx`, add an `onAddToMap?: (row: StructureRow) => void` prop. Replace the `<Link to="/private-maps">Add via Private Map</Link>` at line 297-301 with a button calling `onAddToMap`. Wire it up in Deployables.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/stores/appStore.ts` | Modify | Add `defaultMapId` state + setter with localStorage/IndexedDB persistence |
| `apps/periscope/src/chain/config.ts` | Modify | Rename extension template names to Periscope branding |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Extension column cleanup, currency column, parent column ID, CSV export button, Add to Map dialog integration |
| `apps/periscope/src/components/StructureDetailCard.tsx` | Modify | Add Deploy/Configure/Update buttons, Add to Map button, new `onDeploy`/`onAddToMap` props |
| `apps/periscope/src/views/PrivateMaps.tsx` | Modify | Add "Set Default" map button to MapCard/MapCardV2 |
| `apps/periscope/src/lib/csv.ts` | Create | Zero-dependency CSV export utility (build string + trigger download) |
| `apps/periscope/src/components/AddToMapDialog.tsx` | Create | Shared inline dialog for adding a structure location to a private map |

## Open Questions

1. **V2 map support in AddToMapDialog -- which TX builders to use?**
   - **Option A: V1 maps only** -- Only support `buildAddLocation` (V1 encrypted maps). Simpler, but V2 maps are the newer format.
     Pros: Less code, V1 is proven. Cons: Users with only V2 maps cannot use inline add.
   - **Option B: V1 + V2 support** -- Handle both V1 (`buildAddLocation`) and V2 (`buildAddLocationEncrypted` for mode=0, `buildAddLocationStandings` for mode=1).
     Pros: Full compatibility. Cons: More complex dialog logic, needs to branch on map version and mode.
   - **Recommendation:** Option B. V2 maps are the active format. The branching logic is manageable since the three TX builders share similar parameter shapes.

2. **CSV export -- should DataGrid expose filtered rows, or should Deployables export from its own `filteredData`?**
   - **Option A: Export from Deployables' `filteredData`** -- The export button lives in Deployables' `actions` slot and operates on `filteredData` (the quick-filter result). Does not respect DataGrid's internal column filters.
     Pros: Simple, no DataGrid changes. Cons: Column-level filters are not reflected in export.
   - **Option B: Add `onExport` callback to DataGrid** -- DataGrid calls an `onExport(rows)` callback with `getFilteredRowModel().rows` when an internal export button is clicked.
     Pros: Exports exactly what the user sees. Cons: Requires DataGrid API change, tighter coupling.
   - **Recommendation:** Option B. Users expect "export what I see." The DataGrid change is minimal -- add an optional `onExport` prop and a download icon button that passes the filtered rows.

3. **Parent column ID format -- how much of the objectId to show?**
   - **Option A: First 10 chars** -- e.g., "My SSU 0x1a2b3c4d5e". Compact but may not be unique enough for filtering.
   - **Option B: First 8 + last 4 chars** -- e.g., "My SSU 0x1a2b..3d5e". More distinctive, matches CopyAddress conventions.
   - **Recommendation:** Option A for the accessor (filtering), Option B for the cell renderer (display). The accessor just needs enough chars to disambiguate when typing a filter; the cell renderer can show the prettier truncated form.

## Deferred

- **Drag-and-drop location reordering in private maps** -- Out of scope for this plan; no current request.
- **Batch CSV import for structures** -- Inverse of export; could be useful but not requested.
- **Private map sharing from the AddToMapDialog** -- Creating new maps inline is too complex; keep that on the Private Maps page.
- **V2 map invite support in AddToMapDialog** -- The dialog only adds locations to maps the user is already a member of. Inviting new members stays on the Private Maps page.
