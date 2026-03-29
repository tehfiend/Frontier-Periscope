# Plan: SSU Escrow Transfer Fixes

**Status:** Pending
**Created:** 2026-03-28
**Module:** chain-shared, ssu-dapp

## Overview

Selling and buying items on SSU markets does not properly move items to and from escrow. The root cause is architectural: the market contracts (`market.move` and the separate `market_standings` module) operate purely as order books -- they track sell listings and buy orders with coin escrow, but have no integration with the game's inventory system. When a seller posts a listing, items stay in the SSU inventory with no lock or transfer. When a buyer purchases items, coins move to the seller but no items move to the buyer. The same gap exists for filling buy orders.

The `ssu_unified.move` contract has the correct inventory manipulation functions (`admin_to_escrow`, `admin_from_escrow`, `admin_to_player`, `admin_escrow_to_player`, etc.) that use the world package's `storage_unit` API to move items between inventories. However, these inventory operations are never composed with the market operations in a single transaction. The sell/buy/fill TX builders in `ssu-unified.ts` and `market-standings.ts` only call market functions -- they never include inventory withdrawal or deposit steps.

This plan adds multi-step PTB (Programmable Transaction Block) composition so that sell listings escrow items on creation, buy operations deliver items to the buyer, and cancellations return items from escrow. The fix requires Move contract changes (one new function + switching from owned to shared config objects in `ssu_unified.move`) plus TypeScript TX builder and UI changes.

Note: The extension authorization in the world package's `storage_unit` functions checks that the `Auth` witness type (e.g., `SsuUnifiedAuth`) is registered on the StorageUnit's extension field -- it does NOT check the TX sender's address. The sender authorization in `ssu_unified.move` is a separate layer (`assert_authorized` checks owner/delegate). The `player_to_escrow` and `player_to_owner` functions demonstrate this -- they skip `assert_authorized` but still provide `SsuUnifiedAuth {}` to the storage_unit functions successfully. This means a new `public_escrow_to_self` function can allow any player to withdraw from escrow without needing admin/delegate status, as long as the SsuUnifiedAuth extension is registered on the SSU.

## Current State

### Market Contract (`contracts/market/sources/market.move`)

The `market.move` contract manages an order book:
- `post_sell_listing` (line 300-338): Records listing metadata (seller, ssuId, typeId, price, quantity) as a dynamic field. **Does not take any Item object or call any inventory function.** Items are not moved.
- `buy_from_listing` (line 512-553): Decrements listing quantity, splits payment coin, transfers proceeds to seller. **Does not produce or transfer any Item to buyer.** Returns change coin only.
- `cancel_sell_listing` (line 366-381): Removes the listing dynamic field. **Does not return any items.**
- `fill_buy_order` (line 455-509): Decrements buy order quantity, splits escrowed coin, pays the seller. **Does not take any Item from seller or give items to buyer.**
- `post_buy_order` (line 386-428): Records order metadata + escrows `Coin<T>`. No item handling.
- `cancel_buy_order` (line 431-451): Returns escrowed coin to buyer. No item handling.

The `market_standings` contract (deployed on-chain but source not in repo) appears to be a standings-gated wrapper around the same order book pattern. The TS builders in `market-standings.ts` call `market_standings::post_sell_listing`, `market_standings::buy_from_listing`, etc. with identical signatures (no Item parameter).

### SSU Unified Contract (`contracts/ssu_unified/sources/ssu_unified.move`)

The `ssu_unified.move` contract has inventory movement functions:
- `admin_to_escrow` (line 267-282): Withdraws from owner inventory -> deposits to open/escrow inventory. Requires authorized caller (owner/delegate).
- `admin_from_escrow` (line 285-300): Withdraws from open/escrow inventory -> deposits to owner inventory.
- `admin_to_player` (line 303-319): Withdraws from owner inventory -> deposits to player's owned inventory.
- `admin_escrow_to_self` (line 322-337): Withdraws from escrow -> deposits to sender's owned inventory.
- `admin_escrow_to_player` (line 339-356): Withdraws from escrow -> deposits to recipient's owned inventory.
- `player_to_escrow` (line 367-377): Player deposits a pre-withdrawn item into escrow.
- `player_to_owner` (line 380-390): Player deposits a pre-withdrawn item into owner inventory.

