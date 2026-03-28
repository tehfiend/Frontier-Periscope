# Plan: Structures UX v2 + Private Map Defaults

**Status:** Ready
**Created:** 2026-03-27
**Updated:** 2026-03-28
**Module:** periscope

## Overview

This plan covers a batch of UX improvements to the Structures (Deployables) view and a supporting feature for Private Maps. The primary goals are: (1) streamline the "Add to Map" workflow so users can add a structure's location to a private map directly from the Structures view instead of navigating away, (2) introduce CSV export for the datagrid, (3) clean up the extension column and contract display names, (4) surface the market currency as its own filterable column, (5) make the parent column filterable by ID, (6) add Deploy/Configure buttons to the detail card, and (7) fix detection of user-published turret extensions so they show "Periscope Turret" instead of "Custom".

These changes reduce friction in common workflows (adding map locations, exporting data, deploying extensions) and improve information density by giving market currency and parent IDs their own dedicated columns.

The private map default selection (item #1) is a prerequisite for item #8 (the inline "Add to Map" dialog) because the dialog should pre-select a sensible default map.

## Current State

### Private Maps
- Private maps are managed in `apps/periscope/src/views/PrivateMaps.tsx`. Maps are stored in IndexedDB (`db.manifestPrivateMaps` for V1, `db.manifestPrivateMapsV2` for V2).
- There is no concept of a "default" private map. The user must navigate to `/private-maps`, select a map, and manually add locations.
- The existing `AddLocationDialog` (line 1346) only supports V1 maps (`ManifestPrivateMap`). For V2 maps, the "Add Location" button exists in the UI (line 400) but the dialog never renders because `selectedMap` is null for V2 (line 110: `selectedMapVersion === "v1" ? selectedMapV1 : null`). This means V2 add-location is currently unimplemented.
- The `appStore` (`apps/periscope/src/stores/appStore.ts`) uses Zustand with localStorage + IndexedDB hydration for persisted settings like `activeCharacterId`. This is the natural place for a `defaultMapId` setting.

### Structures / Deployables
- The main view is `apps/periscope/src/views/Deployables.tsx` (~1500 lines). It defines `StructureRow` (line 52), column definitions (line 585), and several inline sub-components (`LocationEditor`, `ParentSelect`, `FilterButton`, `StatCard`).
- **Extension column** (line 725): When `info.status === "default"`, it shows `<span className="text-xs text-zinc-600">None</span>` (line 757). The column also contains both a Configure icon button (line 793, `<Settings2>`) and a text action button (line 802, showing "Deploy", "Configure", or "Update").
- **Market currency**: The currency ticker is shown as a badge inside the extension column cell (lines 769-773). It's extracted from `extensionConfigMap` -> `extConfig.marketId` -> `currencyByMarketId`. There is no dedicated column.
- **Parent column** (line 837): Uses `parentLabels.get(d.parentId)` as the accessor, returning the parent's label (name). Network nodes with no explicit parent show their own label. The accessor returns a name string, not an ID, so filtering by object ID is impossible. The `parentId` field itself is a Dexie row ID (UUID, 36 chars) when set manually via `ParentSelect` (which saves `o.id`, line 1479), or a Sui object ID when set from chain sync via `energySourceId`. The `parentLabels` map (line 408) indexes by both `row.id` and `row.objectId`.
- **"Add to Map" link**: In `LocationEditor` (line 1291), when a structure has no location, it shows `<Link to="/private-maps">Add to map</Link>` -- this navigates away entirely. The `StructureDetailCard` (lines 296-302) has a similar `<Link to="/private-maps">Add via Private Map</Link>`.
- **Detail card** (`apps/periscope/src/components/StructureDetailCard.tsx`): Shows structure details including extension info, fuel, location, notes, and dApp URL. It accepts an `onConfigure` prop but it's only rendered inside the Standings Config section (line 230). Importantly, `onConfigure` is NOT currently passed from Deployables.tsx (only `onReset`, `onSaveNotes`, and `isResetting` are wired at line 1127). There are no standalone Deploy or Configure buttons.
- **CSV export**: No CSV export infrastructure exists. No `papaparse` or similar dependency. However, `apps/periscope/src/lib/dataExport.ts` has a JSON backup export that uses the `Blob` + `URL.createObjectURL` + programmatic click pattern -- the CSV download trigger can reuse this approach.

### Extension Display Names
- Extension templates are defined in `apps/periscope/src/chain/config.ts` starting at line 236:
  - `gate_standings` -> name: `"Gate Standings"` (line 239)
  - `ssu_unified` -> name: `"SSU Unified"` (line 256)
  - `turret_standings` -> name: `"Turret Priority"` (line 273)
- These names appear in the extension column cell (line 762: `info.template?.name ?? "Standings"`) and in the detail card (line 172).

### Turret Extension Detection Bug
- **Bug:** A user-published turret extension shows "Custom" instead of "Periscope Turret" on the Structures page.
- **Root cause -- two failures in the detection chain:**
  1. `useStructureRows` (line 62-73) builds `extensionByAssembly` from `db.extensions`, looking up `tmpl.packageIds[tenant]`. But for the `turret_standings` template, `packageIds` is `{}` (empty -- turrets use per-user published packages). So `pkgId` is undefined, and no entry is added to the map. The fallback `extensionByAssembly.get(d.objectId) ?? d.extensionType` uses the raw chain-synced value.
  2. `classifyExtension` (config.ts line 310) checks the on-chain extension TypeName (e.g. `0x<user-pkg>::turret_priority::TurretPriorityAuth`) against template witness types. For turret_standings, the witness `turret_priority::TurretPriorityAuth` matches, but `template.packageIds[tenant]` is undefined, so the package ID check fails. This falls through to `return { status: "periscope-outdated", template }` -- or if the on-chain extension format doesn't contain the full `::turret_priority::TurretPriorityAuth` path, it returns `{ status: "unknown" }` (shown as "Custom").
- **Key insight:** The `TurretPublishFlow` already saves the `publishedPackageId` to `StructureExtensionConfig` (line 248). This is the source of truth for detecting user-published turret packages. The fix should check `publishedPackageId` from the extension config when classifying turret extensions.
- **Where the data lives:**
  - `db.structureExtensionConfigs` -- `publishedPackageId` field (type `StructureExtensionConfig`, db/types.ts line 274)
  - `db.extensions` -- `templateId: "turret_standings"` with the assembly linkage
  - `TurretPublishFlow` (line 248) saves `publishedPackageId` to the config
- **Affected files:**
  - `apps/periscope/src/hooks/useStructureRows.ts` -- `extensionByAssembly` needs to handle turrets
  - `apps/periscope/src/chain/config.ts` -- `classifyExtension` needs a way to accept known user package IDs
  - `apps/periscope/src/views/Deployables.tsx` -- pass turret package IDs into classification
  - `apps/periscope/src/components/StructureDetailCard.tsx` -- pass `knownPackageId` to `classifyExtension` (line 70 calls it without turret package ID)

### DataGrid Component
- `apps/periscope/src/components/DataGrid.tsx`: A generic TanStack Table wrapper. It accepts `actions` as a ReactNode prop rendered in the toolbar (line 112). The `table` instance with `getFilteredRowModel()` is internal to DataGrid -- not exposed to consumers. CSV export will need either a callback prop or a way to access filtered rows.

## Target State

### 1. Default Private Map Selection
- Add `defaultMapId: string | null` and `setDefaultMapId` to `appStore` with localStorage + IndexedDB persistence (same pattern as `activeCharacterId`).
- Add a "Set as Default" button or star icon next to each map in the PrivateMaps view's map list.
- The default map ID is consumed by the new inline "Add to Map" dialog (item #8).

### 2. CSV Export
- Add an "Export CSV" button to the DataGrid toolbar area.
- Use a zero-dependency approach: build CSV in-memory from the filtered row data, then trigger a browser download via `Blob` + `URL.createObjectURL` (same pattern as `lib/dataExport.ts`). No library needed for simple tabular data.
- Export columns: Status, Name, Object ID, Type, Category, Extension, Location, Parent, Standing, Owner, Runtime (hours), Notes, Updated.
- DataGrid exposes its post-column-filter rows via an `onExport` callback so the export reflects exactly what the user sees.

### 3. Extension Column -- "Deploy" Link Instead of "None"
- When `info.status === "default"` and `r.ownership === "mine"`, replace the `"None"` text with a `"Deploy"` button that opens the deploy panel (same as the existing deploy action).
- When `info.status === "default"` and `r.ownership !== "mine"`, show a dash (`--`) instead of "None".

### 4. Remove Redundant Configure Link + Add Buttons to Detail Card
- In the extension column cell (lines 789-809): remove the separate `<Settings2>` icon button (lines 791-801, including comment and closing `)}`) since the text action button already opens the same deploy/configure panel. Keep only the text button ("Configure" or "Update") -- but hide it for `info.status === "default"` since the inline "Deploy" (item #3) handles that case.
- In `StructureDetailCard.tsx`: add a row of action buttons below the Extension Type section (after line 220). Show "Deploy" if extension status is "default", "Configure" if status is "periscope", "Update" if "periscope-outdated". These use a new `onDeploy` prop for deploy/update and the existing `onConfigure` prop for configure. Also remove the existing "Configure" button in the Standings Config header (lines 230-238) since the new button row replaces it and the old one lacked an ownership guard.

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
- Change the parent column accessor to include the raw `parentId` value alongside the label, enabling filtering by ID.
- The `parentId` values are either UUIDs (36-char, from manual ParentSelect assignment, line 1479: `onSave(o.id)`) or Sui object IDs (from chain sync via `energySourceId`). Since UUIDs are reasonably short and Sui object IDs need truncation, append the full `parentId` to the accessor string (no truncation). The column filter's text search will match against any substring.
- Accessor: for a row with `parentId`, return `(parentLabels.get(parentId) ?? "") + " " + parentId`. For self-referencing nodes, return `row.label + " " + row.id + " " + row.objectId` (include both IDs since children's `parentId` can be either a Dexie UUID from manual ParentSelect or a Sui objectId from chain sync).
- The cell renderer shows the label only (no visible ID) -- the IDs are in the accessor for filtering purposes only.
- A node should list itself as its own parent in the accessor so it groups with its children when filtering.

### 8. "Add to Map" Inline Dialog
- Replace the `<Link to="/private-maps">Add to map</Link>` in `LocationEditor` (line 1291) and `StructureDetailCard` (lines 296-302) with a button that opens a new `AddToMapDialog` component.
- The dialog contains:
  - A map selector dropdown listing all V1 maps (with `decryptedMapKey`) and V2 maps, defaulting to `appStore.defaultMapId`.
  - Structure name pre-filled as description.
  - System ID, Planet, and L-Point inputs pre-filled from the structure's current local location data (if any).
  - Structure Object ID pre-filled.
  - "Add Location" button that builds the TX and signs it.
- The dialog supports both V1 and V2 maps. V1 uses `buildAddLocation` (encrypted). V2 branches on mode: `buildAddLocationEncrypted` for mode=0, `buildAddLocationStandings` for mode=1.
- The dialog reuses the encryption/TX-building logic from `AddLocationDialog` in `PrivateMaps.tsx` (lines 1346-1495). Extract that logic into a shared utility or component that both views can import.
- After successful addition, also update the structure's local systemId/lPoint in the DB if they were empty, and trigger a map location sync.

### 9. Turret Extension Detection Fix
- Fix `classifyExtension` to recognize user-published turret packages. The approach: accept an optional `knownPackageId?: string` parameter so the caller can pass the published package ID for turrets. The caller resolves the package ID before calling (e.g., `turretPackageIds.get(d.objectId)` in Deployables, `extConfig?.publishedPackageId` in StructureDetailCard).
- Fix `useStructureRows`'s `extensionByAssembly` to include turret extensions by using the `publishedPackageId` from `db.structureExtensionConfigs`.
- Update all `classifyExtension` call sites: Deployables.tsx (extension column accessor + cell), StructureDetailCard.tsx (line 70).
- After the fix, a turret extension shows as "periscope" (with the template name "Periscope Turret" after the rename in item #6) instead of "Custom" or "Outdated".

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default map storage | appStore (Zustand) + localStorage + IndexedDB | Matches existing pattern for `activeCharacterId`. Fast synchronous read on startup. |
| CSV export approach | DataGrid `onExport` callback with zero-dependency Blob download | Exports exactly what the user sees (post-column-filter). The DataGrid change is minimal -- add an optional `onExport` prop and a download icon button. |
| CSV trigger location | Internal DataGrid download button via `onExport` prop | DataGrid renders a download icon when `onExport` is provided. Export reflects the filtered view precisely. |
| Extension "None" replacement | "Deploy" button for owned, dash for watched | More actionable than passive "None" text. Watched structures cannot be deployed to. |
| Detail card buttons | New `onDeploy` prop + existing `onConfigure` | Separates deploy (create new extension) from configure (modify existing). The deploy panel handles both cases already. |
| Contract rename scope | `EXTENSION_TEMPLATES[].name` in config.ts only | Single source of truth. Name propagates everywhere through `classifyExtension` -> `info.template.name`. |
| Parent accessor format | Label + full parentId (no truncation) in accessor string | ParentId values are UUIDs (36 chars) or Sui object IDs. UUIDs are short enough to include in full. Self-referencing nodes include both `id` and `objectId` so children using either format group correctly. The IDs are invisible in the cell -- only in the accessor for filter matching. |
| AddToMapDialog map support | Full V1 + V2 support | V2 maps are the active format. V1 and V2 mode=0 share similar encrypted param shapes. V2 mode=1 (`buildAddLocationStandings`) differs -- it takes `registryId`, `tribeId`, `charId`, and plaintext data instead of `inviteId` and encrypted data. The `buildAddLocationTx` utility handles branching. All three builders exist in `@tehfrontier/chain-shared`. |
| AddToMapDialog location | New component in `apps/periscope/src/components/AddToMapDialog.tsx` | Shared between Deployables and StructureDetailCard. Keeps PrivateMaps.tsx from growing. |
| Add-location TX logic | Extract into `lib/mapLocation.ts` | Shared between AddToMapDialog and PrivateMaps' existing AddLocationDialog. Avoids duplicating encryption + version/mode branching. |
| Encryption key requirement | Dialog uses `useStoredEncryptionKey` hook | Same pattern as PrivateMaps. Key auto-derives on first use. For V2 standings-gated maps with `mode === 1`, no encryption needed. |
| Turret detection strategy | Pass `knownPackageId` string to `classifyExtension` | Caller resolves the package ID from extension config before calling. Leverages existing data -- `TurretPublishFlow` already saves `publishedPackageId` to `db.structureExtensionConfigs`. Simple scalar param, no map lookups inside classification. |

## Implementation Phases

### Phase 1: Foundation -- Default Map + Contract Renames + Turret Detection Fix
1. Add `defaultMapId: string | null`, `setDefaultMapId` action to `appStore.ts` with localStorage key `"periscope:defaultMapId"` and IndexedDB setting key `"defaultMapId"`. Follow the same hydration pattern as `activeCharacterId` (lines 36-44, 72-80).
2. In `PrivateMaps.tsx`, add a "Set Default" star/button to each `MapCard` and `MapCardV2`. When clicked, call `useAppStore.getState().setDefaultMapId(mapId)`. Highlight the default map visually (e.g., a star icon or border change).
3. Rename extension templates in `apps/periscope/src/chain/config.ts`:
   - Line 239: `"Gate Standings"` -> `"Periscope Gate"`
   - Line 256: `"SSU Unified"` -> `"Periscope SSU"`
   - Line 273: `"Turret Priority"` -> `"Periscope Turret"`
4. Update descriptions to reference "Periscope" branding (lines 240-241, 257-258, 274-275). Note: line 242/259/276 are `assemblyTypes` -- do not modify.
5. **Fix turret detection in `classifyExtension`** (`apps/periscope/src/chain/config.ts`):
   - Add an optional `knownPackageId?: string` parameter to `classifyExtension`. The caller passes the published package ID for turrets (resolved before calling).
   - New signature: `classifyExtension(extensionType, tenant, knownPackageId?)`.
   - In the template loop, when `currentPkgId` is falsy (turret template has empty `packageIds`), check `knownPackageId` instead. If `knownPackageId` is set and `extensionType` starts with it, return `{ status: "periscope", template }`. Otherwise return `{ status: "periscope-outdated", template }` (witness matched but package unknown).
6. **Fix turret detection in `useStructureRows`** (`apps/periscope/src/hooks/useStructureRows.ts`):
   - Accept `structureExtensionConfigs` as an additional input (from `db.structureExtensionConfigs`).
   - In the `extensionByAssembly` memo (line 62-73), when `pkgId` is falsy (turret template), check `structureExtensionConfigs` for a matching `assemblyId` with a `publishedPackageId`. If found, use `publishedPackageId` as the package ID: `map.set(ext.assemblyId, \`${publishedPkgId}::${tmpl.witnessType}\`)`.
7. Also update `TurretPublishFlow.tsx` line 266 to use the new template name: change `templateName: "Turret Priority"` to `templateName: "Periscope Turret"`.

### Phase 2: Column Cleanup -- Extension, Currency, Parent
1. **Extension column "None" -> "Deploy"**: In `Deployables.tsx` line 757, replace `<span className="text-xs text-zinc-600">None</span>` with a conditional: if `r.ownership === "mine"`, show a "Deploy" button that calls `setDeployTarget(r)`; otherwise show a dash. Additionally, guard the existing action button block (lines 802-808) so it does NOT render when `info.status === "default"` -- otherwise both the inline "Deploy" and the right-side action button would show "Deploy" simultaneously.
2. **Remove redundant Configure icon**: Delete the `<Settings2>` icon button block at lines 791-801 in the extension column cell (includes the comment at line 791 and closing `)}` at line 801).
3. **Market currency column**: Add a new column definition after the extension column (after line 814 which closes the column object; line 813 only closes the `cell` method). Accessor: `extensionConfigMap.get(d.objectId)?.marketId ? currencyByMarketId.get(extensionConfigMap.get(d.objectId)!.marketId!) ?? "" : ""`. Header: "Currency". Size: 100. filterFn: `excelFilterFn`. Remove the ticker badge from the extension column cell (delete lines 769-773).
4. **Parent column -> filterable by ID**: Change the accessor at line 838-842 to include the parentId value. For rows with `parentId`, return `(parentLabels.get(d.parentId) ?? "") + " " + d.parentId`. For self-referencing nodes, return `d.label + " " + d.id + " " + d.objectId` (both IDs so filtering matches regardless of how children reference their parent). The cell renderer continues to show only the label (no visible ID change) -- the IDs are embedded in the accessor for filter matching only.
5. **Pass turret package IDs to classifyExtension calls**: In the extension column's `accessorFn` and `cell` renderer (lines 726-728, 742), pass `extensionConfigMap.get(d.objectId)?.publishedPackageId` as the `knownPackageId` parameter to `classifyExtension`. Also update the `classifyExtension` call in `StructureDetailCard.tsx` (line 70) to pass `extConfig?.publishedPackageId` -- the card already has `extConfig` from `useStructureExtensionConfig` (line 61).

### Phase 3: Detail Card Buttons + CSV Export
1. **Detail card Deploy/Configure buttons**: In `StructureDetailCard.tsx`, add a new prop `onDeploy?: (row: StructureRow) => void`. Add a button row after the Extension Type section (after line 220 which closes the section div, before the Standings Config section at line 222). This ensures the buttons appear even when `extConfig` is null (no standings config to show). Also remove the existing "Configure" button from the Standings Config section header (lines 230-238) since the new button row replaces it -- this avoids a duplicate Configure button and removes a button that had no ownership check. Show:
   - "Deploy Extension" button when `extensionInfo.status === "default"` and `row.ownership === "mine"` -> calls `onDeploy`.
   - "Configure" button when `extensionInfo.status === "periscope"` and `row.ownership === "mine"` -> calls `onConfigure`.
   - "Update Extension" button when `extensionInfo.status === "periscope-outdated"` and `row.ownership === "mine"` -> calls `onDeploy`.
2. Wire up new props in `Deployables.tsx` where `StructureDetailCard` is rendered (line 1127). Add `onDeploy={(row) => setDeployTarget(row)}` and `onConfigure={(row) => setDeployTarget(row)}`. Note: `onConfigure` prop already exists on StructureDetailCard but is not currently passed from Deployables -- this is new wiring.
3. **CSV export**: Create a `exportToCsv` utility function in `apps/periscope/src/lib/csv.ts`. It accepts an array of objects and column definitions (header + accessor key), builds a CSV string with proper escaping (quotes around fields containing commas/quotes/newlines), and triggers a browser download (reuse the Blob + click pattern from `lib/dataExport.ts`).
4. **CSV export button**: Add an optional `onExport?: (rows: T[]) => void` prop to `DataGrid`. When provided, DataGrid renders a download icon button that calls `onExport(getFilteredRowModel().rows.map(r => r.original))`. In Deployables, pass `onExport={(rows) => exportToCsv(rows, structureColumns)}` via the DataGrid props. File name: `structures-{ISO date}.csv`.

### Phase 4: Inline "Add to Map" Dialog
1. **Extract shared add-location logic**: Before building the new dialog, extract the encryption + TX-building core from `PrivateMaps.tsx` `AddLocationDialog` (lines 1374-1393) into a shared utility (e.g., `apps/periscope/src/lib/mapLocation.ts`). This utility should expose a function like `buildAddLocationTx({ mapVersion, mapMode, packageId, mapId, inviteId, structureId, locationData, senderAddress, mapPublicKey, registryId?, tribeId?, charId? })` that branches on version/mode to call the appropriate chain-shared builder. The `registryId`, `tribeId`, and `charId` params are required for V2 mode=1 (standings) maps but unused for V1 and V2 mode=0. Both `PrivateMaps.tsx` and the new dialog will import from this utility.
2. Create `apps/periscope/src/components/AddToMapDialog.tsx`. Props: `structureRow: StructureRow`, `onClose`, `onAdded?`. The component:
   - Reads all V1 and V2 maps from IndexedDB via `useLiveQuery`.
   - Uses `useStoredEncryptionKey` for encryption.
   - Shows a map selector dropdown, defaulting to `useAppStore(s => s.defaultMapId)`.
   - Pre-fills description with `structureRow.label`, structureId with `structureRow.objectId`.
   - Pre-fills system ID from `structureRow.systemId`, derives planet/lPoint from `structureRow.lPoint` if available.
   - On submit: calls the shared `buildAddLocationTx` utility, which encrypts location data (for V1 and V2 mode=0 maps) or sends cleartext (for V2 mode=1) and builds the appropriate TX. Note: the V2 builders (`buildAddLocationEncrypted`, `buildAddLocationStandings`) exist in chain-shared but are not yet used anywhere in the app -- this dialog will be their first consumer.
   - On success: updates the structure's local systemId/lPoint if they were previously empty, syncs map locations.
3. In `Deployables.tsx`, add state `const [addToMapTarget, setAddToMapTarget] = useState<StructureRow | null>(null)`. Replace `<Link to="/private-maps">Add to map</Link>` at line 1291 with `<button onClick={() => setAddToMapTarget(r)}>Add to map</button>`. Render `AddToMapDialog` when `addToMapTarget` is set.
4. In `StructureDetailCard.tsx`, add an `onAddToMap?: (row: StructureRow) => void` prop. Replace the `<Link to="/private-maps">Add via Private Map</Link>` at lines 296-303 with a button calling `onAddToMap`. Wire it up in Deployables.
5. Update `PrivateMaps.tsx` `AddLocationDialog` to use the shared `buildAddLocationTx` utility extracted in step 1, replacing its inline encryption + TX-building logic.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/stores/appStore.ts` | Modify | Add `defaultMapId` state + setter with localStorage/IndexedDB persistence |
| `apps/periscope/src/chain/config.ts` | Modify | Rename extension template names to Periscope branding; add `knownPackageId` param to `classifyExtension` for turret detection |
| `apps/periscope/src/hooks/useStructureRows.ts` | Modify | Accept `structureExtensionConfigs`, use `publishedPackageId` for turret `extensionByAssembly` entries |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Extension column cleanup, currency column, parent column ID, CSV export button, Add to Map dialog integration, build turretPackageIds map for classifyExtension |
| `apps/periscope/src/components/StructureDetailCard.tsx` | Modify | Add Deploy/Configure/Update buttons, Add to Map button, new `onDeploy`/`onAddToMap` props; pass `knownPackageId` to `classifyExtension` for turret detection |
| `apps/periscope/src/views/PrivateMaps.tsx` | Modify | Add "Set Default" map button to MapCard/MapCardV2; refactor AddLocationDialog to use shared `mapLocation.ts` utility |
| `apps/periscope/src/components/DataGrid.tsx` | Modify | Add optional `onExport` prop with download icon button |
| `apps/periscope/src/components/extensions/TurretPublishFlow.tsx` | Modify | Update `templateName` string from "Turret Priority" to "Periscope Turret" (line 266) |
| `apps/periscope/src/lib/csv.ts` | Create | Zero-dependency CSV export utility (reuses Blob download pattern from `dataExport.ts`) |
| `apps/periscope/src/lib/mapLocation.ts` | Create | Shared add-location TX builder (encryption + version/mode branching) |
| `apps/periscope/src/components/AddToMapDialog.tsx` | Create | Shared inline dialog for adding a structure location to a private map |

## Resolved Questions

1. **V2 map support in AddToMapDialog:** Option B -- full V1 + V2 support. V2 maps are the active format. The `buildAddLocationTx` utility in `lib/mapLocation.ts` branches on version and mode to call the appropriate chain-shared builder.

2. **CSV export data source:** Option B -- DataGrid `onExport` callback. DataGrid renders a download icon button when `onExport` is provided, passing `getFilteredRowModel().rows.map(r => r.original)`. This ensures the export reflects exactly what the user sees after column filters.

3. **Parent column ID format:** No truncation needed. The `parentId` field is either a UUID (36 chars, from manual ParentSelect) or a Sui object ID (from chain `energySourceId`). The full `parentId` is appended to the accessor string for filter matching but is NOT displayed in the cell -- the cell continues to show only the label. This avoids visual clutter while enabling ID-based filtering.

## Deferred

- **Drag-and-drop location reordering in private maps** -- Out of scope for this plan; no current request.
- **Batch CSV import for structures** -- Inverse of export; could be useful but not requested.
- **Private map sharing from the AddToMapDialog** -- Creating new maps inline is too complex; keep that on the Private Maps page.
- **V2 map invite support in AddToMapDialog** -- The dialog only adds locations to maps the user is already a member of. Inviting new members stays on the Private Maps page.
