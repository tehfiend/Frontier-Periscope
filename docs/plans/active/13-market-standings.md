# Plan: Market Standings -- Standings-Based Token Market

**Status:** Ready for execution
**Created:** 2026-03-23
**Module:** contracts, chain-shared

## Overview

The current `market` contract (`contracts/market/sources/market.move`) uses an address-based allowlist (`authorized: vector<address>`) for minting authorization -- the market creator manually adds wallet addresses that are allowed to mint tokens. This works but has no relationship to the diplomatic standings system. There is no standings check on trading (posting sell listings / buy orders) either -- anyone can trade.

The `market_standings` contract replaces this with standings-based authorization powered by the already-deployed `StandingsRegistry`. Instead of maintaining a separate address list, the market references a `StandingsRegistry` and uses configurable u8 thresholds: `min_mint` (minimum standing to mint tokens), `min_trade` (minimum standing to post sell listings), and `min_buy` (minimum standing to buy from listings or post buy orders). This integrates token economies directly into the diplomatic framework -- faction leaders can restrict their token minting and trading to trusted allies, while hostile characters are automatically excluded. The market creator still serves as admin for fee configuration and threshold management, but authorization decisions are delegated to the registry.

This is a big-bang replacement, not an upgrade. A new contract package `contracts/market_standings/` is published alongside a new `contracts/token_template_standings/` (since `token_template` calls `market::create_market()` in its `init()` and must be re-pointed). The existing `market` and `token_template` packages remain on-chain for backward compatibility but are no longer the active path. The `ssu_market` / `ssu_market_utopia` contracts depend on `market::market::Market<T>` -- they will need standings-aware variants (`ssu_market_standings` / `ssu_market_standings_utopia`) that import `market_standings` instead.

## Current State

### market contract (`contracts/market/sources/market.move`)
- `Market<T>` shared object: `creator`, `authorized: vector<address>`, `treasury_cap: TreasuryCap<T>`, `fee_bps`, `fee_recipient`, `next_sell_id`, `next_buy_id`
- Minting: `mint()` checks `authorized.contains(&sender)` -- address allowlist
- Sell listings: `post_sell_listing()` -- anyone can post (no auth check)
- Buy orders: `post_buy_order()` -- anyone can post (no auth check)
- Write accessors (for ssu_market): `borrow_sell_listing_mut()`, `remove_sell_listing()`, `borrow_buy_order_mut()`, `remove_buy_order()`, `split_escrowed_coin()`, `remove_escrowed_coin()`
- Published at `0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a`
- Move.toml: depends only on Sui framework (no world dependency)

### token_template (`contracts/token_template/sources/token.move`)
- `init(witness, ctx)` calls `coin::create_currency()` then `market::create_market(treasury, ctx)`
- Published package bytecodes are patched at runtime to create custom tokens (module name, OTW, metadata vectors, decimals)
- Move.toml: depends on Sui + `market` (local)
- Published at `0x38e749bfd487ca48633df45126820e23eddfbba8e0fc391f0f7a748dcb665ccf`

### ssu_market / ssu_market_utopia (`contracts/ssu_market_utopia/sources/ssu_market.move`)
- `SsuConfig` shared object: links SSU to Market<T> by ID, owner + delegates authorization
- Trade functions call `market::borrow_sell_listing()`, `market::remove_sell_listing()`, `market::split_escrowed_coin()`, etc. as public accessors on Market<T>
- Transfer functions (admin_to_escrow, player_to_escrow, etc.) work without market link
- Two copies: `contracts/ssu_market/` (world_stillness dep) and `contracts/ssu_market_utopia/` (world_utopia dep)
- Move.toml: depends on Sui + world + market

### standings_registry (`contracts/standings_registry/`)
- `StandingsRegistry` shared object: `owner`, `admins`, `name`, `ticker`, `default_standing: u8`
- Per-entity standings as dynamic fields: `TribeKey { tribe_id: u32 } -> u8`, `CharKey { char_id: u64 } -> u8`
- `get_standing(registry, tribe_id, char_id): u8` -- character > tribe > default priority lookup
- Published at `0x7d3864e7d1c1c0573cdbc044bffdb0711100f5461910c086777580d005c76341`
- Move.toml: depends only on Sui framework (no world dependency)

