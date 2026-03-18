# Plan: Trade Page UX Improvements

**Status:** Complete — all phases implemented
**Created:** 2026-03-15
**Updated:** 2026-03-17
**Reviewed:** 2026-03-17 (post-implementation review — all phases verified against codebase)
**Module:** periscope, chain-shared

## Overview

The GovernanceTrade page (`apps/periscope/src/views/GovernanceTrade.tsx`) currently requires manual Object ID entry for OrgMarket discovery and raw numeric type ID entry for buy orders. This creates a poor user experience that makes the trade page impractical for real use. The page was built as a functional proof-of-concept during the market/currency sprint and now needs polish.

**Terminology:** An SSU that has been enabled for trading (has the `ssu_market` extension authorized) is called a **Trade Node**. This is the user-facing term throughout the UI. Enabling an SSU as a Trade Node requires deploying the `ssu_market` extension first — this is a prerequisite that the trade page must handle seamlessly. Users can also assign a custom name to each Trade Node for easy identification.

This plan addresses five UX gaps: (1) auto-discover OrgMarket objects from chain events instead of manual ID entry, (2) Trade Node setup flow — detect whether SSUs have the market extension, enable it with one click, and allow naming, (3) replace raw type ID input with a searchable autocomplete backed by the gameTypes static data (32K+ types in IndexedDB), (4) present Trade Nodes in a selectable list for buy order delivery point selection, and (5) for sell orders, show Trade Node inventory contents so users can select items to list rather than typing type IDs manually. These improvements transform the trade page from a developer debugging tool into a usable marketplace interface.

The changes span two modules: `chain-shared` gets a new OrgMarket discovery query, and `periscope` gets new UI components and refactored trade views. No contract changes are needed -- all required data is already on-chain.

## Current State

### GovernanceTrade.tsx (1477 lines)

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

- **SSU discovery:** `useOwnedAssemblies()` hook (`apps/periscope/src/hooks/useOwnedAssemblies.ts`) -- returns a React Query result wrapping `{ character: CharacterInfo | null, assemblies: OwnedAssembly[] }`. Each `OwnedAssembly` has `objectId`, `type`, `typeId`, `status`, `extensionType?`, `ownerCapId?` (defined in `apps/periscope/src/chain/queries.ts` lines 6-13).
- **Extension deploy:** `useExtensionDeploy()` hook (`apps/periscope/src/hooks/useExtensionDeploy.ts`) -- `deploy()` takes `{ template: ExtensionTemplate, assemblyId, assemblyType, characterId, ownerCapId, tenant, config? }`. Returns `{ deploy, reset, status, txDigest, error }`. Requires an `ExtensionTemplate` from `apps/periscope/src/chain/config.ts`. Uses `buildAuthorizeExtension()` from `apps/periscope/src/chain/transactions.ts` which constructs the borrow-authorize-return PTB using `template.packageIds[tenant]` and `template.witnessType`.
- **Extension templates:** Defined in `EXTENSION_TEMPLATES` array in `apps/periscope/src/chain/config.ts` (lines 116-207). **No `ssu_market` template exists yet** -- one must be added before Trade Node enablement will work.
- **Inventory fetching:** `fetchAssemblyInventory(client: SuiClient, assemblyId: string, assemblyType: string): Promise<AssemblyInventory[]>` in `apps/periscope/src/chain/inventory.ts`. Each `AssemblyInventory` has `assemblyId`, `assemblyType`, `inventoryId`, `items: InventoryItem[]`, `maxCapacity`, `usedCapacity`. Each `InventoryItem` has `typeId: number` and `quantity: number`.
- **DataGrid component:** `apps/periscope/src/components/DataGrid.tsx` -- TanStack Table wrapper with search, sort, filter
- **Type name lookup:** Assets view builds `typeNameMap` from `db.gameTypes.toArray()` (lines 32-41 of `apps/periscope/src/views/Assets.tsx`)
- **No existing autocomplete component** -- needs to be built
- **Contract addresses:** `getContractAddresses(tenant)` from `packages/chain-shared/src/config.ts` returns `ContractAddresses` which includes `ssuMarket?: { packageId: string }`. The ssu_market package ID is `0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885` (same for stillness and utopia).

