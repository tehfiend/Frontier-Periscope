# Plan: Currency Trading UI in Periscope

**Status:** Review Pass 4
**Created:** 2026-04-04
**Module:** periscope

## Overview

The Periscope app has a Currencies page (`/currencies`) that lets users create, manage, and view currencies -- including minting, burning, treasury management, and viewing existing market orders and exchange pairs. However, there is no way for a user to **trade**: they cannot post sell listings, create buy orders, buy from existing listings, fill buy orders, place exchange bids/asks, or cancel their own orders. The view is read-only for trading.

Meanwhile, the SSU dApp (`apps/ssu-dapp`) has a full set of trading dialogs: `PlaceOrderDialog` (exchange bids/asks), `CancelOrderDialog`, `CreateBuyOrderDialog` (market buy orders), `SellDialog` (market sell listings), `BuyFromListingDialog`, `CancelListingDialog`, `CancelBuyOrderDialog`, and `FillBuyOrderDialog`. These dialogs use `@tehfrontier/chain-shared` TX builders that are already exported and available to Periscope.

This plan adds trading actions to the existing Currencies detail panel so users can interact with both the **Market order book** (item-based sell listings and buy orders priced in the selected currency) and the **Exchange** (currency-to-currency trading via OrderBook pairs). No new routes are needed -- the trading UI lives inside the existing `CurrencyDetail` component.

## Current State

### Currencies View (`apps/periscope/src/views/Currencies.tsx`)

The `CurrencyDetail` component (line 868) renders three sections for a selected currency:

1. **Market Identity** -- currency metadata, admin actions (mint, burn, authorize, fees), decommission toggle
2. **Treasury** -- balance, deposit, withdraw, admin management
3. **Market Order Book** -- read-only DataGrid of sell listings and buy orders fetched via `queryMarketListings` / `queryMarketBuyOrders`
4. **Exchange Pairs** -- read-only expandable list of OrderBook pairs, each showing a DataGrid of bid/ask orders via `fetchExchangeOrders`

Key gap: The order book and exchange pair sections are display-only. There are no buttons to buy from a listing, post a sell listing, create a buy order, cancel an order, place a bid/ask, or cancel a bid/ask.

### SSU dApp Trading Dialogs (`apps/ssu-dapp/src/components/`)

The SSU dApp has these trading dialogs, all using `<dialog>` elements and chain-shared TX builders:

| Dialog | TX Builder | Purpose |
|--------|-----------|---------|
| `PlaceOrderDialog` | `buildPlaceBid` / `buildPlaceAsk` | Place exchange bid or ask |
| `CancelOrderDialog` | `buildCancelBid` / `buildCancelAsk` | Cancel own exchange order |
| `CreateBuyOrderDialog` | `buildPostBuyOrder` | Post market buy order with escrowed coins |
| `BuyFromListingDialog` | `buildBuyAndReceive` | Buy from a sell listing |
| `SellDialog` | `buildEscrowAndList` / `buildPlayerEscrowAndList` | Post a sell listing |
| `FillBuyOrderDialog` | `buildFillBuyOrder` | Fill an existing buy order (authorized sellers) |
| `CancelListingDialog` | `buildCancelSellListing` | Cancel own sell listing |
| `CancelBuyOrderDialog` | `buildCancelBuyOrder` | Cancel own buy order |

However, the SSU dApp dialogs are tightly coupled to the SSU context (SSU config, SSU owner character, escrow workflows). Periscope's Currencies view operates at a higher level -- it knows the market ID, coin type, and wallet address, but does not have SSU-specific context. We need to adapt/rewrite these dialogs for the Currencies context.

### Available TX Builders in `@tehfrontier/chain-shared`

**Market module** (`packages/chain-shared/src/market.ts`):
- `buildPostSellListing(params)` -- post a sell listing (needs ssuId, typeId, pricePerUnit, quantity)
- `buildUpdateSellListing(params)` -- update price/quantity on own listing
- `buildCancelSellListing(params)` -- cancel own sell listing
- `buildBuyFromListing(params)` -- buy from an existing sell listing (needs coin objects for payment)
- `buildPostBuyOrder(params)` -- post a buy order with escrowed coins
- `buildCancelBuyOrder(params)` -- cancel own buy order (returns escrowed coins)
- `buildFillBuyOrder(params)` -- fill a buy order (authorized sellers only)