### Standings integration pattern (reference: gate_standings, ssu_standings)
- Contract takes `&StandingsRegistry` as function parameter
- Extracts `tribe_id` and `char_id` from `&Character` via `character.tribe()` and `in_game_id::item_id(&character.key())`
- Calls `standings_registry::get_standing(registry, tribe_id, char_id)`
- Compares result against configurable threshold
- Requires world contracts dependency for `Character` access

### chain-shared
- `packages/chain-shared/src/market.ts` -- TX builders for all market operations + query functions
- `packages/chain-shared/src/ssu-market.ts` -- TX builders for SSU trade execution
- `packages/chain-shared/src/standings-registry.ts` -- TX builders for registry management
- `packages/chain-shared/src/config.ts` -- `CONTRACT_ADDRESSES` with `market`, `ssuMarket`, `tokenTemplate`, `standingsRegistry` entries
- `packages/chain-shared/src/types.ts` -- `ContractAddresses` interface, `MarketInfo`, `MarketSellListing`, `MarketBuyOrder`

## Target State

### 1. market_standings contract (`contracts/market_standings/sources/market_standings.move`)

A new standalone contract (no world dependency). Mirrors the `market` module API but replaces the `authorized: vector<address>` field with standings-based configuration.

**Shared object: `Market<T>`**
```
Market<T> {
    id: UID,
    creator: address,
    treasury_cap: TreasuryCap<T>,
    fee_bps: u64,
    fee_recipient: address,
    next_sell_id: u64,
    next_buy_id: u64,
    registry_id: ID,       // which StandingsRegistry to reference
    min_mint: u8,           // minimum standing to mint (0-6)
    min_trade: u8,          // minimum standing to post sell listings (0-6)
    min_buy: u8,            // minimum standing to buy from listings / post buy orders (0-6)
}
```

**Key difference from `market`:** No `authorized: vector<address>`. Instead, `registry_id`, `min_mint`, `min_trade`, `min_buy`.

**Standing check approach:** No world dependency. The market contract stays lightweight and composable. The caller passes `&StandingsRegistry`, `tribe_id: u32`, and `char_id: u64`. The ssu_market_standings contract (which already has world dep) extracts IDs from `&Character` and passes them. For direct market calls (e.g., CLI minting), the caller provides their own IDs. The contract verifies `registry_id` matches but trusts the caller-provided tribe/char IDs.

