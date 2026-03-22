# Plan: Periscope Contact List, Wallet Transfers, Structures UI, Address Copy, SSU Market Orders
**Status:** Active
**Created:** 2026-03-22
**Updated:** 2026-03-22
**Module:** periscope, ssu-dapp
**Phases:** 0/7 complete

## Overview

This plan covers five related UI improvements across Periscope and the SSU dApp. The changes range from new features (contact list, wallet transfers) to polish (address copy, structure detail card) to a data grid refactor (SSU market orders).

The **Contact List** is a reusable component backed by the existing `manifestCharacters` Dexie table. It provides a search-as-you-type picker for selecting characters from the cached manifest data. This component will be consumed by the Wallet transfer feature and can be reused anywhere a character picker is needed (e.g., permissions, finance minting).

The **Wallet Transfers** feature adds the ability to send custom currencies (Coin<T>) to other characters. It builds on the existing Wallet view (`apps/periscope/src/views/Wallet.tsx`) which currently shows read-only balances and transaction history. The transfer flow uses the contact list to select a recipient, then builds a `splitCoins` + `transferObjects` PTB for the selected coin type.

The **Structures Improvements** consolidate the Deployables data grid: merging Ownership + Owner columns, adding a detail card below the grid for the selected structure, removing Item ID and Fuel from the grid (moving them to the detail card), and populating location from both private maps and public manifest locations.

The **Address UI** improvement adds a copy-to-clipboard button on every truncated address across both Periscope and the SSU dApp. A shared `CopyAddress` component encapsulates the pattern.

The **SSU Market Orders** improvement replaces the separate Sell Orders and Buy Orders card-based lists with a single combined DataGrid using the same excel-like column filtering as the Periscope Structures view.

## Current State

### Manifest Characters (Contact Data Source)
- **`apps/periscope/src/db/types.ts`** -- `ManifestCharacter` interface (lines 417-440) with `id`, `characterItemId`, `name`, `suiAddress`, `tribeId`, `tenant`, `cachedAt`
- **`apps/periscope/src/db/index.ts`** -- `manifestCharacters` table with indexes on `id, characterItemId, name, suiAddress, tribeId, tenant, cachedAt`
- **`apps/periscope/src/chain/manifest.ts`** -- `searchCachedCharacters(query, limit)` (line 230) already exists for searching by name/ID/address. `fetchCharacterByAddress()` (line 198) resolves from chain if not cached.
- **`apps/periscope/src/views/Manifest.tsx`** -- Characters tab shows the DataGrid with character data

### Wallet View
- **`apps/periscope/src/views/Wallet.tsx`** -- Read-only view showing balances and currency transactions for the active character. Uses `useActiveCharacter()` for the Sui address and `useSuiClient()` for GraphQL queries. Transaction list is a manual HTML table with sorting/filtering. No transfer capability exists.
- **`apps/periscope/src/components/WalletConnect.tsx`** -- EVE Vault wallet integration for signing transactions
- **`apps/periscope/src/hooks/useSignAndExecuteTransaction.ts`** -- Custom hook wrapping dapp-kit's `signAndExecuteTransaction`

### Structures (Deployables) View
- **`apps/periscope/src/views/Deployables.tsx`** -- Full structures view with DataGrid. Currently has these columns: Status, Name (label + objectId), Item ID, Type, Extension, Location, Parent, Ownership, Owner, Fuel, Runtime, Notes, Updated, Actions
- **`StructureRow` interface** (lines 46-70) -- Unified row merging `deployables` and `assemblies` tables
- **Ownership column** (line 713-729) -- Shows "Mine" or "Watched" badge
- **Owner column** (lines 731-746) -- Shows `ownerName ?? "Unknown"` + truncated address. The `ownerNames` map (line 221) only resolves from the local `players` table, not from `manifestCharacters`
- **Item ID column** (lines 595-608) -- Simple font-mono display of `itemId`
- **Fuel column** (lines 748-758) -- Shows fuel level as number
- **Location column** (lines 671-694) -- Uses `LocationEditor` component with system search + planet/L-point selectors. Only populates from manually-set values or the sync chain process
- **No detail card** -- The grid is the only structure display
- **No row selection** -- DataGrid component does not support row selection

