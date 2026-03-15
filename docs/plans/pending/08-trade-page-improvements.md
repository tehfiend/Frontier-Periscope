# Plan: Trade Page UX Improvements

**Status:** Draft
**Created:** 2026-03-15
**Module:** periscope, chain-shared

## Overview

The GovernanceTrade page (`apps/periscope/src/views/GovernanceTrade.tsx`) currently requires manual Object ID entry for OrgMarket discovery and raw numeric type ID entry for buy orders. This creates a poor user experience that makes the trade page impractical for real use. The page was built as a functional proof-of-concept during the market/currency sprint and now needs polish.

This plan addresses four UX gaps: (1) auto-discover OrgMarket objects from chain events instead of manual ID entry, (2) replace raw type ID input with a searchable autocomplete backed by the gameTypes static data (32K+ types in IndexedDB), (3) present user-owned SSUs in a selectable list for buy order delivery point selection, and (4) for sell orders, show SSU inventory contents so users can select items to list rather than typing type IDs manually. These improvements transform the trade page from a developer debugging tool into a usable marketplace interface.

The changes span two modules: `chain-shared` gets a new OrgMarket discovery query, and `periscope` gets new UI components and refactored trade views. No contract changes are needed -- all required data is already on-chain.

## Current State

### GovernanceTrade.tsx (1478 lines)

The main trade view at `apps/periscope/src/views/GovernanceTrade.tsx` has two tabs:

**Sell Orders Tab** (lines 194-515):
- `SellOrdersTab` component receives `org`, `currencies`, `tenant`, `account` props
- Uses `useOwnedAssemblies()` to discover SSUs (lines 207, 224-230) -- filters for `storage_unit`, `smart_storage_unit`, `protocol_depot`
- "Create Market" section (lines 314-391): SSU selector dropdown works well -- picks from discovered SSUs
- "Manage Listings" section (lines 394-498): **Problem areas:**
  - `listingConfigId` (line 219): raw text input for MarketConfig Object ID (`0x...`) -- user must know this
  - `listingTypeId` (line 220): raw numeric input for item type ID -- user must look up type IDs manually
  - `listingPrice` (line 221): raw numeric input -- no currency context
- No inventory display -- user cannot see what items are in their SSUs to list for sale
- `handleCreateMarket()` (lines 232-268) captures the MarketConfig ID from TX response, auto-fills `listingConfigId`

**Buy Orders Tab** (lines 519-1414):
- `BuyOrdersTab` component, same props
- `orgMarketId` state (line 539): raw text input (lines 842-894) -- **the primary UX problem**
  - User must paste an OrgMarket Object ID manually, or create a new one
  - No persistence -- loses the ID on page refresh
  - No auto-discovery from chain
- `orderSsuId` (line 555): raw text input (lines 1076-1088) -- user must paste SSU Object ID for delivery point
- `orderTypeId` (line 556): raw numeric input (lines 1090-1102) -- same problem as sell tab
- Buy order list (lines 1197-1376): displays `Type #{order.typeId}` with no name resolution
- "Confirm Fill" form (lines 1290-1371): seller address and quantity -- reasonable for hackathon admin flow

### chain-shared: ssu-market.ts

`packages/chain-shared/src/ssu-market.ts` provides:
- `queryOrgMarket(client, orgMarketId)` (lines 406-432): fetches OrgMarket by known ID
- `queryBuyOrders(client, orgMarketId)` (lines 438-490): iterates dynamic fields
- **Missing:** No discovery query -- cannot find OrgMarket by org ID or creator address

### chain-shared: treasury.ts

`packages/chain-shared/src/treasury.ts` provides `buildFundBuyOrder()` (lines 195-227) which composes `treasury::mint` + `ssu_market::create_buy_order` in a single PTB.

### Move Contract: ssu_market.move

`contracts/ssu_market/sources/ssu_market.move`:
- `OrgMarket` is a shared object (line 62-68): has `org_id: ID`, `admin: address`, `authorized_ssus: vector<ID>`
- `OrgMarketCreatedEvent` (lines 93-97): emits `org_market_id`, `org_id`, `admin` -- **key for discovery**
- `MarketConfig` is also shared (line 47-51): has `admin: address`, `ssu_id: ID`

### Static Data: gameTypes

