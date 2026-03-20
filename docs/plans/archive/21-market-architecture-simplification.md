# Plan: Market Architecture Simplification

**Status:** Complete
**Created:** 2026-03-19
**Completed:** 2026-03-19
**Module:** contracts, chain-shared, ssu-dapp, ssu-market-dapp, periscope

## Overview

The SSU market system currently uses four separate on-chain object types spread across three contract packages: `MarketConfig` + `OrgMarket` (in `ssu_market`), `CurrencyMarket<T>` (in `currency_market`), and `Organization` + `OrgTreasury<T>` (in `governance` / `governance_ext`). This creates unnecessary indirection -- a token creator must publish a token, create an Organization, deposit the TreasuryCap into an OrgTreasury, create a CurrencyMarket, and create MarketConfig/OrgMarket objects. Five separate transactions before a single trade can occur.

This plan unifies everything into a single `Market<T>` object that contains the `TreasuryCap<T>`, an order book (sell listings + buy orders), an authorized-minters list, and fee configuration. The token template is updated so that publishing a token automatically creates and shares a `Market<T>` -- one transaction produces a fully functional currency with a built-in marketplace. Three contract packages (`governance`, `governance_ext`, `currency_market`) are deleted entirely. The `currency_market` directory is replaced by a new `market` contract.

The `ssu_market` contract replaces `MarketConfig` with `SsuConfig` -- a per-SSU configuration object with `owner: address`, `delegates: vector<address>`, and `market_id: Option<ID>`. The owner can delegate SSU management to other addresses, and the market link is optional (set later when connecting to a Market). Transfer functions check owner OR delegate authorization. Trade execution functions require the market_id to be set and take `&mut Market<T>` instead of `&mut CurrencyMarket<T>`. This is a test environment with no upgrade constraints -- everything is published fresh.

## Current State

### On-Chain Objects (4 types across 4 packages)

1. **MarketConfig** (`ssu_market::ssu_market`) -- per-SSU config with `admin: address`, `ssu_id: ID`. Dynamic fields: `SellOrder` (keyed by type_id), legacy `Listing`. Used for sell orders, inventory transfers, and admin authorization.
   - File: `contracts/ssu_market/sources/ssu_market.move`

2. **OrgMarket** (`ssu_market::ssu_market`) -- per-org buy order manager with `org_id: ID`, `admin: address`, `authorized_ssus: vector<ID>`. Dynamic fields: `BuyOrder` (keyed by order_id), escrowed `Coin<T>` (keyed by order_id + 1B offset).
   - File: `contracts/ssu_market/sources/ssu_market.move`

3. **CurrencyMarket\<T\>** (`currency_market::currency_market`) -- per-currency global order book with `creator: address`, `fee_bps: u64`, `fee_recipient: address`. Dynamic fields: `SellListing` (keyed by sell_id), `BuyOrder` (keyed by buy_id), escrowed `Coin<T>` (keyed by buy_id + 1B offset).
   - File: `contracts/currency_market/sources/currency_market.move`
   - Depends on: `governance::org`, `governance_ext::treasury`

4. **Organization** (`governance::org`) -- four-tier membership model. Used by OrgMarket + OrgTreasury for stakeholder authorization.
   - File: `contracts/governance/sources/org.move`

5. **OrgTreasury\<T\>** (`governance_ext::treasury`) -- shared wrapper around TreasuryCap<T>, locked once deposited. Stakeholders mint/burn via Organization checks.
   - File: `contracts/governance_ext/sources/treasury.move`
   - Depends on: `governance::org`

### Token Template

- File: `contracts/token_template/sources/token.move`
- Dependencies: Sui framework only (no market dependency)
- `init()` creates TreasuryCap + CoinMetadata, transfers TreasuryCap to publisher, freezes metadata
- Bytecode patching in `packages/chain-shared/src/token-factory.ts` patches identifiers + constants, publishes with dependencies `["0x1", "0x2"]`
- Pre-compiled bytecodes stored as base64 constant `TEMPLATE_BYTECODES_B64`

### Chain-Shared Layer

- `packages/chain-shared/src/currency-market.ts` -- builders + queries for CurrencyMarket<T>
- `packages/chain-shared/src/ssu-market.ts` -- builders + queries for MarketConfig, OrgMarket, sell orders, buy orders
- `packages/chain-shared/src/governance.ts` -- builders + queries for Organization
- `packages/chain-shared/src/treasury.ts` -- builders + queries for OrgTreasury
- `packages/chain-shared/src/types.ts` -- CurrencyMarketInfo, CurrencyMarketSellListing, CurrencyMarketBuyOrder, MarketInfo, OrgMarketInfo, BuyOrderInfo, OrganizationInfo, etc.
- `packages/chain-shared/src/config.ts` -- ContractAddresses includes `ssuMarket`, `governance`, `governanceExt`, `currencyMarket` entries
- `packages/chain-shared/src/token-factory.ts` -- buildPublishToken, parsePublishResult, buildMintTokens, buildBurnTokens

### dApp Layer

- `apps/ssu-dapp/src/hooks/useMarketConfig.ts` -- discovers MarketConfig by SSU ID
- `apps/ssu-dapp/src/views/SsuView.tsx` -- uses useMarketConfig, passes marketConfigId to TransferDialog
- `apps/ssu-dapp/src/components/TransferDialog.tsx` -- uses marketConfigId + marketPackageId for ssu_market transfer calls
- `apps/ssu-market-dapp/src/lib/constants.ts` -- CURRENCY_MARKET_PACKAGE_ID, getCurrencyMarketPackageId()
- `apps/ssu-market-dapp/src/components/CurrencyMarketBrowser.tsx` -- queries CurrencyMarket objects
- `apps/ssu-market-dapp/src/components/CurrencyMarketDetail.tsx` -- displays listings + buy orders

## Target State

### Single Object: Market\<T\>

```move
public struct Market<phantom T> has key {
    id: UID,
    creator: address,
    authorized: vector<address>,     // who can mint/manage (replaces org stakeholders)
    treasury_cap: TreasuryCap<T>,    // locked, can't be extracted
    fee_bps: u64,
    fee_recipient: address,
    next_sell_id: u64,
    next_buy_id: u64,
}
```

Dynamic fields on Market:
- `SellKey(u64)` -> `SellListing` (sell listing data)
- `BuyKey(u64)` -> `BuyOrder` (buy order data)
- `BuyCoinKey(u64)` -> `Coin<T>` (escrowed payment)

### SsuConfig (replaces MarketConfig)

```move
public struct SsuConfig has key {
    id: UID,
    ssu_id: ID,
    owner: address,
    delegates: vector<address>,
    market_id: Option<ID>,   // optional link to Market<T>, set later via set_market
}
```

- `create_ssu_config(ssu_id, ctx)` -- creates with owner = ctx.sender(), empty delegates, market_id = option::none()
- `add_delegate(config, addr, ctx)` -- owner only
- `remove_delegate(config, addr, ctx)` -- owner only
- `set_market(config, market_id, ctx)` -- owner only
- `remove_market(config, ctx)` -- owner only

Authorization helper:
```move
fun assert_authorized(config: &SsuConfig, ssu: &StorageUnit, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(sender == config.owner || config.delegates.contains(&sender), ENotAuthorized);
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
}
```

Transfer functions (7 inventory transfers) only need SsuConfig -- no market required.
Trade functions (escrow_and_list, buy_from_listing, fill_buy_order) assert that config.market_id is set and matches the provided Market.

### Token Template (creates Market on publish)

```move
module token_template::TOKEN_TEMPLATE;

use sui::coin;
use market::market;

public struct TOKEN_TEMPLATE has drop {}

fun init(witness: TOKEN_TEMPLATE, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency(
        witness, 9, b"TMPL", b"Template Token", b"A faction token",
        option::none(), ctx,
    );
    transfer::public_freeze_object(metadata);
    market::create_market(treasury_cap, ctx);
}
```

Publish = currency + market in one transaction. No second step.

### Contracts Deleted

- `contracts/governance/` -- Organization replaced by `authorized` list on Market
- `contracts/governance_ext/` -- OrgTreasury replaced by `treasury_cap` field on Market
- `contracts/currency_market/` -- replaced by new `contracts/market/`

### New Dependency Chain

```
token_template -> market -> Sui
ssu_market -> market, world -> Sui
ssu_market_utopia -> market, world_utopia -> Sui
```