### Location Data Sources
- **`manifestLocations` table** -- Public locations from `LocationRevealedEvent` (Plan 24, already implemented)
- **`manifestMapLocations` table** -- Private map locations with `structureId` field that links to an assembly object ID
- **`crossReferenceManifestLocations()` in manifest.ts** (line 723) -- Already auto-populates deployable locations from public manifest data during discovery
- Missing: private map locations are not cross-referenced with structures

### Address Truncation
- **25 files in Periscope** and **8 files in SSU dApp** use the pattern `addr.slice(0, N)...addr.slice(-M)` to truncate addresses
- Most show a `title` attribute with the full address on hover, and some have an ExternalLink to Suiscan
- No copy-to-clipboard functionality exists anywhere

### SSU dApp Market Orders
- **`apps/ssu-dapp/src/components/MarketContent.tsx`** -- Renders two separate sections: "Sell Orders" (via `ListingAdminList` or `ListingBuyerList`) and "Buy Orders" (inline card-based list)
- **`apps/ssu-dapp/src/components/ListingAdminList.tsx`** -- Card-based listing with edit/cancel inline
- **`apps/ssu-dapp/src/components/ListingBuyerList.tsx`** -- Card-based listing with buy button via `ListingCard`
- **`apps/ssu-dapp/src/hooks/useBuyOrders.ts`** -- Fetches `MarketBuyOrder[]` + resolves item names -> `BuyOrderWithName[]`
- **`apps/ssu-dapp/src/hooks/useMarketListings.ts`** -- Fetches `MarketSellListing[]` + resolves item names -> `SellListingWithName[]`
- **`@tehfrontier/chain-shared` types** -- `MarketSellListing` has `listingId, seller, ssuId, typeId, pricePerUnit, quantity, postedAtMs`. `MarketBuyOrder` has `orderId, buyer, typeId, pricePerUnit, quantity, originalQuantity, postedAtMs`
- **No DataGrid in SSU dApp** -- The SSU dApp does not currently use the DataGrid component or @tanstack/react-table. It would need to either import from Periscope's shared components or include its own.

## Target State

### 1. Contact List Component
A reusable `ContactPicker` component in `apps/periscope/src/components/ContactPicker.tsx`:
- Search-as-you-type input backed by `searchCachedCharacters()` from `manifest.ts`
- Shows matching characters with name, tribe, and truncated address
- Returns the selected `ManifestCharacter` to the parent
- Supports an optional `onLookup` callback for resolving unknown addresses from chain
- Used in Wallet transfer dialog and available for future use in permissions, finance, etc.

### 2. Wallet Transfer
A transfer dialog in the Wallet view:
- Select coin type from current balances
- Pick recipient via ContactPicker (or paste raw address)
- Enter amount with max-balance shortcut
- Build PTB: `splitCoins` from owned coins -> `transferObjects` to recipient address
- Sign via EVE Vault wallet
- Success/error feedback

### 3. Structures Improvements

**Combined Ownership/Owner column:** Single column showing ownership badge + character name (resolved from `manifestCharacters` if not in `players` table) + truncated address with copy button.

**Structure detail card:** Below the DataGrid, a card showing extended info for the currently selected row:
- Full object ID (with copy), Item ID, owner address, fuel level + runtime, fuel expiry time, extension type, parent chain, dApp URL link, last updated timestamp, notes (editable)

**Column changes:**
- Remove: Item ID, Fuel (moved to detail card)
- Modify: Merge Ownership + Owner into single "Owner" column

**Location auto-population from private maps:** During structure sync, cross-reference `manifestMapLocations` where `structureId` matches the assembly object ID. If a match is found and the structure lacks a location, populate `systemId` from the map location's `solarSystemId` and compute `lPoint` from `planet` + `lPoint` fields.

### 4. Address Copy Component
A shared `CopyAddress` component:
- Shows truncated address with a small copy icon button
- Clicking copies the full address to clipboard via `navigator.clipboard.writeText()`
- Brief "Copied!" tooltip/feedback (1-2 second timeout)
- Optional ExternalLink icon to Suiscan
- Replaces the current truncated-address spans across both apps

