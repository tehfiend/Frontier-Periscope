# Plan: Market Buy Order Improvements
**Status:** Active
**Created:** 2026-03-21
**Updated:** 2026-03-21 (slimmed -- private location/invite moved to Plan 23)
**Module:** contracts, chain-shared, ssu-dapp, ssu-market-dapp, periscope

## Overview

The market system has several UX gaps and correctness issues that this plan addresses via fresh-publishing new contracts. Since we're republishing anyway, we take the opportunity to fix all known contract-level issues, add buy order struct improvements, and introduce a simple public/private visibility flag on `SsuConfig`.

**Architectural decisions:**

1. **Buy orders stay on per-SSU `Market<T>`** -- Buy orders remain as dynamic fields on `Market<T>` objects. Prices vary by location (location-dependent markets), so a shared buy order pool doesn't make sense. Buy orders gain `posted_at_ms` and `original_quantity` fields.

2. **SSU visibility flag** -- `SsuConfig` gains a simple `is_public: bool` field. Public SSU locations come from the game's `LocationRegistry` (populated by the game server when the player uses in-game "Publish Location"). Our contract only tracks whether the SSU opts in to being discoverable in cross-market queries.

**Core issues fixed:**
1. `BuyOrder` struct lacks `posted_at_ms` timestamp (unlike `SellListing`), forcing a fragile event-correlation workaround limited to 50 events.
2. "Create Buy Order" dialog forces single coin object selection instead of auto-merging all available coins.
3. Fee calculation uses truncating integer division: `total_price / 10000 * fee_bps` loses precision (e.g., total_price=9999, fee_bps=500 yields 0 instead of 499).
4. Several events are too sparse for indexing -- missing timestamps, addresses, and type IDs.
5. `ssu_market` uses `ESSUMismatch` error for type_id mismatch in `player_fill_buy_order` (wrong error code).
6. `MarketBuyOrder` type uses `number` for `pricePerUnit` -- precision loss for values > 2^53.

**New features:**
7. **SSU visibility** -- `SsuConfig` gains `is_public: bool`. Public SSUs are discoverable in cross-market queries. Location data for public SSUs comes from the game's `LocationRegistry` via existing world contracts.
8. **Cross-market sell listing queries** -- List all public sell listings for a given currency across ALL SSU markets.

**Approach:** Fresh-publish `market` package, both `ssu_market` variants, and `token_template` (which depends on `market`). Existing test markets/currencies become orphaned -- new ones are created after publish.

## Current State

### Contract Layer

**`contracts/market/sources/market.move`** -- `BuyOrder` struct (lines 85-91):
```move
public struct BuyOrder has store, drop {
    order_id: u64,
    buyer: address,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
}
```
No `posted_at_ms` or `original_quantity` fields. Compare with `SellListing` (lines 74-82) which has `posted_at_ms: u64`.

**`post_buy_order`** (lines 376-410) does not take `&Clock`. No `original_quantity` stored.

**`BuyOrderPostedEvent`** (lines 122-129) lacks `posted_at_ms`.

**`BuyOrderCancelledEvent`** (lines 139-142) has only `market_id` + `order_id` -- no buyer, type_id, or refund_amount.

**`BuyOrderFilledEvent`** (lines 131-137) is missing `buyer`, `type_id`, and `price_per_unit`.

**`SellListingPostedEvent`** (lines 100-108) is missing `posted_at_ms`.

**Fee calculation bug** in `ssu_market` (lines 415, 474, 539): `total_price / 10000 * fee_bps` -- integer division truncates first, then multiplies. For `total_price < 10000`, fee is always 0 regardless of `fee_bps`.

**`player_fill_buy_order`** (line 466): `assert!(type_id == market::order_type_id(order), ESSUMismatch)` -- wrong error constant; should have a `ETypeMismatch` error.

**`SsuConfig` struct** in `ssu_market.move` (lines 54-60):
```move
public struct SsuConfig has key {
    id: UID,
    ssu_id: ID,
    owner: address,
    delegates: vector<address>,
    market_id: Option<ID>,
}
```
No visibility field.

**`contracts/token_template/sources/token.move`** -- depends on `market` package via `market = { local = "../market" }` in Move.toml. Republishing `market` means `token_template` also needs a Move.toml update (local dep still works, but `published-at` address in market changes).

### Location Data -- World Contracts

**`world::location`** stores locations as Poseidon2 cryptographic hashes (`Location { location_hash: vector<u8> }`). These are NOT human-readable. The `LocationRegistry` maps assembly IDs to `Coordinates { solarsystem: u64, x: String, y: String, z: String }`, but is only populated by the game server via `reveal_location()` (called when the player uses in-game "Publish Location").

**Implication for cross-market queries:** Public SSU locations can be resolved from the game's `LocationRegistry` by assembly ID. Our contract only needs `is_public: bool` to indicate discoverability -- no location data stored on `SsuConfig`.

