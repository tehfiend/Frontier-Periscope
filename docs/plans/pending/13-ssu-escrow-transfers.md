# Plan: SSU Escrow Transfer Fixes

**Status:** Draft
**Created:** 2026-03-28
**Module:** chain-shared, ssu-dapp

## Overview

Selling and buying items on SSU markets does not properly move items to and from escrow. The root cause is architectural: the market contracts (`market.move` and the separate `market_standings` module) operate purely as order books -- they track sell listings and buy orders with coin escrow, but have no integration with the game's inventory system. When a seller posts a listing, items stay in the SSU inventory with no lock or transfer. When a buyer purchases items, coins move to the seller but no items move to the buyer. The same gap exists for filling buy orders.

The `ssu_unified.move` contract has the correct inventory manipulation functions (`admin_to_escrow`, `admin_from_escrow`, `admin_to_player`, `admin_escrow_to_player`, etc.) that use the world package's `storage_unit` API to move items between inventories. However, these inventory operations are never composed with the market operations in a single transaction. The sell/buy/fill TX builders in `ssu-unified.ts` and `market-standings.ts` only call market functions -- they never include inventory withdrawal or deposit steps.

This plan adds multi-step PTB (Programmable Transaction Block) composition so that sell listings escrow items on creation, buy operations deliver items to the buyer, and cancellations return items from escrow. The fix is entirely in the TypeScript TX builders and the UI components that call them -- no Move contract changes are needed because all the required on-chain primitives already exist.

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
2. **Buy from listing:** market::buy_from_listing + admin_escrow_to_player -- payment processed, then items moved from escrow to buyer's player inventory.
3. **Cancel listing:** market::cancel_sell_listing + admin_from_escrow -- listing removed, then items returned from escrow to owner inventory.
4. **Fill buy order:** admin_to_escrow + market::fill_buy_order -- items moved to escrow (or directly to buyer), then payment released. (Alternatively, for the seller: withdraw items from their inventory, then fill the order.)
5. **Cancel buy order:** Unchanged (coin-only, already correct).
6. **Create buy order:** Unchanged (coin-only, already correct).

The seller (SSU owner/delegate) orchestrates item escrow through the `ssu_unified` contract. The buyer receives items in their player inventory slot at the SSU where the items are located.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fix location | TX builders in `ssu-unified.ts` + new composite builders | Keeps the market contract untouched. Compose existing Move functions via PTBs. The `ssu_unified.move` and `market.move`/`market_standings` already have all the needed entry points. |
| Escrow model | Move items to SSU "open" inventory on listing; move from open to buyer on purchase | The SSU open/escrow inventory is the natural holding area. `admin_to_escrow` (owner -> open) and `admin_escrow_to_player` (open -> player) are already implemented. |
| Who executes buy-side transfers | The buyer's TX includes the `ssu_unified::admin_escrow_to_player` call | The SSU owner/delegate must be the TX sender for admin functions. However, a buyer is typically NOT the SSU owner. **This creates a fundamental problem** -- see Open Question 1. |
| PTB composition pattern | Follow `TransferDialog.tsx` patterns for cap borrow/return | Proven pattern already used for manual inventory transfers. |
| Backwards compatibility | None needed -- prototyping phase, no users | Per project conventions, no migration support. |
| Parameter threading | Thread `TransferContext` data through ContentTabs -> MarketContent -> dialogs | The data already exists in the component tree; it just needs to be passed down. |

## Implementation Phases

### Phase 1: Analyze Escrow Authority Model

Before writing code, resolve the fundamental question of who has authority to move items during a buy transaction. The `ssu_unified.move` admin functions require the TX sender to be the config owner or delegate. Options:

1. **Buyer-initiated (current approach):** The buyer sends the TX. For this to work, either:
   - The buyer must be a delegate on the SsuUnifiedConfig (requires setup), OR
   - A new `player_escrow_to_self` function is added to `ssu_unified.move` that allows any player to withdraw from escrow to their own player inventory (similar to `player_to_escrow` which allows any player to deposit)

