# Plan: SSU Escrow Transfer Fixes

**Status:** Active
**Created:** 2026-03-28
**Module:** chain-shared, ssu-dapp, contracts/ssu_unified

## Overview

Buying and selling items on SSU markets is fundamentally broken: items never move. The market contract (`market.move`) is a pure payment/order-book system -- it tracks sell listings and buy orders with coin escrow, but has zero knowledge of item inventories. When a seller posts a listing, items stay in the SSU owner inventory with no reservation. When a buyer pays for items, they receive nothing. When a buy order is filled, payment goes to the seller but no items are delivered.

The `ssu_unified.move` contract has the correct inventory manipulation functions (`admin_to_escrow`, `admin_from_escrow`, `admin_to_player`, `admin_escrow_to_player`, etc.) that use the world package's `storage_unit` API to move items between inventories. However, these are never composed with market operations, and the admin-only authorization prevents buyers from triggering item delivery.

The fix adds composite Move entry points to `ssu_unified` that atomically combine market operations with inventory transfers in a single function call. This guarantees that items always move when payment happens. The contract gains a `market` dependency so it can call `market::buy_from_listing` etc. internally. For buy operations specifically, the composite function provides authorization through the market call itself -- if payment succeeds, items are delivered.

A secondary fix is required: `SsuUnifiedConfig` objects are currently address-owned, meaning only the owner can reference them in transactions. Since buyer-side operations need to reference the config, it must be changed to a shared object.

## Current State

### Market contract (`contracts/market/sources/market.move`)

The market contract manages an order book with sell listings and buy orders stored as dynamic fields on a `Market<T>` shared object:

- `post_sell_listing` (line 300-338): Records listing metadata (seller, ssuId, typeId, price, quantity) as a dynamic field. **Does not withdraw or escrow items.**
- `buy_from_listing` (line 512-553): Decrements listing quantity, splits payment coin, applies fees, transfers proceeds to seller. **Does not transfer items to buyer.** Returns change coin only.
- `cancel_sell_listing` (line 366-381): Removes listing dynamic field. **Does not return any items.**
- `fill_buy_order` (line 455-509): Decrements buy order quantity, splits escrowed coin, pays seller. **Does not deliver items to buyer.**
- `post_buy_order` (line 386-428): Records order + escrows `Coin<T>`. No item handling.
- `cancel_buy_order` (line 431-451): Returns escrowed coin to buyer. No item handling.

The contract exposes public accessors: `borrow_sell_listing`, `listing_type_id`, `listing_quantity`, `borrow_buy_order`, `order_buyer`, etc. These enable other contracts to read order book state.

### SSU Unified contract (`contracts/ssu_unified/sources/ssu_unified.move`)

Has inventory management functions using `SsuUnifiedAuth` witness for world-package extension authorization:

- `admin_to_escrow` (line 267-282): withdraw_item + deposit_to_open_inventory. **Admin only.**
- `admin_from_escrow` (line 285-300): withdraw_from_open_inventory + deposit_item. **Admin only.**
- `admin_to_player` (line 303-319): withdraw_item + deposit_to_owned (recipient). **Admin only.**
- `admin_escrow_to_player` (line 340-356): withdraw_from_open_inventory + deposit_to_owned (recipient). **Admin only.**
- `admin_escrow_to_self` (line 322-337): withdraw_from_open_inventory + deposit_to_owned (sender).
- `player_to_escrow` (line 367-377): deposit_to_open_inventory. **No auth check.**
- `player_to_owner` (line 380-390): deposit_item. **No auth check.**

Depends on `world` only (Move.toml line 6). No `market` dependency.

**Config ownership issue:** `SsuUnifiedConfig` is created with `transfer::transfer(config, ctx.sender())` (lines 116, 151) making it an **address-owned object**. On Sui, only the owner can reference an owned object in a transaction -- even as an immutable `&` reference. This means non-owner players cannot call `player_to_escrow`, `player_to_owner`, or any function taking `&SsuUnifiedConfig`. The composite buy function (`buy_and_receive`) would have the same problem -- the buyer can't reference the config.