These all use the `SsuUnifiedAuth` witness for the world package's extension-authenticated `storage_unit` functions.

### TX Builders (`packages/chain-shared/src/ssu-unified.ts`)

- `buildEscrowAndListWithStandings` (line 218-241): Calls `market_standings::post_sell_listing` only. Comment says "Items stay in SSU inventory -- no withdraw step needed." **This is the bug.** Items should be moved to escrow when listed.
- `buildBuyFromListingWithStandings` (line 258-296): Calls `market_standings::buy_from_listing` only. Returns change coin. **Does not deliver items to buyer.**
- `buildCancelListingWithStandings` (line 310-323): Calls `market_standings::cancel_sell_listing` only. **Does not return items from escrow.**
- `buildFillBuyOrderWithStandings` (line 344-367): Calls `market_standings::fill_buy_order` only. **Does not withdraw items from seller's inventory.**

- `buildPostSellListing` in `market.ts` (line 326-344): Calls `market::post_sell_listing`. Same issue.
- `buildBuyFromListing` in `market.ts` (line 180-213): Calls `market::buy_from_listing`. Same issue.
- `buildFillBuyOrder` in `market.ts` (line 151-167): Calls `market::fill_buy_order`. Same issue.

### UI Components (`apps/ssu-dapp/src/components/`)

- `SellDialog.tsx` (line 68-106): Calls `buildEscrowAndListWithStandings` or `buildPostSellListing`. No inventory movement.
- `BuyFromListingDialog.tsx` (line 58-107): Calls `buildBuyFromListingWithStandings` or `buildBuyFromListing`. No item delivery.
- `FillBuyOrderDialog.tsx` (line 50-103): Calls `buildFillBuyOrderWithStandings` or `buildFillBuyOrder`. No item withdrawal.
- `CancelListingDialog.tsx` (line 40-73): Calls `buildCancelListingWithStandings` or `buildCancelSellListing`. No item return.
- `ListingCard.tsx` (line 53-81): Calls `buildBuyFromListingWithStandings` directly. Same issue.
- `ListingAdminList.tsx` (line 61-77): Calls `buildCancelListingWithStandings`. Same issue.
- `CancelBuyOrderDialog.tsx` (line 39-57): Calls `buildCancelBuyOrder` -- this is correct (coin-only, no items).
- `CreateBuyOrderDialog.tsx` (line 108-125): Calls `buildPostBuyOrder` -- this is correct (coin escrow only).

### TransferDialog.tsx (Correct Reference Implementation)

The `TransferDialog.tsx` (line 67-244) correctly demonstrates how to compose inventory operations in PTBs:
- `buildOwnerCapTransferPtb`: borrow_owner_cap -> withdraw_by_owner -> deposit_by_owner -> return_owner_cap
- `buildAdminMarketPtb`: calls `ssu_unified::admin_to_escrow` / `admin_from_escrow` / etc.
- `buildPlayerMarketPtb`: borrow_owner_cap -> withdraw_by_owner -> return_owner_cap -> `ssu_unified::player_to_escrow` / `player_to_owner`

These patterns are exactly what the sell/buy TX builders need to use.

### Parameter Availability

The dapp components and hooks already have all the data needed for the fix:
- `SsuConfigResult` from `useSsuConfig.ts`: has `ssuConfigId`, `packageId` (ssu_unified), `marketStandingsPackageId`, `marketId`, `registryId`, `owner`, `delegates`
- `TransferContext` from `SsuView.tsx`: has `ssuConfigId`, `marketPackageId` (ssu_unified package), `characterObjectId`, `ssuObjectId`, `isAuthorized`, `slotCaps` (OwnerCap refs)
- `SellDialog`: receives `ssuObjectId`, `ssuConfig`, `tribeId`, `charId`, and `item` (with typeId)
- `FillBuyOrderDialog`: receives `ssuObjectId`, `ssuConfig`, `tribeId`, `charId`, and `order` (with typeId)
- `BuyFromListingDialog`: receives `ssuConfig` and `listing` (with ssuId for the SSU where items come from)