**Exchange module** (`packages/chain-shared/src/exchange.ts`):
- `buildPlaceBid(params)` -- place a bid on an OrderBook
- `buildPlaceAsk(params)` -- place an ask on an OrderBook
- `buildCancelBid(params)` -- cancel own bid
- `buildCancelAsk(params)` -- cancel own ask
- `buildCreatePair(params)` -- create a new exchange pair

**Coin queries** (`packages/chain-shared/src/token-factory.ts`):
- `queryOwnedCoins(client, owner, coinType)` -- fetch owned coins for payment

### Config (`apps/periscope/src/chain/config.ts`)

Both tenants already have `exchange.packageId` configured (line 19 and 76), and `market.packageId` is also present. All TX builders are already exported from `@tehfrontier/chain-shared`.

## Target State

### Trading Actions on the Market Order Book Section

Add action buttons to each row and a "Create" action to the order book header:

1. **Buy from Listing** button on sell listing rows (when wallet connected and user is not the seller)
2. **Cancel Listing** button on own sell listing rows
3. **Fill Buy Order** button on buy order rows (when user is authorized on the market)
4. **Cancel Buy Order** button on own buy order rows
5. **Post Sell Listing** button in the order book header actions area
6. **Create Buy Order** button in the order book header actions area

### Trading Actions on the Exchange Pairs Section

Add action buttons to each expanded pair's order table and to the section header:

1. **Place Order** (bid/ask) button per expanded pair
2. **Cancel Order** button on own exchange orders
3. **Create Pair** button in the section header (for creating new OrderBook pairs)

### Implementation Approach

Rather than porting the SSU dApp's `<dialog>` components wholesale (which are coupled to SSU context), we will build inline panel forms similar to the existing admin panels (Mint, Burn, Auth, Fees) in the CurrencyDetail component. This approach is consistent with the current Currencies page UX where actions expand inline rather than opening modals.

For exchange trading specifically, where the PlaceOrderDialog is self-contained and not SSU-dependent, we can adapt it as an inline panel or a simple dialog within the Currencies detail view.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI Pattern | Inline panels within CurrencyDetail (matching existing Mint/Burn pattern) | Consistent with existing UX; avoids modals; keeps context visible |
| Market sell listings | Use `buildPostSellListing` directly (not the SSU escrow variants) | Periscope operates at currency level, not SSU level; the base market TX builder is what we need |
| Buy from listing | Use `buildBuyFromListing` directly | The SSU dApp's `buildBuyAndReceive` adds SSU-specific escrow steps not needed here |
| Exchange trading | Inline bid/ask form per expanded pair | Keeps the exchange section self-contained |
| Row-level actions | Add a small actions column to both DataGrids | Follows the SSU dApp's pattern of per-row Cancel buttons |
| Cancel own orders | Show cancel button only for own address rows | Standard pattern matching SSU dApp |
| Wallet connect | Auto-connect via Eve Vault on action click (existing `ensureWallet()` pattern) | Matches existing Currencies behavior per CLAUDE.md: "Auto-connect wallet inline on action click" |
| File organization | Extract trading components into a separate file | Currencies.tsx is ~2700 lines; extracting keeps file sizes manageable |
| MarketOrderRow extension | Add `listingId`/`orderId` numeric field to MarketOrderRow | The existing `id` is a string like `sell-123`; row-level actions need the raw numeric ID for TX builders |
| Coin format utilities | Reuse existing `formatTokenAmount`/`formatPrice` from Currencies.tsx | The view already has these; no need to import `formatBaseUnits` from chain-shared for consistency |

## Implementation Phases

### Phase 1: Market Order Book Trading Actions

Add inline trading forms and row-level actions to the Market Order Book section of CurrencyDetail.

1. **Extend `MarketOrderRow` type** (line 96 of Currencies.tsx):
   - Add `numericId: number` field (the listingId for sell rows, orderId for buy rows)
   - Add `ssuId?: string` field (needed for sell listings context -- from `MarketSellListing.ssuId`)
   - Update the row builder at line 1012 to populate these fields from `sellListings` and `buyOrders`