### TX builders (`packages/chain-shared/src/ssu-unified.ts`)

- `buildEscrowAndListWithStandings` (line 218-241): Calls `market_standings::post_sell_listing` only. Despite the "escrow" name, **no escrow happens**.
- `buildBuyFromListingWithStandings` (line 258-296): Calls `market_standings::buy_from_listing` only. **No item delivery.**
- `buildCancelListingWithStandings` (line 310-323): Calls `market_standings::cancel_sell_listing` only. **No unescrow.**
- `buildFillBuyOrderWithStandings` (line 344-367): Calls `market_standings::fill_buy_order` only. **No item transfer.**

### TX builders (`packages/chain-shared/src/market.ts`)

- `buildPostSellListing` (line 326-344): Calls `market::post_sell_listing` only.
- `buildBuyFromListing` (line 180-213): Calls `market::buy_from_listing` only.
- `buildCancelSellListing` (line 384-395): Calls `market::cancel_sell_listing` only.
- `buildFillBuyOrder` (line 151-167): Calls `market::fill_buy_order` only.

### UI components (`apps/ssu-dapp/src/components/`)

- `SellDialog.tsx`: Calls `buildEscrowAndListWithStandings` or `buildPostSellListing` -- payment side only.
- `BuyFromListingDialog.tsx`: Calls `buildBuyFromListingWithStandings` or `buildBuyFromListing` -- payment side only.
- `FillBuyOrderDialog.tsx`: Calls `buildFillBuyOrderWithStandings` or `buildFillBuyOrder` -- payment side only.
- `CancelListingDialog.tsx`: Calls `buildCancelListingWithStandings` or `buildCancelSellListing` -- no inventory changes.

### Reference implementation: `TransferDialog.tsx`

The `TransferDialog.tsx` (line 67-244) correctly demonstrates inventory transfer PTB patterns:
- `buildOwnerCapTransferPtb`: borrow_owner_cap -> withdraw_by_owner -> deposit_by_owner -> return_owner_cap
- `buildAdminMarketPtb`: calls `ssu_unified::admin_to_escrow` / `admin_from_escrow` / etc.
- `buildPlayerMarketPtb`: borrow_owner_cap -> withdraw_by_owner -> return_owner_cap -> `ssu_unified::player_to_escrow`

### Parameter availability

The dapp components already have most data needed:
- `SsuConfigResult` from `useSsuConfig.ts`: has `ssuConfigId`, `packageId`, `marketStandingsPackageId`, `marketId`, `registryId`, `owner`, `delegates`
- `TransferContext` from `SsuView.tsx`: has `ssuConfigId`, `marketPackageId`, `characterObjectId`, `ssuObjectId`, `isAuthorized`, `slotCaps`
- Missing: buyer-side dialogs need the buyer's Character object ID, and the `TransferContext` data isn't threaded through to market dialogs.

### Summary of bugs

| Operation | Payment | Item Transfer | Bug |
|-----------|---------|---------------|-----|
| Create sell listing | N/A | No escrow | Items remain in owner inventory, not reserved |
| Buy from listing | Buyer pays seller | No transfer | Buyer receives nothing |
| Cancel listing | N/A | No unescrow | Items were never escrowed |
| Fill buy order | Escrowed coin to seller | No delivery | Buyer paid but gets no items |

## Target State

All four market trade operations atomically compose payment handling with inventory transfer. The `ssu_unified` Move contract gains composite entry points that call both `market` functions and `storage_unit` inventory functions in one Move function call, guaranteeing atomicity.

### Trade flow after fix

**Sell (escrow + list):**
1. Admin calls `ssu_unified::escrow_and_list<T>`
2. Items move: owner inventory -> escrow (open) inventory
3. Listing created on Market<T>
4. Single atomic TX -- items are always escrowed when listing is created

**Buy (pay + receive):**
1. Buyer calls `ssu_unified::buy_and_receive<T>`
2. Payment: buyer coin -> seller (with fees)
3. Items move: escrow -> buyer's owned inventory
4. Change coin returned to buyer
5. Single atomic TX -- buyer always receives items when they pay