## Target State

### 1. OrgMarket Auto-Discovery

Instead of manual ID entry, the Buy Orders tab automatically discovers OrgMarket objects associated with the user's organization by querying `OrgMarketCreatedEvent` events filtered by `org_id`.

**Flow:**
1. App has the org's `chainObjectId` from the local `organizations` table
2. On tab mount, query chain for `OrgMarketCreatedEvent` where `org_id` matches
3. If found, auto-load the OrgMarket info and buy orders
4. If multiple found (unlikely for single org), use the most recent one (last event). Multi-OrgMarket selection deferred.
5. If none found, show "Create OrgMarket" button (existing flow)
6. Persist discovered OrgMarket ID in the organizations table (new field `orgMarketId`)

### 2. Trade Node Setup

An SSU must have the `ssu_market` extension authorized before it can participate in trading. The UI calls these enabled SSUs **Trade Nodes**.

**Flow:**
1. User sees a list of their owned SSUs (from `useOwnedAssemblies()`)
2. Each SSU shows its status: "Trade Node" (extension active) or "Not enabled"
3. For SSUs without the extension: a one-click "Enable as Trade Node" button that:
   a. Authorizes the `ssu_market` extension via `useExtensionDeploy`
   b. Prompts the user to set a custom name for the Trade Node
   c. Stores the name locally in IndexedDB (on the deployable/assembly record or a new `tradeNodes` table)
4. For existing Trade Nodes: show the custom name, with an edit icon to rename
5. Only Trade Nodes appear in the SSU pickers for sell/buy order creation

### 3. Item Type Autocomplete

A reusable `TypeSearchInput` component that provides:
- Text input with debounced search against `db.gameTypes`
- Dropdown showing matching types with name, group, category
- Search matches on `name`, `groupName`, `categoryName`
- Selection populates the type ID
- Shows selected item name + ID after selection
- Dexie `where("name").startsWithIgnoreCase()` for indexed prefix search, falling back to `.filter()` for substring

### 4. Trade Node Selection for Buy Orders

Replace the raw SSU ID text input with:
- Dropdown/list of user's Trade Nodes (SSUs with market extension enabled)
- For authorized Trade Nodes: show which ones are in the OrgMarket's `authorizedSsus` list
- Badge showing node status (online/offline) and custom name
- Only Trade Nodes (extension-enabled SSUs) appear in the picker

### 5. Sell Order Inventory Browser

For the sell orders tab, add:
- Trade Node selector showing enabled SSUs with custom names
- Per-Trade-Node inventory view showing items currently in the SSU
- Item rows show type name (from gameTypes), quantity, and "List for Sale" action
- Clicking "List for Sale" pre-fills the listing form with the type ID
- Uses existing `fetchAssemblyInventory()` from `chain/inventory.ts`
- Show which Trade Nodes have MarketConfig already (discoverable via `MarketConfig` shared objects with matching `ssu_id`)

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
| Trade Node terminology | SSUs with market extension = "Trade Nodes" | User-facing term. Clearer than "market SSU" or "OrgMarket SSU". |
| Extension prerequisite | One-click "Enable as Trade Node" in trade page | Seamless UX — user doesn't need to visit Extensions page separately. Uses existing `useExtensionDeploy` hook. |
| Trade Node naming | Custom name stored in IndexedDB `tradeNodes` table | Local-only label for easy identification. Not stored on-chain (no contract support). Editable anytime. |
| Trade Node detection | Check assembly's authorized extensions for `ssu_market` | On-chain query via `getObject` dynamic fields or local extension records in `db.extensions`. |

## Implementation Phases

### Phase 1: OrgMarket Auto-Discovery + Persistence [COMPLETE]