2. **Create `CurrencyTrading.tsx`** (`apps/periscope/src/components/CurrencyTrading.tsx`) with these components:

   **Wallet/signing pattern**: Each panel component calls `useCurrentAccount()`, `useDAppKit()`, `useWallets()`, and `useSuiClient()` directly (same hooks used in `CurrencyDetail`). This avoids passing `signAndExecute` and `ensureWallet` as props and follows the same pattern as existing admin panels in Currencies.tsx. Each panel has its own `ensureWallet()` helper.

   a. `PostSellListingPanel` -- inline form:
      - Props: `marketId`, `coinType`, `packageId`, `decimals`, `symbol`, `onSuccess(msg: string)`, `onError(msg: string)`
      - SSU picker: `useLiveQuery(() => db.deployables.filter(...)` filtered to SSU assembly types, show dropdown with `${ssuName} (${systemName})` labels
      - Item autocomplete: `useLiveQuery(() => db.gameTypes.toArray())`, fuzzy search by name, show dropdown
      - Price per unit input (number, converted to bigint via `BigInt(Math.floor(Number(input) * 10 ** decimals))`)
      - Quantity input (integer)
      - Submit: `ensureWallet()` -> `buildPostSellListing({ packageId, marketId, coinType, ssuId, typeId, pricePerUnit, quantity, senderAddress })` -> `signAndExecute`

   b. `CreateBuyOrderPanel` -- inline form:
      - Props: `marketId`, `coinType`, `packageId`, `decimals`, `symbol`, `onSuccess(msg: string)`, `onError(msg: string)`
      - Item autocomplete (same pattern as sell)
      - Price per unit input
      - Quantity input
      - Balance display: use `queryOwnedCoins(suiClient, account.address, coinType)` in a `useEffect` to show current balance
      - Total escrow preview: `pricePerUnit * BigInt(quantity)`
      - Insufficient balance warning (red text when total > balance)
      - Submit: `ensureWallet()` -> `buildPostBuyOrder({ packageId, marketId, coinType, coinObjectIds, totalAmount, typeId, pricePerUnit, quantity, senderAddress })` -> `signAndExecute`

   c. `BuyFromListingPanel` -- compact inline form for row-level buy action:
      - Props: `listingId: number`, `maxQuantity: number`, `pricePerUnit: bigint`, `itemName: string`, `marketId`, `coinType`, `packageId`, `decimals`, `symbol`, `onSuccess(msg: string)`, `onError(msg: string)`, `onCancel()`
      - Quantity input (max = maxQuantity)
      - Total cost display: `pricePerUnit * BigInt(quantity)`, formatted with `formatTokenAmount`
      - Fetch owned coins for payment on mount
      - Submit: `ensureWallet()` -> `buildBuyFromListing({ packageId, marketId, coinType, listingId, quantity, coinObjectIds, senderAddress })` -> `signAndExecute`
      - Note: `buildBuyFromListing` passes all coin objects and the contract calculates payment. No `totalAmount` param needed.

   d. `FillBuyOrderPanel` -- compact inline form for row-level fill action:
      - Props: `orderId: number`, `typeId: number`, `maxQuantity: number`, `itemName: string`, `marketId`, `coinType`, `packageId`, `onSuccess(msg: string)`, `onError(msg: string)`, `onCancel()`
      - Quantity input (max = maxQuantity)
      - Submit: `ensureWallet()` -> `buildFillBuyOrder({ packageId, marketId, coinType, orderId, typeId, quantity, senderAddress })` -> `signAndExecute`

3. **Add Actions column to `orderColumns`** (currently defined at line 1045):
   - New column `id: "actions"`, size: 80, no header text, `enableColumnFilter: false`, `enableSorting: false`
   - The `orderColumns` `useMemo` dependency array (line 1154: `[coinDecimals, coinSymbol]`) must be expanded to include `suiAddress`, `walletAddress`, `isAuthorized`
   - Cell renderer checks `row.original.type` and `row.original.byAddress`:
     - Own sell listing (`byAddress === suiAddress || byAddress === walletAddress`): "Cancel" text button (red) -> calls handler with `buildCancelSellListing({ packageId: marketPkg, marketId: row.marketId, coinType: row.coinType, listingId: row.numericId, senderAddress })`
     - Other's sell listing + wallet connected: "Buy" text button (emerald) -> sets `buyTarget` state to show `BuyFromListingPanel`
     - Own buy order (`byAddress === suiAddress || byAddress === walletAddress`): "Cancel" text button (red) -> calls handler with `buildCancelBuyOrder`
     - Other's buy order + `isAuthorized`: "Fill" text button (amber) -> sets `fillTarget` state to show `FillBuyOrderPanel`
   - Note: `suiAddress` is the active character's address, `walletAddress` is the connected wallet's address. Both should be checked since Sui addresses from chain data may match either.