**Cancel (delist + unescrow):**
1. Admin calls `ssu_unified::cancel_and_unescrow<T>`
2. Listing removed from Market<T>
3. Items move: escrow -> owner inventory
4. Single atomic TX -- items always return when listing is cancelled

**Fill buy order (deliver + get paid):**
1. Admin calls `ssu_unified::fill_and_deliver<T>`
2. Payment: escrowed coin split -> seller
3. Items move: owner inventory -> buyer's owned inventory
4. Single atomic TX -- items always delivered when order is filled

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Composition approach | Composite Move entry points in ssu_unified | PTB composition works for admin operations but NOT for buy -- the buyer isn't the admin, so they can't call admin inventory functions in a separate PTB step. A composite Move function for buy provides authorization through the market call itself: the buyer pays via `market::buy_from_listing` inside the function, and items are delivered atomically. Making all 4 operations composite is consistent, prevents race conditions (reading listing quantity then acting on it), and simplifies TX builders. |
| Market dependency | ssu_unified depends on market package directly | The composite functions call market functions (post_sell_listing, buy_from_listing, etc.). Direct dependency is cleanest. The market package is stable. |
| market_standings bypass | Composite functions call market directly, not market_standings | Adding market_standings dependency would increase contract complexity. The composite functions call `market::market::` functions directly. Standings enforcement for buy operations is deferred. Sell operations still work because `market::post_sell_listing` checks `is_authorized(market, sender)`. |
| Config ownership | Change SsuUnifiedConfig from owned to shared | Non-owner players cannot reference owned objects on Sui, even as `&` immutable references. The buyer calling `buy_and_receive` needs `&SsuUnifiedConfig`. Shared objects are reference-able by anyone while still protected by `assert_authorized` for admin mutations. Standard Sui pattern. Gas overhead negligible for small config objects. |
| Quantity casting | Accept u64 from market, cast to u32 for storage_unit | Market uses u64 quantities, storage_unit uses u32. Cast with bounds check. Practical item quantities never approach u32 max (4 billion). |
| buy_and_receive authorization | No admin check -- payment IS the authorization | The function calls `market::buy_from_listing` internally, which handles payment. If buyer doesn't pay enough, the market call aborts and no items move. The `type_id` is read from the listing (not caller input), preventing item type mismatch attacks. This is fundamentally more secure than an unrestricted `public_escrow_to_self` function that any player could call to drain escrow without paying. |
| Cancel seller constraint | Only the listing creator can cancel | `market::cancel_sell_listing` asserts `listing.seller == ctx.sender()`. Since `escrow_and_list` sets the seller to the calling admin/delegate address, only that same address can later call `cancel_and_unescrow`. A different delegate cannot cancel another delegate's listing. Acceptable for hackathon scope. |
| Backwards compatibility | None needed | Prototyping phase, no users. Existing owned configs will need to be recreated as shared. |
| Standings enforcement | Bypass for hackathon (Option A) | Composite functions call `market::market::` directly, skipping `market_standings` standings checks. Sell side already enforces via `market::is_authorized`. Buy-side standings enforcement is nice-to-have, deferred. |
| Buyer character resolution | Off-chain resolution (Option A) | Seller's client resolves buyer's character object ID from the buy order's `buyer` address before building the TX. The address is available from the BuyOrder query; the dapp resolves via manifest/character cache or on-chain query. On-chain resolution not feasible without a registry. |
| Escrow quantity tracking | Shared pool (Option A) | The escrow (open inventory) is a shared pool per type_id, not tracked per-listing. The composite `escrow_and_list` guarantees items are escrowed at listing time, keeping the pool balanced. Per-listing tracking adds significant complexity with no practical benefit. |

## Implementation Phases

### Phase 1: Update ssu_unified Move Contract

1. In `contracts/ssu_unified/Move.toml`, add `market` dependency:
   ```toml
   [dependencies]
   world = { git = "https://github.com/evefrontier/world-contracts.git", subdir = "contracts/world", rev = "v0.0.21" }
   market = { local = "../market" }
   ```

2. In `contracts/ssu_unified/sources/ssu_unified.move`, add imports and error constant:
   ```move
   use sui::coin::Coin;
   use sui::clock::Clock;

   const EQuantityOverflow: u64 = 4;
   ```