1. **Add `orgMarketId` field to `OrganizationRecord`** in `apps/periscope/src/db/types.ts` -- add `orgMarketId?: string` to the interface (after `chainObjectId?: string`).
2. **Add DB migration V14** in `apps/periscope/src/db/index.ts` -- add `this.version(14).stores({ tradeNodes: "id" })` after the V13 block. The `orgMarketId` field on `OrganizationRecord` is optional and not indexed, so no schema change for `organizations` is needed (Dexie only requires re-declaration when indexes change). The `tradeNodes` table is new, so it must be declared. **Note:** This V14 migration is shared with Phase 2 (which also uses the `tradeNodes` table). Both Phase 1 and Phase 2 DB changes go into the same `this.version(14)` call.
3. **Add `discoverOrgMarket()` query** in `packages/chain-shared/src/ssu-market.ts` -- use `client.queryEvents({ query: { MoveEventType: "${ssuMarketPackageId}::ssu_market::OrgMarketCreatedEvent" } })` to fetch all OrgMarket creation events, then client-side filter where `parsedJson.org_id` matches the target org's chain object ID. Return the `org_market_id` from the matching event. Handle pagination (max 50 events per query). Signature: `discoverOrgMarket(client: SuiClient, ssuMarketPackageId: string, orgObjectId: string): Promise<string | null>`. Follows the exact same pattern as `queryClaimEvents()` in `governance.ts` (lines 246-316). Need to import `type { EventId }` from `@mysten/sui/client` for the cursor typing.
4. **Create `useOrgMarket()` hook** in `apps/periscope/src/hooks/useOrgMarket.ts`:
   - Imports: `useQuery` from `@tanstack/react-query`; `useSuiClient` from `@mysten/dapp-kit`; `queryOrgMarket`, `queryBuyOrders`, `discoverOrgMarket`, `getContractAddresses` from `@tehfrontier/chain-shared`; `db` from `@/db`; types as needed
   - Params: `org: OrganizationRecord | undefined`, `tenant: TenantId`
   - Gets the ssu_market package ID: `const ssuMarketPkgId = getContractAddresses(tenant).ssuMarket?.packageId`
   - Gets `client` via `useSuiClient()` from `@mysten/dapp-kit`
   - Single `useQuery` with `queryKey: ["orgMarket", org?.id, tenant]`, `staleTime: 60_000`, `enabled: !!org?.chainObjectId && !!ssuMarketPkgId`
   - `queryFn` performs these steps sequentially:
     1. **Resolve orgMarketId:** If `org.orgMarketId` is set, use it. Otherwise call `discoverOrgMarket(client, ssuMarketPkgId, org.chainObjectId!)` -- if found, persist via `await db.organizations.update(org.id, { orgMarketId: discoveredId })`.
     2. **If no orgMarketId found** (neither cached nor discovered): return `{ orgMarketId: null, orgMarketInfo: null, buyOrders: [] }`
     3. **Fetch OrgMarket info:** `const info = await queryOrgMarket(client, orgMarketId)` -- if null (object deleted/invalid), clear cache via `db.organizations.update(org.id, { orgMarketId: undefined })` and return null result
     4. **Fetch buy orders:** `const orders = await queryBuyOrders(client, orgMarketId)`
     5. **Return:** `{ orgMarketId, orgMarketInfo: info, buyOrders: orders }`
   - Return type from hook: `{ orgMarketId: string | null, orgMarketInfo: OrgMarketInfo | null, buyOrders: BuyOrderInfo[], isLoading: boolean, error: Error | null, refetch: () => void }`
   - Destructure from `useQuery`: `const { data, isLoading, error, refetch } = useQuery(...)`, then spread `data` fields with defaults
5. **Refactor `BuyOrdersTab`** to use `useOrgMarket()` instead of manual `orgMarketId` state:
   - Remove the `orgMarketId` state variable (line 539) and the manual input section (lines 842-894)
   - Remove `orgMarketInfo`, `loadingMarket`, `loadOrgMarket()`, `loadBuyOrders()`, `buyOrders`, `loadingOrders` local state -- these are now provided by the hook
   - Destructure from hook: `const { orgMarketId, orgMarketInfo, buyOrders, isLoading, refetch } = useOrgMarket(org, tenant as TenantId);`
   - When `isLoading`: show a spinner with "Discovering OrgMarket..."
   - When `orgMarketId` is null and not loading: show "Create New OrgMarket" button (existing flow) plus a small "Advanced: Enter ID manually" collapsible toggle for edge cases
   - Update all references to the old state variables to use hook-provided values
   - Keep the `handleCreateOrgMarket()` function but add persistence (see step 6)