### Chain-Shared Layer

**`packages/chain-shared/src/types.ts`** -- `MarketBuyOrder` (lines 59-65): no `postedAtMs` or `originalQuantity` fields. `pricePerUnit` is `number` type (precision loss for values > 2^53).

**`packages/chain-shared/src/market.ts`** -- `buildPostBuyOrder` (lines 302-319) takes `paymentObjectId: string` -- a single coin object, no merging. `queryMarketBuyOrders` (line 543) reads `pricePerUnit` as `Number()`.

**`packages/chain-shared/src/market.ts`** -- `queryMarkets` (lines 350-421) already supports discovering all `Market<T>` objects for a given coin type via GraphQL type filtering. This is the foundation for cross-market sell listing queries.

**`packages/chain-shared/src/ssu-market.ts`** -- `buildBuyFromListing` takes `paymentObjectId: string` -- a single coin object. `buildEscrowAndList` (line 140) does not accept any location params. `SsuConfigInfo` type has no visibility field.

### Dapp Layer

**`apps/ssu-dapp/src/hooks/useBuyOrders.ts`** -- Event-based timestamp workaround queries `BuyOrderPostedEvent`, limited to 50 events, joins by `order_id`.

**`apps/ssu-dapp/src/components/CreateBuyOrderDialog.tsx`** -- Manual coin selector showing individual coin objects. Cannot combine fragmented coins for a larger buy order.

**`apps/ssu-dapp/src/components/FillBuyOrderDialog.tsx`** -- `totalPaymentBase = order.pricePerUnit * qty` uses `number * number`, potential precision issues.

**`apps/ssu-dapp/src/hooks/useSsuConfig.ts`** -- `SsuConfigResult` has no visibility field.

**`apps/ssu-market-dapp/src/components/PostBuyOrderForm.tsx`** -- Manual coin object ID text input (not even a dropdown), uses raw `Number(pricePerUnit)` without decimal conversion.

**`apps/ssu-market-dapp/src/components/MarketDetail.tsx`** -- Displays `order.pricePerUnit.toLocaleString()` (raw base units, no decimal formatting).

## Target State

### Contract Layer -- market.move

Buy orders stay on `Market<T>` with struct improvements:

1. `BuyOrder` gains `posted_at_ms: u64` and `original_quantity: u64`.
2. `post_buy_order` takes `&Clock` to set `posted_at_ms`, stores `original_quantity: quantity`.
3. `BuyOrderPostedEvent` gains `posted_at_ms: u64`.
4. `BuyOrderCancelledEvent` gains `buyer: address`, `type_id: u64`, `refund_amount: u64`.
5. `BuyOrderFilledEvent` gains `buyer: address`, `type_id: u64`, `price_per_unit: u64`.
6. `SellListingPostedEvent` gains `posted_at_ms: u64`.
7. Read accessors added: `order_original_quantity`, `order_posted_at_ms`.
8. No changes to SellListing struct (no per-listing location fields needed).

### Contract Layer -- ssu_market.move

Both variants (`ssu_market` and `ssu_market_utopia`) get these changes:

1. **`SsuConfig` gains visibility flag:**
   ```move
   public struct SsuConfig has key {
       id: UID,
       ssu_id: ID,
       owner: address,
       delegates: vector<address>,
       market_id: Option<ID>,
       is_public: bool,
   }
   ```

2. **New `set_visibility` function** -- owner only:
   ```move
   public fun set_visibility(
       config: &mut SsuConfig,
       is_public: bool,
       ctx: &TxContext,
   ) {
       assert!(ctx.sender() == config.owner, ENotOwner);
       config.is_public = is_public;

       event::emit(VisibilitySetEvent {
           config_id: object::id(config),
           ssu_id: config.ssu_id,
           is_public,
       });
   }
   ```

3. **New `VisibilitySetEvent`:**
   ```move
   public struct VisibilitySetEvent has copy, drop {
       config_id: ID,
       ssu_id: ID,
       is_public: bool,
   }
   ```

4. **Read accessor:** `config_is_public`.

5. Fee calculation fixed: `total_price * fee_bps / 10000` in all three trade functions.
6. New `ETypeMismatch` error code (code = 9) replaces misuse of `ESSUMismatch`.
7. `escrow_and_list` signature unchanged (no per-listing location params needed -- SSU-level visibility covers it).
8. `BuyOrderFilledEvent` enriched with `buyer`, `price_per_unit`.

### Chain-Shared Layer

**Type changes:**
- `MarketBuyOrder.pricePerUnit` changes from `number` to `bigint`.
- `MarketBuyOrder` gains `postedAtMs: number` and `originalQuantity: number`.
- `MarketSellListing.pricePerUnit` changes from `number` to `bigint`.
- `SsuConfigInfo` gains `isPublic: boolean`.