3. Update the `SsuUnifiedConfig` struct doc comment (line 15): change "Per-user owned SSU config" to "Shared SSU config" since it will now be a shared object.

4. Change `create_config` (line 116): replace `transfer::transfer(config, ctx.sender())` with `transfer::share_object(config)`.

5. Change `create_config_with_market` (line 151): same -- `transfer::share_object(config)`.

6. Add composite trade functions after the existing player functions (~line 391):

   **`escrow_and_list<T>`** -- admin atomically escrows items + creates listing:
   - Takes: `config: &SsuUnifiedConfig`, `market: &mut market::market::Market<T>`, `storage_unit: &mut StorageUnit`, `character: &Character`, `type_id: u64`, `price_per_unit: u64`, `quantity: u64`, `clock: &Clock`, `ctx: &mut TxContext`
   - Calls `assert_authorized(config, ctx)`
   - Asserts `quantity <= 0xFFFFFFFF` (EQuantityOverflow)
   - Reads `ssu_id` from `config.ssu_id` (prevents mismatched SSU IDs)
   - Withdraws items from owner inventory: `storage_unit::withdraw_item` + `storage_unit::deposit_to_open_inventory`
   - Creates listing: `market::market::post_sell_listing(market, config.ssu_id, type_id, price_per_unit, quantity, clock, ctx)`

   **`buy_and_receive<T>`** -- buyer atomically pays + receives items:
   - Takes: `_config: &SsuUnifiedConfig`, `market: &mut market::market::Market<T>`, `storage_unit: &mut StorageUnit`, `character: &Character` (SSU owner's), `recipient: &Character` (buyer's), `listing_id: u64`, `quantity: u64`, `payment: Coin<T>`, `clock: &Clock`, `ctx: &mut TxContext`
   - Returns: `Coin<T>` (change)
   - No admin check -- authorization comes from successful market purchase
   - Reads `type_id` from listing in a scope block so the immutable borrow drops before the mutable call: `let type_id = { let listing = market::market::borrow_sell_listing(market, listing_id); market::market::listing_type_id(listing) };` (u64 is copied out; the `&SellListing` ref dies at the closing brace)
   - Asserts `quantity <= 0xFFFFFFFF`
   - Executes purchase: `market::market::buy_from_listing(market, listing_id, quantity, payment, clock, ctx)` -> returns change
   - Transfers items: `storage_unit::withdraw_from_open_inventory` (type_id from listing, quantity as u32) + `storage_unit::deposit_to_owned` (to recipient)
   - Returns change coin

   **`cancel_and_unescrow<T>`** -- admin atomically cancels listing + returns items from escrow:
   - Takes: `config: &SsuUnifiedConfig`, `market: &mut market::market::Market<T>`, `storage_unit: &mut StorageUnit`, `character: &Character`, `listing_id: u64`, `ctx: &mut TxContext`
   - Calls `assert_authorized(config, ctx)`
   - Reads listing via immutable borrow in a scope block so the ref drops before the mutable cancel call: `let (type_id, quantity) = { let listing = market::market::borrow_sell_listing(market, listing_id); (market::market::listing_type_id(listing), market::market::listing_quantity(listing)) };` (u64 values are copied out; the `&SellListing` ref dies at the closing brace)
   - Asserts `quantity <= 0xFFFFFFFF`
   - Cancels listing: `market::market::cancel_sell_listing(market, listing_id, ctx)`
   - Returns items: `storage_unit::withdraw_from_open_inventory` + `storage_unit::deposit_item`

   **`fill_and_deliver<T>`** -- admin atomically fills buy order + delivers items to buyer:
   - Takes: `config: &SsuUnifiedConfig`, `market: &mut market::market::Market<T>`, `storage_unit: &mut StorageUnit`, `character: &Character` (SSU owner's), `buyer_character: &Character`, `order_id: u64`, `type_id: u64`, `quantity: u64`, `ctx: &mut TxContext`
   - Calls `assert_authorized(config, ctx)`
   - Asserts `quantity <= 0xFFFFFFFF`
   - Fills order: `market::market::fill_buy_order(market, order_id, type_id, quantity, ctx)` -- pays seller from escrow
   - Delivers items: `storage_unit::withdraw_item` + `storage_unit::deposit_to_owned` (to buyer_character)
   - Note: `type_id` passed by caller because buy orders don't store ssu_id. Verified by `fill_buy_order`'s internal type_id check.

7. Build: `sui move build` from `contracts/ssu_unified/`.
8. Publish: `sui client publish --gas-budget 500000000`.
9. Record new package ID.

### Phase 2: Update chain-shared Config & TX Builders

1. In `packages/chain-shared/src/config.ts`, update `ssuUnified.packageId` for both tenants with the new published package ID. Move current IDs to `previousOriginalPackageIds`.

2. In `packages/chain-shared/src/ssu-unified.ts`, rewrite the 4 trade TX builders to call the new composite functions:

   **`buildEscrowAndList`** (replaces `buildEscrowAndListWithStandings`):
   - Params: `ssuUnifiedPackageId`, `ssuConfigId`, `ssuObjectId` (storage unit), `characterObjectId`, `coinType`, `marketId`, `typeId`, `pricePerUnit`, `quantity`, `senderAddress`
   - Single moveCall: `ssu_unified::escrow_and_list<coinType>` with args: config, market, storage_unit, character, type_id, price_per_unit, quantity, clock
   - Note: `ssu_id` is read from config on-chain, not passed as parameter

   **`buildBuyAndReceive`** (replaces `buildBuyFromListingWithStandings`):
   - Params: `ssuUnifiedPackageId`, `ssuConfigId`, `ssuObjectId`, `ownerCharacterObjectId`, `buyerCharacterObjectId`, `coinType`, `marketId`, `listingId`, `quantity`, `coinObjectIds`, `senderAddress`
   - Merge coins (existing pattern), then moveCall: `ssu_unified::buy_and_receive<coinType>` with args: config, market, storage_unit, owner_character, buyer_character, listing_id, quantity, payment_coin, clock
   - Transfer returned change coin to sender

   **`buildCancelAndUnescrow`** (replaces `buildCancelListingWithStandings`):
   - Params: `ssuUnifiedPackageId`, `ssuConfigId`, `ssuObjectId`, `characterObjectId`, `coinType`, `marketId`, `listingId`, `senderAddress`
   - Single moveCall: `ssu_unified::cancel_and_unescrow<coinType>` with args: config, market, storage_unit, character, listing_id

   **`buildFillAndDeliver`** (replaces `buildFillBuyOrderWithStandings`):
   - Params: `ssuUnifiedPackageId`, `ssuConfigId`, `ssuObjectId`, `characterObjectId`, `buyerCharacterObjectId`, `coinType`, `marketId`, `orderId`, `typeId`, `quantity`, `senderAddress`
   - Single moveCall: `ssu_unified::fill_and_deliver<coinType>` with args: config, market, storage_unit, character, buyer_character, order_id, type_id, quantity

3. Keep old function names as deprecated aliases or remove them (no backwards compat needed).

### Phase 3: Thread Missing Data to Market Dialogs

**Note:** This phase and Phase 5 are logically interleaved -- Phase 5 step 1 extends `useOwnerCharacter` to return the owner character object ID, and this phase threads it to dialogs. Implement them together.

Some data is already available in dialog components and some is not:
- `ssuConfig` (with `ssuConfigId`, `packageId` a.k.a. ssuUnifiedPackageId) -- already threaded to all dialogs (`SellDialog` via `ContentTabs`; the rest via `MarketOrdersGrid`)
- `ssuObjectId` -- threaded to `SellDialog` (via ContentTabs) and `FillBuyOrderDialog` (via MarketOrdersGrid), but NOT to `BuyFromListingDialog` or `CancelListingDialog`
- SSU owner's character object ID -- not available in any dialog; resolved in Phase 5, threaded here
- Buyer's character object ID -- not available in any dialog; resolved per-dialog in Phase 4/5

1. In `apps/ssu-dapp/src/components/MarketOrdersGrid.tsx`: Pass `ssuObjectId` to `BuyFromListingDialog` and `CancelListingDialog` (it's already a prop on MarketOrdersGrid but not forwarded to these two dialogs).

2. In `apps/ssu-dapp/src/components/BuyFromListingDialog.tsx` and `CancelListingDialog.tsx`: Accept new `ssuObjectId` prop.

3. Thread the SSU owner's character object ID from `SsuView.tsx` (after Phase 5 step 1 extends `useOwnerCharacter`) through `ContentTabs` as a new `ownerCharacterObjectId` prop. From `ContentTabs`, forward it two ways:
   - To `SellDialog` directly (SellDialog is rendered by ContentTabs, not by MarketOrdersGrid)
   - To `MarketContent` -> `MarketOrdersGrid` -> `BuyFromListingDialog`, `CancelListingDialog`, `FillBuyOrderDialog`

### Phase 4: Update Dialog Components

Note: `ssuConfig.packageId` IS the ssuUnified package ID and `ssuConfig.ssuConfigId` is the config object ID -- both already available in every dialog via the existing `ssuConfig` prop. No separate `ssuUnifiedPackageId` or `ssuConfigId` prop needed.

1. **SellDialog.tsx** -- update `handleSell`:
   - Import `buildEscrowAndList`
   - Replace `buildEscrowAndListWithStandings` / `buildPostSellListing` calls
   - Use `ssuConfig.packageId` as ssuUnifiedPackageId, `ssuConfig.ssuConfigId`, `ssuObjectId` (already a prop), `ownerCharacterObjectId` (new prop from Phase 3/5)

2. **BuyFromListingDialog.tsx** -- update `handleBuy`:
   - Import `buildBuyAndReceive`
   - Replace `buildBuyFromListingWithStandings` / `buildBuyFromListing` calls
   - Use `ssuConfig.packageId`, `ssuConfig.ssuConfigId`, `ssuObjectId` (new prop from Phase 3), `ownerCharacterObjectId` (new prop from Phase 3/5), `buyerCharacterObjectId` (connected wallet's character, resolved via `useCharacter`)
   - The buyer's character object ID is resolved from the connected wallet address using the existing `useCharacter` hook

3. **CancelListingDialog.tsx** -- update handler:
   - Import `buildCancelAndUnescrow`
   - Replace `buildCancelListingWithStandings` / `buildCancelSellListing` calls
   - Use `ssuConfig.packageId`, `ssuConfig.ssuConfigId`, `ssuObjectId` (new prop from Phase 3), `ownerCharacterObjectId` (new prop from Phase 3/5)

4. **FillBuyOrderDialog.tsx** -- update `handleFill`:
   - Import `buildFillAndDeliver`
   - Replace `buildFillBuyOrderWithStandings` / `buildFillBuyOrder` calls
   - Use `ssuConfig.packageId`, `ssuConfig.ssuConfigId`, `ssuObjectId` (already a prop), `ownerCharacterObjectId` (new prop from Phase 3/5), `buyerCharacterObjectId` (resolved from `order.buyer` address)
   - The buyer's character object ID must be resolved from the buy order's `buyer` address

5. **ListingCard.tsx**, **ListingAdminList.tsx**, **ListingBuyerList.tsx**: These components are dead code -- not imported anywhere in the app (ListingBuyerList imports ListingCard internally, but no file outside this group imports any of the three). The active market UI goes through `MarketOrdersGrid` -> individual dialog components. Remove all three files to avoid stale TX builder references.

### Phase 5: Character Object Resolution

The composite functions need Character object references for both the SSU owner and the buyer/seller counterpart. Two distinct resolution paths:

**SSU owner's Character object ID** (needed by `buy_and_receive`, `escrow_and_list`, `cancel_and_unescrow`, `fill_and_deliver`):
- Already resolvable: `useOwnerCharacter(assembly.ownerCapId)` in `SsuView.tsx` internally resolves the Character object ID from the OwnerCap's owner but only returns the name.
- Fix: Extend `useOwnerCharacter` to return both the name and the character object ID. Thread the owner character object ID into the transfer context or directly to the market dialogs.

**Counterpart's Character object ID** (needed by `buy_and_receive` for buyer, `fill_and_deliver` for buy-order buyer):

1. Extend `useOwnerCharacter` hook in `apps/ssu-dapp/src/hooks/useOwnerCharacter.ts` to also return `characterObjectId: string | null`.

2. The existing `useCharacter(walletAddress)` hook already resolves a wallet address to a `CharacterInfo` with `characterObjectId`. No new hook is needed.
   - For the connected wallet's character: already available via `useCharacter(walletAddress)` in `SsuView.tsx`
   - For a buy order's buyer address: call `useCharacter(order.buyer)` inside `FillBuyOrderDialog`
   - Note: `useCharacter` uses the PlayerProfile lookup pattern, which works for any wallet address

3. Thread the SSU owner's character object ID from `SsuView.tsx` through to `ContentTabs` -> `MarketContent` -> `MarketOrdersGrid` -> dialog components.

4. Update `BuyFromListingDialog`: buyer's character = connected wallet's character (from `useCharacter`); SSU owner's character = threaded from SsuView.

5. Update `FillBuyOrderDialog`: the buyer's character object ID must be resolved from `order.buyer` address using `useCharacter(order.buyer)` inside the dialog.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/ssu_unified/Move.toml` | Edit | Add `market` dependency |
| `contracts/ssu_unified/sources/ssu_unified.move` | Edit | Change config to shared objects; add 4 composite trade functions |
| `packages/chain-shared/src/config.ts` | Edit | Update ssuUnified package IDs for both tenants after republish |
| `packages/chain-shared/src/ssu-unified.ts` | Edit | Rewrite 4 trade TX builders to call ssu_unified composite functions |
| `apps/ssu-dapp/src/components/ContentTabs.tsx` | Edit | Thread SSU owner character object ID to MarketContent and SellDialog |
| `apps/ssu-dapp/src/components/MarketContent.tsx` | Edit | Accept and forward SSU owner character object ID to MarketOrdersGrid |
| `apps/ssu-dapp/src/components/MarketOrdersGrid.tsx` | Edit | Forward ssuObjectId + owner character ID to all market dialogs |
| `apps/ssu-dapp/src/components/SellDialog.tsx` | Edit | Use buildEscrowAndList composite builder |
| `apps/ssu-dapp/src/components/BuyFromListingDialog.tsx` | Edit | Use buildBuyAndReceive composite builder |
| `apps/ssu-dapp/src/components/CancelListingDialog.tsx` | Edit | Use buildCancelAndUnescrow composite builder |
| `apps/ssu-dapp/src/components/FillBuyOrderDialog.tsx` | Edit | Use buildFillAndDeliver composite builder |
| `apps/ssu-dapp/src/components/ListingAdminList.tsx` | Delete | Dead code -- not imported anywhere |
| `apps/ssu-dapp/src/components/ListingBuyerList.tsx` | Delete | Dead code -- not imported anywhere |
| `apps/ssu-dapp/src/components/ListingCard.tsx` | Delete | Dead code -- not imported anywhere |
| `apps/ssu-dapp/src/hooks/useOwnerCharacter.ts` | Edit | Return characterObjectId alongside name |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Edit | Thread SSU owner character object ID to market dialogs |

## Open Questions

None -- all resolved. See Design Decisions table.
## Deferred

- **Standings enforcement for composite buy** -- The composite `buy_and_receive` bypasses `market_standings`. Can be added by depending on `market_standings` or reimplementing the standings check.
- **Edit listing quantity adjustment** -- When updating a listing's quantity via `update_sell_listing`, the escrowed amount should be adjusted. Requires a new composite `update_and_adjust_escrow` function.
- **Non-standings market variants** -- The `market.ts` TX builders (`buildPostSellListing`, `buildBuyFromListing`, etc.) should also be updated or deprecated in favor of the unified composite versions.
- **On-chain escrow enforcement** -- Verifying on-chain that total escrow >= total listed quantity. Currently relies on correct client-side TX builder usage.
- **Automated buyer notification** -- UI to show "items in escrow -- claim available" for completed purchases.