- `apps/periscope/src/db/index.ts` (V3, line 144): `gameTypes` table indexed on `id, name, groupId, groupName, categoryId, categoryName`
- `apps/periscope/src/db/types.ts` (lines 36-49): `GameType` has `id`, `name`, `description`, `groupName`, `groupId`, `categoryName`, `categoryId`, `iconUrl`
- Loaded from World API by `apps/periscope/src/lib/worldApi.ts` (fetches `/v2/types`)
- DataInitializer loads on first run, ~32K types
- Already used in Assets view (`apps/periscope/src/views/Assets.tsx` lines 32-41) for name resolution

### Existing Patterns

- **SSU discovery:** `useOwnedAssemblies()` hook (`apps/periscope/src/hooks/useOwnedAssemblies.ts`) -- returns `{ character, assemblies }` with type, objectId, ownerCapId
- **Inventory fetching:** `fetchAssemblyInventory()` in `apps/periscope/src/chain/inventory.ts` -- returns items with `typeId` and `quantity`
- **DataGrid component:** `apps/periscope/src/components/DataGrid.tsx` -- TanStack Table wrapper with search, sort, filter
- **Type name lookup:** Assets view builds `typeNameMap` from `db.gameTypes.toArray()` (lines 32-41)
- **No existing autocomplete component** -- needs to be built

## Target State

### 1. OrgMarket Auto-Discovery

Instead of manual ID entry, the Buy Orders tab automatically discovers OrgMarket objects associated with the user's organization by querying `OrgMarketCreatedEvent` events filtered by `org_id`.

**Flow:**
1. App has the org's `chainObjectId` from the local `organizations` table
2. On tab mount, query chain for `OrgMarketCreatedEvent` where `org_id` matches
3. If found, auto-load the OrgMarket info and buy orders
4. If multiple found (unlikely for single org), present a selector
5. If none found, show "Create OrgMarket" button (existing flow)
6. Persist discovered OrgMarket ID in the organizations table (new field `orgMarketId`)

### 2. Item Type Autocomplete

A reusable `TypeSearchInput` component that provides:
- Text input with debounced search against `db.gameTypes`
- Dropdown showing matching types with name, group, category
- Search matches on `name`, `groupName`, `categoryName`
- Selection populates the type ID
- Shows selected item name + ID after selection
- Dexie `where("name").startsWithIgnoreCase()` for indexed prefix search, falling back to `.filter()` for substring

### 3. SSU Selection for Buy Orders

Replace the raw SSU ID text input with:
- Dropdown/list of user's discovered SSUs (from `useOwnedAssemblies()`)
- For authorized SSUs: show which ones are in the OrgMarket's `authorizedSsus` list
- Badge showing SSU status (online/offline)

### 4. Sell Order Inventory Browser

For the sell orders tab, add:
- Per-SSU inventory view showing items currently in the SSU
- Item rows show type name (from gameTypes), quantity, and "List for Sale" action
- Clicking "List for Sale" pre-fills the listing form with the type ID
- Uses existing `fetchAssemblyInventory()` from `chain/inventory.ts`
- Show which SSUs have MarketConfig already (discoverable via `MarketConfig` shared objects with matching `ssu_id`)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OrgMarket discovery method | Query `OrgMarketCreatedEvent` by `org_id` | Events are indexed and filterable. The `org_id` field in the event directly matches the org's chain object ID. Alternative (scanning all shared objects of type OrgMarket) is expensive and not well-supported. |
| OrgMarket ID persistence | New `orgMarketId` field on `OrganizationRecord` | Avoids re-querying events on every page load. Updated when discovered or created. |
| Type search implementation | Dexie query against IndexedDB `gameTypes` table | Data already loaded (32K types). Client-side search avoids API calls. Dexie supports `.where("name").startsWithIgnoreCase()` for indexed searches. |
| Type search component | New reusable `TypeSearchInput` component | Will be useful in other views (blueprints, inventory filters). Keep generic. |
| Inventory display for sell orders | Fetch on demand when SSU selected | Avoid fetching all SSU inventories upfront. Use existing `fetchAssemblyInventory()`. |
| MarketConfig discovery | Query events for `PurchaseEvent` or scan shared objects | For hackathon, track MarketConfig IDs locally after creation (already done in `handleCreateMarket`). Full discovery deferred. |
| SSU selector pattern | Reuse existing `<select>` dropdown pattern | Consistent with create-market section. Enhancement: add status badge. |

## Implementation Phases

### Phase 1: OrgMarket Auto-Discovery + Persistence