The missing piece: buyer-side dialogs need the buyer's Character object ID and an OwnerCap reference for the SSU where items should be delivered. This data exists in the `TransferContext` but is not currently passed through to `MarketContent` -> `MarketOrdersGrid` -> `BuyFromListingDialog`/`FillBuyOrderDialog`.

## Target State

All market operations compose inventory steps with market steps in a single PTB:

1. **Sell (post listing):** admin_to_escrow + market::post_sell_listing -- items moved to escrow, then listing created.
2. **Buy from listing:** market::buy_from_listing + public_escrow_to_self -- payment processed, then items moved from escrow to buyer's player inventory. Buyer executes.
3. **Cancel listing:** market::cancel_sell_listing + admin_from_escrow -- listing removed, then items returned from escrow to owner inventory. Seller (admin) executes.
4. **Fill buy order:** admin_to_escrow + market::fill_buy_order -- items moved to escrow, then payment released to seller. Buyer picks up items later via public_escrow_to_self.
5. **Cancel buy order:** Unchanged (coin-only, already correct).
6. **Create buy order:** Unchanged (coin-only, already correct).

The seller (SSU owner/delegate) orchestrates item escrow through the `ssu_unified` contract. The buyer receives items in their player inventory slot at the SSU where the items are located.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fix location | One new Move function + composite TX builders in `ssu-unified.ts` | Market contracts untouched. Only `ssu_unified.move` gets one addition (`public_escrow_to_self`). All composition via PTBs. |
| Escrow model | Move items to SSU "open" inventory on listing; move from open to buyer on purchase | The SSU open/escrow inventory is the natural holding area. `admin_to_escrow` (owner -> open) already exists for the sell side. |
| Buy-side delivery | New `public_escrow_to_self` function in ssu_unified.move | Mirrors `player_to_escrow` (unrestricted deposit) with `public_escrow_to_self` (unrestricted withdrawal from escrow to own inventory). The storage_unit extension check provides the Auth witness. No admin/delegate status required for buyers. |
| Config ownership model | Change SsuUnifiedConfig from owned to shared | Currently owned objects -- non-owners can't reference them in TXs, making `player_to_escrow`/`player_to_owner` unusable. Shared objects are reference-able by anyone while still protected by `assert_authorized` for mutations. |
| PTB composition pattern | Follow `TransferDialog.tsx` patterns for cap borrow/return | Proven pattern already used for manual inventory transfers. |
| Backwards compatibility | None needed -- prototyping phase, no users | Per project conventions, no migration support. |
| Parameter threading | Thread `TransferContext` data through ContentTabs -> MarketContent -> dialogs | The data already exists in the component tree; it just needs to be passed down. |

## Implementation Phases

### Phase 1: Fix `SsuUnifiedConfig` Ownership Model + Add `public_escrow_to_self`

**Critical finding:** `SsuUnifiedConfig` is currently an address-owned object (`transfer::transfer(config, ctx.sender())`). On Sui, only the owner can reference an owned object in a transaction -- even as an immutable `&` reference. This means the existing `player_to_escrow` and `player_to_owner` functions are **unusable by non-owner players**, because a non-owner player cannot pass `tx.object(ssuConfigId)` in their PTB.

The fix is to make `SsuUnifiedConfig` a shared object so that anyone can reference it. The `assert_authorized` check in admin functions still prevents unauthorized modifications. Player/public functions use `_config: &SsuUnifiedConfig` as a read-only reference, which is safe with shared objects.