6. **Update `handleCreateOrgMarket()`** to persist the new OrgMarket ID:
   - After the TX succeeds and `marketCreated.objectId` is extracted (lines 629-637), add: `await db.organizations.update(org.id, { orgMarketId: marketCreated.objectId })`
   - Then call `refetch()` from the hook to refresh the view

### Phase 2: Trade Node Setup Flow [COMPLETE]

1. **Add `ssu_market` extension template** to `apps/periscope/src/chain/config.ts` `EXTENSION_TEMPLATES` array:
   ```ts
   {
     id: "ssu_market",
     name: "SSU Market",
     description: "Enable trading on this SSU. Allows stocking items for sale and receiving buy order deliveries.",
     assemblyTypes: ["storage_unit", "smart_storage_unit", "protocol_depot"],
     hasConfig: false,
     packageIds: {
       stillness: "0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885",
       utopia: "0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885",
     },
     configObjectIds: {},
     witnessType: "ssu_market::MarketAuth",
   }
   ```
   This is required because `useExtensionDeploy().deploy()` takes an `ExtensionTemplate` and uses `template.packageIds[tenant]` to construct the Move call and `template.witnessType` for the witness type argument. The witness type `MarketAuth` is defined at line 44 of `contracts/ssu_market/sources/ssu_market.move`. The `buildAuthorizeExtension()` function in `apps/periscope/src/chain/transactions.ts` maps `storage_unit`, `smart_storage_unit`, and `protocol_depot` assembly types to the `storage_unit::StorageUnit` Move type for the borrow/authorize/return flow.
2. **Add `tradeNodes` table** in `apps/periscope/src/db/index.ts` (V14 migration, alongside orgMarketId change):
   - Schema: `id` (SSU objectId), `name` (custom label), `marketConfigId?` (set after MarketConfig creation), `enabledAt` (ISO timestamp)
   - Indexed on `id`
   - Dexie stores declaration: `tradeNodes: "id"`
3. **Add `TradeNodeRecord` type** in `apps/periscope/src/db/types.ts`:
   - `id: string` (SSU objectId -- same as the assembly objectId from `OwnedAssembly`)
   - `name: string` (custom label)
   - `marketConfigId?: string` (set after MarketConfig creation)
   - `enabledAt: string` (ISO timestamp)
4. **Add `tradeNodes` EntityTable** to the `PeriscopeDB` class in `apps/periscope/src/db/index.ts`:
   - Add import for `TradeNodeRecord` to the import list at the top
   - Add class property: `tradeNodes!: EntityTable<TradeNodeRecord, "id">;`
5. **Lift `useOwnedAssemblies()` to `GovernanceTrade` component** -- move the call from `SellOrdersTab`/`BuyOrdersTab` up to the parent `GovernanceTrade()` function (after line 51). Pass `discovery` data down as a prop to both tabs and to the new Trade Node section. This avoids three separate calls to the same hook.
6. **Create Trade Node management section** as a new `TradeNodeManager` component rendered in `GovernanceTrade()` between the tab buttons (line 153) and the tab content (line 155):
   - Props: `discovery` (from `useOwnedAssemblies`), `tenant: TenantId`
   - Uses `useLiveQuery(() => db.tradeNodes.toArray())` to get all Trade Nodes
   - "Your Trade Nodes" header with a list of enabled Trade Nodes
   - Each row: custom name (editable inline via `db.tradeNodes.update(id, { name })`), SSU object ID (truncated), assembly status badge (from `discovery.assemblies.find(a => a.objectId === tradeNode.id)?.status`), "Rename" action
   - Below the list: "Enable New Trade Node" section showing SSUs from `discovery.assemblies` that are (a) storage-type (`storage_unit`, `smart_storage_unit`, `protocol_depot`) and (b) NOT yet in `db.tradeNodes` (filter by checking `tradeNodeIds.has(ssu.objectId)`)
   - Each unregistered SSU: type + objectId (truncated), assembly status, "Enable as Trade Node" button
   - Collapsible section (default collapsed if user already has Trade Nodes, expanded if none)