2. **Two-step settlement:** The buy TX only handles coins. A separate admin TX (run by SSU owner/delegate or automated) moves items from escrow to buyer. This is the current (broken) behavior -- just with explicit escrow.

3. **Direct virtual model:** Keep listings virtual (no escrow on listing). At purchase time, the SSU admin moves items directly from owner inventory to buyer. This requires the admin to co-sign or the operation to be split.

**This is the critical blocker that must be resolved before implementation.**

### Phase 2: Add Composite TX Builders

Add new composite TX builder functions to `packages/chain-shared/src/ssu-unified.ts`:

1. **`buildSellWithEscrow`**: Compose `ssu_unified::admin_to_escrow` + `market_standings::post_sell_listing` (or `market::post_sell_listing`) in a single PTB. The SSU owner/delegate executes this to list items.
   - Parameters: ssuConfigId, ssuObjectId (StorageUnit), characterObjectId, typeId, quantity, marketId, coinType, pricePerUnit, registryId, tribeId, charId, senderAddress, ssuUnifiedPackageId, marketStandingsPackageId
   - Step 1: Call `ssu_unified::admin_to_escrow` to move items from owner -> escrow
   - Step 2: Call `market_standings::post_sell_listing` to create the listing

2. **`buildCancelListingWithReturn`**: Compose `market_standings::cancel_sell_listing` + `ssu_unified::admin_from_escrow` in a single PTB.
   - Parameters: ssuConfigId, ssuObjectId, characterObjectId, typeId, quantity, marketId, coinType, listingId, senderAddress, ssuUnifiedPackageId, marketStandingsPackageId
   - Step 1: Call `market_standings::cancel_sell_listing` to remove listing
   - Step 2: Call `ssu_unified::admin_from_escrow` to move items from escrow -> owner

3. **`buildBuyWithDelivery`**: Compose `market_standings::buy_from_listing` + item delivery. (Exact design depends on Phase 1 resolution.)

4. **`buildFillBuyOrderWithItems`**: Compose item withdrawal + `market_standings::fill_buy_order`. (Exact design depends on Phase 1 resolution.)

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

Depends on Phase 1 resolution. Two possible paths:

**Path A (new player function on contract):**
1. Add `player_escrow_to_self` to `ssu_unified.move` (or equivalent).
2. `buildBuyWithDelivery` composes: `market_standings::buy_from_listing` + `ssu_unified::player_escrow_to_self`.
3. `buildFillBuyOrderWithItems` composes: `ssu_unified::player_to_escrow` (items from seller) + `market_standings::fill_buy_order`.

**Path B (admin-only settlement):**
1. Buy TX only handles coins (current behavior of `buy_from_listing`).
2. Admin runs a separate TX to move items from escrow to buyer.
3. UI shows "pending settlement" status on completed buys.

### Phase 6: Update Admin Listing Management

1. In `apps/ssu-dapp/src/components/ListingAdminList.tsx`:
   - Update `handleCancel` to use `buildCancelListingWithReturn` (return items from escrow).
   - Update `handleUpdate` -- if quantity is reduced, return excess items from escrow; if increased, escrow more items.

2. In `apps/ssu-dapp/src/components/EditListingDialog.tsx`:
   - Update to handle quantity changes with corresponding inventory movements.