**Query changes:**
- `queryMarketBuyOrders` updated: reads `posted_at_ms`, `original_quantity`, uses `BigInt()` for `price_per_unit`.
- `queryMarketListings` uses `BigInt()` for `price_per_unit`.
- New `queryAllListingsForCurrency(client, packageId, coinType)` -- discovers all `Market<coinType>` objects, queries listings on each, returns aggregated results filtered to public SSUs only.
- `querySsuConfig` returns `isPublic` field.

**TX builder changes:**
- `buildPostBuyOrder` gains `coinObjectIds: string[]` (replaces `paymentObjectId`) and `totalAmount: bigint`. Uses merge+split pattern. Passes Clock.
- `buildBuyFromListing` gains `coinObjectIds: string[]` (replaces `paymentObjectId`), uses merge pattern.
- `pricePerUnit` param type changes to `bigint` in relevant builders.
- New `buildSetVisibility(params)` TX builder.

**Config changes:**
- All package IDs updated for both tenants (`market`, `ssuMarket`).
- Old `originalPackageId` values added to `previousOriginalPackageIds`.

### Dapp Layer

- `useBuyOrders.ts` reads `postedAtMs` directly from query, removes event workaround.
- `useSsuConfig.ts` returns `isPublic` from `SsuConfigInfo`.
- `CreateBuyOrderDialog.tsx` replaces coin selector with total balance display + merged coin TX.
- `FillBuyOrderDialog.tsx` uses `BigInt` arithmetic.
- `SellDialog.tsx` no longer needs location params (SSU-level visibility covers it).
- New visibility toggle in SSU admin settings (simple public/private switch).
- `ssu-market-dapp` components updated for decimal formatting and cross-market queries.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Buy order storage | Stay on per-SSU `Market<T>` | Prices vary by location (location-dependent markets). A shared pool eliminates location context. Per-SSU buy orders keep pricing tied to the physical market location, which is more natural for an EVE-style economy. |
| Visibility on SsuConfig | `is_public: bool` only | Location is per-SSU, not per-currency. One SSU may host multiple currencies -- they all share the same physical location. A simple boolean is sufficient; public SSU coordinates come from the game's `LocationRegistry` (existing world contract). |
| Location on SsuConfig (not SellListing) | SSU-level visibility covers all orders | Individual listings don't need their own `is_public` -- all orders at a public SSU are public, all orders at a private SSU are private. Simplifies the contract and avoids redundant data. |
| Public SSU location source | Game's `LocationRegistry` via `storage_unit::reveal_location()` | Location coordinates for public SSUs are already available on-chain in `LocationRegistry`, populated by the game server when the player uses in-game "Publish Location". Our contract does NOT store location data -- it only stores the visibility flag. The dApp can query `LocationRegistry` by assembly ID to display coordinates. |
| Private location sharing | Deferred to Plan 23 (Private Map System) | Encrypted location sharing, invite system, and private map features are decoupled from market improvements and handled by a separate plan. This keeps Plan 22 focused on market UX and correctness. |
| Upgrade vs. fresh publish | Fresh publish | Sui compatible upgrade policy forbids adding struct fields. These are testnet contracts with test currencies -- no production data to preserve. |
| Timestamp storage | Directly in `BuyOrder` struct | Fresh publish allows struct changes. Simplest, most consistent with `SellListing` pattern. |
| Coin merging approach | `mergeCoins` + `splitCoins` in PTB | Standard Sui pattern for combining fragmented coins. No contract changes needed for merge. |
| `pricePerUnit` type | `bigint` in types + queries | `u64` on-chain values can exceed `Number.MAX_SAFE_INTEGER` (2^53). `BigInt` prevents silent precision loss. |
| Fee calculation order | `total_price * fee_bps / 10000` | Multiply first avoids truncation to 0 for small totals. Overflow risk is negligible -- `u64` max is 1.8e19, and `fee_bps <= 10000` means `total_price * 10000` overflows only at 1.8e15 base units. |
| `original_quantity` field | Add to `BuyOrder` | Enables UI to show "5 of 10 filled" without historical event queries. Cheap (8 bytes). |
| `BuyOrderCancelledEvent` enrichment | Add `buyer`, `type_id`, `refund_amount` | Enables richer UI (order history, refund tracking) and better indexing without needing to correlate with post events. |
| `token_template` changes | Move.toml only (no source changes) | Template uses `local = "../market"` dep which auto-resolves. Address stays `0x0` since templates are always fresh-published. |
| Cross-market discovery | GraphQL type filtering (no on-chain registry) | `Market<T>` is generic over coin type T. GraphQL can filter by `{packageId}::market::Market<{coinType}>` to find all markets for a currency. |

## Implementation Phases

### Phase 1: Contract Changes -- market.move (buy order improvements)