7. **"Enable as Trade Node" flow** (inside `TradeNodeManager`):
   - Click button --> prompt for custom name (inline input below the button, default: `"Trade Node " + ssu.objectId.slice(0, 8)`)
   - Get the `ssu_market` template via `getTemplate("ssu_market")` from `apps/periscope/src/chain/config.ts`
   - Call `deploy({ template, assemblyId: ssu.objectId, assemblyType: ssu.type, characterId: discovery.character.characterObjectId, ownerCapId: ssu.ownerCapId, tenant })` via `useExtensionDeploy`
   - **Edge case:** If `ssu.ownerCapId` is undefined, show an error "OwnerCap not found for this SSU. Try refreshing."
   - **Edge case:** If `discovery.character` is null, show "No character found. Connect your wallet first."
   - On success: insert into `db.tradeNodes` with the custom name and `enabledAt: new Date().toISOString()`
   - Show success/error status (use existing `OpStatusBanner` pattern)
8. **Filter SSU pickers** in both Sell and Buy tabs to only show Trade Nodes (cross-reference `discovery.assemblies` with `db.tradeNodes` via `useLiveQuery`). Display custom names in dropdowns instead of raw object IDs. Format: `"{name} -- {objectId.slice(0, 10)}..."`.
9. **Update `handleCreateMarket()` in SellOrdersTab** to persist the MarketConfig ID back to `db.tradeNodes.update(ssuId, { marketConfigId })`.

### Phase 3: Item Type Autocomplete Component [COMPLETE]

1. **Create `TypeSearchInput` component** at `apps/periscope/src/components/TypeSearchInput.tsx`:
   - Props: `value: number | null`, `onChange: (typeId: number | null) => void`, `placeholder?: string`, `className?: string`
   - Imports: `useState`, `useRef`, `useEffect`, `useCallback` from React; `db` from `@/db`; `Search`, `X` from `lucide-react`
   - Text input with search icon (use `Search` icon from lucide-react)
   - Internal state: `query: string`, `results: GameType[]`, `isOpen: boolean`, `highlightIndex: number`
   - Debounced search (300ms via `setTimeout`/`clearTimeout` in a `useEffect`) against `db.gameTypes`
   - Search strategy: first try `db.gameTypes.where("name").startsWithIgnoreCase(query.trim()).limit(20).toArray()`, then if fewer than 5 results, also `db.gameTypes.filter(t => t.name.toLowerCase().includes(query) || t.groupName.toLowerCase().includes(query)).limit(20).toArray()`, deduplicate by `id`, cap total at 20
   - Dropdown: absolutely positioned `div` below input with `z-10`, max-height with overflow scroll
   - Dropdown results: show `name` (bold, `text-zinc-100`), `groupName > categoryName` (muted, `text-zinc-500 text-xs`), `#typeId` (mono, `text-zinc-600 text-xs`)
   - Keyboard: `onKeyDown` handler on input -- ArrowDown/ArrowUp change `highlightIndex`, Enter selects highlighted, Escape closes dropdown
   - When selected: input shows chip with item name and X button to clear (clicking X calls `onChange(null)` and clears query)
   - Click outside closes dropdown: use `useRef` on the wrapper `div`, add `mousedown` event listener on `document`, close if click target is outside ref
   - Handle empty `gameTypes` table: if `db.gameTypes.count()` is 0, show "Item data loading..." hint in the dropdown
   - Match the existing input styling: `rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none`