4. **Add state variables** to CurrencyDetail:
   - `showPostSell: boolean`, `showCreateBuyOrder: boolean` -- toggle buttons for header-level forms
   - `buyTarget: MarketOrderRow | null` -- which sell listing row the user wants to buy from
   - `fillTarget: MarketOrderRow | null` -- which buy order row the user wants to fill
   - `tradePending: boolean` -- loading state during TX execution

5. **Add trading toggle buttons** to the Market Order Book section header (line 2483, beside the existing Refresh button):
   - "Sell" toggle -> shows `PostSellListingPanel` below the DataGrid
   - "Buy Order" toggle -> shows `CreateBuyOrderPanel` below the DataGrid
   - Both use the `AdminToggle` component pattern already in the file

6. **Render `BuyFromListingPanel` / `FillBuyOrderPanel`** below the DataGrid when `buyTarget` / `fillTarget` is set. Include a dismiss button to clear the target.

7. **Cancel handlers** stay in Currencies.tsx (not extracted):
   - `handleCancelSellListing(listingId: number)`: `ensureWallet()` -> `buildCancelSellListing` -> `signAndExecute` -> `loadOrders()`
   - `handleCancelBuyOrder(orderId: number)`: `ensureWallet()` -> `buildCancelBuyOrder` -> `signAndExecute` -> `loadOrders()`
   - These are simple one-shot calls, no form UI needed. Use `onStatusChange` for feedback.

8. **Add new imports** to Currencies.tsx:
   - `buildCancelSellListing`, `buildCancelBuyOrder` from `@tehfrontier/chain-shared`
   - `PostSellListingPanel`, `CreateBuyOrderPanel`, `BuyFromListingPanel`, `FillBuyOrderPanel` from `@/components/CurrencyTrading`

### Phase 2: Exchange Pair Trading Actions

Add trading actions to the Exchange Pairs section of CurrencyDetail.

1. **Add `PlaceExchangeOrderPanel`** to `CurrencyTrading.tsx`:
   - Props: `bookObjectId`, `coinTypeA`, `coinTypeB`, `feeBps`, `decimalsA: number`, `decimalsB: number`, `symbolA: string`, `symbolB: string`, `onSuccess(msg: string)`, `onError(msg: string)`, `onCancel()`
   - Uses `useCurrentAccount()`, `useDAppKit()`, `useSuiClient()` for wallet access
   - Side toggle (Bid/Ask) -- Bid deposits coinTypeB, Ask deposits coinTypeA
   - Price input (denominated in coinTypeB, converted via `BigInt(Math.floor(Number(input) * 10 ** decimalsB))`)
   - Amount input (denominated in coinTypeA, converted similarly)
   - Fetch owned coins for the payment side via `queryOwnedCoins(suiClient, account.address, payCoinType)` where `payCoinType = side === "bid" ? coinTypeB : coinTypeA`
   - Display wallet balance for the deposit coin
   - Total deposit preview (bid: `price * amount / 10^decimalsA`; ask: `amount`) -- same formula as SSU dApp PlaceOrderDialog line 82
   - Insufficient balance warning
   - Submit: `ensureWallet()` -> `buildPlaceBid` or `buildPlaceAsk` -> `signAndExecute`
   - Reference: closely mirrors `apps/ssu-dapp/src/components/PlaceOrderDialog.tsx` (lines 27-310) but as an inline panel
   - Exchange package ID resolved via `getContractAddresses(tenant).exchange?.packageId` -- requires `tenant` prop or direct hook access