1. In `contracts/ssu_unified/sources/ssu_unified.move`:
   - Change `create_config` (line 87-117): replace `transfer::transfer(config, ctx.sender())` with `transfer::share_object(config)`.
   - Change `create_config_with_market` (line 120-152): same change -- `transfer::share_object(config)`.
   - Add `public_escrow_to_self` function:
     ```move
     /// Public: any player can withdraw from escrow to their own player inventory.
     /// Mirrors player_to_escrow (any player can deposit to escrow).
     /// The storage_unit extension check ensures SsuUnifiedAuth is registered.
     public fun public_escrow_to_self(
         _config: &SsuUnifiedConfig,
         storage_unit: &mut StorageUnit,
         character: &Character,
         type_id: u64,
         quantity: u32,
         ctx: &mut TxContext,
     ) {
         let item = storage_unit::withdraw_from_open_inventory(
             storage_unit, character, SsuUnifiedAuth {}, type_id, quantity, ctx,
         );
         storage_unit::deposit_to_owned(
             storage_unit, character, item, SsuUnifiedAuth {}, ctx,
         );
     }
     ```
   - Note: Changing from owned to shared means admin functions (`set_standings_config`, `set_market`, `add_delegate`, etc.) that take `&mut SsuUnifiedConfig` still work -- shared objects support mutable borrows. The `assert!(config.owner == ctx.sender(), ENotOwner)` check prevents non-owners from modifying.

2. Build: `sui move build` from `contracts/ssu_unified/`.
3. Publish: `sui client publish --gas-budget 500000000`.
4. Update `packages/chain-shared/src/config.ts`: set new `ssuUnified.packageId` for both tenants, move old ID to `previousOriginalPackageIds`.

**Impact on existing SsuUnifiedConfig objects:** Existing configs created with the old contract are address-owned and cannot be retroactively converted to shared. Users with existing configs will need to create new shared configs. Since this is the prototyping phase with no real users, this is acceptable.

Security note: `public_escrow_to_self` allows any player to withdraw any items from escrow to their own player inventory at any time. In the current prototyping phase this is acceptable -- the escrow inventory should only contain items that are actively listed for sale. In a production system, this would need on-chain verification that the withdrawal corresponds to a completed purchase. See Deferred section.

### Phase 2: Add Composite TX Builders

Add new composite TX builder functions to `packages/chain-shared/src/ssu-unified.ts`. Each builds a single PTB with multiple moveCall steps.

1. **`buildSellWithEscrow`** (seller = SSU owner/delegate)
   - Step 1: `ssu_unified::admin_to_escrow(config, storage_unit, character, type_id, quantity)` -- moves items from owner inventory to escrow
   - Step 2: `market_standings::post_sell_listing(market, registry, tribe_id, char_id, ssu_id, type_id, price, quantity, clock)` -- creates listing
   - Parameters: ssuConfigId, ssuObjectId, characterObjectId, typeId, quantity, marketId, coinType, pricePerUnit, registryId, tribeId, charId, senderAddress, ssuUnifiedPackageId, marketStandingsPackageId
   - Also support `market::post_sell_listing` fallback (when `marketModule === "market"`)

2. **`buildCancelListingWithReturn`** (seller = SSU owner/delegate)
   - Step 1: `market_standings::cancel_sell_listing(market, listing_id)` -- removes listing
   - Step 2: `ssu_unified::admin_from_escrow(config, storage_unit, character, type_id, quantity)` -- returns items from escrow to owner inventory
   - Parameters: ssuConfigId, ssuObjectId, characterObjectId, typeId, quantity, marketId, coinType, listingId, senderAddress, ssuUnifiedPackageId, marketStandingsPackageId