1. **Add `orgMarketId` field to `OrganizationRecord`** in `apps/periscope/src/db/types.ts` -- add `orgMarketId?: string` to the interface.
2. **Add DB migration V14** in `apps/periscope/src/db/index.ts` -- re-declare `organizations` table schema with same indexes (field is optional, no index needed). Upgrade function: no-op (existing records get `undefined`).
3. **Add `discoverOrgMarket()` query** in `packages/chain-shared/src/ssu-market.ts` -- use `client.queryEvents({ query: { MoveEventType: "<ssuMarketPkgId>::ssu_market::OrgMarketCreatedEvent" } })` to fetch all OrgMarket creation events, then client-side filter where `parsedJson.org_id` matches the target org's chain object ID. Return the `org_market_id` from the matching event. Handle pagination (max 50 events per query). Signature: `discoverOrgMarket(client: SuiClient, ssuMarketPackageId: string, orgObjectId: string): Promise<string | null>`. Follows the exact same pattern as `queryClaims()` in `governance.ts` (lines 256-310).
4. **Create `useOrgMarket()` hook** in `apps/periscope/src/hooks/useOrgMarket.ts` -- React Query hook that:
   - First checks `org.orgMarketId` from local DB
   - If set, verify it still exists on chain via `queryOrgMarket()` -- if null, clear the cached ID and fall through to discovery
   - If not set, calls `discoverOrgMarket()` on chain
   - If discovered, persists to `db.organizations.update()`
   - Returns `{ orgMarketId, orgMarketInfo, buyOrders, isLoading, error, createOrgMarket(), refreshOrders() }`
   - Uses `@tanstack/react-query` with `staleTime: 60_000` (consistent with other chain queries)
5. **Refactor `BuyOrdersTab`** to use `useOrgMarket()` instead of manual `orgMarketId` state. Remove the manual ID input section (lines 842-894). Show loading state during discovery. Keep "Create New OrgMarket" as fallback when no OrgMarket is discovered. Add a small "Advanced: Enter ID manually" toggle for edge cases.
6. **Update `handleCreateOrgMarket()`** to persist the new OrgMarket ID to the org record.

### Phase 2: Item Type Autocomplete Component

1. **Create `TypeSearchInput` component** at `apps/periscope/src/components/TypeSearchInput.tsx`:
   - Props: `value: number | null`, `onChange: (typeId: number | null) => void`, `placeholder?: string`
   - Text input with search icon
   - Debounced search (300ms) against `db.gameTypes`
   - Search strategy: first try `.where("name").startsWithIgnoreCase(query).limit(20)`, then if fewer than 5 results, also `.filter(t => t.name.toLowerCase().includes(query) || t.groupName.toLowerCase().includes(query))` with limit
   - Dropdown results: show `name` (bold), `groupName > categoryName` (muted), `#typeId` (mono)
   - Keyboard navigation (arrow keys, enter to select, escape to close)
   - When selected: show chip with item name and X to clear
   - Click outside closes dropdown
   - Handle empty `gameTypes` table: show "Item data loading..." hint if no types available yet
2. **Replace type ID inputs in `SellOrdersTab`** -- swap `listingTypeId` raw input for `TypeSearchInput`
3. **Replace type ID input in `BuyOrdersTab`** -- swap `orderTypeId` raw input for `TypeSearchInput`
4. **Resolve type names in buy order list** -- add `typeNameMap` lookup (same pattern as Assets view) to show item names instead of raw `Type #{typeId}`

### Phase 3: SSU Selection Improvements

1. **Enhance SSU dropdown in Buy Orders** -- replace `orderSsuId` raw text input with a `<select>` populated from the OrgMarket's `authorizedSsus` list (cross-referenced with discovered assemblies for labels). Show SSU object ID prefix + status.
2. **Add SSU status badges** to all SSU dropdowns -- green dot for online, gray for offline.
3. **Filter authorized SSUs** -- in the "Add SSU" section, exclude SSUs already in `authorizedSsus`.

### Phase 4: Sell Order Inventory Browser

1. **Add inventory fetch to SellOrdersTab** -- when user selects an SSU (for create-market or listing), fetch its inventory using `fetchAssemblyInventory()`.
2. **Create `SsuInventoryPanel` component** at `apps/periscope/src/components/SsuInventoryPanel.tsx`:
   - Props: `assemblyId: string`, `assemblyType: string`, `onSelectItem: (typeId: number) => void`
   - Fetches inventory on mount using `fetchAssemblyInventory(client, assemblyId, assemblyType)` (requires `useSuiClient()` internally)
   - Displays items in a compact list: item name (from gameTypes via `useLiveQuery`), quantity, "Select" button
   - Shows loading spinner during fetch, "No items in this SSU" if inventory is empty
   - "Select" triggers `onSelectItem(typeId)` which pre-fills the listing form