2. **Replace type ID inputs in `SellOrdersTab`** -- change `listingTypeId` from `string` to `number | null`, replace the `<input type="number">` (lines 419-431) with `<TypeSearchInput value={listingTypeId} onChange={setListingTypeId} placeholder="Search items..." />`. Update `handleSetListing` to use `listingTypeId` directly (already a number, no `Number()` conversion needed). Update the disabled check: `!listingTypeId` becomes `listingTypeId === null`.
3. **Replace type ID input in `BuyOrdersTab`** -- change `orderTypeId` from `string` to `number | null`, replace the `<input type="number">` (lines 1090-1102) with `<TypeSearchInput value={orderTypeId} onChange={setOrderTypeId} placeholder="Search items..." />`. Update `handleFundBuyOrder` to use `orderTypeId` directly. Update the disabled check similarly.
4. **Resolve type names in buy order list** -- add `typeNameMap` via `useLiveQuery(() => db.gameTypes.toArray())` and `useMemo` (same pattern as `apps/periscope/src/views/Assets.tsx` lines 32-41). Replace `Type #{order.typeId}` (line 1238) with `{typeNameMap[order.typeId] ?? "Type #" + order.typeId}`. Also add `#{order.typeId}` as a muted suffix for reference.

### Phase 4: Trade Node Selection Improvements [COMPLETE]

1. **Enhance Trade Node dropdown in Buy Orders** -- replace `orderSsuId` raw text input (lines 1076-1088) with a `<select>` populated from Trade Nodes. Cross-reference each Trade Node with `orgMarketInfo.authorizedSsus` to show which nodes are authorized delivery points. Format options: `"{tradeName} -- {objectId.slice(0, 10)}... {isAuthorized ? '(authorized)' : '(not authorized)'}"`
2. **Add status badges** to all Trade Node dropdowns -- cross-reference Trade Node objectId with `discovery.assemblies` to get `status`. Show a small colored dot: green for "online", yellow for "anchoring", gray for "offline"/"unknown".
3. **Filter "Add SSU" section** (lines 970-1011) to only show Trade Nodes that are NOT already in `orgMarketInfo.authorizedSsus`. Replace the current dual selector/text-input pattern with a simple `<select>` of unadded Trade Nodes.
4. **Edge case:** If user has no Trade Nodes, show a hint: "Enable an SSU as a Trade Node first (see above)" in both the buy order SSU selector and the "Add SSU" section.

### Phase 5: Sell Order Inventory Browser [COMPLETE]

1. **Create `SsuInventoryPanel` component** at `apps/periscope/src/components/SsuInventoryPanel.tsx`:
   - Props: `assemblyId: string`, `assemblyType: string`, `onSelectItem: (typeId: number) => void`
   - Imports: `useSuiClient` from `@mysten/dapp-kit`; `useQuery` from `@tanstack/react-query`; `useLiveQuery` from `dexie-react-hooks`; `fetchAssemblyInventory` from `@/chain/inventory`; `db` from `@/db`; `Loader2`, `Package` from `lucide-react`
   - Fetches inventory using `useQuery({ queryKey: ["ssuInventory", assemblyId], queryFn: () => fetchAssemblyInventory(client, assemblyId, assemblyType), staleTime: 30_000 })`
   - Builds `typeNameMap` from `useLiveQuery(() => db.gameTypes.toArray())` + `useMemo` (same pattern as Assets view)
   - Displays items in a compact list: item name (from typeNameMap, fallback `"Type #{typeId}"`), quantity (formatted with `toLocaleString()`), "Select" button
   - Shows `<Loader2>` spinner during fetch, "No items in this SSU" if inventory is empty (all `AssemblyInventory[].items` are empty)
   - "Select" button triggers `onSelectItem(typeId)` which pre-fills the listing form
   - Flatten all inventories: `inventories.flatMap(inv => inv.items)` since an SSU may have multiple inventory dynamic fields
   - Style: compact rows with `border-b border-zinc-800` dividers, `text-sm`, consistent with trade page styling
2. **Integrate into SellOrdersTab** -- show `<SsuInventoryPanel>` when the listing form is open and a Trade Node is selected. Show it below the Trade Node selector and above the type ID input. When user clicks "Select" on an inventory item, set `listingTypeId` to that item's `typeId` (via `onSelectItem`).
3. **Add Trade Node selector to listing form** -- in the "Manage Listings" section, add a `<select>` dropdown above the MarketConfig ID input to pick a Trade Node. When a Trade Node with a known `marketConfigId` (from `db.tradeNodes`) is selected, auto-fill `listingConfigId`. This removes the need to manually enter the MarketConfig Object ID in most cases.
4. **Track MarketConfig IDs locally** -- `handleCreateMarket()` already captures the MarketConfig ID from the TX response (lines 251-259). Add: after setting `listingConfigId`, also persist to `db.tradeNodes.update(marketSsuId, { marketConfigId: marketCreated.objectId })`. This means subsequent listings for the same SSU auto-fill the MarketConfig ID.