1. **`contracts/market/sources/market.move`** -- Add fields to `BuyOrder` struct:
   ```move
   public struct BuyOrder has store, drop {
       order_id: u64,
       buyer: address,
       type_id: u64,
       price_per_unit: u64,
       quantity: u64,
       original_quantity: u64,
       posted_at_ms: u64,
   }
   ```

2. **`contracts/market/sources/market.move`** -- Update `post_buy_order` to take `&Clock` and store new fields:
   ```move
   public fun post_buy_order<T>(
       market: &mut Market<T>,
       payment: Coin<T>,
       type_id: u64,
       price_per_unit: u64,
       quantity: u64,
       clock: &Clock,
       ctx: &mut TxContext,
   )
   ```
   Set `original_quantity: quantity` and `posted_at_ms: clock.timestamp_ms()` in the `BuyOrder` record.

3. **`contracts/market/sources/market.move`** -- Enrich `BuyOrderPostedEvent`:
   ```move
   public struct BuyOrderPostedEvent has copy, drop {
       market_id: ID,
       order_id: u64,
       buyer: address,
       type_id: u64,
       price_per_unit: u64,
       quantity: u64,
       posted_at_ms: u64,
   }
   ```

4. **`contracts/market/sources/market.move`** -- Enrich `BuyOrderFilledEvent`. Note: this event is defined in market.move but never emitted there (fill logic is in ssu_market). Enriching it for consistency and future use:
   ```move
   public struct BuyOrderFilledEvent has copy, drop {
       market_id: ID,
       order_id: u64,
       seller: address,
       buyer: address,
       type_id: u64,
       price_per_unit: u64,
       quantity: u64,
       total_paid: u64,
   }
   ```

5. **`contracts/market/sources/market.move`** -- Enrich `BuyOrderCancelledEvent`:
   ```move
   public struct BuyOrderCancelledEvent has copy, drop {
       market_id: ID,
       order_id: u64,
       buyer: address,
       type_id: u64,
       refund_amount: u64,
   }
   ```
   Update `cancel_buy_order` to read buyer/type_id before removing, compute `refund_amount` from coin value, and emit enriched event.

6. **`contracts/market/sources/market.move`** -- Enrich `SellListingPostedEvent` with `posted_at_ms`:
   ```move
   public struct SellListingPostedEvent has copy, drop {
       market_id: ID,
       listing_id: u64,
       seller: address,
       ssu_id: ID,
       type_id: u64,
       price_per_unit: u64,
       quantity: u64,
       posted_at_ms: u64,
   }
   ```
   Update `post_sell_listing` to include `posted_at_ms: clock.timestamp_ms()` in the event.

7. **`contracts/market/sources/market.move`** -- Add read accessors:
   ```move
   public fun order_original_quantity(order: &BuyOrder): u64 { order.original_quantity }
   public fun order_posted_at_ms(order: &BuyOrder): u64 { order.posted_at_ms }
   ```

8. **`contracts/market/sources/market.move`** -- Update `test_buy_order_lifecycle` test: `post_buy_order` calls need `&clock` param. Verify `original_quantity` and `posted_at_ms` on the created order. Update `create_market` test assertion to still check `next_buy_id == 0`.

9. Build: `cd contracts/market && sui move build && sui move test`.

### Phase 2: Contract Changes -- ssu_market.move (visibility + bug fixes + event enrichment)

For both `contracts/ssu_market/sources/ssu_market.move` and `contracts/ssu_market_utopia/sources/ssu_market.move`:

**SsuConfig visibility flag:**

1. **Update `SsuConfig` struct** -- add visibility flag:
   ```move
   public struct SsuConfig has key {
       id: UID,
       ssu_id: ID,
       owner: address,
       delegates: vector<address>,
       market_id: Option<ID>,
       is_public: bool,
   }
   ```

2. **Update `create_ssu_config`** -- initialize new field:
   ```move
   let config = SsuConfig {
       // ... existing fields ...
       is_public: false,
   };
   ```

3. **Add `set_visibility` function** -- owner only:
   ```move
   public fun set_visibility(
       config: &mut SsuConfig,
       is_public: bool,
       ctx: &TxContext,
   ) {
       assert!(ctx.sender() == config.owner, ENotOwner);
       config.is_public = is_public;

       event::emit(VisibilitySetEvent {
           config_id: object::id(config),
           ssu_id: config.ssu_id,
           is_public,
       });
   }
   ```

4. **Add `VisibilitySetEvent`:**
   ```move
   public struct VisibilitySetEvent has copy, drop {
       config_id: ID,
       ssu_id: ID,
       is_public: bool,
   }
   ```

5. **Add read accessor:**
   ```move
   public fun config_is_public(config: &SsuConfig): bool { config.is_public }
   ```

**Error codes:**

6. **Add error code** `ETypeMismatch` (code = 9):
   ```move
   #[error(code = 9)]
   const ETypeMismatch: vector<u8> = b"Item type does not match buy order type";
   ```

**Fee and error fixes:**