3. **Integrate into SellOrdersTab** -- show inventory panel when creating a listing, below the SSU selector. Clicking an inventory item populates `listingTypeId`.
4. **Track MarketConfig IDs locally** -- after `handleCreateMarket()` succeeds, store `{ ssuId, marketConfigId }` in a new `marketConfigs` settings key so the listing form can auto-fill `listingConfigId` for known SSUs.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Modify | Add `orgMarketId?: string` to `OrganizationRecord` |
| `apps/periscope/src/db/index.ts` | Modify | Add V14 migration (re-declare organizations with same schema) |
| `packages/chain-shared/src/ssu-market.ts` | Modify | Add `discoverOrgMarket(client, ssuMarketPackageId, orgObjectId)` query using `queryEvents` |
| `apps/periscope/src/hooks/useOrgMarket.ts` | Create | React Query hook for OrgMarket auto-discovery + persistence |
| `apps/periscope/src/views/GovernanceTrade.tsx` | Modify | Refactor BuyOrdersTab to use `useOrgMarket()`, replace raw inputs with new components, add inventory browser, resolve type names |
| `apps/periscope/src/components/TypeSearchInput.tsx` | Create | Reusable autocomplete component for game type selection |
| `apps/periscope/src/components/SsuInventoryPanel.tsx` | Create | SSU inventory display with item selection |

## Open Questions

1. **OrgMarket event discovery: what if `queryEvents` is unreliable or the event type string changes after contract upgrade?**
   - **Option A: Event-based discovery** -- Use `client.queryEvents({ MoveEventType: "<pkg>::ssu_market::OrgMarketCreatedEvent" })`. Pros: standard Sui pattern, indexed, fast. Cons: requires exact event type string including package ID, breaks if contract is upgraded to new package.
   - **Option B: Owned-object scan** -- Use `client.getOwnedObjects()` with `StructType` filter for `OrgMarket`. But `OrgMarket` is a shared object, not owned, so this won't work.
   - **Option C: Store OrgMarket ID at creation time only, no discovery** -- When user creates OrgMarket, persist the ID immediately. For pre-existing OrgMarkets, provide a manual ID entry fallback. Pros: simple, no query fragility. Cons: doesn't help if user created the OrgMarket in a different session or browser.
   - **Recommendation:** Option A (event-based) as primary, with Option C fallback. The ssu_market package ID is fixed (deployed once, known in `chain-shared/src/config.ts`). If events fail, the manual input remains as an advanced option.

2. **Type search performance with 32K types in IndexedDB?**
   - **Option A: Dexie indexed query** -- `.where("name").startsWithIgnoreCase(query)` is O(log n) via the B-tree index. Pros: fast, uses existing index. Cons: only matches prefixes, not substrings.
   - **Option B: Full-text scan with `.filter()`** -- Iterate all 32K records client-side. Pros: matches anywhere in name/group/category. Cons: could be slow on low-end devices.
   - **Option C: Hybrid** -- Use indexed prefix query first. If results < threshold, supplement with filtered substring search (capped at 50 results total). Pros: fast for common cases, comprehensive for unusual searches. Cons: slightly more complex.
   - **Recommendation:** Option C (hybrid). Prefix search handles most cases instantly. Substring fallback catches "EU-90" when user types "90". Cap total results at 20-30 to keep the dropdown manageable.

## Deferred

- **MarketConfig auto-discovery** -- Discovering which SSUs already have MarketConfig objects requires scanning shared objects or events. For now, we track MarketConfig IDs locally after creation. Full discovery (scan `MarketConfig` objects where `admin` = user address) deferred to post-hackathon.
- **Buy order type name resolution on chain** -- The chain stores `type_id` as a u64. Name resolution is always client-side via gameTypes. No on-chain change needed.
- **Automated buy order fill** -- Currently uses stakeholder-confirmed manual fill. Automated fill (checking extension inventory on-chain) is a separate feature.
- **Multi-org support** -- Current implementation assumes a single org. Multi-org OrgMarket management deferred.
- **SSU inventory real-time updates** -- Inventory is fetched once on selection. Real-time subscription (via Sui events) deferred.