3. **`buildBuyWithDelivery`** (buyer = any player)
   - Step 1: Merge+split coins for payment (existing pattern from `buildBuyFromListingWithStandings`)
   - Step 2: `market_standings::buy_from_listing(market, listing_id, quantity, payment, clock)` -> returns change
   - Step 3: `tx.transferObjects([change], sender)` -- return change to buyer
   - Step 4: `ssu_unified::public_escrow_to_self(config, storage_unit, character, type_id, quantity)` -- delivers items from escrow to buyer's player inventory
   - Parameters: ssuConfigId, ssuObjectId, characterObjectId (buyer's), typeId, quantity, marketId, coinType, listingId, coinObjectIds, senderAddress, ssuUnifiedPackageId, marketStandingsPackageId
   - Requires buyer's Character object to be passed as a TX object

4. **`buildFillBuyOrderWithItems`** (seller fills a buy order)
   - When seller is SSU owner/delegate (admin):
     - Step 1: `ssu_unified::admin_to_escrow(config, storage_unit, character, type_id, quantity)` -- move seller's items to escrow (for audit trail; could skip directly to buyer)
     - Step 2: `market_standings::fill_buy_order(market, registry, tribe_id, char_id, ssu_id, order_id, type_id, quantity, clock)` -- processes payment
   - Note: Items remain in escrow for the buyer to pick up via `public_escrow_to_self`, OR the admin can deliver directly. For simplicity in v1, items go to escrow and the buyer picks them up.
   - Parameters: ssuConfigId, ssuObjectId, characterObjectId, typeId, quantity, marketId, coinType, registryId, tribeId, charId, orderId, senderAddress, ssuUnifiedPackageId, marketStandingsPackageId

5. **`buildUpdateListingWithEscrowDelta`** (seller = SSU owner/delegate)
   - Calculate delta = newQuantity - oldQuantity
   - If delta > 0: `ssu_unified::admin_to_escrow(config, storage_unit, character, type_id, delta)` -- escrow more
   - If delta < 0: `ssu_unified::admin_from_escrow(config, storage_unit, character, type_id, |delta|)` -- un-escrow
   - Then: `market_standings::update_sell_listing(market, listing_id, new_price, new_quantity)` (or `market::update_sell_listing`)
   - Parameters: ssuConfigId, ssuObjectId, characterObjectId, typeId, oldQuantity, newQuantity, newPrice, marketId, coinType, listingId, senderAddress, ssuUnifiedPackageId, marketStandingsPackageId/marketPackageId

Also add a TS TX builder for the new Move function:

6. **`buildPublicEscrowToSelf`** (standalone, for manual pickup)
   - Calls `ssu_unified::public_escrow_to_self(config, storage_unit, character, type_id, quantity)`
   - Parameters: ssuUnifiedPackageId, ssuConfigId, ssuObjectId, characterObjectId, typeId, quantity, senderAddress

### Phase 3: Thread TransferContext to Market Dialogs

1. In `apps/ssu-dapp/src/components/ContentTabs.tsx`:
   - Pass `transferContext` to `MarketContent` as a new prop.

2. In `apps/ssu-dapp/src/components/MarketContent.tsx`:
   - Accept `transferContext` prop.
   - Pass relevant fields to `MarketOrdersGrid`.

3. In `apps/ssu-dapp/src/components/MarketOrdersGrid.tsx`:
   - Accept `transferContext` prop.
   - Pass to `BuyFromListingDialog`, `FillBuyOrderDialog`, `CancelListingDialog`, `SellDialog`.

4. In each dialog:
   - Accept new props for ssuConfigId, ssuUnifiedPackageId, characterObjectId, ssuObjectId.
   - Use these to call the composite TX builders from Phase 2.

### Phase 4: Update Sell Flow

1. In `apps/ssu-dapp/src/components/SellDialog.tsx`:
   - Replace `buildEscrowAndListWithStandings` / `buildPostSellListing` with `buildSellWithEscrow`.
   - Add `ssuConfigId`, `ssuObjectId`, `characterObjectId`, `ssuUnifiedPackageId` to the params.
   - The seller must be authorized (owner/delegate) -- this is already enforced by the `canSell` check in `ContentTabs.tsx`.

2. In `apps/ssu-dapp/src/components/CancelListingDialog.tsx`:
   - Replace `buildCancelListingWithStandings` / `buildCancelSellListing` with `buildCancelListingWithReturn`.
   - Need to pass typeId and quantity from the listing to restore items from escrow.

### Phase 5: Update Buy and Fill Flows

1. In `apps/ssu-dapp/src/components/BuyFromListingDialog.tsx`:
   - Replace `buildBuyFromListingWithStandings` / `buildBuyFromListing` with `buildBuyWithDelivery`.
   - Add `ssuConfigId`, `ssuObjectId`, `characterObjectId`, `ssuUnifiedPackageId` to the params.
   - The buyer's Character object ID comes from `TransferContext.characterObjectId` (threaded in Phase 3).

2. In `apps/ssu-dapp/src/components/FillBuyOrderDialog.tsx`:
   - Replace `buildFillBuyOrderWithStandings` / `buildFillBuyOrder` with `buildFillBuyOrderWithItems`.
   - The seller (who fills the order) must be authorized (owner/delegate). This is the same authorization check already present.

3. In `apps/ssu-dapp/src/components/ListingCard.tsx`:
   - Replace `buildBuyFromListingWithStandings` with `buildBuyWithDelivery`.
   - Thread the same new props from MarketContent/MarketOrdersGrid.

### Phase 6: Update Admin Listing Management

1. In `apps/ssu-dapp/src/components/ListingAdminList.tsx`:
   - Update `handleCancel` to use `buildCancelListingWithReturn` (return items from escrow).
   - Update `handleUpdate` to use `buildUpdateListingWithEscrowDelta` -- if quantity is reduced, return excess items from escrow; if increased, escrow more items.

2. In `apps/ssu-dapp/src/components/EditListingDialog.tsx`:
   - Pass `oldQuantity` (from listing) to `buildUpdateListingWithEscrowDelta`.
   - Add ssuConfigId, ssuObjectId, characterObjectId, ssuUnifiedPackageId to the params (same threading as Phase 3).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/ssu_unified/sources/ssu_unified.move` | Edit | Change config from owned to shared objects, add `public_escrow_to_self` function |
| `packages/chain-shared/src/config.ts` | Edit | Update `ssuUnified.packageId` for both tenants after republish |
| `packages/chain-shared/src/ssu-unified.ts` | Edit | Add composite TX builders: `buildSellWithEscrow`, `buildCancelListingWithReturn`, `buildBuyWithDelivery`, `buildFillBuyOrderWithItems`, `buildUpdateListingWithEscrowDelta`, `buildPublicEscrowToSelf` |
| `apps/ssu-dapp/src/components/ContentTabs.tsx` | Edit | Thread `transferContext` to MarketContent |
| `apps/ssu-dapp/src/components/MarketContent.tsx` | Edit | Accept and forward `transferContext` |
| `apps/ssu-dapp/src/components/MarketOrdersGrid.tsx` | Edit | Accept and forward transfer data to dialogs |
| `apps/ssu-dapp/src/components/SellDialog.tsx` | Edit | Use `buildSellWithEscrow` composite builder |
| `apps/ssu-dapp/src/components/CancelListingDialog.tsx` | Edit | Use `buildCancelListingWithReturn` composite builder |
| `apps/ssu-dapp/src/components/BuyFromListingDialog.tsx` | Edit | Use `buildBuyWithDelivery` composite builder |
| `apps/ssu-dapp/src/components/FillBuyOrderDialog.tsx` | Edit | Use `buildFillBuyOrderWithItems` composite builder |
| `apps/ssu-dapp/src/components/ListingAdminList.tsx` | Edit | Use composite builders for cancel/edit |
| `apps/ssu-dapp/src/components/EditListingDialog.tsx` | Edit | Handle quantity changes with inventory movements |
| `apps/ssu-dapp/src/components/ListingCard.tsx` | Edit | Use composite buy builder |

## Open Questions

1. **Should `public_escrow_to_self` have any access restrictions beyond the extension check?**
   - **Option A: Unrestricted (current Phase 1 design)** -- Any player can withdraw any items from escrow to their own player inventory at any time. The storage_unit extension check is the only guard. Pros: Simple, enables single-TX buy-and-deliver flow. Cons: Malicious player could drain escrow items that aren't theirs (e.g., items listed for someone else's buy order).
   - **Option B: Add a "purchased quantity" tracking field** -- The contract tracks how many items of each type a player is entitled to withdraw, incremented by buy/fill operations. Pros: Secure escrow. Cons: Requires the ssu_unified contract to depend on the market contract (to verify purchases), adding complexity and cross-package dependencies.
   - **Option C: Accept the risk for now, add on-chain enforcement later** -- Ship unrestricted `public_escrow_to_self` for the prototype. Document the security limitation. Tighten in a future contract upgrade when cross-package escrow verification is designed.
   - **Recommendation:** Option C. This is a prototyping phase with no real users. The risk is that a bad actor drains escrow -- but the SSU owner controls what goes into escrow and can stop listing if this happens. On-chain enforcement is deferred.

2. **Should `update_sell_listing` (quantity change) trigger inventory movements?**
   - **Option A: Yes, move items to/from escrow on quantity change** -- If quantity increases, escrow more items. If quantity decreases, return items from escrow. Pros: Escrow always matches listing quantity. Cons: More complex TX builder; requires knowing the old quantity to compute delta.
   - **Option B: No, only handle full listing lifecycle (create/cancel)** -- Update only changes price/quantity on the listing metadata. Quantity mismatches resolved on purchase (fail if insufficient escrow). Pros: Simpler. Cons: Could allow overselling if seller lists more than what's in escrow.
   - **Recommendation:** Option A. The TX builder knows the current listing quantity (from the listing data passed to the edit dialog). Computing the delta and composing the appropriate escrow/un-escrow step is straightforward and prevents inventory inconsistencies.

3. **Should items be escrowed during fill-buy-order, or delivered directly to escrow for buyer pickup?**
   - **Option A: Escrow then buyer pickup** -- Seller moves items to escrow via `admin_to_escrow`, fills the order, buyer later calls `public_escrow_to_self`. Pros: Consistent with sell-listing model. Cons: Two-step for the buyer (fill TX + pickup TX), unless items are auto-delivered.
   - **Option B: Direct delivery via admin_escrow_to_player in same PTB** -- Seller escrows items, then immediately delivers to buyer's player inventory. Pros: Single TX, items arrive instantly. Cons: Requires knowing the buyer's Character object ID at fill time (available from the buy order's buyer address, but needs resolution).
   - **Option C: Two-PTB approach for v1** -- Fill TX only handles coins. Items stay in owner inventory. Buyer manually requests items via a separate UI action.
   - **Recommendation:** Option A for v1. The buyer already needs to be at the SSU to pick up items. The `public_escrow_to_self` function handles this. The UI can show "items in escrow -- click to claim" for completed purchases.

4. **Should `SsuUnifiedConfig` be shared or use a different discovery/reference pattern?**
   - **Option A: Shared object (current Phase 1 design)** -- Change `transfer::transfer` to `transfer::share_object`. Anyone can reference the config in TXs. Admin functions are still owner-protected. Pros: Simplest fix. Enables player functions. Cons: Shared objects have slightly higher gas costs due to consensus ordering. Config objects are small so this is negligible.
   - **Option B: Make config immutable after creation** -- Use `transfer::freeze_object`. Pros: Zero-cost reads. Cons: Cannot update config (market link, delegates, thresholds). Would require destroy+recreate pattern for changes.
   - **Option C: Store config fields on the StorageUnit as dynamic fields** -- Eliminate SsuUnifiedConfig as a separate object. Use dynamic fields on the SSU itself. Pros: No ownership issue (StorageUnit is shared). Cons: Invasive change, different storage/query pattern.
   - **Recommendation:** Option A. Shared objects are the standard Sui pattern for objects referenced by multiple users. Gas overhead is negligible for small config objects. The existing `assert_authorized` checks protect mutations.

## Deferred

- **On-chain escrow enforcement** -- Verifying on-chain that items in escrow match active listings. Currently relies on correct client-side PTB composition. A future contract upgrade could add listing-aware escrow validation.
- **Cross-SSU purchases** -- Buying items from an SSU other than the one the buyer is currently viewing. Requires item delivery to a different SSU.
- **Partial fill inventory tracking** -- When a buy order is partially filled, tracking which items have been delivered and which are pending.
- **Automated settlement** -- A background process that detects completed trades and settles item transfers automatically.