7. **Fix fee calculation** in `buy_from_listing` (line 415), `player_fill_buy_order` (line 474), and `fill_buy_order` (line 539) -- change:
   ```move
   let fee_amount = total_price / 10000 * fee_bps;
   ```
   to:
   ```move
   let fee_amount = total_price * fee_bps / 10000;
   ```

8. **Fix type mismatch error** in `player_fill_buy_order` -- change:
   ```move
   assert!(type_id == market::order_type_id(order), ESSUMismatch);
   ```
   to:
   ```move
   assert!(type_id == market::order_type_id(order), ETypeMismatch);
   ```

**Event enrichment:**

9. **Update `BuyOrderFilledEvent`** in ssu_market -- add `buyer` and `price_per_unit`:
   ```move
   public struct BuyOrderFilledEvent has copy, drop {
       config_id: ID,
       ssu_id: ID,
       order_id: u64,
       type_id: u64,
       quantity: u64,
       total_paid: u64,
       price_per_unit: u64,
       seller: address,
       buyer: address,
   }
   ```
   Update both `player_fill_buy_order` and `fill_buy_order` to read buyer from the order (already available via `market::order_buyer(order)`) and emit the enriched event.

10. Build both: `cd contracts/ssu_market && sui move build` and `cd contracts/ssu_market_utopia && sui move build`.

### Phase 3: Publish Contracts

1. **Prepare `contracts/market/Move.toml` for fresh publish** -- Remove `published-at` line and set `market = "0x0"`.
2. **Publish `market`** -- `sui client publish contracts/market` (fresh publish, not upgrade).
3. **Update `contracts/market/Move.toml`** -- Set new `published-at` and `market` address from publish output.
4. **Prepare `contracts/ssu_market/Move.toml`** -- The `market` dep is `local = "../market"` so it auto-resolves to the newly-published market. Remove `published-at` line and set `ssu_market = "0x0"`.
5. **Publish `ssu_market` (stillness)** -- `sui client publish contracts/ssu_market`.
6. **Update `contracts/ssu_market/Move.toml`** -- Set new `published-at` and `ssu_market` address from publish output.
7. **Prepare `contracts/ssu_market_utopia/Move.toml`** -- Remove `published-at` line, set `ssu_market = "0x0"`.
8. **Publish `ssu_market_utopia`** -- `sui client publish contracts/ssu_market_utopia`.
9. **Update `contracts/ssu_market_utopia/Move.toml`** -- Set new `published-at` and `ssu_market` address from publish output.

Note: `token_template/Move.toml` uses `market = { local = "../market" }` and `token_template = "0x0"` -- no changes needed since templates are always published fresh with `0x0` addresses.

### Phase 4: Chain-Shared Updates

**Type updates:**

1. **`packages/chain-shared/src/types.ts`** -- Update `MarketBuyOrder`:
   ```typescript
   export interface MarketBuyOrder {
       orderId: number;
       buyer: string;
       typeId: number;
       pricePerUnit: bigint;
       quantity: number;
       originalQuantity: number;
       postedAtMs: number;
   }
   ```

2. **`packages/chain-shared/src/types.ts`** -- Update `MarketSellListing.pricePerUnit` to `bigint`:
   ```typescript
   export interface MarketSellListing {
       listingId: number;
       seller: string;
       ssuId: string;
       typeId: number;
       pricePerUnit: bigint;
       quantity: number;
       postedAtMs: number;
   }
   ```

3. **`packages/chain-shared/src/types.ts`** -- Update `SsuConfigInfo`:
   ```typescript
   export interface SsuConfigInfo {
       objectId: string;
       owner: string;
       ssuId: string;
       delegates: string[];
       marketId: string | null;
       isPublic: boolean;
   }
   ```

4. **`packages/chain-shared/src/types.ts`** -- Add new type:
   ```typescript
   export interface CrossMarketListing extends MarketSellListing {
       marketId: string;
       coinType: string;
       ssuConfigId: string;
   }
   ```

**Query updates:**

5. **`packages/chain-shared/src/market.ts`** -- Update `queryMarketBuyOrders`:
   - Use `BigInt(fields.price_per_unit ?? 0)` instead of `Number()`.
   - Read `original_quantity` and `posted_at_ms` from the dynamic field.
   - Map to updated `MarketBuyOrder` with all new fields.

6. **`packages/chain-shared/src/market.ts`** -- Update `queryMarketListings`:
   - Use `BigInt(fields.price_per_unit ?? 0)` instead of `Number()`.

7. **`packages/chain-shared/src/market.ts`** -- Add `queryAllListingsForCurrency`:
   ```typescript
   export async function queryAllListingsForCurrency(
       client: SuiGraphQLClient,
       marketPackageId: string,
       ssuMarketPackageId: string,
       coinType: string,
   ): Promise<CrossMarketListing[]>
   ```
   Discovers all `Market<coinType>` objects via `queryMarkets`, then queries listings on each. For each listing, discovers the SsuConfig for the listing's `ssuId` to check `isPublic`. Returns only listings at public SSUs, enriched with `marketId`, `coinType`, and `ssuConfigId`.