No more governance or governance_ext dependencies anywhere.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Merge CurrencyMarket + OrgTreasury + Organization into Market\<T\> | Single unified object | Eliminates 3-step setup (create org, deposit treasury, create market). One publish creates everything. |
| TreasuryCap locked inside Market\<T\> | Consumed in create_market, stored as field | Irreversible -- prevents accidental extraction. Same security model as OrgTreasury but without the org overhead. |
| `authorized` list replaces Organization stakeholders | `vector<address>` on Market\<T\> | Organizations are overkill for token management. A simple address list with creator-only management suffices. Governance org can be revisited later as a separate concern. |
| Wrapper key structs (SellKey, BuyKey, BuyCoinKey) | Named structs instead of raw u64 | Prevents key collisions between sell listings, buy orders, and escrowed coins. Current system uses u64 keys with a 1B offset hack -- wrapper structs are cleaner. |
| SellListing drops market_config_id field | Remove field | Market_config_id was for linking back to the per-SSU MarketConfig. With SsuConfig having market_id, this reverse link is unnecessary. |
| Token template depends on market package | Published market first, template references it | Template bytecodes must include market as a dependency. Bytecode patching still works -- only identifiers and constants change, not the dependency graph. |
| Rename currency_market dir to market | New `contracts/market/` directory | Clearer name reflecting the unified role. Module path: `market::market`. |
| SsuConfig replaces SsuAdmin | Struct with owner, delegates, optional market_id | Supports delegation (owner + delegates can manage SSU), optional market link (set later via set_market). Transfer functions work without market. Trade functions require market_id to be set. |
| SsuConfig.market_id is Option\<ID\> | Optional, starts as none | SSU can operate for transfers without connecting to a Market. Owner links to a Market when ready via set_market. Trade execution asserts market_id is set. |
| Delegate management is owner-only | Only owner can add/remove delegates | Prevents delegate escalation (delegates cannot add other delegates). Simple flat permission model. |
| No migration | Fresh publish everything | Test environment, no production data to preserve. |
| Delete governance/governance_ext entirely | Remove packages | No other contracts depend on them. The governance plan (phase 2) is independently deferred and can use a new design if/when revisited. |
| Remove mint/burn from token_template | Market\<T\> handles mint/burn via locked TreasuryCap | Eliminates duplicate mint/burn paths. Previously-published tokens still have their own mint/burn (different package). New tokens only use Market. |
| Delete GovernanceDashboard view | Remove entirely | Organization is deleted. 4-tier membership (stakeholder/member/serf/opposition) has no on-chain backing. Access control handled by Market.authorized + ACL system. No replacement needed. |
| Delete GovernanceTrade view | Remove entirely | All trading moves to ssu-dapp Market tab (plan 20). OrgMarket is deleted. useOrgMarket hook + useSellOrders hook also deleted. |
| Rework GovernanceFinance -> Finance | Rewrite to use Market\<T\> | Token creation still needed but flow changes: publish auto-creates Market (no manual TreasuryCap deposit). Mint/burn calls Market functions. Treasury management becomes authorized-list management. Remove bounty board integration. |
| Keep GovernanceTurrets as-is | Defer ACL rework | Turret deployment is independent of governance contracts. Org-aware targeting (KOS list from opposition tier) needs ACL rework but still works with existing published turret contracts. Post-hackathon. |
| Defer GovernanceClaims rework | Keep functional with existing published contracts | Claims reference org_id on-chain. Existing published governance contract still works. Non-critical for hackathon. ACL-based claims is a post-hackathon redesign. |
| Delete governance.ts, extract claims.ts | Split: delete org builders, keep claim builders in new claims.ts | GovernanceDashboard (sole consumer of org builders) is deleted. GovernanceClaims still needs `buildCreateClaim`/`buildRemoveClaim` -- extracted to minimal claims.ts. governance config entry kept for claims packageId. |
| Delete treasury.ts from chain-shared | Remove entirely | GovernanceFinance rewritten to use Market\<T\> builders. No remaining consumers of OrgTreasury functions. |
| Keep DB tables as legacy | Do not drop Dexie tables | Dexie schema versions are append-only. Tables (organizations, orgTierMembers, currencies, tradeNodes) remain in schema but are no longer written to by new code. currencies table is reworked to store Market\<T\> references instead of OrgTreasury references. |

## Implementation Phases

### Phase 1: Create `market` Contract

Create a new `contracts/market/` directory with the unified Market\<T\> module.

**Steps:**

1. Create `contracts/market/Move.toml`:
   - Package name: `market`
   - Edition: 2024
   - Dependencies: Sui only
   - Address: `market = "0x0"`