## File Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `apps/periscope/src/db/types.ts` | Modify | 1, 2 | Add `orgMarketId?: string` to `OrganizationRecord`, add `TradeNodeRecord` type |
| `apps/periscope/src/db/index.ts` | Modify | 1, 2 | Add V14 migration: `tradeNodes` table + `orgMarketId` on organizations. Add `TradeNodeRecord` import and `tradeNodes` EntityTable property. |
| `packages/chain-shared/src/ssu-market.ts` | Modify | 1 | Add `discoverOrgMarket(client, ssuMarketPackageId, orgObjectId)` query using `queryEvents` |
| `apps/periscope/src/hooks/useOrgMarket.ts` | Create | 1 | React Query hook for OrgMarket auto-discovery + persistence |
| `apps/periscope/src/chain/config.ts` | Modify | 2 | Add `ssu_market` entry to `EXTENSION_TEMPLATES` array with `witnessType: "ssu_market::MarketAuth"` and package IDs |
| `apps/periscope/src/views/GovernanceTrade.tsx` | Modify | 1-5 | Add Trade Node management section, refactor both tabs to use Trade Nodes, replace raw inputs with new components, add inventory browser, resolve type names |
| `apps/periscope/src/components/TypeSearchInput.tsx` | Create | 3 | Reusable autocomplete component for game type selection |
| `apps/periscope/src/components/SsuInventoryPanel.tsx` | Create | 5 | Trade Node inventory display with item selection |

## Open Questions

1. ~~**OrgMarket event discovery: what if `queryEvents` is unreliable or the event type string changes after contract upgrade?**~~ **RESOLVED** — Use both: persist on creation (instant for creators), auto-discover via `OrgMarketCreatedEvent` when not saved (for stakeholders joining an existing org). Cache the discovered ID locally so subsequent loads skip the chain query. The `ssu_market` package ID is fixed in `config.ts`. Flow: check local DB → if missing, query events by `org_id` → cache result → use.


2. ~~**Type search performance with 32K types in IndexedDB?**~~ **RESOLVED** — Option C (hybrid). Indexed prefix query first (`startsWithIgnoreCase`), supplement with filtered substring search if results < threshold. Cap total at 20-30 results.

## Deferred

- ~~**MarketConfig auto-discovery**~~ **DONE** -- `discoverMarketConfig()` was added to `ssu-market.ts` using GraphQL object scan. `SellOrdersTab` auto-discovers MarketConfig for each Trade Node on mount, clearing stale configs on tenant switch.
- **Buy order type name resolution on chain** -- The chain stores `type_id` as a u64. Name resolution is always client-side via gameTypes. No on-chain change needed.
- **Automated buy order fill** -- Currently uses stakeholder-confirmed manual fill. Automated fill (checking extension inventory on-chain) is a separate feature.
- **Multi-org support** -- Current implementation assumes a single org. Multi-org OrgMarket management deferred.
- **SSU inventory real-time updates** -- Inventory is fetched once on selection. Real-time subscription (via Sui events) deferred.
- **On-chain Trade Node naming** -- Custom names are stored locally in IndexedDB only. On-chain naming would require a contract change (dynamic field on MarketConfig or a separate registry). Deferred to post-hackathon.
- **Trade Node status sync** -- Extension authorization status is checked once on page load. Real-time extension status subscription deferred.

## Verification Log (2026-03-15)

Pre-implementation verification -- all file paths, line numbers, types, and patterns were verified against the codebase at plan creation time. See original plan for full details.

## Post-Implementation Review (2026-03-17)

All five phases verified complete. Implementation closely followed the plan with these notable deviations:

### Implementation deviations from plan