**TX builder updates:**

8. **`packages/chain-shared/src/market.ts`** -- Update `buildPostBuyOrder`:
   - Change `paymentObjectId: string` to `coinObjectIds: string[]` and add `totalAmount: bigint`.
   - Implement merge+split pattern for coins.
   - Add `tx.object("0x6")` (Clock) as final argument.
   - Change `pricePerUnit` to `bigint`.

9. **`packages/chain-shared/src/market.ts`** -- Update `PostSellListingParams.pricePerUnit` to `bigint`, `UpdateSellListingParams.pricePerUnit` to `bigint`.

10. **`packages/chain-shared/src/ssu-market.ts`** -- Update `buildBuyFromListing`:
    - Change `paymentObjectId: string` to `coinObjectIds: string[]`.
    - Implement merge pattern: merge all coins into base coin, pass base coin directly.
    - Change `pricePerUnit` to `bigint` in `EscrowAndListParams`.

11. **`packages/chain-shared/src/ssu-market.ts`** -- Add visibility TX builder:
    ```typescript
    export function buildSetVisibility(params: SetVisibilityParams): Transaction
    ```

12. **`packages/chain-shared/src/ssu-market.ts`** -- Update `querySsuConfig` to return `isPublic` from the `SsuConfig` object.

13. **`packages/chain-shared/src/config.ts`** -- Update all package IDs for both tenants:
    - `market.packageId` to new market package.
    - `ssuMarket.packageId` to new ssu_market package.
    - `ssuMarket.originalPackageId` to new ssu_market package (fresh publish = new original).
    - Add old `originalPackageId` values to `previousOriginalPackageIds`.

14. **`packages/chain-shared/src/index.ts`** -- Export new types and functions.

### Phase 5: Dapp Updates -- ssu-dapp