2. **Add `CreateExchangePairPanel`** to `CurrencyTrading.tsx`:
   - Props: `currentCoinType`, `currentSymbol`, `tenant: TenantId`, `onSuccess(msg: string)`, `onError(msg: string)`, `onCancel()`
   - CoinTypeA pre-filled with current currency's coinType (read-only display)
   - CoinTypeB text input (user enters full coin type like `0xpkg::module::SYMBOL`), or picks from `db.currencies` via autocomplete
   - Fee BPS input (number, default 0)
   - Exchange package ID resolved via `getContractAddresses(tenant).exchange?.packageId`
   - Submit: `ensureWallet()` -> `buildCreatePair({ packageId: exchangePkg, coinTypeA, coinTypeB, feeBps, senderAddress })` -> `signAndExecute`

3. **Add "Create Pair" toggle button** to Exchange Pairs section header (line 2500 of Currencies.tsx):
   - New state: `showCreatePair: boolean`
   - Renders `CreateExchangePairPanel` below the header when active
   - After success, trigger `discoverExchangePairs` re-sync

4. **Add "Place Order" button** inside each expanded pair's detail panel (line 2552):
   - New state: `placeOrderPairId: string | null` -- which pair has the order form open
   - Show `PlaceExchangeOrderPanel` below the DataGrid inside the expanded pair section
   - After success, call `loadExchangeOrders(pairId)`

5. **Extend `ExchangeOrderRow` type** (line 109):
   - Add `orderId: number` field (currently only has `id` string)
   - Add `bookObjectId: string`, `coinTypeA: string`, `coinTypeB: string` fields (needed for cancel handler)
   - Update row builder at line 2517 to populate all new fields from `OrderInfo` + the parent pair context

6. **Move `exchangeColumns` into the per-pair render loop** (resolves Open Question 3 with Option A):
   - Remove the top-level `exchangeColumns` useMemo at line 1158
   - Define columns inline inside the `currencyPairs.map()` at line 2506, where `pair.id`, `pair.coinTypeA`, `pair.coinTypeB` are in scope
   - Add new column `id: "actions"`, size: 70
   - Cell: if `owner === suiAddress || owner === walletAddress`, show "Cancel" button
   - Cancel calls `handleCancelExchangeOrder(pair.id, row.original.orderId, row.original.side === "Bid", pair.coinTypeA, pair.coinTypeB)`

7. **Cancel handler for exchange orders** stays in Currencies.tsx:
   - `handleCancelExchangeOrder(pairId: string, orderId: number, isBid: boolean, coinTypeA: string, coinTypeB: string)`: `ensureWallet()` -> `buildCancelBid` or `buildCancelAsk` -> `signAndExecute` -> `loadExchangeOrders(pairId)`
   - Uses `getContractAddresses(tenant).exchange?.packageId` for the exchange package ID

8. **Add new imports** to Currencies.tsx:
   - `buildCancelBid`, `buildCancelAsk` from `@tehfrontier/chain-shared`
   - `PlaceExchangeOrderPanel`, `CreateExchangePairPanel` from `@/components/CurrencyTrading`

### Phase 3: Polish and UX

1. Add loading spinners on action buttons while transactions are pending (use existing `isProcessing` pattern or local `isPending` state per action).

2. Add success/error feedback for each trading action -- use existing `onStatusChange` callback to update the top-level StatusBanner.

3. After successful trade actions, auto-refresh the relevant data:
   - After posting/cancelling sell listing or buy order: call `loadOrders()`
   - After buying from listing or filling buy order: call `loadOrders()` + `loadMarketInfo()` (supply may change)
   - After exchange order: call `loadExchangeOrders(pairId)`

4. Add confirmation prompts for destructive actions (cancel own listing/order) -- a simple "Are you sure?" inline message before executing.