1. **`discoverOrgMarket()` uses GraphQL object scan, not event queries** -- The plan specified `queryEvents` with `OrgMarketCreatedEvent`, but the implementation uses a GraphQL `objects(filter: { type })` query to scan all `OrgMarket` shared objects and match by `org_id`. This is functionally equivalent and arguably more reliable (doesn't depend on event indexing).

2. **`discoverMarketConfig()` was implemented (originally deferred)** -- The plan listed MarketConfig auto-discovery as deferred, but `discoverMarketConfig()` was added to `ssu-market.ts`. `SellOrdersTab` calls it on mount for all Trade Nodes, auto-populating `marketConfigId` and clearing stale configs on tenant switch.

3. **`useSellOrders` hook added (not in plan)** -- A new `useSellOrders.ts` hook wraps `queryAllSellOrders()` with React Query (15s refetch interval). The `SellOrdersForNode` sub-component in `GovernanceTrade.tsx` uses it to display active sell orders per Trade Node with cancel/edit-price actions.

4. **`queryAllSellOrders()` added to chain-shared (not in plan)** -- New function in `ssu-market.ts` for querying sell orders from a `MarketConfig` object's dynamic fields.

5. **Trade Node auto-sync from on-chain state** -- The `TradeNodeManager` component auto-discovers Trade Nodes by cross-referencing `authorizedSsus` from OrgMarket, local extension records, and assembly extension fields. SSUs found on-chain are auto-registered in `db.tradeNodes` without requiring manual "Enable" flow.

6. **`TypeSearchInput` uses bundled `types.json` fallback** -- Beyond Dexie search, the component also loads a static `/data/types.json` file for name resolution when `db.gameTypes` has no match. This handles cold-start before DataInitializer finishes.

7. **`SsuInventoryPanel` supports `filterKind` prop** -- The plan didn't include inventory kind filtering, but the implementation adds a `filterKind?: InventoryKind` prop (e.g., `"owner"`) to show only owner inventory (items available to sell) vs escrowed inventory. The SellOrdersTab uses `filterKind="owner"`.

8. **`SsuInventoryPanel` uses bundled `types.json` for type names** -- Instead of `useLiveQuery` on `db.gameTypes`, the component uses a React Query-cached fetch of `/data/types.json` with `staleTime: Infinity`. Functionally equivalent, avoids Dexie reactive subscription overhead for read-only data.

9. **GovernanceTrade.tsx grew to 2053 lines** -- Plan expected modifications to a 1477-line file. The substantial growth reflects the addition of `TradeNodeManager`, `SellOrdersForNode`, and significantly expanded sell/buy order management UI.

10. **`ssu_market` template uses different `utopia` package ID** -- Plan specified `0xdb9df1...` for both stillness and utopia. Implementation uses `0x53c2bf5e90d12b8a92594ab959f3d883dc2afdaf6031e9640151f82582a17501` for utopia (correct for a separately published contract).

### Files created/modified (confirmed)

| File | Status |
|------|--------|
| `apps/periscope/src/db/types.ts` | `orgMarketId` on `OrganizationRecord` + `TradeNodeRecord` type -- DONE |
| `apps/periscope/src/db/index.ts` | V14 migration with `tradeNodes: "id"` + `tradeNodes` EntityTable -- DONE |
| `packages/chain-shared/src/ssu-market.ts` | `discoverOrgMarket()` + `discoverMarketConfig()` + `queryAllSellOrders()` -- DONE |
| `apps/periscope/src/hooks/useOrgMarket.ts` | Created -- DONE |
| `apps/periscope/src/hooks/useSellOrders.ts` | Created (not in plan) -- DONE |
| `apps/periscope/src/chain/config.ts` | `ssu_market` template added -- DONE |
| `apps/periscope/src/views/GovernanceTrade.tsx` | Full refactor with TradeNodeManager, filtered SSU pickers, TypeSearchInput, SsuInventoryPanel, sell order management -- DONE |
| `apps/periscope/src/components/TypeSearchInput.tsx` | Created -- DONE |
| `apps/periscope/src/components/SsuInventoryPanel.tsx` | Created -- DONE |
