# Plan: Currency Trading UI in Periscope

**Status:** Draft
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
| File organization | All changes in Currencies.tsx | The file is already large (~2700 lines) but contains all the detail panel logic; adding trading dialogs keeps related code together. If the file gets unwieldy, a future refactor can extract sub-components. |

## Implementation Phases

### Phase 1: Market Order Book Trading Actions

Add inline trading forms and row-level actions to the Market Order Book section of CurrencyDetail.

1. Add "Post Sell Listing" toggle button to order book header actions (beside Refresh), with inline form panel containing:
   - SSU ID field (text input, required by the `buildPostSellListing` TX builder)
   - Item type ID field (number input, or autocomplete from db.gameTypes)
   - Price per unit field (number input)
   - Quantity field (number input)
   - Submit button calling `buildPostSellListing` -> `signAndExecute`

2. Add "Create Buy Order" toggle button to order book header actions, with inline form panel containing:
   - Item type ID field (number input, or autocomplete from db.gameTypes)
   - Price per unit field (number input)
   - Quantity field (number input)
   - Wallet balance display for the currency
   - Total escrow preview
   - Submit button calling `buildPostBuyOrder` -> `signAndExecute`

3. Add an "Actions" column to the `orderColumns` definition in CurrencyDetail:
   - For sell listings where `byAddress === suiAddress`: show "Cancel" button -> `buildCancelSellListing`
   - For sell listings where `byAddress !== suiAddress` and wallet connected: show "Buy" button -> open inline buy form (quantity input, total cost preview, submit via `buildBuyFromListing`)
   - For buy orders where `byAddress === suiAddress`: show "Cancel" button -> `buildCancelBuyOrder`
   - For buy orders where `byAddress !== suiAddress` and `isAuthorized`: show "Fill" button -> open inline fill form (quantity input, submit via `buildFillBuyOrder`)

4. Add state variables for the new trading forms:
   - `showPostSell` / `showCreateBuyOrder` toggles
   - Form field state for each
   - `buyTarget` / `fillTarget` state for row-level actions (track which listing/order is being acted on)

5. Fetch owned coins when needed for buy/fill actions using existing `queryOwnedCoins`.

### Phase 2: Exchange Pair Trading Actions

Add trading actions to the Exchange Pairs section of CurrencyDetail.

1. Add "Create Pair" button to the Exchange Pairs section header:
   - Inline form with coinTypeA (pre-filled with current currency's coinType), coinTypeB (text input), feeBps (number input)
   - Submit via `buildCreatePair` -> `signAndExecute`

2. Add "Place Order" button inside each expanded pair's detail area (beside the DataGrid):
   - Side toggle: Bid / Ask
   - Price input (in coinTypeB units)
   - Amount input (in coinTypeA units)
   - Wallet balance display for the payment coin type
   - Total deposit preview
   - Submit via `buildPlaceBid` or `buildPlaceAsk` -> `signAndExecute`

3. Add an "Actions" column to the `exchangeColumns` definition:
   - For orders where `owner === suiAddress` (or walletAddress): show "Cancel" button
   - Cancel calls `buildCancelBid` or `buildCancelAsk` based on the order's side

4. After placing/cancelling exchange orders, refetch the pair's orders via `loadExchangeOrders(pairId)`.

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
| `apps/periscope/src/views/Currencies.tsx` | Modify | Add trading forms, row actions, and state to CurrencyDetail. Add Actions column to orderColumns and exchangeColumns. Add inline panels for PostSellListing, CreateBuyOrder, PlaceExchangeOrder, CreatePair. Add row-level Buy/Cancel/Fill buttons. |

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

3. **File size concern**: `Currencies.tsx` is already ~2700 lines. Adding 6+ trading forms will push it further. Should we extract sub-components?
   - **Option A: Keep everything in Currencies.tsx** -- Pros: All related code together, no import graph changes. Cons: Very large file.
   - **Option B: Extract trading panels into separate files** -- E.g., `CurrencyTradePanel.tsx`, `ExchangeTradePanel.tsx`. Pros: Better separation of concerns, smaller files. Cons: More files, need to pass many props.
   - **Option C: Extract after initial implementation** -- Implement in Currencies.tsx first, then extract if the file becomes unwieldy. Pros: Faster initial implementation. Cons: Deferred cleanup.
   - **Recommendation:** Option B. Extract the new trading components into `apps/periscope/src/components/CurrencyTrading.tsx` (for market order book trading actions) and add exchange trading inline. This keeps the main Currencies.tsx from growing excessively while keeping related trading logic together.

## Deferred

- **Market standings trading**: The `market-standings` module has standings-gated versions of all TX builders (requiring `registryId`, `tribeId`, `charId`). Supporting standings-based markets adds complexity. Defer until regular market trading is working.
- **Cross-market listings view**: `queryAllListingsForCurrency` aggregates listings across all markets for a currency. Could be a useful "global order book" view. Defer as a future enhancement.
- **Edit/update existing listings**: `buildUpdateSellListing` allows updating price and quantity. Lower priority than the core create/cancel/buy flows.
- **Real-time order book updates**: Currently requires manual refresh. Could add polling or event subscription later.