1. **`apps/ssu-dapp/src/hooks/useBuyOrders.ts`** -- Major rewrite:
   - Remove event-based timestamp workaround (remove `queryEventsGql` import, `timestampMap` logic, try/catch block).
   - Read `postedAtMs` and `originalQuantity` directly from the query result (now returned by `queryMarketBuyOrders`).
   - `BuyOrderWithName` interface becomes `interface BuyOrderWithName extends MarketBuyOrder { name: string; }` (no extra `postedAtMs` field -- it's in `MarketBuyOrder` now).

2. **`apps/ssu-dapp/src/hooks/useSsuConfig.ts`** -- Add visibility field:
   - Add `isPublic: boolean` to `SsuConfigResult` interface.
   - Map from `querySsuConfig` result which now returns this field.

3. **`apps/ssu-dapp/src/components/CreateBuyOrderDialog.tsx`** -- Replace coin selector:
   - Remove `paymentObjectId` state, auto-select `useEffect`, and `<select>` dropdown.
   - Compute total balance: `const totalBalance = ownedCoins?.reduce((sum, c) => sum + c.balance, 0n) ?? 0n;`.
   - Display "Balance: X SYMBOL" (read-only) instead of dropdown.
   - Warn if `totalBalance < totalBaseUnits` (insufficient balance).
   - Fix line 119: change `pricePerUnit: Number(priceBaseUnits)` to `pricePerUnit: priceBaseUnits` (now bigint).
   - Call `buildPostBuyOrder` with `coinObjectIds: ownedCoins.map(c => c.objectId)` and `totalAmount: totalBaseUnits`.

4. **`apps/ssu-dapp/src/components/ListingCard.tsx`** -- Use merged coin builder + BigInt fixes:
   - Line 45: `listing.pricePerUnit * quantity` fails (bigint * number). Change to `listing.pricePerUnit * BigInt(quantity)`.
   - Line 74: Replace `paymentObjectId: ""` with coin merge pattern. Add `useQuery` for `queryOwnedCoins` to fetch all coins, then pass `coinObjectIds: ownedCoins.map(c => c.objectId)`.
   - `formatBaseUnits` calls on lines 48-49 already accept `bigint` -- no change needed there.

5. **`apps/ssu-dapp/src/components/FillBuyOrderDialog.tsx`** -- BigInt arithmetic:
   - Line 47: `totalPaymentBase = order.pricePerUnit * qty` fails when `pricePerUnit` is bigint. Change to `order.pricePerUnit * BigInt(qty)`.
   - Line 52: `fmtAmount(baseUnits: number)` type signature -> `fmtAmount(baseUnits: number | bigint)`. The underlying `formatBaseUnits` already accepts `number | bigint`.
   - Line 172: `totalPaymentBase > 0` -> `totalPaymentBase > 0n` (bigint comparison).

6. **`apps/ssu-dapp/src/components/MarketContent.tsx`** -- Major updates:
   - Line 77: `fmtPrice(baseUnits: number)` -> `fmtPrice(baseUnits: number | bigint)`. The underlying `formatBaseUnits` already accepts both.
   - Line 165: `fmtPrice(order.pricePerUnit)` works without change once `fmtPrice` accepts bigint.
   - Line 170: `fmtPrice(order.pricePerUnit * order.quantity)` fails -- bigint * number. Change to `fmtPrice(order.pricePerUnit * BigInt(order.quantity))`.
   - Cancel buy order handler passes `marketId` (unchanged -- buy orders still on Market).

7. **`apps/ssu-dapp/src/components/ListingAdminList.tsx`** -- Change `pricePerUnit: Number(priceBase)` to `pricePerUnit: priceBase` (ensure `priceBase` is `bigint`).

8. **`apps/ssu-dapp/src/components/SellDialog.tsx`** -- Change `pricePerUnit: Number(priceBaseUnits)` to `pricePerUnit: priceBaseUnits` (bigint). No location params needed (SSU-level covers it).

9. **`apps/ssu-dapp/src/components/VisibilitySettings.tsx`** (new) -- Simple visibility toggle for SSU admin:
   - Shown in `SsuView.tsx` for SSU owner when `ssuConfig` exists.
   - Toggle switch for public/private visibility.
   - Optionally queries `LocationRegistry` for the SSU's assembly ID and displays coordinates if the SSU is public and the location has been published in-game.
   - Calls `buildSetVisibility` on save with `{ isPublic }`.
   - Depends on `@tehfrontier/chain-shared` for `buildSetVisibility`.

10. **`apps/ssu-dapp/src/views/SsuView.tsx`** -- Render `VisibilitySettings` for SSU owners when `ssuConfig` is available.

### Phase 6: Dapp Updates -- ssu-market-dapp + periscope

1. **`apps/ssu-market-dapp/src/lib/constants.ts`** -- Update `SSU_MARKET_PACKAGE_ID` and `MARKET_PACKAGE_ID` to new values.

2. **`apps/ssu-market-dapp/src/components/PostBuyOrderForm.tsx`** -- Major update:
   - Add coin query (import `queryOwnedCoins`).
   - Replace manual `paymentObjectId` text input with total balance display.
   - Add decimal-aware price input.
   - Use updated `buildPostBuyOrder` with `coinObjectIds` array.
   - Fix `totalCost` calculation to use `BigInt`.

3. **`apps/ssu-market-dapp/src/components/PostSellListingForm.tsx`** -- Change `pricePerUnit: Number(pricePerUnit)` to `pricePerUnit: BigInt(pricePerUnit)`.

4. **`apps/ssu-market-dapp/src/components/ListingCard.tsx`** -- Update:
   - Add coin merge pattern for buy flow (replace `paymentObjectId: ""`).
   - Display prices using `formatBaseUnits`.

5. **`apps/ssu-market-dapp/src/components/OwnerView.tsx`** -- Change `pricePerUnit: Number(editPrice)` to `pricePerUnit: BigInt(editPrice)`.

6. **`apps/ssu-market-dapp/src/components/MarketDetail.tsx`** -- Display improvements:
   - `listing.pricePerUnit.toLocaleString()` -> proper `formatBaseUnits` call.
   - `order.pricePerUnit.toLocaleString()` -> proper `formatBaseUnits` call.
   - Show `originalQuantity` and `postedAtMs` for buy orders.

7. **`apps/periscope/src/chain/config.ts`** -- Update `EXTENSION_TEMPLATES` ssu_market `packageIds` for both tenants.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/market/sources/market.move` | Modify | Add `original_quantity` + `posted_at_ms` to `BuyOrder`. Update `post_buy_order` to take `&Clock`. Enrich `BuyOrderPostedEvent`, `BuyOrderFilledEvent`, `BuyOrderCancelledEvent`, `SellListingPostedEvent`. Add read accessors. Update tests. |
| `contracts/market/Move.toml` | Modify | New `published-at` and `market` address after fresh publish |
| `contracts/ssu_market/sources/ssu_market.move` | Modify | Add `is_public: bool` to `SsuConfig`. Add `set_visibility` function. Fix fee calc. Add `ETypeMismatch`. Enrich `BuyOrderFilledEvent`. Add `VisibilitySetEvent`. |
| `contracts/ssu_market/Move.toml` | Modify | New `published-at` + `ssu_market` address |
| `contracts/ssu_market_utopia/sources/ssu_market.move` | Modify | Same changes as stillness variant |
| `contracts/ssu_market_utopia/Move.toml` | Modify | New `published-at` + address |
| `packages/chain-shared/src/types.ts` | Modify | `pricePerUnit` -> `bigint` on `MarketBuyOrder` + `MarketSellListing`. Add `postedAtMs` + `originalQuantity` to `MarketBuyOrder`. Add `isPublic` to `SsuConfigInfo`. Add `CrossMarketListing` type. |
| `packages/chain-shared/src/market.ts` | Modify | Update `queryMarketBuyOrders` for new fields + `BigInt`. Update `queryMarketListings` for `BigInt`. Add `queryAllListingsForCurrency`. Update `buildPostBuyOrder` with coin merge + Clock. Update `pricePerUnit` to `bigint` in builders. |
| `packages/chain-shared/src/ssu-market.ts` | Modify | `coinObjectIds` merge in `buildBuyFromListing`. `bigint` for `pricePerUnit`. Add `buildSetVisibility`. Update `querySsuConfig` for `isPublic`. |
| `packages/chain-shared/src/config.ts` | Modify | All new package IDs for both tenants |
| `packages/chain-shared/src/index.ts` | Modify | Export new types and functions |
| `apps/ssu-dapp/src/hooks/useBuyOrders.ts` | Modify | Remove event workaround. Read `postedAtMs` + `originalQuantity` directly from query. |
| `apps/ssu-dapp/src/hooks/useSsuConfig.ts` | Modify | Add `isPublic` to `SsuConfigResult`. |
| `apps/ssu-dapp/src/components/CreateBuyOrderDialog.tsx` | Modify | Replace coin selector with balance display + merged TX. |
| `apps/ssu-dapp/src/components/ListingCard.tsx` | Modify | Use merged coin builder, `BigInt` arithmetic |
| `apps/ssu-dapp/src/components/FillBuyOrderDialog.tsx` | Modify | `BigInt` arithmetic for payment calculation. |
| `apps/ssu-dapp/src/components/MarketContent.tsx` | Modify | `BigInt`-safe price formatting. |
| `apps/ssu-dapp/src/components/ListingAdminList.tsx` | Modify | `pricePerUnit` now `bigint`, update `Number()` -> direct pass |
| `apps/ssu-dapp/src/components/SellDialog.tsx` | Modify | `pricePerUnit` now `bigint` |
| `apps/ssu-dapp/src/components/VisibilitySettings.tsx` | Create | Simple public/private toggle for SSU admin, optional LocationRegistry coordinate display |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Modify | Render VisibilitySettings for SSU owners |
| `apps/ssu-market-dapp/src/lib/constants.ts` | Modify | Update package IDs |
| `apps/ssu-market-dapp/src/components/PostBuyOrderForm.tsx` | Modify | Add coin query + merge, decimal formatting |
| `apps/ssu-market-dapp/src/components/PostSellListingForm.tsx` | Modify | `pricePerUnit: Number()` -> `BigInt()` |
| `apps/ssu-market-dapp/src/components/ListingCard.tsx` | Modify | Coin merge for buy, decimal formatting |
| `apps/ssu-market-dapp/src/components/OwnerView.tsx` | Modify | `pricePerUnit: Number()` -> `BigInt()` |
| `apps/ssu-market-dapp/src/components/MarketDetail.tsx` | Modify | Decimal-aware price display, show `originalQuantity` + `postedAtMs` for buy orders |
| `apps/periscope/src/chain/config.ts` | Modify | Update EXTENSION_TEMPLATES ssu_market packageIds |

## Open Questions

None -- fresh publish approach eliminates all upgrade compatibility concerns. Buy orders stay on Market<T> with struct improvements. Visibility is a simple boolean on SsuConfig. Public SSU locations come from the game's LocationRegistry. Cross-market queries filter by `isPublic`. Private location sharing is deferred to Plan 23.

## Deferred

- **Order expiry / TTL** -- Adds complexity (scheduled cleanup or lazy expiry checks). Not needed for testnet MVP. Can be added in a future republish.
- **Coin merging for periscope Finance view** -- Finance view has its own buy flow that also needs coin merging, but is out of scope for this plan.
- **Create new test currencies after publish** -- Handled manually via token factory after contracts are deployed.
- **`ssu-market-dapp` `characterObjectId: ""` TODO** -- The `ListingCard.tsx` in ssu-market-dapp has `characterObjectId: ""` which needs to be resolved from the chain via wallet address. Separate issue.
- **`number` -> `bigint` for `quantity` fields** -- Quantity values are unlikely to exceed 2^53 in practice (game item quantities). Deferred to avoid unnecessary churn.
- **Market<T> `create_market` with custom fee** -- Currently `create_market` always sets `fee_bps: 0`. A `create_market_with_fee` variant could be useful but isn't needed now.
- **Cross-market browse UI** -- This plan adds the contract fields and chain-shared query layer for cross-market currency browsing. A dedicated "Market Browser" view is a separate plan.
- **Parallel cross-market queries** -- `queryAllListingsForCurrency` queries markets sequentially. `Promise.all` could parallelize. Deferred since testnet has <20 markets per currency.
- **Private location sharing and encrypted map system** -- See Plan 23 (Private Map System).