**Three-threshold model:**
- `min_mint` -- minimum standing to mint new tokens
- `min_trade` -- minimum standing to post sell listings (the seller's gate)
- `min_buy` -- minimum standing to buy from sell listings and to post buy orders (the buyer's gate)

This allows scenarios like "sell cheap fuel to allies but not enemies" by setting `min_buy` to a friendly standing while leaving `min_trade` lower. Buy orders also require `min_buy` because a buy order is a commitment to purchase -- hostile characters should not be able to post buy orders on a restricted market.

**Functions:**

- `create_market<T>(treasury_cap, registry_id, min_mint, min_trade, min_buy, ctx)` -- creates shared Market<T>. Registry ID stored but not verified at creation (caller must ensure it points to a valid StandingsRegistry).
- `mint<T>(market, registry, tribe_id, char_id, amount, recipient, ctx)` -- checks `standing >= min_mint`. Emits `MintEvent`.
- `burn<T>(market, coin, ctx)` -- any holder can burn (no standings check, same as current).
- `post_sell_listing<T>(market, registry, tribe_id, char_id, ssu_id, type_id, price_per_unit, quantity, clock, ctx)` -- checks `standing >= min_trade`. Emits `SellListingPostedEvent`.
- `update_sell_listing<T>(market, listing_id, price_per_unit, quantity, ctx)` -- seller only (no standings re-check; you already passed the check when posting).
- `cancel_sell_listing<T>(market, listing_id, ctx)` -- seller only (no standings check for cancellation).
- No standalone `buy_from_listing` on Market -- buying is orchestrated by `ssu_market_standings::buy_from_listing()` which calls the public `check_standing()` helper with `min_buy` before executing payment and item transfer. This matches the current pattern where `market` has no buy_from_listing function either.
- `post_buy_order<T>(market, registry, tribe_id, char_id, payment, type_id, price_per_unit, quantity, clock, ctx)` -- checks `standing >= min_buy`. Escrows payment. Emits `BuyOrderPostedEvent`.
- `cancel_buy_order<T>(market, order_id, ctx)` -- buyer only (no standings check for cancellation).
- `update_fee<T>(market, fee_bps, fee_recipient, ctx)` -- creator only.
- `update_standings_config<T>(market, registry_id, min_mint, min_trade, min_buy, ctx)` -- creator only. Allows changing the registry or thresholds.
- All existing read/write accessors for ssu_market integration: `borrow_sell_listing()`, `borrow_sell_listing_mut()`, `remove_sell_listing()`, `has_sell_listing()`, `borrow_buy_order()`, `borrow_buy_order_mut()`, `remove_buy_order()`, `has_buy_order()`, `split_escrowed_coin()`, `remove_escrowed_coin()`, field accessors.
- New read accessors: `market_registry_id()`, `market_min_mint()`, `market_min_trade()`, `market_min_buy()`.
- `check_standing(market, registry, tribe_id, char_id, threshold)` -- public helper that verifies `registry_id` matches and `get_standing() >= threshold`. Used internally and available for external callers.

**Events:** Same event structs as current market, plus:
- `StandingsConfigUpdatedEvent { market_id, registry_id, min_mint, min_trade, min_buy }`

**Error codes:** Same as current market (minus ENotAuthorized/EAlreadyAuthorized which are address-list errors), plus:
- `ERegistryMismatch` -- supplied registry does not match stored registry_id
- `EStandingTooLow` -- character's standing is below the required threshold

**Move.toml dependencies:**
- Sui framework
- standings_registry (local)

### 2. token_template_standings (`contracts/token_template_standings/sources/token.move`)

Identical to `token_template` but its `init()` calls `market_standings::create_market()` instead of `market::create_market()`. The bytecode patching system patches the same fields (module name, OTW, metadata vectors, decimals).

**Additional parameters needed at creation:** `registry_id`, `min_mint`, `min_trade`, `min_buy`. Since `init()` runs at publish time with no external arguments, these need to be baked into the bytecode as constants (same pattern as DECIMALS). The bytecode patcher replaces them.

```move
/// Sentinel: 32-byte vector, all zeros except last byte = 0x01.
/// Patcher replaces with actual registry ID bytes.
const REGISTRY_ID_BYTES: vector<u8> = x"0000000000000000000000000000000000000000000000000000000000000001";
const MIN_MINT: u8 = 251;   // sentinel (outside valid range 0-6), patched by client
const MIN_TRADE: u8 = 252;  // sentinel (outside valid range 0-6), patched by client
const MIN_BUY: u8 = 253;    // sentinel (outside valid range 0-6), patched by client

fun init(witness: TOKEN_TEMPLATE, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness, DECIMALS, b"TMPL", b"Template Token", b"A faction token",
        option::none(), ctx,
    );
    transfer::public_freeze_object(metadata);
    let registry_id = object::id_from_bytes(REGISTRY_ID_BYTES);
    market_standings::create_market(treasury, registry_id, MIN_MINT, MIN_TRADE, MIN_BUY, ctx);
}
```

Note: DECIMALS defaults to 9, and the four u8 sentinels (DECIMALS=9, MIN_MINT=251, MIN_TRADE=252, MIN_BUY=253) are all distinct, so the bytecode patcher's `update_constants` will not collide when replacing U8 constants.

**Move.toml dependencies:**
- Sui framework
- market_standings (local)

### 3. ssu_market_standings / ssu_market_standings_utopia

New variants of `ssu_market` that depend on `market_standings` instead of `market`. The API surface is identical -- same `SsuConfig`, same trade functions -- but all `Market<T>` references point to `market_standings::market_standings::Market<T>`.

**Key change in trade functions:** Functions like `player_escrow_and_list()` and `player_fill_buy_order()` that call `market::post_sell_listing()` internally now need to pass the standings parameters. Since these functions already take `&Character` (for SSU inventory operations), they can extract `tribe_id` and `char_id` and forward them to the market_standings functions. The `&StandingsRegistry` becomes an additional parameter on trade functions.

**Functions changed (new params: `registry: &StandingsRegistry`):**
- `escrow_and_list<T>()` -- adds registry + extracts character IDs for the market post_sell_listing call (checks `min_trade`)
- `player_escrow_and_list<T>()` -- same
- `buy_from_listing<T>()` -- adds registry + extracts buyer character IDs, calls market's `check_standing()` with `min_buy` threshold before executing the purchase
- `player_fill_buy_order<T>()` -- NO change needed (seller fills an existing order; the buyer already passed the `min_buy` check when posting)
- `fill_buy_order<T>()` -- NO change needed (same reasoning)

**Transfer functions unchanged:** `admin_to_escrow`, `player_to_escrow`, etc. do not touch Market<T> and are unaffected.

**Character ID extraction pattern (used in trade functions):**
```move
use world::in_game_id;
// Extract tribe_id and char_id from Character
let tribe_id = character.tribe();
let char_id = in_game_id::item_id(&character.key());
```

**Two copies needed:**
- `contracts/ssu_market_standings/` -- depends on world_stillness + market_standings
- `contracts/ssu_market_standings_utopia/` -- depends on world_utopia + market_standings

### 4. chain-shared Updates

**New file: `packages/chain-shared/src/market-standings.ts`**
- TX builders mirroring `market.ts` but targeting `market_standings::market_standings::*`
- `buildCreateMarketStandings()` -- includes registry_id, min_mint, min_trade, min_buy params
- `buildMintStandings()` -- includes registry object, tribe_id, char_id
- `buildPostSellListingStandings()` -- includes registry object, tribe_id, char_id
- `buildPostBuyOrderStandings()` -- includes registry object, tribe_id, char_id
- `buildUpdateStandingsConfig()` -- creator-only config update (includes min_buy)
- All other builders (cancel, update listing, burn, update fee) remain largely same
- Query functions: `queryMarketsStandings()`, `queryMarketStandingsDetails()` -- adapted for new struct fields (registryId, minMint, minTrade, minBuy instead of authorized)

**New file: `packages/chain-shared/src/ssu-market-standings.ts`**
- TX builders mirroring `ssu-market.ts` but targeting `ssu_market_standings::ssu_market::*` (or `ssu_market::ssu_market::*` depending on package naming)
- Trade functions that require standings add `registryId: string` param:
  - `buildEscrowAndListStandings()` -- adds registry param
  - `buildPlayerEscrowAndListStandings()` -- adds registry param
  - `buildBuyFromListingStandings()` -- adds registry param (for min_buy check)
- Functions without standings changes (cancel, fill_buy_order, transfers) mirror ssu-market.ts with updated package target
- SsuConfig management functions (create, add_delegate, etc.) are identical -- may re-export from ssu-market.ts or duplicate
- Query functions: `discoverSsuConfigStandings()` adapted for new package type

**Modify: `packages/chain-shared/src/types.ts`**
- Add `MarketStandingsInfo` interface (same shape as MarketInfo but with `registryId: string`, `minMint: number`, `minTrade: number`, `minBuy: number` instead of `authorized: string[]`)

**Modify: `packages/chain-shared/src/config.ts`**
- Add `marketStandings?: { packageId: string }` to `ContractAddresses`
- Add `tokenTemplateStandings?: { packageId: string }` to `ContractAddresses`
- Add `ssuMarketStandings?: { packageId: string; originalPackageId?: string; previousOriginalPackageIds?: string[] }` to `ContractAddresses`

**Modify: `packages/chain-shared/src/index.ts`**
- Export new `market-standings` module
- Export new `ssu-market-standings` module
- Export new `token-factory-standings` module

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New contract vs. upgrade | New contract (big bang) | Hackathon approach; no migration path needed for existing Market<T> objects. Existing markets keep working with the old contract. |
| World dependency | No world dependency (Option A) | Market stays lightweight and composable. Caller passes tribe_id + char_id. The ssu_market_standings contract (which already has world dep) extracts IDs from `&Character` and passes them. For direct calls, the caller provides their own IDs. Security concern of forged IDs is minimal: ssu_market_standings extracts from real Character, and direct mint is a creator-trusted operation. |
| Standing check on cancel/update | No standing check | If a player posted a listing when their standing was high enough, they should always be able to cancel or update it. Preventing cancellation would lock their escrowed assets. |
| Standing check on burn | No standing check | Any token holder should be able to burn. Restricting burn would lock tokens of characters whose standing later dropped. |
| Standing check on buy_from_listing | Standing check via `min_buy` threshold | Prevents hostile characters from benefiting from faction markets (e.g., buying cheap fuel). The seller gate (`min_trade`) controls who can post; the buyer gate (`min_buy`) controls who can purchase. This enables "sell cheap fuel to allies only" scenarios. |
| Standing check on post_buy_order | Standing check via `min_buy` threshold | A buy order is a commitment to purchase. Hostile characters should not be able to post buy orders on a restricted market. Uses the same `min_buy` threshold for consistency. |
| Standing check on fill_buy_order | No standing check | The seller is filling an existing buy order. The buyer already passed `min_buy` when posting. The seller receives payment, not market access -- no reason to gate. |
| Three-threshold model | `min_mint`, `min_trade`, `min_buy` | Three thresholds give faction leaders granular control. Common configs: (1) allies-only market: min_trade=4, min_buy=4; (2) sell to allies, buy from anyone: min_trade=4, min_buy=0; (3) public market with restricted minting: min_mint=5, min_trade=0, min_buy=0. |
| Event struct naming | Same names as current market | Downstream indexers and UIs pattern-match on event type names. Keeping names consistent reduces migration friction. The package ID in the event type distinguishes old vs. new. |
| Dependency structure | market_standings depends on standings_registry only (no world) | Keeps the market contract composable. The world dependency lives in ssu_market_standings, which already needs it for SSU inventory operations. |
| Bytecode patcher changes | Add REGISTRY_ID_BYTES, MIN_MINT, MIN_TRADE, MIN_BUY constants | Same pattern as existing DECIMALS constant. The patcher already handles vector<u8> and u8 constant replacement. Sentinel values 251/252/253 are chosen because they're outside the valid standing range 0-6 and won't collide with DECIMALS (default 9). |

## Implementation Phases

### Phase 1: market_standings contract
1. Create `contracts/market_standings/` directory with `Move.toml` and `sources/market_standings.move`
2. Move.toml: depend on Sui framework + standings_registry (local)
3. Implement `Market<T>` struct with `registry_id: ID`, `min_mint: u8`, `min_trade: u8`, `min_buy: u8` (no `authorized` field)
4. Implement `create_market<T>()` accepting treasury_cap + registry_id + min_mint + min_trade + min_buy
5. Implement internal `check_standing()` helper: takes `&Market<T>`, `&StandingsRegistry`, `tribe_id: u32`, `char_id: u64`, `threshold: u8`; asserts `object::id(registry) == market.registry_id` (ERegistryMismatch), calls `standings_registry::get_standing(registry, tribe_id, char_id)`, asserts result `>= threshold` (EStandingTooLow). Also expose as public for external callers.
6. Implement `mint<T>()` with standings check: takes `&StandingsRegistry` + tribe_id + char_id, calls `check_standing(market, registry, tribe_id, char_id, market.min_mint)`
7. Implement `burn<T>()` -- same as current (no standings check)
8. Implement `post_sell_listing<T>()` with standings check using `min_trade`
9. Implement `post_buy_order<T>()` with standings check using `min_buy` + escrow
10. Implement `update_sell_listing<T>()`, `cancel_sell_listing<T>()`, `cancel_buy_order<T>()` -- seller/buyer only, no standings re-check
11. Implement `update_fee<T>()` and `update_standings_config<T>()` -- creator only. `update_standings_config` accepts registry_id + min_mint + min_trade + min_buy.
12. Implement all read/write accessors matching current market API surface, plus new accessors: `market_registry_id()`, `market_min_mint()`, `market_min_trade()`, `market_min_buy()`
13. Implement `StandingsConfigUpdatedEvent` (includes min_buy field) and new error codes (ERegistryMismatch, EStandingTooLow)
14. Write tests: create market, mint with sufficient/insufficient standing, post sell listing with standings check, post buy order with standings check, check_standing with min_buy threshold, cancel listings, threshold updates

### Phase 2: token_template_standings contract
1. Create `contracts/token_template_standings/` directory with `Move.toml` and `sources/token.move`
2. Move.toml: depend on Sui framework + market_standings (local). Note: market_standings transitively depends on standings_registry, so no direct dep needed.
3. Copy `token_template` init pattern, replace `market::create_market()` with `market_standings::market_standings::create_market()`
4. Add constants for bytecode patcher: `REGISTRY_ID_BYTES: vector<u8>` (32-byte sentinel `x"00...01"`), `MIN_MINT: u8 = 251`, `MIN_TRADE: u8 = 252`, `MIN_BUY: u8 = 253`. Four distinct U8 sentinel values (plus DECIMALS=9) ensure the patcher's `update_constants` won't collide.
5. Build the template package, extract the compiled `.mv` bytecodes, base64-encode for embedding
6. Create `packages/chain-shared/src/token-factory-standings.ts` -- new file mirroring `token-factory.ts` but with additional constant patches for registry_id, min_mint, min_trade, min_buy. Uses different embedded bytecodes (from token_template_standings build). Different publish dependencies (market_standings package ID instead of market).

### Phase 3: ssu_market_standings contracts
1. Create `contracts/ssu_market_standings/` -- copy `ssu_market` source, change imports from `market::market` to `market_standings::market_standings`
2. Move.toml: depend on Sui + world_stillness + market_standings + standings_registry. The standings_registry dependency is needed because trade functions now take `&StandingsRegistry` as a parameter (it's a type from that package, not just transitively used).
3. Add `use standings_registry::standings_registry::StandingsRegistry` and `use world::in_game_id` imports
4. Update `escrow_and_list` and `player_escrow_and_list` to accept `registry: &StandingsRegistry` and forward `character.tribe()` / `in_game_id::item_id(&character.key())` to the market_standings `post_sell_listing` call (which checks `min_trade`)
5. Update `buy_from_listing` to accept `registry: &StandingsRegistry` + `buyer_character: &Character` (already has buyer_character). Extract tribe_id/char_id from buyer_character, call `market_standings::check_standing(market, registry, tribe_id, char_id, market_standings::market_min_buy(market))` before executing the purchase. The rest of the buy logic (payment splitting, item transfer) remains the same.
6. `player_fill_buy_order`, `fill_buy_order` -- import path changes (Market<T> from market_standings) but no standings params added. The buyer already passed `min_buy` when posting the order.
7. Transfer functions (`admin_to_escrow`, `player_to_escrow`, etc.) remain unchanged -- they use `StorageUnit` operations only
8. Create `contracts/ssu_market_standings_utopia/` -- identical source, Move.toml references world_utopia instead of world_stillness
9. Verify both compile with `sui move build`

### Phase 4: chain-shared integration
1. Create `packages/chain-shared/src/market-standings.ts` -- TX builders for all market_standings functions. Pattern: mirror `market.ts` structure, add `registryId: string`, `tribeId: number`, `charId: number` params to mint/post functions.
2. Create `packages/chain-shared/src/ssu-market-standings.ts` -- TX builders for ssu_market_standings trade functions. Pattern: mirror `ssu-market.ts` structure, add `registryId: string` to trade functions that need standings checks (escrow_and_list, player_escrow_and_list, buy_from_listing). Non-standings functions (cancel, fill_buy_order, transfers) update package target only.
3. Create `packages/chain-shared/src/token-factory-standings.ts` -- bytecode patcher for the new template. Embed compiled `.mv` from token_template_standings build. Add `registryId`, `minMint`, `minTrade`, `minBuy` to `CreateTokenParams`. Publish dependencies reference market_standings package ID. The patcher calls `update_constants` for each:
   - REGISTRY_ID_BYTES: `bcs.vector(bcs.u8()).serialize(registryIdBytes).toBytes()` with `"Vector(U8)"` type
   - MIN_MINT: `new Uint8Array([minMint])` old=`new Uint8Array([251])` with `"U8"` type
   - MIN_TRADE: `new Uint8Array([minTrade])` old=`new Uint8Array([252])` with `"U8"` type
   - MIN_BUY: `new Uint8Array([minBuy])` old=`new Uint8Array([253])` with `"U8"` type
4. Add `MarketStandingsInfo` type to `types.ts`: same shape as `MarketInfo` but with `registryId: string`, `minMint: number`, `minTrade: number`, `minBuy: number` instead of `authorized: string[]`.
5. Add `marketStandings`, `tokenTemplateStandings`, `ssuMarketStandings` to `ContractAddresses` interface in `types.ts` and populate empty entries in `config.ts`.
6. Export `market-standings`, `ssu-market-standings`, and `token-factory-standings` from `index.ts`.

### Phase 5: Publish and configure
1. Build all four new contract packages
2. Publish `market_standings` -- record package ID
3. Publish `token_template_standings` -- record package ID
4. Publish `ssu_market_standings` (stillness) -- record package ID
5. Publish `ssu_market_standings_utopia` (utopia) -- record package ID
6. Update `config.ts` with published package IDs
7. Create a test token using the new template to verify end-to-end flow

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/market_standings/Move.toml` | Create | Package manifest: Sui + standings_registry deps |
| `contracts/market_standings/sources/market_standings.move` | Create | Standings-based market contract (~650 lines) |
| `contracts/token_template_standings/Move.toml` | Create | Package manifest: Sui + market_standings deps |
| `contracts/token_template_standings/sources/token.move` | Create | Token template using market_standings::create_market |
| `contracts/ssu_market_standings/Move.toml` | Create | Package manifest: Sui + world_stillness + market_standings + standings_registry |
| `contracts/ssu_market_standings/sources/ssu_market.move` | Create | SSU market extension using market_standings (Stillness) |
| `contracts/ssu_market_standings_utopia/Move.toml` | Create | Package manifest: Sui + world_utopia + market_standings + standings_registry |
| `contracts/ssu_market_standings_utopia/sources/ssu_market.move` | Create | SSU market extension using market_standings (Utopia) |
| `packages/chain-shared/src/market-standings.ts` | Create | TX builders + queries for market_standings |
| `packages/chain-shared/src/ssu-market-standings.ts` | Create | TX builders for ssu_market_standings trade + transfer functions |
| `packages/chain-shared/src/token-factory-standings.ts` | Create | Bytecode patcher for token_template_standings |
| `packages/chain-shared/src/types.ts` | Modify | Add MarketStandingsInfo, extend ContractAddresses |
| `packages/chain-shared/src/config.ts` | Modify | Add marketStandings/tokenTemplateStandings/ssuMarketStandings entries |
| `packages/chain-shared/src/index.ts` | Modify | Export market-standings, ssu-market-standings, and token-factory-standings |

## Open Questions

All resolved.

## Deferred

- **Market migration tooling** -- No automatic migration from existing Market<T> objects to market_standings Market<T>. Token creators deploy new markets; existing markets remain operational on the old contract.
- **Periscope UI for market_standings configuration** -- The Periscope token factory UI currently supports the old market. Updating it to offer standings-based markets is a separate UI task.
- **ssu-dapp updates** -- The ssu-dapp currently interacts with `market` and `ssu_market`. Updating it to support `market_standings` and `ssu_market_standings` is a separate task.