### 5. SSU Market Orders DataGrid
Replace the card-based sell/buy order lists with a single combined DataGrid:
- Columns: Type (Buy/Sell), Item Name, Qty, Price, By (character name), Timestamp, Actions
- Excel-like column filtering (same `excelFilterFn` from ColumnFilter) on Type, Item Name, By
- Actions column with context-dependent buttons (Buy/Fill/Edit/Cancel) based on order type and user role, triggering overlay dialogs
- The DataGrid + ColumnFilter components are copied into the SSU dApp (not shared via package, to keep the SSU dApp self-contained as a lightweight in-game dApp)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Contact data source | `manifestCharacters` Dexie table | Already populated by Manifest discovery. No new data fetching needed. `searchCachedCharacters()` exists. |
| ContactPicker location | `apps/periscope/src/components/ContactPicker.tsx` | Periscope component, reusable across views. Not in chain-shared (it's a UI component with Dexie dependency). |
| Transfer PTB pattern | `splitCoins` + `transferObjects` | Standard Sui coin transfer pattern. Works for any `Coin<T>`. No custom Move contract needed. |
| Coin selection for transfer | Use `queryOwnedCoins()` from `@tehfrontier/chain-shared` (token-factory.ts) | Already exists and wraps `listCoinsGql()` with pagination. Returns `{ objectId, balance }[]` needed for the PTB. |
| Owner name resolution | Check `players` table first, then `manifestCharacters` by `suiAddress` | Players table has manually curated names. Manifest has auto-discovered names. Players take priority. |
| Detail card position | Below DataGrid, outside the scroll area | Always visible without scrolling the grid. Updates reactively when row selection changes. |
| DataGrid row selection | Add optional `onRowClick` + `selectedRowId` props to DataGrid | Minimal change to the shared component. Only Deployables uses it initially. |
| Columns removed from grid | Item ID, Fuel | These are detail-level data, not scan-level. Runtime (derived from fuel) stays in grid as it's actionable at a glance. |
| Private map location cross-ref | Query `manifestMapLocations` where `structureId` matches | `structureId` field (nullable) on `ManifestMapLocation` was designed for this exact purpose. |
| CopyAddress component scope | Shared component in each app's `components/` | Not worth a shared package for a single tiny component. Copy into both apps. |
| SSU DataGrid approach | Copy DataGrid + ColumnFilter into SSU dApp | SSU dApp is a lightweight in-game dApp. Adding a monorepo dependency on Periscope would be wrong. The components are ~183 + ~363 lines respectively. |
| Combined market orders grid | Single DataGrid with Type column | Simplifies the UI. Users can filter by Buy/Sell. Actions column handles context-dependent buttons. |
| Market order Timestamp | From `postedAtMs` field | Both `MarketSellListing.postedAtMs` and `MarketBuyOrder.postedAtMs` exist. |
| Market order actions UX | Action buttons open small overlay dialogs (Option B) | Reuses existing `CreateBuyOrderDialog`, `FillBuyOrderDialog` patterns. More space for inputs. New small dialogs needed for "Edit Listing" and "Buy from Listing" flows (extracted from `ListingAdminList` and `ListingCard`). |
| CopyAddress clipboard API | `navigator.clipboard.writeText()` with try/catch fallback to `document.execCommand('copy')` | CEF 122 (Chromium 122) supports the Clipboard API. Fallback covers insecure context edge cases. |

## Implementation Phases

### Phase 1a: CopyAddress Component + Periscope Views
1. Create `apps/periscope/src/components/CopyAddress.tsx` -- A small component accepting `address: string`, optional `sliceStart` (default 8), optional `sliceEnd` (default 4), optional `explorerUrl` (Suiscan link), optional `className`. Renders truncated address + copy icon. Uses `navigator.clipboard.writeText()` with a try/catch fallback to `document.execCommand('copy')`. Brief "Copied" state via `useState` + `setTimeout`.
2. Update truncated addresses in Periscope main views:
   - `Manifest.tsx` -- Sui Address column (line 88-103), Object ID column (line 109-126)
   - `Deployables.tsx` -- Owner column address (line 741-742), Name column objectId (line 587-588)
   - `Wallet.tsx` -- Sui address display (line 283-284), Tx digest (line 507-508)
   - `Finance.tsx` -- Market ID, authorized addresses, coin type displays
   - `Targets.tsx` -- Target address display
   - `Settings.tsx` -- Address displays
   - `GovernanceTurrets.tsx` -- Address displays
   - `Extensions.tsx` -- Package ID displays
   - `PrivateMaps.tsx` -- Creator address, map ID displays

### Phase 1b: CopyAddress Adoption -- Remaining Periscope + SSU dApp
1. Continue CopyAddress adoption in remaining Periscope files:
   - `Bridge.tsx` -- Address displays
   - `Assets.tsx` -- Address displays
   - `Killmails.tsx` -- Address displays
   - `OPSEC.tsx` -- Address displays
   - `TurretConfig.tsx` -- Object ID display
   - `Sonar.tsx` -- Address displays
   - Permission components: `SharedAclCard.tsx`, `SharedAclEditor.tsx`, `PolicyCard.tsx`, `GroupEditor.tsx`, `GroupCard.tsx`, `BetrayalAlertBanner.tsx`, `AclEditor.tsx`, `AclTab.tsx`
   - `CharacterSwitcher.tsx` -- Address display
   - `WalletConnect.tsx` -- Address display
   - `AddCharacterDialog.tsx` -- Address display
   - `CommandPalette.tsx` -- Address display
2. Create `apps/ssu-dapp/src/components/CopyAddress.tsx` -- Same component copied into the SSU dApp.
3. Update truncated addresses in SSU dApp:
   - `MarketContent.tsx` -- Seller/buyer address
   - `ListingAdminList.tsx` -- Seller address
   - `ListingCard.tsx` -- Seller address
   - `WalletConnect.tsx` -- Address display
   - `AssemblyHeader.tsx` -- Object ID display
   - `AssemblyActions.tsx` -- Object ID display
   - `PublishToMapDialog.tsx` -- Object ID display

### Phase 2: Contact List Component
1. Create `apps/periscope/src/components/ContactPicker.tsx`:
   - Props: `onSelect: (character: ManifestCharacter) => void`, `placeholder?: string`, `excludeAddresses?: string[]`, `tenant?: string`
   - Internal state: `query` string, `results` array, `loading` boolean
   - On query change (debounced 200ms): call `searchCachedCharacters(query)` filtered by `tenant`
   - Dropdown shows matching characters: name (bold), tribe name (from `manifestTribes` lookup), truncated address with `CopyAddress`
   - Clicking a result calls `onSelect` and closes the dropdown
   - Optional: manual address entry -- if query looks like a `0x` address and no results, show "Look up on chain" button that calls `fetchCharacterByAddress()`
   - Keyboard: Escape closes, Enter selects first result, arrow keys navigate

### Phase 3: Wallet Transfer
1. Add a "Send" button to the Wallet view header (next to Refresh button). Only visible when wallet is connected. Import `useCurrentAccount` and `useDAppKit` from `@mysten/dapp-kit-react` (Wallet.tsx currently has no wallet imports -- it's read-only).
2. Create `apps/periscope/src/components/TransferDialog.tsx`:
   - Props: `balances: CoinBalance[]`, `coinMeta: Record<string, CoinMeta>`, `senderAddress: string`, `onClose: () => void`
   - Step 1: Select coin type from dropdown (populated from `balances`)
   - Step 2: Select recipient via `ContactPicker` or paste raw `0x...` address
   - Step 3: Enter amount. Show available balance. "Max" button fills available amount.
   - Step 4: Confirm + sign
   - Build PTB:
     a. Query owned coins for selected type via `queryOwnedCoins(client, senderAddress, coinType)` from `@tehfrontier/chain-shared`
     b. If multiple coins, `mergeCoins` into first, then `splitCoins` exact amount
     c. `transferObjects` the split coin to recipient address
   - Execute via `useDAppKit().signAndExecuteTransaction` (same pattern as Finance.tsx line 56)
   - Show success with tx digest link, or error message
3. Wire the dialog into `Wallet.tsx` -- state toggle `showTransfer`, pass balances + coinMeta + suiAddress

### Phase 4: Structures Detail Card + Column Changes
1. **Add row selection to DataGrid** -- Add optional props to `apps/periscope/src/components/DataGrid.tsx`:
   - `selectedRowId?: string` -- Currently selected row ID
   - `onRowClick?: (rowId: string) => void` -- Callback when a row is clicked
   - Add click handler on `<tr>` that calls `onRowClick(row.id)`
   - Add visual highlight class on the selected row (e.g. `bg-cyan-900/20 border-l-2 border-l-cyan-500`)
2. **Merge Ownership + Owner columns** in `Deployables.tsx`:
   - Remove the separate `ownership` column (lines 712-729)
   - Modify the `owner` column to show: ownership badge (Mine/Watched) + character name + truncated address with `CopyAddress`
   - Resolve owner name from both `players` table (existing `ownerNames` map) AND `manifestCharacters` table (new lookup by `suiAddress`)
   - Add `manifestCharacters` lookup: `useLiveQuery(() => db.manifestCharacters.toArray())` -> build address-to-name map. Merge with `ownerNames`, players taking priority.
3. **Remove Item ID and Fuel columns** from the grid (remove the column definitions at lines 595-608 and 748-758)
4. **Add selected row state** to `Deployables` component: `const [selectedId, setSelectedId] = useState<string | null>(null)`. Pass to DataGrid.
5. **Create `StructureDetailCard` component** in `apps/periscope/src/components/StructureDetailCard.tsx`:
   - Export the `StructureRow` interface from `Deployables.tsx` (currently non-exported at line 46) so the detail card can import it
   - Props: `row: StructureRow | null`, `systemNames: Map<number, string>`, `tribeMap?: Record<number, string>`
   - Renders when `row` is not null
   - Layout: 2-column grid with labeled fields
   - Fields: Object ID (full, with `CopyAddress`), Item ID, Type, Status, Owner (name + full address), Fuel Level + Runtime + Expiry, Extension Type (with classify info), Parent (name + link), dApp URL (clickable link), Location (system name + L-point), Notes (editable via `EditableCell`), Last Updated
   - Visual: rounded border card, same dark theme styling as existing stat cards
6. **Render `StructureDetailCard`** below the DataGrid in `Deployables.tsx`, passing the selected row from the data array

### Phase 5: Structure Location from Private Maps
1. **Add `crossReferencePrivateMapLocations()`** to `apps/periscope/src/chain/manifest.ts`:
   - Query `manifestMapLocations` where `structureId` is not null
   - For each location, check if a matching deployable/assembly exists by `objectId === structureId`
   - If found and the structure lacks `systemId`/`lPoint`, populate from the map location: `systemId = mapLoc.solarSystemId`, `lPoint = "P{mapLoc.planet}-L{mapLoc.lPoint}"`
   - This complements the existing `crossReferenceManifestLocations()` which handles public locations
2. **Call `crossReferencePrivateMapLocations()`** from the structure sync handler (`handleSyncOwn` in Deployables.tsx) after the main sync loop, or from `syncMapLocations()` in manifest.ts after decrypting locations
3. **Also call during manifest location discovery** -- in `syncMapLocations()` (manifest.ts line 864), after caching the decrypted locations, call the cross-reference function for any locations that have a non-null `structureId`

### Phase 6: SSU Market Orders DataGrid
1. **Copy DataGrid + ColumnFilter components** into the SSU dApp:
   - Copy `apps/periscope/src/components/DataGrid.tsx` to `apps/ssu-dapp/src/components/DataGrid.tsx`
   - Copy `apps/periscope/src/components/ColumnFilter.tsx` to `apps/ssu-dapp/src/components/ColumnFilter.tsx`
   - Imports use the same `@/*` path alias as Periscope -- no path changes needed
   - Add `@tanstack/react-table` and `@tanstack/react-virtual` dependencies to `apps/ssu-dapp/package.json` (ColumnFilter uses react-virtual for its virtualized checkbox list)
   - Also add `lucide-react` if not already present (DataGrid + ColumnFilter use icons from it)
2. **Create unified order type** in `apps/ssu-dapp/src/components/MarketOrdersGrid.tsx`:
   ```typescript
   interface MarketOrderRow {
       id: string; // `sell-{listingId}` or `buy-{orderId}`
       type: "Sell" | "Buy";
       itemName: string;
       typeId: number;
       quantity: number;
       pricePerUnit: bigint;
       by: string; // character name or truncated address
       byAddress: string; // full address
       timestamp: Date;
       isMine: boolean;
       // Original data for action dialogs
       listing?: SellListingWithName; // present when type === "Sell"
       buyOrder?: BuyOrderWithName;   // present when type === "Buy"
   }
   ```
3. **Define columns** with `excelFilterFn` on Type, Item Name, By:
   - Type: "Sell" or "Buy" with color badge (green for sell, amber for buy). Size ~80px.
   - Item Name: resolved item name (no ID number). Size ~180px.
   - Qty: formatted number. Size ~80px.
   - Price: formatted with `formatBaseUnits` and currency symbol. Size ~120px.
   - By: character name from `useCharacterNames` hook (existing), or truncated address with `CopyAddress`. Size ~140px.
   - Timestamp: formatted date/time from `postedAtMs`. Size ~140px.
   - Actions: non-sortable, non-filterable column (set `enableSorting: false`, `enableColumnFilter: false`). Size ~120px. Renders context-dependent buttons:
     - For sell orders where `!isMine`: "Buy" button (cyan) -> opens `BuyFromListingDialog`
     - For sell orders where `isMine`: "Edit" button (cyan text) -> opens `EditListingDialog`, "Cancel" button (red text) -> opens confirm dialog
     - For buy orders where `!isMine`: "Fill" button (amber) -> opens existing `FillBuyOrderDialog`
     - For buy orders where `isMine`: no action buttons (cancel buy order not yet supported by contract)
     - All action buttons are small (`text-[10px]`, `px-2 py-0.5`) to fit the grid row
4. **Replace `MarketContent.tsx` internals** -- Update the `listings` prop type from `MarketSellListing[]` to `SellListingWithName[]` in both `ContentTabs.tsx` and `MarketContent.tsx` (the actual data passed from `SsuView` is already `SellListingWithName[]`; the prop type was just under-specified). Remove the separate Sell Orders and Buy Orders sections. Render a single `MarketOrdersGrid` that merges `listings` (mapped to sell rows) and `buyOrders` (mapped to buy rows). Pass through `ssuConfig`, `characterObjectId`, `coinType`, `ssuObjectId`, `walletAddress`, `ownerCapReceivingId`, and `isConnected` to `MarketOrdersGrid` for action dialog props. Keep the "+ Create Buy Order" button in the grid `actions` slot.
5. **Create new action dialogs** extracted from existing inline patterns:
   - Create `apps/ssu-dapp/src/components/BuyFromListingDialog.tsx` -- Extracted from `ListingCard.tsx`'s buy flow. Props: `listing: MarketSellListing`, `ssuConfig`, `characterObjectId`, `coinType`, `ssuObjectId`, `onClose`. Contains quantity input, total price preview, and calls `buildBuyFromListing` + `signAndExecute`. Uses same `<dialog>` pattern as `FillBuyOrderDialog`.
   - Create `apps/ssu-dapp/src/components/EditListingDialog.tsx` -- Extracted from `ListingAdminList.tsx`'s inline edit. Props: `listing: MarketSellListing`, `ssuConfig`, `coinType`, `onClose`. Contains price + quantity inputs, calls `buildUpdateSellListing` + `signAndExecute`. Uses same `<dialog>` pattern.
   - Create `apps/ssu-dapp/src/components/CancelListingDialog.tsx` -- Simple confirmation dialog. Props: `listing: MarketSellListing`, `ssuConfig`, `characterObjectId`, `ssuObjectId`, `coinType`, `onClose`. Calls `buildCancelListing` + `signAndExecute`.
6. **Preserve existing dialogs** -- `CreateBuyOrderDialog` and `FillBuyOrderDialog` remain unchanged and are triggered from the grid Actions column. `SellDialog` is for creating new listings from inventory (not relevant to the orders grid). `ListingAdminList` and `ListingBuyerList` / `ListingCard` are no longer imported by `MarketContent.tsx` but kept in the codebase (they may still be useful or can be removed in a follow-up cleanup).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/components/CopyAddress.tsx` | Create | Reusable truncated address with copy-to-clipboard |
| `apps/ssu-dapp/src/components/CopyAddress.tsx` | Create | Same component for SSU dApp |
| `apps/periscope/src/components/ContactPicker.tsx` | Create | Search-as-you-type character picker backed by manifest |
| `apps/periscope/src/components/TransferDialog.tsx` | Create | Coin transfer dialog with recipient picker |
| `apps/periscope/src/components/StructureDetailCard.tsx` | Create | Expandable detail card for selected structure |
| `apps/periscope/src/components/DataGrid.tsx` | Modify | Add optional `selectedRowId` + `onRowClick` props for row selection |
| `apps/periscope/src/views/Wallet.tsx` | Modify | Add Send button + wire TransferDialog |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Merge Owner/Ownership columns, remove Item ID + Fuel columns, add row selection + detail card, add manifest character name resolution |
| `apps/periscope/src/chain/manifest.ts` | Modify | Add `crossReferencePrivateMapLocations()` |
| `apps/periscope/src/views/Manifest.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Finance.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Targets.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Settings.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/GovernanceTurrets.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Extensions.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/PrivateMaps.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Bridge.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Assets.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Killmails.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/OPSEC.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/Sonar.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/views/TurretConfig.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/CharacterSwitcher.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/WalletConnect.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/AddCharacterDialog.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/CommandPalette.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/SharedAclCard.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/SharedAclEditor.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/PolicyCard.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/GroupEditor.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/GroupCard.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/BetrayalAlertBanner.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/AclEditor.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/periscope/src/components/permissions/AclTab.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/ssu-dapp/src/components/DataGrid.tsx` | Create | DataGrid component copied from Periscope |
| `apps/ssu-dapp/src/components/ColumnFilter.tsx` | Create | ColumnFilter component copied from Periscope |
| `apps/ssu-dapp/src/components/MarketOrdersGrid.tsx` | Create | Combined sell+buy orders DataGrid with Actions column |
| `apps/ssu-dapp/src/components/BuyFromListingDialog.tsx` | Create | Dialog for buying from a sell listing (extracted from ListingCard) |
| `apps/ssu-dapp/src/components/EditListingDialog.tsx` | Create | Dialog for editing own sell listing price/qty (extracted from ListingAdminList) |
| `apps/ssu-dapp/src/components/CancelListingDialog.tsx` | Create | Confirmation dialog for cancelling own sell listing |
| `apps/ssu-dapp/src/components/MarketContent.tsx` | Modify | Replace card-based lists with MarketOrdersGrid |
| `apps/ssu-dapp/src/components/ContentTabs.tsx` | Modify | Update `listings` prop type from `MarketSellListing[]` to `SellListingWithName[]` |
| `apps/ssu-dapp/src/components/ListingAdminList.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/ssu-dapp/src/components/ListingCard.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/ssu-dapp/src/components/WalletConnect.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/ssu-dapp/src/components/AssemblyHeader.tsx` | Modify | Replace truncated addresses with CopyAddress |
| `apps/ssu-dapp/src/components/AssemblyActions.tsx` | Modify | Replace truncated object IDs with CopyAddress |
| `apps/ssu-dapp/src/components/PublishToMapDialog.tsx` | Modify | Replace truncated object IDs with CopyAddress |
| `apps/ssu-dapp/package.json` | Modify | Add `@tanstack/react-table`, `@tanstack/react-virtual`, `lucide-react` dependencies |

## Deferred

- **Contact list favorites/pinning** -- Ability to star frequently-used contacts for quick access. Deferred until usage patterns are clearer.
- **Bulk transfer** -- Sending to multiple recipients in one transaction. Deferred as an optimization.
- **Structure grouping/tree view** -- Rendering parent-child relationships as a tree in the detail card. Deferred to a separate UX improvement plan.
- **Cross-app shared component package** -- Moving `CopyAddress`, `DataGrid`, `ColumnFilter` into a shared UI package. Not worth the complexity for 2 consumers.
- **Wallet transfer for SUI gas coin** -- SUI transfers need special handling (must leave gas reserve). Deferred -- focus on custom currencies first.