2. Create `contracts/market/sources/market.move` with module `market::market`:

   **Error codes:**
   - ENotCreator: "Only the market creator can manage authorized list"
   - ENotAuthorized: "Only authorized addresses can mint"
   - ENotSeller: "Only the listing seller can modify this listing"
   - ENotBuyer: "Only the order buyer can modify this order"
   - EListingNotFound: "Sell listing not found"
   - EOrderNotFound: "Buy order not found"
   - EExceedsOrderQuantity: "Fill quantity exceeds remaining order quantity"
   - EInsufficientPayment: "Payment is less than the required escrow amount"
   - EZeroQuantity: "Quantity must be greater than zero"
   - EInvalidFeeBps: "Fee basis points must be <= 10000"

   **Structs:**
   - `Market<phantom T> has key` -- as defined in Target State above
   - `SellKey has copy, drop, store { listing_id: u64 }` -- dynamic field key for sell listings
   - `BuyKey has copy, drop, store { order_id: u64 }` -- dynamic field key for buy orders
   - `BuyCoinKey has copy, drop, store { order_id: u64 }` -- dynamic field key for escrowed coins
   - `SellListing has store, drop` -- listing_id, seller, ssu_id (ID), type_id, price_per_unit, quantity, posted_at_ms (no market_config_id)
   - `BuyOrder has store, drop` -- order_id, buyer, type_id, price_per_unit, quantity

   **Events:**
   - MarketCreatedEvent { market_id, creator }
   - SellListingPostedEvent { market_id, listing_id, seller, ssu_id, type_id, price_per_unit, quantity }
   - SellListingUpdatedEvent { market_id, listing_id, price_per_unit, quantity }
   - SellListingCancelledEvent { market_id, listing_id }
   - BuyOrderPostedEvent { market_id, order_id, buyer, type_id, price_per_unit, quantity }
   - BuyOrderFilledEvent { market_id, order_id, seller, quantity, total_paid }
   - BuyOrderCancelledEvent { market_id, order_id }
   - MintEvent { market_id, amount, recipient, minter }
   - BurnEvent { market_id, amount, burner }
   - AuthorizedAddedEvent { market_id, addr }
   - AuthorizedRemovedEvent { market_id, addr }

   **Market creation:**
   - `public fun create_market<T>(treasury_cap: TreasuryCap<T>, ctx: &mut TxContext)` -- consumes TreasuryCap, creates Market\<T\> with creator = ctx.sender(), authorized = [creator], fee_bps = 0, fee_recipient = creator. Shares the Market object. Emits MarketCreatedEvent.
   - Annotate with `#[allow(lint(share_owned))]`

   **Mint/burn (authorized access):**
   - `public fun mint<T>(market: &mut Market<T>, amount: u64, recipient: address, ctx: &mut TxContext)` -- assert sender in authorized list. Mints via market.treasury_cap. Transfers coin to recipient. Emits MintEvent.
   - `public fun burn<T>(market: &mut Market<T>, coin: Coin<T>, ctx: &TxContext)` -- any holder can burn. Burns via market.treasury_cap. Emits BurnEvent.

   **Authorization management (creator only):**
   - `public fun add_authorized<T>(market: &mut Market<T>, addr: address, ctx: &TxContext)` -- assert sender == creator. Push addr to authorized list. Emits AuthorizedAddedEvent.
   - `public fun remove_authorized<T>(market: &mut Market<T>, addr: address, ctx: &TxContext)` -- assert sender == creator. Remove addr from authorized list. Emits AuthorizedRemovedEvent.

   **Fee management (creator only):**
   - `public fun update_fee<T>(market: &mut Market<T>, fee_bps: u64, fee_recipient: address, ctx: &TxContext)` -- assert sender == creator, fee_bps <= 10000. Updates fee_bps and fee_recipient.

   **Sell listings (anyone can post):**
   - `public fun post_sell_listing<T>(market: &mut Market<T>, ssu_id: ID, type_id: u64, price_per_unit: u64, quantity: u64, clock: &Clock, ctx: &mut TxContext)` -- assert quantity > 0. Increments next_sell_id, creates SellListing, adds as dynamic field keyed by SellKey { listing_id }. Emits SellListingPostedEvent.
   - `public fun update_sell_listing<T>(market: &mut Market<T>, listing_id: u64, price_per_unit: u64, quantity: u64, ctx: &TxContext)` -- assert listing exists (SellKey), assert seller == sender. Updates fields. Emits SellListingUpdatedEvent.
   - `public fun cancel_sell_listing<T>(market: &mut Market<T>, listing_id: u64, ctx: &TxContext)` -- assert listing exists, assert seller == sender. Removes dynamic field. Emits SellListingCancelledEvent.

   **Buy orders (anyone can post, with coin escrow):**
   - `public fun post_buy_order<T>(market: &mut Market<T>, payment: Coin<T>, type_id: u64, price_per_unit: u64, quantity: u64, ctx: &mut TxContext)` -- assert quantity > 0, assert payment >= total_cost. Increments next_buy_id, creates BuyOrder, adds as dynamic field keyed by BuyKey { order_id }. Escrows coin keyed by BuyCoinKey { order_id }. Emits BuyOrderPostedEvent.
   - `public fun cancel_buy_order<T>(market: &mut Market<T>, order_id: u64, ctx: &mut TxContext)` -- assert order exists, assert buyer == sender. Removes BuyOrder + escrowed coin, transfers coin back to buyer. Emits BuyOrderCancelledEvent.

   **Read accessors (for ssu_market to call):**
   - `public fun market_creator<T>(market: &Market<T>): address`
   - `public fun market_fee_bps<T>(market: &Market<T>): u64`
   - `public fun market_fee_recipient<T>(market: &Market<T>): address`
   - `public fun next_sell_id<T>(market: &Market<T>): u64`
   - `public fun next_buy_id<T>(market: &Market<T>): u64`
   - `public fun is_authorized<T>(market: &Market<T>, addr: address): bool`
   - `public fun total_supply<T>(market: &Market<T>): u64` -- reads from treasury_cap

   **Write accessors (for ssu_market trade execution):**
   - `public fun borrow_sell_listing<T>(market: &Market<T>, listing_id: u64): &SellListing` -- for reading listing data during trade execution
   - `public fun borrow_sell_listing_mut<T>(market: &mut Market<T>, listing_id: u64): &mut SellListing` -- for updating quantity after partial fill
   - `public fun remove_sell_listing<T>(market: &mut Market<T>, listing_id: u64): SellListing` -- for removing fully filled listings
   - `public fun has_sell_listing<T>(market: &Market<T>, listing_id: u64): bool`
   - `public fun borrow_buy_order<T>(market: &Market<T>, order_id: u64): &BuyOrder` -- for reading order data during trade execution
   - `public fun borrow_buy_order_mut<T>(market: &mut Market<T>, order_id: u64): &mut BuyOrder`
   - `public fun remove_buy_order<T>(market: &mut Market<T>, order_id: u64): BuyOrder`
   - `public fun has_buy_order<T>(market: &Market<T>, order_id: u64): bool`
   - `public fun split_escrowed_coin<T>(market: &mut Market<T>, order_id: u64, amount: u64, ctx: &mut TxContext): Coin<T>` -- splits amount from escrowed coin for the given order
   - `public fun remove_escrowed_coin<T>(market: &mut Market<T>, order_id: u64): Coin<T>` -- removes and returns entire escrowed coin (for order cleanup)

   **SellListing field accessors:**
   - `public fun listing_id(listing: &SellListing): u64`
   - `public fun listing_seller(listing: &SellListing): address`
   - `public fun listing_ssu_id(listing: &SellListing): ID`
   - `public fun listing_type_id(listing: &SellListing): u64`
   - `public fun listing_price_per_unit(listing: &SellListing): u64`
   - `public fun listing_quantity(listing: &SellListing): u64`
   - `public fun set_listing_quantity(listing: &mut SellListing, quantity: u64)`

   **BuyOrder field accessors:**
   - `public fun order_id(order: &BuyOrder): u64`
   - `public fun order_buyer(order: &BuyOrder): address`
   - `public fun order_type_id(order: &BuyOrder): u64`
   - `public fun order_price_per_unit(order: &BuyOrder): u64`
   - `public fun order_quantity(order: &BuyOrder): u64`
   - `public fun set_order_quantity(order: &mut BuyOrder, quantity: u64)`

3. Add Move unit tests:
   - test_create_market: create Market, verify creator/authorized/fees
   - test_mint_burn: authorized user mints, any holder burns
   - test_unauthorized_mint: non-authorized user fails to mint
   - test_sell_listing_lifecycle: post, update, cancel
   - test_buy_order_lifecycle: post, cancel (verify coin return)
   - test_authorization_management: add/remove authorized addresses

4. Build and verify: `cd contracts/market && sui move build`

### Phase 2: Update `token_template`

Update the template to depend on `market` and create a Market\<T\> in `init()`.

**Steps:**

1. Update `contracts/token_template/Move.toml`:
   - Add dependency: `market = { local = "../market" }`
   - Keep Sui dependency unchanged

2. Update `contracts/token_template/sources/token.move`:
   - Add `use market::market;`
   - Change `init()`:
     - After `coin::create_currency(...)`, call `market::create_market(treasury_cap, ctx)` instead of `transfer::public_transfer(treasury, ctx.sender())`
     - Keep `transfer::public_freeze_object(metadata)`
   - Remove the standalone `mint<T>` and `burn<T>` entry functions (Market handles these now)

3. Build: `cd contracts/token_template && sui move build`

4. Update bytecode patching in `packages/chain-shared/src/token-factory.ts`:
   - Compile the updated template, extract new base64 bytecodes
   - Update `TEMPLATE_BYTECODES_B64` constant with new compiled bytes
   - Update `buildPublishToken()` dependencies array: add the published `market` package ID alongside `"0x1"` and `"0x2"`
   - Update `parsePublishResult()`: look for `Market<T>` in created objects (instead of TreasuryCap). The Market object ID replaces treasuryCapId in the result.
   - Update `PublishTokenResult` interface: replace `treasuryCapId` with `marketId`
   - Remove `buildMintTokens` and `buildBurnTokens` (moved to market.ts builders)

### Phase 3: Update `ssu_market` Contract

Replace MarketConfig with SsuConfig, delete OrgMarket, update trade execution to use Market\<T\>.

**Steps:**

1. Update `contracts/ssu_market/Move.toml`:
   - Replace `governance = { local = "../governance" }` with `market = { local = "../market" }`
   - Remove governance address entry
   - Keep world dependency unchanged