3. In `apps/ssu-dapp/src/components/ListingCard.tsx`:
   - Update buy handler to use composite TX builder.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/chain-shared/src/ssu-unified.ts` | Edit | Add composite TX builders: `buildSellWithEscrow`, `buildCancelListingWithReturn`, `buildBuyWithDelivery`, `buildFillBuyOrderWithItems` |
| `contracts/ssu_unified/sources/ssu_unified.move` | Possibly edit | May need `player_escrow_to_self` function depending on Phase 1 resolution |
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

1. **Who has authority to move items from escrow to the buyer?**
   - **Option A: Add `player_escrow_to_self` to `ssu_unified.move`** -- Allows any player to withdraw items from the SSU's open/escrow inventory into their own player inventory, as long as the SsuUnifiedAuth witness is used. This mirrors `player_to_escrow` (any player can deposit to escrow) and `admin_escrow_to_self` (admin can withdraw escrow to self). Pros: Buyer can complete the purchase in a single TX without admin involvement. Symmetrical with `player_to_escrow`. Cons: Requires a Move contract change and republish. Anyone could drain escrow -- needs careful access control (perhaps restrict to items matching a listing the player just purchased, or accept the risk since escrow is only for in-flight trades).
   - **Option B: Require SSU admin/delegate to settle items separately** -- Buy TX only handles coin transfer. Items stay in escrow until admin runs a settlement TX. Pros: No contract change needed. Cons: Two-step process, bad UX, items stuck in escrow until admin acts. Could lead to stuck trades if admin is offline.
   - **Option C: Use existing `admin_escrow_to_player` in the same PTB, requiring buyer to be a delegate** -- Pros: No contract change. Cons: Every potential buyer must be added as delegate, which is impractical for public markets.
   - **Recommendation:** Option A. The contract already exists and is in the repo. Adding `player_escrow_to_self` is a minimal one-function addition. The "anyone can drain escrow" concern is mitigated by the fact that items in escrow are only those being actively traded. In practice, the escrow inventory is managed -- only listed quantities should be in escrow. The alternative (Option B) makes the market essentially unusable for normal trading.

2. **Should `update_sell_listing` (quantity change) trigger inventory movements?**
   - **Option A: Yes, move items to/from escrow on quantity change** -- If quantity increases, escrow more items. If quantity decreases, return items from escrow. Pros: Escrow always matches listing quantity. Cons: More complex TX builder; requires knowing the old quantity to compute delta.
   - **Option B: No, only handle full listing lifecycle (create/cancel)** -- Update only changes price/quantity on the listing metadata. Quantity mismatches resolved on purchase (fail if insufficient escrow). Pros: Simpler. Cons: Could allow overselling if seller lists more than what's in escrow.
   - **Recommendation:** Option A. The TX builder knows the current listing quantity (from the listing data passed to the edit dialog). Computing the delta and composing the appropriate escrow/un-escrow step is straightforward and prevents inventory inconsistencies.

3. **How should the `ssu_unified::admin_escrow_to_self` function (already in the contract) be distinguished from the proposed `player_escrow_to_self`?**
   - **Option A: Rename existing to `delegate_escrow_to_self` and add `player_escrow_to_self` as unrestricted** -- Pros: Clear naming. Cons: Breaking change for existing callers (but no users in production).
   - **Option B: Add new function `public_escrow_to_self` that skips authorization check** -- Pros: Non-breaking addition. Cons: Security risk -- anyone can drain escrow.
   - **Option C: Keep `admin_escrow_to_self` as-is, add `player_escrow_to_self` that takes an `Item` parameter (player pre-withdraws from their owned inventory, then deposits to own)** -- Wait, this doesn't make sense for escrow withdrawal. The player needs to withdraw FROM escrow, not deposit.
   - **Recommendation:** Option B (add `public_escrow_to_self`). The naming is clear -- it's a public function anyone can call. The security concern is acceptable for the current prototyping phase, and can be tightened later with on-chain listing verification. The existing `admin_escrow_to_self` stays unchanged for admin operations.

## Deferred

- **On-chain escrow enforcement** -- Verifying on-chain that items in escrow match active listings. Currently relies on correct client-side PTB composition. A future contract upgrade could add listing-aware escrow validation.
- **Cross-SSU purchases** -- Buying items from an SSU other than the one the buyer is currently viewing. Requires item delivery to a different SSU.
- **Partial fill inventory tracking** -- When a buy order is partially filled, tracking which items have been delivered and which are pending.
- **Automated settlement** -- A background process that detects completed trades and settles item transfers automatically.