5. Ensure all actions use the `ensureWallet()` pattern for auto-connecting the Eve Vault wallet before executing transactions.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/views/Currencies.tsx` | Modify | Extend `MarketOrderRow` and `ExchangeOrderRow` types with numeric IDs. Add Actions column to `orderColumns` and `exchangeColumns`. Add state for trade form targets. Add trading toggle buttons to order book and exchange headers. Import new trading components. |
| `apps/periscope/src/components/CurrencyTrading.tsx` | Create | New file with inline trading panel components: `PostSellListingPanel`, `CreateBuyOrderPanel`, `BuyFromListingPanel`, `FillBuyOrderPanel`, `PlaceExchangeOrderPanel`, `CreateExchangePairPanel`. Each uses chain-shared TX builders and the existing `ensureWallet` + `signAndExecute` pattern. |

## Open Questions

1. **SSU ID for sell listings**: The `buildPostSellListing` TX builder requires an `ssuId` parameter. In the SSU dApp context, this is the SSU the listing is posted from. In the Currencies view, we are not in an SSU context. How should the user specify the SSU?
   - **Option A: Free-text SSU ID input** -- User pastes or types an SSU object ID. Pros: Simple to implement, no dependencies. Cons: Bad UX, users don't memorize SSU IDs.
   - **Option B: SSU picker from local deployables DB** -- Query `db.deployables` for SSUs the user owns (or all known SSUs) and show a dropdown/autocomplete. Pros: Good UX, leverages existing data. Cons: Requires the user to have synced their deployables first; slightly more code.
   - **Option C: Skip market sell listings entirely, focus on exchange and buy orders first** -- Sell listings are SSU-specific by design (items come from SSU inventory). Users can use the SSU dApp for sell listings. Pros: Simpler scope, avoids the SSU context gap. Cons: Incomplete trading story.
   - **Recommendation:** Option B for sell listings and Option C as a fallback. Use `db.deployables` to build an SSU picker filtered to the user's owned SSUs. If no SSUs are available locally, show a message directing the user to sync their structures first. This provides usable UX while acknowledging the SSU dependency.

2. **Item type autocomplete for buy orders and sell listings**: The `typeId` parameter identifies the game item. The SSU dApp uses a `useGameItems` hook that fetches from the World API. Periscope has `db.gameTypes` in IndexedDB. Which approach?
   - **Option A: Use db.gameTypes from IndexedDB** -- Pros: Already available, no additional network calls, consistent with Periscope patterns. Cons: May be incomplete if the user hasn't synced game types.
   - **Option B: Fetch from World API on demand** -- Pros: Always up to date. Cons: Adds network dependency, different from existing Periscope patterns.
   - **Recommendation:** Option A. Use `db.gameTypes` with a search/autocomplete similar to how `loadOrders` already resolves item names via `db.gameTypes.bulkGet()`. Fall back to manual typeId input if the database is empty.

3. **Exchange column actions need pair context**: The `exchangeColumns` definition at line 1158 is a static `useMemo` with no dependencies except `[]`. To show cancel buttons that know the `bookObjectId` and `coinTypeA`/`coinTypeB`, we need to either: (a) pass these values through column meta, (b) move the column definition inside the per-pair render loop, or (c) use a callback ref from the parent. How to handle this?
   - **Option A: Move exchangeColumns into the per-pair render function** -- Pros: Each pair's columns naturally have access to its book ID and coin types. Cons: Columns are re-created on every render of every pair.
   - **Option B: Use column meta / cell context** -- Pass `bookObjectId`, `coinTypeA`, `coinTypeB` via TanStack Table's column meta. Pros: Columns stay memoized. Cons: Requires accessing meta in cell renderers, slightly more complex.
   - **Option C: Use a callback map** -- Store a `Map<string, { bookObjectId, coinTypeA, coinTypeB }>` and look up from row.original.id prefix. Pros: Simple. Cons: Fragile string parsing.
   - **Recommendation:** Option A. The exchange order tables are small (typically <50 rows) and rendered one at a time inside an expanded pair. Recreating columns per-pair is negligible and keeps the code straightforward. The columns are already inside a `.map()` loop for each pair (line 2506).

## Deferred

- **Market standings trading**: The `market-standings` module has standings-gated versions of all TX builders (requiring `registryId`, `tribeId`, `charId`). Supporting standings-based markets adds complexity. Defer until regular market trading is working.
- **Cross-market listings view**: `queryAllListingsForCurrency` aggregates listings across all markets for a currency. Could be a useful "global order book" view. Defer as a future enhancement.
- **Edit/update existing listings**: `buildUpdateSellListing` allows updating price and quantity. Lower priority than the core create/cancel/buy flows.
- **Real-time order book updates**: Currently requires manual refresh. Could add polling or event subscription later.