2. Rewrite `contracts/ssu_market/sources/ssu_market.move`:

   **Remove entirely:**
   - All `use governance::org::*` imports
   - MarketConfig struct and all MarketConfig-related functions (create_market, set_listing, remove_listing, buy_item)
   - OrgMarket struct and all OrgMarket functions (create_org_market, add_authorized_ssu, remove_authorized_ssu, create_buy_order, confirm_buy_order_fill, cancel_buy_order)
   - BuyOrder struct (the ssu_market version -- market::market has its own)
   - SellOrder struct and all SellOrder functions (create_sell_order, cancel_sell_order, buy_sell_order, update_sell_price)
   - Legacy Listing struct and deprecated functions (stock_items, buy_and_withdraw, has_listing, listing_price, listing_available)
   - All legacy read accessors (market_admin, market_ssu_id, has_sell_order, sell_order_price, sell_order_quantity)

   **Keep:**
   - MarketAuth witness struct (for SSU extension authorization)
   - TransferEvent event struct

   **Add:**
   - `use market::market::{Self, Market};`
   - SsuConfig struct: `public struct SsuConfig has key { id: UID, ssu_id: ID, owner: address, delegates: vector<address>, market_id: Option<ID> }`
   - SsuConfigCreatedEvent: `{ config_id: ID, owner: address, ssu_id: ID }`
   - DelegateAddedEvent: `{ config_id: ID, delegate: address }`
   - DelegateRemovedEvent: `{ config_id: ID, delegate: address }`
   - MarketSetEvent: `{ config_id: ID, market_id: ID }`
   - MarketRemovedEvent: `{ config_id: ID }`

   **New functions:**
   - `public fun create_ssu_config(ssu_id: ID, ctx: &mut TxContext)` -- creates SsuConfig with owner = ctx.sender(), delegates = empty vector, market_id = option::none(). Shares the SsuConfig. No market reference needed.
   - `public fun add_delegate(config: &mut SsuConfig, addr: address, ctx: &TxContext)` -- assert sender == config.owner. Push addr to delegates. Emits DelegateAddedEvent.
   - `public fun remove_delegate(config: &mut SsuConfig, addr: address, ctx: &TxContext)` -- assert sender == config.owner. Remove addr from delegates. Emits DelegateRemovedEvent.
   - `public fun set_market(config: &mut SsuConfig, market_id: ID, ctx: &TxContext)` -- assert sender == config.owner. Sets config.market_id = option::some(market_id). Emits MarketSetEvent.
   - `public fun remove_market(config: &mut SsuConfig, ctx: &TxContext)` -- assert sender == config.owner. Sets config.market_id = option::none(). Emits MarketRemovedEvent.
   - SsuConfig read accessors: `config_owner`, `config_ssu_id`, `config_market_id`, `config_delegates`

   **Authorization helper (internal):**
   ```move
   fun assert_authorized(config: &SsuConfig, ssu: &StorageUnit, ctx: &TxContext) {
       let sender = ctx.sender();
       assert!(sender == config.owner || config.delegates.contains(&sender), ENotAuthorized);
       assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
   }
   ```

   **Inventory transfer functions (7 functions, updated from MarketConfig to SsuConfig):**
   Replace all `config: &MarketConfig` parameters with `config: &SsuConfig`. Replace `assert!(ctx.sender() == config.admin, ENotAdmin)` with `assert_authorized(config, ssu, ctx)` (checks owner OR delegates). Replace `object::id(config)` in events with `object::id(config)`. These functions work without any market -- they only need SsuConfig. Specific functions:
   - `admin_to_escrow(config: &SsuConfig, ssu, character, type_id, quantity, ctx)`
   - `admin_from_escrow(config: &SsuConfig, ssu, character, type_id, quantity, ctx)`
   - `admin_to_player(config: &SsuConfig, ssu, admin_character, recipient_character, type_id, quantity, ctx)`
   - `admin_escrow_to_player(config: &SsuConfig, ssu, admin_character, recipient_character, type_id, quantity, ctx)`
   - `admin_escrow_to_self(config: &SsuConfig, ssu, character, type_id, quantity, ctx)`
   - `player_to_escrow(config: &SsuConfig, ssu, character, item, ctx)` -- SSU mismatch check only (no owner/delegate check)
   - `player_to_owner(config: &SsuConfig, ssu, character, item, ctx)` -- SSU mismatch check only (no owner/delegate check)

   **Trade execution functions (new, using Market\<T\>):**

   Trade functions additionally assert that `config.market_id` is set and matches `object::id(market)`:
   ```move
   fun assert_market_linked(config: &SsuConfig, market_id: ID) {
       assert!(option::is_some(&config.market_id), EMarketNotLinked);
       assert!(*option::borrow(&config.market_id) == market_id, EMarketMismatch);
   }
   ```

   `escrow_and_list<T>`:
   Authorized user escrows items from owner inventory into extension inventory, then posts a sell listing on the Market.
   ```
   public fun escrow_and_list<T>(
       config: &SsuConfig, market: &mut Market<T>,
       ssu: &mut StorageUnit, character: &Character,
       item: Item, price_per_unit: u64, clock: &Clock, ctx: &mut TxContext,
   )
   ```
   - assert_authorized(config, ssu, ctx), assert_market_linked(config, object::id(market))
   - Capture `type_id = item.type_id()` and `qty = item.quantity()` before deposit (deposit consumes the Item)
   - Deposit item to extension inventory via storage_unit::deposit_item<MarketAuth>
   - Call market::post_sell_listing<T>(market, config.ssu_id, type_id, price_per_unit, qty, clock, ctx)

   `cancel_listing<T>`:
   Cancel a sell listing on Market and return items from extension inventory to owner inventory.
   ```
   public fun cancel_listing<T>(
       config: &SsuConfig, market: &mut Market<T>,
       ssu: &mut StorageUnit, character: &Character,
       listing_id: u64, ctx: &mut TxContext,
   )
   ```
   - assert_authorized(config, ssu, ctx), assert_market_linked(config, object::id(market))
   - Read listing via market::borrow_sell_listing to get type_id + quantity
   - Verify listing.seller == ctx.sender() (caller must be the original lister)
   - Remove listing via market::remove_sell_listing (uses write accessor, not cancel_sell_listing, to avoid redundant seller check)
   - Withdraw items from extension inventory using saved type_id + quantity
   - Deposit to owner inventory
   - Emit SellListingCancelledEvent (ssu_market's own event)

   `buy_from_listing<T>`:
   Buyer purchases items from a sell listing. Atomic: payment -> seller, items -> buyer.
   ```
   public fun buy_from_listing<T>(
       config: &SsuConfig, market: &mut Market<T>,
       ssu: &mut StorageUnit, buyer_character: &Character,
       listing_id: u64, quantity: u32, mut payment: Coin<T>,
       ctx: &mut TxContext,
   ): Coin<T>
   ```
   - assert SSU matches config (`object::id(ssu) == config.ssu_id`), assert_market_linked(config, object::id(market))
   - NOTE: does NOT call assert_authorized -- any buyer can call this function. Only the SSU/market link is validated, not the caller's role.
   - Read listing from market to get price_per_unit, verify quantity available
   - Calculate total_price, calculate fee (fee_bps from market), split payment
   - Transfer fee to fee_recipient, transfer net payment to listing seller
   - Withdraw items from extension inventory, deposit to buyer's owned inventory
   - Update listing quantity (or remove if fully filled)
   - Emit SellOrderFilledEvent (or reuse market event)
   - Return change coin

   `fill_buy_order<T>`:
   Seller fills a buy order by providing items from the SSU. Atomic: items from seller's SSU -> buyer gets items (via extension deposit), escrowed payment -> seller.
   ```
   public fun fill_buy_order<T>(
       config: &SsuConfig, market: &mut Market<T>,
       ssu: &mut StorageUnit, seller_character: &Character,
       order_id: u64, quantity: u32, ctx: &mut TxContext,
   )
   ```
   - assert_authorized(config, ssu, ctx), assert_market_linked(config, object::id(market))
   - Read buy order from market to get price_per_unit, verify quantity
   - Withdraw items from extension inventory (seller's stock)
   - Deposit items to open inventory (for buyer to claim, or directly to buyer -- design note: deposit to open inventory since buyer character may not be in the same PTB)
   - Split escrowed payment from market, transfer to seller
   - Calculate and apply fee (split fee from payment before transferring)
   - Update or remove buy order
   - Emit BuyOrderFilledEvent

3. Build: `cd contracts/ssu_market && sui move build`

### Phase 4: Update `ssu_market_utopia`

Mirror all Phase 3 changes for the Utopia tenant's ssu_market package.

**Steps:**

1. Update `contracts/ssu_market_utopia/Move.toml`:
   - Replace `governance = { local = "../governance" }` with `market = { local = "../market" }`
   - Remove governance address entry
   - Keep `world = { local = "../world_utopia" }` unchanged

2. Copy the updated `ssu_market.move` from `contracts/ssu_market/sources/` to `contracts/ssu_market_utopia/sources/`
   - File is identical -- both use the same module name `ssu_market::ssu_market`
   - The only difference between stillness and utopia is the `world` dependency path in Move.toml

3. Build: `cd contracts/ssu_market_utopia && sui move build`

### Phase 5: Chain-Shared Updates

Update TypeScript types, builders, and queries to match the new contract structure.

**Steps:**

1. Create `packages/chain-shared/src/market.ts` with:

   **Types (exported):**
   - `MarketInfo` -- replaces CurrencyMarketInfo: `{ objectId, creator, authorized: string[], feeBps, feeRecipient, nextSellId, nextBuyId, coinType, totalSupply? }`
   - `MarketSellListing` -- replaces CurrencyMarketSellListing: `{ listingId, seller, ssuId, typeId, pricePerUnit, quantity, postedAtMs }` (no marketConfigId)
   - `MarketBuyOrder` -- replaces CurrencyMarketBuyOrder: `{ orderId, buyer, typeId, pricePerUnit, quantity }`

   **TX builders:**
   - `buildMint(params: { packageId, marketId, coinType, amount, recipient, senderAddress })` -- calls `market::market::mint<T>`
   - `buildBurn(params: { packageId, marketId, coinType, coinObjectId, senderAddress })` -- calls `market::market::burn<T>`
   - `buildAddAuthorized(params: { packageId, marketId, coinType, addr, senderAddress })` -- calls `market::market::add_authorized<T>`
   - `buildRemoveAuthorized(params: { packageId, marketId, coinType, addr, senderAddress })` -- calls `market::market::remove_authorized<T>`
   - `buildUpdateFee(params: { packageId, marketId, coinType, feeBps, feeRecipient, senderAddress })` -- calls `market::market::update_fee<T>`
   - `buildPostSellListing(params: { packageId, marketId, coinType, ssuId, typeId, pricePerUnit, quantity, senderAddress })` -- calls `market::market::post_sell_listing<T>`
   - `buildUpdateSellListing(params: { packageId, marketId, coinType, listingId, pricePerUnit, quantity, senderAddress })` -- calls `market::market::update_sell_listing<T>`
   - `buildCancelSellListing(params: { packageId, marketId, coinType, listingId, senderAddress })` -- calls `market::market::cancel_sell_listing<T>`
   - `buildPostBuyOrder(params: { packageId, marketId, coinType, paymentObjectId, typeId, pricePerUnit, quantity, senderAddress })` -- calls `market::market::post_buy_order<T>`
   - `buildCancelBuyOrder(params: { packageId, marketId, coinType, orderId, senderAddress })` -- calls `market::market::cancel_buy_order<T>`

   **Query functions:**
   - `queryMarkets(client, packageId, coinType?)` -- discovers Market\<T\> objects. Uses GraphQL type filter `packageId::market::Market<coinType>`. Returns MarketInfo[].
   - `queryMarketDetails(client, marketId)` -- fetches single Market by object ID. Returns MarketInfo | null.
   - `queryMarketListings(client, marketId)` -- lists sell listings from Market dynamic fields. Filters by SellKey type in dynamic field name. Returns MarketSellListing[].
   - `queryMarketBuyOrders(client, marketId)` -- lists buy orders from Market dynamic fields. Filters by BuyKey type in dynamic field name. Returns MarketBuyOrder[].

   Note: Dynamic field keys are now typed structs (SellKey, BuyKey, BuyCoinKey) instead of raw u64. The GraphQL dynamic field listing will show the key type as `market::market::SellKey` etc. Query logic filters by name type instead of using the u64 offset hack.

2. Update `packages/chain-shared/src/ssu-market.ts`:

   **Remove entirely:**
   - MarketConfig query/discovery functions: queryMarketConfig, discoverMarketConfig
   - buildCreateMarket (for MarketConfig)
   - SellOrder query functions: querySellOrder, queryAllSellOrders (sell listings now live on Market\<T\>, queried via market.ts)
   - All OrgMarket functions: buildCreateOrgMarket, buildAddAuthorizedSsu, buildRemoveAuthorizedSsu, buildCreateBuyOrder, buildConfirmBuyOrderFill, buildCancelBuyOrder, queryOrgMarket, discoverOrgMarket, queryBuyOrders
   - Legacy listing/purchase builders (buildUpdateSellPrice, etc.)

   **Keep (updated):**
   - buildCreateSellOrder -> rename to buildEscrowAndList: calls `ssu_market::ssu_market::escrow_and_list<T>`. Parameters: packageId, ssuConfigId (was configObjectId), marketId (new), coinType (new), worldPackageId, ssuObjectId, characterObjectId, ownerCapReceivingId, typeId, quantity, pricePerUnit, senderAddress. PTB flow: borrow_owner_cap -> withdraw_by_owner -> escrow_and_list -> return_owner_cap.
   - buildCancelSellOrder -> rename to buildCancelListing: calls `ssu_market::ssu_market::cancel_listing<T>`. Parameters: packageId, ssuConfigId, marketId, coinType, ssuObjectId, characterObjectId, listingId (was typeId), quantity, senderAddress.
   - buildBuySellOrder -> rename to buildBuyFromListing: calls `ssu_market::ssu_market::buy_from_listing<T>`. Parameters: packageId, ssuConfigId, marketId, coinType, ssuObjectId, characterObjectId, listingId, quantity, paymentObjectId, senderAddress.

   **Add:**
   - SsuConfig types: `SsuConfigInfo { objectId, owner, ssuId, delegates: string[], marketId: string | null }`
   - `buildCreateSsuConfig(params: { packageId, ssuId, senderAddress })` -- calls `ssu_market::ssu_market::create_ssu_config`. No market_id parameter (starts as none).
   - `buildAddDelegate(params: { packageId, ssuConfigId, delegate, senderAddress })` -- calls `ssu_market::ssu_market::add_delegate`
   - `buildRemoveDelegate(params: { packageId, ssuConfigId, delegate, senderAddress })` -- calls `ssu_market::ssu_market::remove_delegate`
   - `buildSetMarket(params: { packageId, ssuConfigId, marketId, senderAddress })` -- calls `ssu_market::ssu_market::set_market`
   - `buildRemoveMarket(params: { packageId, ssuConfigId, senderAddress })` -- calls `ssu_market::ssu_market::remove_market`
   - `querySsuConfig(client, ssuConfigId)` -- fetches SsuConfig details (owner, delegates, marketId)
   - `discoverSsuConfig(client, ssuMarketPackageId, ssuId)` -- finds SsuConfig by SSU ID (replaces discoverMarketConfig)
   - `buildFillBuyOrder(params: { packageId, ssuConfigId, marketId, coinType, ssuObjectId, characterObjectId, orderId, quantity, senderAddress })` -- calls `ssu_market::ssu_market::fill_buy_order<T>`
   - Inventory transfer builders (keep existing 7 functions, update parameter name from configObjectId to ssuConfigId)

3. Delete `packages/chain-shared/src/currency-market.ts` entirely.

4. Update `packages/chain-shared/src/types.ts`:

   **Remove:**
   - CurrencyMarketInfo, CurrencyMarketSellListing, CurrencyMarketBuyOrder
   - MarketInfo (the old ssu_market one with objectId/admin/ssuId -- replaced by SsuConfigInfo in ssu-market.ts)
   - OrgMarketInfo, BuyOrderInfo (the old ssu_market ones)

   **Remove (governance types -- no longer referenced after periscope cleanup):**
   - OrganizationInfo, OrgTierData, OnChainClaim
   - Note: `OrganizationInfo` is imported by `turret-priority.ts::generateOrgTurretConfig()` but that function is dead code (never imported by any app). Remove `generateOrgTurretConfig` from turret-priority.ts as well.
   - `OrgTier` from chain-shared is only used by governance.ts (periscope defines its own `OrgTier` in `db/types.ts`) -- safe to remove

   **Add:**
   - MarketInfo: `{ objectId, creator, authorized: string[], feeBps, feeRecipient, nextSellId, nextBuyId, coinType, totalSupply? }` (or import from market.ts)
   - MarketSellListing: `{ listingId, seller, ssuId, typeId, pricePerUnit, quantity, postedAtMs }`
   - MarketBuyOrder: `{ orderId, buyer, typeId, pricePerUnit, quantity }`
   - SsuConfigInfo: `{ objectId, owner, ssuId, delegates: string[], marketId: string | null }`

   **Keep unchanged:**
   - All non-market types (AclConfig, AdminConfig, OrderBookInfo, TollInfo, BountyInfo, LeaseInfo, TokenInfo, TurretPriorityDeployment, SharedAclInfo, ContractAddresses)

   **Remove (additional):**
   - SellOrderInfo (was for local SellOrder on MarketConfig, which no longer exists -- sell listings are now on Market\<T\>)
   - MarketListing (deprecated legacy type)

5. Update `packages/chain-shared/src/config.ts`:

   **ContractAddresses type updates:**
   - Remove: `currencyMarket` entry
   - Remove: `governanceExt` entry (no consumers after treasury.ts deletion)
   - Keep: `governance` entry (GovernanceClaims uses `governance.packageId` + `governance.claimsRegistryObjectId` for chain TXs)
   - Add: `market: { packageId: string }` entry
   - Keep: `ssuMarket` (still needed, just re-published)

   **CONTRACT_ADDRESSES data:**
   - Remove currencyMarket from both stillness and utopia
   - Remove governanceExt from both stillness and utopia
   - Keep governance entries (existing published package IDs -- still referenced by claims view)
   - Add market with placeholder packageId (populated after publish)
   - Update ssuMarket packageId/originalPackageId placeholders

6. Delete `packages/chain-shared/src/governance.ts` entirely.
   - GovernanceDashboard (sole consumer of buildCreateOrg, buildAddToTier, buildRemoveFromTier, discoverOrgByCreator, queryOrganization) is deleted in Phase 7
   - GovernanceClaims uses buildCreateClaim/buildRemoveClaim -- extracted to claims.ts (step 8)
   - queryClaimEvents, buildUpdateClaimName, buildUpdateClaimWeight are unused by any view -- dropped

7. Delete `packages/chain-shared/src/treasury.ts` entirely.
   - GovernanceFinance (sole consumer of buildDepositTreasuryCap, buildMintAndTransfer, buildBurn, buildFundBounty, queryOrgTreasury) is rewritten to use Market\<T\> builders in Phase 7
   - buildMint/buildBurn move to market.ts (already covered in step 1)
   - queryTokenSupply/queryOwnedCoins are in token-factory.ts (not treasury.ts) -- unaffected

8. Create `packages/chain-shared/src/claims.ts` with minimal claim builders:
   - Move `buildCreateClaim` and `buildRemoveClaim` from deleted governance.ts
   - These 2 functions are the only governance.ts exports still needed (by GovernanceClaims view)
   - Keep the same function signatures -- only the file location changes
   - No config dependency needed -- packageId is passed as a parameter by the caller

9. Update `packages/chain-shared/src/index.ts`:
   - Remove: `export * from "./currency-market"`
   - Remove: `export * from "./governance"`
   - Remove: `export * from "./treasury"`
   - Add: `export * from "./market"`
   - Add: `export * from "./claims"`

10. Update `packages/chain-shared/src/token-factory.ts`:
    - Update `TEMPLATE_BYTECODES_B64` with recompiled template bytecodes
    - Update `buildPublishToken` dependencies array: add market package ID
    - Update `PublishTokenResult` interface: replace `treasuryCapId: string` with `marketId: string`
    - Update `parsePublishResult`: search for `market::market::Market` in created objects instead of `TreasuryCap`
    - Remove `buildMintTokens` and `buildBurnTokens` (moved to market.ts)

11. Build chain-shared: `pnpm build --filter @tehfrontier/chain-shared`

### Phase 6: dApp Updates

Update ssu-dapp hooks and components. Update ssu-market-dapp references.

**Steps:**

1. Update `apps/ssu-dapp/src/hooks/useMarketConfig.ts`:
   - Rename to `useSsuConfig.ts` (or keep filename, rename hook)
   - Change hook name: `useMarketConfig` -> `useSsuConfig`
   - Return type: `SsuConfigResult { ssuConfigId, owner, delegates, marketId: string | null, packageId }`
   - Use `discoverSsuConfig` instead of `discoverMarketConfig`
   - Use `querySsuConfig` instead of `queryMarketConfig`
   - Still keyed on ssuObjectId + extension type

2. Update `apps/ssu-dapp/src/views/SsuView.tsx`:
   - Import `useSsuConfig` instead of `useMarketConfig`
   - Replace `marketConfig` variable references with `ssuConfig`
   - `isOwner` check: `ssuConfig.owner === walletAddress`
   - `isAuthorized` check: `ssuConfig.owner === walletAddress || ssuConfig.delegates.includes(walletAddress)`
   - TransferContext: replace `marketConfigId` with `ssuConfigId`, add `marketId` (may be null)

3. Update `apps/ssu-dapp/src/components/TransferDialog.tsx`:
   - Update TransferContext interface: `ssuConfigId` replaces `marketConfigId`, add `marketId: string | null`
   - Update all moveCall targets from `ssu_market::ssu_market::admin_to_escrow` etc. -- function names unchanged, but the object parameter changes from MarketConfig to SsuConfig
   - Transfer functions only require ssuConfigId (no marketId needed)

4. Update `apps/ssu-dapp/src/components/InventoryTabs.tsx`:
   - Any references to marketConfigId -> ssuConfigId

5. Update `apps/ssu-market-dapp/src/lib/constants.ts`:
   - Replace `CURRENCY_MARKET_PACKAGE_ID` with `MARKET_PACKAGE_ID`
   - Rename `getCurrencyMarketPackageId()` to `getMarketPackageId()`

6. Update `apps/ssu-market-dapp/src/components/CurrencyMarketBrowser.tsx`:
   - Rename file to `MarketBrowser.tsx`
   - Use `queryMarkets` instead of `queryCurrencyMarkets`
   - Update type references: MarketInfo instead of CurrencyMarketInfo

7. Update `apps/ssu-market-dapp/src/components/CurrencyMarketDetail.tsx`:
   - Rename file to `MarketDetail.tsx`
   - Use `queryMarketListings` + `queryMarketBuyOrders` instead of currency_market equivalents
   - Update type references

8. Update `apps/ssu-market-dapp/src/components/ListingCard.tsx`:
   - Replace `MarketInfo` (old ssu_market type) with `SsuConfigInfo` or appropriate type
   - Replace `buildBuySellOrder` with `buildBuyFromListing` (new ssu-market.ts function)

9. Update `apps/ssu-market-dapp/src/components/OwnerView.tsx`:
   - Replace `MarketInfo` with appropriate new type
   - Replace `buildUpdateSellPrice`, `buildCancelSellOrder` with new Market\<T\> equivalents (`buildUpdateSellListing`, `buildCancelListing`)

10. Update `apps/ssu-market-dapp/src/components/PostSellListingForm.tsx`:
    - Replace `buildPostSellListing` (from deleted currency-market.ts) with `buildPostSellListing` (from new market.ts)
    - Update parameter shape to match new Market\<T\> function

11. Update `apps/ssu-market-dapp/src/components/PostBuyOrderForm.tsx`:
    - Replace `buildPostBuyOrder` (from deleted currency-market.ts) with `buildPostBuyOrder` (from new market.ts)
    - Update parameter shape

12. Update `apps/ssu-market-dapp/src/components/BuyerView.tsx`:
    - Replace `MarketInfo` type with appropriate new type

13. Update `apps/ssu-market-dapp/src/components/ListingForm.tsx`:
    - Replace `MarketInfo` type with appropriate new type

14. Update `apps/ssu-market-dapp/src/components/MarketView.tsx`:
    - Update any old type/function references

15. Update `apps/ssu-market-dapp/src/hooks/useMarketConfig.ts`:
    - Replace `queryMarketConfig` with `querySsuConfig` (or equivalent Market query)
    - Update `getConfigId()` to return SsuConfig ID instead of MarketConfig ID

16. Update `apps/ssu-market-dapp/src/hooks/useMarketListings.ts`:
    - Replace `queryAllSellOrders` + `SellOrderInfo` with `queryMarketListings` + `MarketSellListing` from market.ts
    - Update `SellOrderWithName` to extend `MarketSellListing` instead of `SellOrderInfo`
    - Query takes marketId instead of configId

17. Update `apps/ssu-market-dapp/src/App.tsx`:
    - Import renamed components

18. Build all dApps: `pnpm build`

### Phase 7: Periscope Governance Cleanup

Remove deleted governance views, rework GovernanceFinance to use Market\<T\>, update navigation and routing.

**Steps:**

1. Delete `apps/periscope/src/views/GovernanceDashboard.tsx` entirely.
   - Sole consumer of: `buildCreateOrg`, `buildAddToTier`, `buildRemoveFromTier`, `discoverOrgByCreator` (from deleted governance.ts)
   - Uses DB tables: `organizations`, `orgTierMembers` -- tables remain in schema but this view no longer writes to them
   - ~600 LOC removed

2. Delete `apps/periscope/src/views/GovernanceTrade.tsx` entirely.
   - Sole consumer of: `buildCreateMarket`, `buildCreateOrgMarket`, `buildAddAuthorizedSsu`, `buildRemoveAuthorizedSsu`, `buildCreateSellOrder`, `buildCancelSellOrder`, `buildUpdateSellPrice`, `buildConfirmBuyOrderFill`, `buildFundBuyOrder`, `buildCancelBuyOrder`, `discoverMarketConfig` (from deleted/rewritten ssu-market.ts)
   - Uses `useOrgMarket` hook and `useSellOrders` hook (both deleted in steps 3-4)
   - All trading functionality moves to ssu-dapp Market tab (plan 20)
   - ~2,000 LOC removed

3. Delete `apps/periscope/src/hooks/useOrgMarket.ts` entirely.
   - Only consumer was GovernanceTrade (deleted in step 2)
   - Uses: `discoverOrgMarket`, `queryOrgMarket`, `queryBuyOrders` from deleted ssu-market.ts functions
   - ~85 LOC removed

4. Delete `apps/periscope/src/hooks/useSellOrders.ts` entirely.
   - Only consumer was GovernanceTrade (deleted in step 2)
   - Uses: `queryAllSellOrders`, `SellOrderInfo` from deleted ssu-market.ts functions/types
   - ~15 LOC removed

5. Rewrite `apps/periscope/src/views/GovernanceFinance.tsx` -> rename to `Finance.tsx`:
   - Remove all `@tehfrontier/chain-shared` governance/treasury imports:
     - Remove: `buildDepositTreasuryCap`, `buildMintAndTransfer`, `buildBurn`, `buildFundBounty`, `queryOrgTreasury`
   - Add Market\<T\> imports from `@tehfrontier/chain-shared`:
     - Add: `buildMint`, `buildBurn`, `buildAddAuthorized`, `buildRemoveAuthorized`, `buildUpdateFee`, `queryMarkets`, `queryMarketDetails`, `buildPublishToken`, `parsePublishResult`
   - Remove Organization dependency:
     - Remove: `useLiveQuery(() => db.organizations.filter(notDeleted).first())` and all org-gated logic
     - The view should work standalone -- no org required
   - Token creation flow changes:
     - Keep `buildPublishToken` + `parsePublishResult` (from token-factory.ts, unchanged)
     - Result now returns `marketId` instead of `treasuryCapId`
     - Remove "Deposit TreasuryCap" step entirely (TreasuryCap auto-locked in Market on publish)
     - After publish, save `marketId` + `coinType` to DB currencies table
   - Mint/burn flow changes:
     - `buildMintAndTransfer` -> `buildMint` (from market.ts): `{ packageId: marketPackageId, marketId, coinType, amount, recipient, senderAddress }`
     - `buildBurn` -> `buildBurn` (from market.ts): `{ packageId: marketPackageId, marketId, coinType, coinObjectId, senderAddress }`
   - Treasury management section:
     - Replace OrgTreasury info display with Market info (creator, authorized list, fee config, total supply)
     - Add authorized address management: add/remove authorized addresses (creator only)
     - Add fee management: update fee_bps + fee_recipient (creator only)
   - Remove bounty board integration (buildFundBounty section)
   - Update DB currencies table usage:
     - Replace `treasuryCapId` with `marketId`
     - Replace `orgId` FK with standalone record (no org dependency)
     - Keep `coinType`, `symbol`, `packageId` fields
   - Export as `Finance` (not `GovernanceFinance`)
   - ~1,311 LOC rewritten to ~800 LOC (simpler flow, no org/treasury indirection)

6. Update `apps/periscope/src/components/Sidebar.tsx`:
   - Remove from Governance nav group:
     - `{ to: "/governance", icon: Building2, label: "Organization" }` (GovernanceDashboard deleted)
     - `{ to: "/governance/trade", icon: ShoppingBag, label: "Trade" }` (GovernanceTrade deleted)
   - Rename: `{ to: "/governance/finance", icon: Coins, label: "Finance" }` stays as-is
   - Keep: Turrets and Claims items unchanged
   - Remove unused icon imports: `Building2`, `ShoppingBag` (verify no other nav items use them)

7. Update `apps/periscope/src/router.tsx`:
   - Remove lazy imports:
     - `LazyGovernanceDashboard` (line 33-35)
     - `LazyGovernanceTrade` (line 45-47)
   - Remove page wrapper functions:
     - `GovernanceDashboardPage` (lines 105-111)
     - `GovernanceTradePage` (lines 137-142)
   - Remove route definitions:
     - `governanceRoute` (line 271-275) -- `/governance` route
     - `governanceTradeRoute` (line 295-299) -- `/governance/trade` route
   - Remove from routeTree children array:
     - `governanceRoute`
     - `governanceTradeRoute`
   - Update `/governance` redirect: change `governanceRoute` to redirect to `/governance/finance` (default governance landing page is now Finance)
   - Update `LazyGovernanceFinance` to import from `Finance` (renamed file)
   - Update `GovernanceFinancePage` component reference

8. Update `apps/periscope/src/db/types.ts`:
   - Update `CurrencyRecord` interface:
     - Remove: `orgId` field (no org dependency)
     - Remove: `treasuryCapId` field (TreasuryCap locked in Market)
     - Add: `marketId: string` field (Market\<T\> object ID)
     - Keep: `id`, `symbol`, `coinType`, `packageId`, `name`, `description`, `decimals`
   - Keep `OrganizationRecord`, `OrgTierMember`, `SystemClaimRecord`, `SystemNickname`, `TradeNodeRecord` type definitions -- still in Dexie schema, just no longer actively used by new code (except Claims view uses SystemClaimRecord/SystemNickname)

9. Update `apps/periscope/src/db/index.ts`:
   - Add new Dexie version (V15 or next available) with updated currencies schema:
     - `currencies: "id, symbol, coinType, marketId, packageId"` (remove orgId index, add marketId)
   - Do NOT remove existing table definitions from earlier versions (Dexie migrations are append-only)

10. Verify `apps/periscope/src/views/GovernanceClaims.tsx` -- NO code changes needed:
    - `buildCreateClaim`, `buildRemoveClaim` still import from `@tehfrontier/chain-shared` (re-exported from new claims.ts via barrel export)
    - `getContractAddresses` unchanged in config.ts, `governance` entry kept
    - Function signatures are identical -- only the internal source file moved
    - The org dependency (`db.organizations.filter(notDeleted).first()`) is used to scope claims to an org. Post-cleanup, claims still reference existing on-chain org objects. This is acceptable for hackathon -- claims rework is deferred.

11. Update `apps/periscope/src/views/Extensions.tsx`:
    - Replace `discoverMarketConfig` + `queryMarketConfig` imports with `discoverSsuConfig` + `querySsuConfig`
    - Update `MarketConfigInfo` component (line 429) to use SsuConfig queries
    - Rename component to `SsuConfigInfo` or similar
    - Update query keys from `"marketConfig-discover"` / `"marketConfig"` to `"ssuConfig-discover"` / `"ssuConfig"`
    - Display `owner`, `ssuId`, `delegates`, `marketId` (may be null) instead of old MarketConfig fields

12. Update `apps/periscope/src/views/GovernanceTurrets.tsx`:
    - Remove org/orgTierMembers DB queries if they are used only for display (verify)
    - The view currently reads `db.organizations` and `db.orgTierMembers` for KOS list display
    - For hackathon: keep as-is. The existing org data in local DB is read-only and still works for turret targeting display. ACL-based rework is deferred.
    - No import changes needed -- this view only imports from `@tehfrontier/chain-shared` for turret types (TURRET_TYPES, SHIP_CLASSES, etc.), not governance functions.

13. Build periscope: `pnpm build --filter @tehfrontier/periscope`

### Phase 8: Post-Deploy Setup

Publish contracts and create initial objects.

**Steps:**

1. Publish `contracts/market/` -- record package ID
2. Update `contracts/token_template/Move.toml` with market's published-at address
3. Compile token_template, extract bytecodes, update `TEMPLATE_BYTECODES_B64`
4. Publish token via dApp (buildPublishToken) -- this creates Coin\<T\> + Market\<T\> in one TX
5. Record Market\<T\> object ID from publish result
6. Publish `contracts/ssu_market/` with market dependency -- record package ID
7. Publish `contracts/ssu_market_utopia/` with market dependency -- record package ID
8. Call `ssu_market::create_ssu_config(ssu_id)` for each SSU that needs a market extension
9. Call `ssu_market::set_market(config, market_id)` to link each SsuConfig to its Market
10. Optionally call `ssu_market::add_delegate(config, delegate_addr)` for any delegates
11. Update `packages/chain-shared/src/config.ts` with all new package IDs and object IDs
12. Call `authorize_extension<MarketAuth>()` on each SSU (SSU owner must do this)
13. Mint initial token supply via `market::market::mint<T>` (authorized addresses only)

## File Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `contracts/market/Move.toml` | CREATE | 1 | New package manifest for unified market |
| `contracts/market/sources/market.move` | CREATE | 1 | Market\<T\> module: treasury + order book + auth |
| `contracts/token_template/Move.toml` | MODIFY | 2 | Add market dependency |
| `contracts/token_template/sources/token.move` | MODIFY | 2 | init() creates Market via create_market, remove mint/burn |
| `contracts/ssu_market/Move.toml` | MODIFY | 3 | Replace governance dep with market |
| `contracts/ssu_market/sources/ssu_market.move` | REWRITE | 3 | SsuConfig (owner/delegates/optional market_id), transfers, trade execution via Market\<T\> |
| `contracts/ssu_market_utopia/Move.toml` | MODIFY | 4 | Replace governance dep with market |
| `contracts/ssu_market_utopia/sources/ssu_market.move` | REWRITE | 4 | Mirror ssu_market changes (SsuConfig + delegation) |
| `contracts/governance/` | DELETE | 3 | Replaced by Market.authorized |
| `contracts/governance_ext/` | DELETE | 3 | Replaced by Market.treasury_cap |
| `contracts/currency_market/` | DELETE | 1 | Replaced by contracts/market/ |
| `packages/chain-shared/src/market.ts` | CREATE | 5 | Market TX builders + queries |
| `packages/chain-shared/src/claims.ts` | CREATE | 5 | Minimal claim builders (extracted from governance.ts) |
| `packages/chain-shared/src/currency-market.ts` | DELETE | 5 | Replaced by market.ts |
| `packages/chain-shared/src/governance.ts` | DELETE | 5 | Org builders removed; claim builders moved to claims.ts |
| `packages/chain-shared/src/treasury.ts` | DELETE | 5 | Replaced by Market mint/burn in market.ts |
| `packages/chain-shared/src/ssu-market.ts` | REWRITE | 5 | SsuConfig builders (create, delegates, market link), remove OrgMarket/MarketConfig |
| `packages/chain-shared/src/types.ts` | MODIFY | 5 | Remove org/currency-market types, add Market types |
| `packages/chain-shared/src/config.ts` | MODIFY | 5 | Remove currencyMarket/governanceExt, add market, keep governance |
| `packages/chain-shared/src/index.ts` | MODIFY | 5 | Remove currency-market/governance/treasury exports, add market/claims |
| `packages/chain-shared/src/turret-priority.ts` | MODIFY | 5 | Remove dead `generateOrgTurretConfig` + OrganizationInfo import |
| `packages/chain-shared/src/token-factory.ts` | MODIFY | 5 | New bytecodes, market dependency, Market in parse result |
| `apps/ssu-dapp/src/hooks/useMarketConfig.ts` | REWRITE | 6 | Rename to useSsuConfig, discover SsuConfig |
| `apps/ssu-dapp/src/views/SsuView.tsx` | MODIFY | 6 | useSsuConfig, ssuConfigId in context |
| `apps/ssu-dapp/src/components/TransferDialog.tsx` | MODIFY | 6 | ssuConfigId replaces marketConfigId |
| `apps/ssu-dapp/src/components/InventoryTabs.tsx` | MODIFY | 6 | Update market config references |
| `apps/ssu-market-dapp/src/lib/constants.ts` | MODIFY | 6 | MARKET_PACKAGE_ID replaces CURRENCY_MARKET_PACKAGE_ID |
| `apps/ssu-market-dapp/src/components/CurrencyMarketBrowser.tsx` | RENAME+MODIFY | 6 | -> MarketBrowser.tsx, use Market queries |
| `apps/ssu-market-dapp/src/components/CurrencyMarketDetail.tsx` | RENAME+MODIFY | 6 | -> MarketDetail.tsx, use Market queries |
| `apps/ssu-market-dapp/src/components/ListingCard.tsx` | MODIFY | 6 | Replace MarketInfo + buildBuySellOrder |
| `apps/ssu-market-dapp/src/components/OwnerView.tsx` | MODIFY | 6 | Replace MarketInfo + old sell order builders |
| `apps/ssu-market-dapp/src/components/PostSellListingForm.tsx` | MODIFY | 6 | Use new market.ts buildPostSellListing |
| `apps/ssu-market-dapp/src/components/PostBuyOrderForm.tsx` | MODIFY | 6 | Use new market.ts buildPostBuyOrder |
| `apps/ssu-market-dapp/src/components/BuyerView.tsx` | MODIFY | 6 | Replace MarketInfo type |
| `apps/ssu-market-dapp/src/components/ListingForm.tsx` | MODIFY | 6 | Replace MarketInfo type |
| `apps/ssu-market-dapp/src/components/MarketView.tsx` | MODIFY | 6 | Update type references |
| `apps/ssu-market-dapp/src/hooks/useMarketConfig.ts` | MODIFY | 6 | Use SsuConfig query instead of MarketConfig |
| `apps/ssu-market-dapp/src/hooks/useMarketListings.ts` | MODIFY | 6 | Use Market listings query instead of SellOrder |
| `apps/ssu-market-dapp/src/App.tsx` | MODIFY | 6 | Import renamed components |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | DELETE | 7 | Organization view removed (org model deleted) |
| `apps/periscope/src/views/GovernanceTrade.tsx` | DELETE | 7 | Trade view removed (moves to ssu-dapp) |
| `apps/periscope/src/views/GovernanceFinance.tsx` | REWRITE+RENAME | 7 | -> Finance.tsx, use Market\<T\> for mint/burn/auth |
| `apps/periscope/src/views/GovernanceClaims.tsx` | VERIFY | 7 | No changes -- barrel export handles claims.ts re-export |
| `apps/periscope/src/hooks/useOrgMarket.ts` | DELETE | 7 | OrgMarket hook removed (OrgMarket deleted) |
| `apps/periscope/src/hooks/useSellOrders.ts` | DELETE | 7 | Sell orders hook removed (queries deleted types) |
| `apps/periscope/src/views/Extensions.tsx` | MODIFY | 7 | Replace MarketConfig queries with SsuConfig queries |
| `apps/periscope/src/components/Sidebar.tsx` | MODIFY | 7 | Remove Organization + Trade nav items |
| `apps/periscope/src/router.tsx` | MODIFY | 7 | Remove Dashboard/Trade routes, add /governance redirect |
| `apps/periscope/src/db/types.ts` | MODIFY | 7 | Update CurrencyRecord: remove orgId/treasuryCapId, add marketId |
| `apps/periscope/src/db/index.ts` | MODIFY | 7 | New Dexie version with updated currencies schema |

## Open Questions

None -- all design decisions resolved.

## Deferred

- **Governance reboot:** The Organization model (tribes, characters, tiers) was useful for game mechanics (KOS lists, turret targeting). If governance is needed later, it should be a standalone concern decoupled from treasury/market management. The `authorized` list on Market handles the immediate need.
- **GovernanceTurrets ACL rework:** Turret deployment works independently of governance. The org-aware targeting (KOS list from opposition tier, friendly tribes from membership) currently reads from local DB org data. Reworking to use ACL-based targeting (gate_acl, acl_registry) is a post-hackathon task. The view continues to work as-is with existing org data in Dexie.
- **GovernanceClaims rework:** System claims reference org_id on-chain via the existing published governance contract. The claims view still works with existing published org objects. Redesigning claims to use ACLs or Market-based authority is post-hackathon. The `buildCreateClaim`/`buildRemoveClaim` builders are preserved in the new claims.ts module.
- **DB table cleanup:** The `organizations`, `orgTierMembers`, and `tradeNodes` Dexie tables remain in the schema (Dexie versions are append-only) but are no longer written to by new code. GovernanceTurrets and GovernanceClaims still read from them. A future migration could archive or repurpose these tables.
- **Fee collection on buy order fills:** The exact fee flow for fill_buy_order (who pays the fee -- buyer's escrowed funds or seller's proceeds?) can be finalized during implementation. The plan assumes fee is deducted from the escrowed payment before transferring to seller.
- **Market upgradeability:** Market\<T\> is a shared object. If we need to add fields later, we'd need a new package publish. This is acceptable for the hackathon but should be considered for production.
- **Multi-SSU sell listings:** A seller with multiple SSUs could post listings from each. The SellListing.ssu_id field tells buyers which SSU to visit. No aggregation is planned.
