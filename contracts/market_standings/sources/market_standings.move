/// Standings-based Market<T>: treasury + order book + standings authorization.
///
/// Replaces the address-based allowlist from `market::market` with standings-based
/// authorization powered by StandingsRegistry. Three configurable thresholds:
///   - min_mint: minimum standing to mint new tokens
///   - min_trade: minimum standing to post sell listings
///   - min_buy: minimum standing to buy from listings / post buy orders
///
/// No world dependency -- callers pass tribe_id and char_id directly.
/// The ssu_market_standings contract extracts IDs from &Character.
module market_standings::market_standings;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;
use standings_registry::standings_registry::{Self, StandingsRegistry};

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotCreator: vector<u8> = b"Only the market creator can perform this action";

#[error(code = 1)]
const ERegistryMismatch: vector<u8> = b"Supplied registry does not match stored registry_id";

#[error(code = 2)]
const EStandingTooLow: vector<u8> = b"Character standing is below the required threshold";

#[error(code = 3)]
const ENotSeller: vector<u8> = b"Only the listing seller can modify this listing";

#[error(code = 4)]
const ENotBuyer: vector<u8> = b"Only the order buyer can modify this order";

#[error(code = 5)]
const EListingNotFound: vector<u8> = b"Sell listing not found";

#[error(code = 6)]
const EOrderNotFound: vector<u8> = b"Buy order not found";

#[error(code = 7)]
const EExceedsOrderQuantity: vector<u8> = b"Fill quantity exceeds remaining order quantity";

#[error(code = 8)]
const EInsufficientPayment: vector<u8> = b"Payment is less than the required escrow amount";

#[error(code = 9)]
const EZeroQuantity: vector<u8> = b"Quantity must be greater than zero";

#[error(code = 10)]
const EInvalidFeeBps: vector<u8> = b"Fee basis points must be <= 10000";

// -- Structs --------------------------------------------------------------------

/// Unified market object: treasury + order book + standings authorization.
public struct Market<phantom T> has key {
    id: UID,
    creator: address,
    treasury_cap: TreasuryCap<T>,
    fee_bps: u64,
    fee_recipient: address,
    next_sell_id: u64,
    next_buy_id: u64,
    registry_id: ID,
    min_mint: u8,
    min_trade: u8,
    min_buy: u8,
}

/// Dynamic field key for sell listings.
public struct SellKey has copy, drop, store { listing_id: u64 }

/// Dynamic field key for buy orders.
public struct BuyKey has copy, drop, store { order_id: u64 }

/// Dynamic field key for escrowed coins on buy orders.
public struct BuyCoinKey has copy, drop, store { order_id: u64 }

/// Sell listing: advertisement pointing to an SSU.
/// Items stay in the SSU -- this is a directory entry for discovery.
public struct SellListing has store, drop {
    listing_id: u64,
    seller: address,
    ssu_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    posted_at_ms: u64,
}

/// Buy order: buyer wants to purchase items, paying Coin<T>.
public struct BuyOrder has store, drop {
    order_id: u64,
    buyer: address,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    original_quantity: u64,
    posted_at_ms: u64,
}

// -- Events ---------------------------------------------------------------------

public struct MarketCreatedEvent has copy, drop {
    market_id: ID,
    creator: address,
    registry_id: ID,
    min_mint: u8,
    min_trade: u8,
    min_buy: u8,
}

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

public struct SellListingUpdatedEvent has copy, drop {
    market_id: ID,
    listing_id: u64,
    price_per_unit: u64,
    quantity: u64,
}

public struct SellListingCancelledEvent has copy, drop {
    market_id: ID,
    listing_id: u64,
}

public struct BuyOrderPostedEvent has copy, drop {
    market_id: ID,
    order_id: u64,
    buyer: address,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    posted_at_ms: u64,
}

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

public struct BuyOrderCancelledEvent has copy, drop {
    market_id: ID,
    order_id: u64,
    buyer: address,
    type_id: u64,
    refund_amount: u64,
}

public struct MintEvent has copy, drop {
    market_id: ID,
    amount: u64,
    recipient: address,
    minter: address,
}

public struct BurnEvent has copy, drop {
    market_id: ID,
    amount: u64,
    burner: address,
}

public struct StandingsConfigUpdatedEvent has copy, drop {
    market_id: ID,
    registry_id: ID,
    min_mint: u8,
    min_trade: u8,
    min_buy: u8,
}

// -- Standing check helper ------------------------------------------------------

/// Public helper: verifies registry matches and standing meets threshold.
/// Used internally and available for external callers (e.g., ssu_market_standings).
public fun check_standing<T>(
    market: &Market<T>,
    registry: &StandingsRegistry,
    tribe_id: u32,
    char_id: u64,
    threshold: u8,
) {
    assert!(object::id(registry) == market.registry_id, ERegistryMismatch);
    let standing = standings_registry::get_standing(registry, tribe_id, char_id);
    assert!(standing >= threshold, EStandingTooLow);
}

// -- Market creation ------------------------------------------------------------

/// Create a Market<T> by consuming TreasuryCap. TreasuryCap is locked inside
/// the Market and cannot be extracted. The creator is set as the fee recipient.
/// Registry ID is stored but not verified at creation -- caller must ensure it
/// points to a valid StandingsRegistry.
#[allow(lint(share_owned))]
public fun create_market<T>(
    treasury_cap: TreasuryCap<T>,
    registry_id: ID,
    min_mint: u8,
    min_trade: u8,
    min_buy: u8,
    ctx: &mut TxContext,
) {
    let creator = ctx.sender();
    let market = Market<T> {
        id: object::new(ctx),
        creator,
        treasury_cap,
        fee_bps: 0,
        fee_recipient: creator,
        next_sell_id: 0,
        next_buy_id: 0,
        registry_id,
        min_mint,
        min_trade,
        min_buy,
    };

    event::emit(MarketCreatedEvent {
        market_id: object::id(&market),
        creator,
        registry_id,
        min_mint,
        min_trade,
        min_buy,
    });

    transfer::share_object(market);
}

// -- Mint/burn (standings-gated) ------------------------------------------------

/// Mint new tokens. Requires standing >= min_mint.
public fun mint<T>(
    market: &mut Market<T>,
    registry: &StandingsRegistry,
    tribe_id: u32,
    char_id: u64,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    check_standing(market, registry, tribe_id, char_id, market.min_mint);

    let minted = coin::mint(&mut market.treasury_cap, amount, ctx);
    transfer::public_transfer(minted, recipient);

    event::emit(MintEvent {
        market_id: object::id(market),
        amount,
        recipient,
        minter: ctx.sender(),
    });
}

/// Burn tokens. Any holder can burn (no standings check).
public fun burn<T>(
    market: &mut Market<T>,
    coin: Coin<T>,
    ctx: &TxContext,
) {
    let amount = coin::value(&coin);
    coin::burn(&mut market.treasury_cap, coin);

    event::emit(BurnEvent {
        market_id: object::id(market),
        amount,
        burner: ctx.sender(),
    });
}

// -- Fee management (creator only) ----------------------------------------------

/// Update fee configuration. Creator only.
public fun update_fee<T>(
    market: &mut Market<T>,
    fee_bps: u64,
    fee_recipient: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == market.creator, ENotCreator);
    assert!(fee_bps <= 10000, EInvalidFeeBps);
    market.fee_bps = fee_bps;
    market.fee_recipient = fee_recipient;
}

// -- Standings config management (creator only) ---------------------------------

/// Update standings configuration. Creator only.
/// Allows changing the registry and/or thresholds.
public fun update_standings_config<T>(
    market: &mut Market<T>,
    registry_id: ID,
    min_mint: u8,
    min_trade: u8,
    min_buy: u8,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == market.creator, ENotCreator);
    market.registry_id = registry_id;
    market.min_mint = min_mint;
    market.min_trade = min_trade;
    market.min_buy = min_buy;

    event::emit(StandingsConfigUpdatedEvent {
        market_id: object::id(market),
        registry_id,
        min_mint,
        min_trade,
        min_buy,
    });
}

// -- Sell listings (standings-gated) --------------------------------------------

/// Post a sell listing. Requires standing >= min_trade.
public fun post_sell_listing<T>(
    market: &mut Market<T>,
    registry: &StandingsRegistry,
    tribe_id: u32,
    char_id: u64,
    ssu_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(quantity > 0, EZeroQuantity);
    check_standing(market, registry, tribe_id, char_id, market.min_trade);

    let listing_id = market.next_sell_id;
    market.next_sell_id = listing_id + 1;

    let listing = SellListing {
        listing_id,
        seller: ctx.sender(),
        ssu_id,
        type_id,
        price_per_unit,
        quantity,
        posted_at_ms: clock.timestamp_ms(),
    };

    dynamic_field::add(&mut market.id, SellKey { listing_id }, listing);

    event::emit(SellListingPostedEvent {
        market_id: object::id(market),
        listing_id,
        seller: ctx.sender(),
        ssu_id,
        type_id,
        price_per_unit,
        quantity,
        posted_at_ms: clock.timestamp_ms(),
    });
}

/// Update price and quantity on an existing sell listing. Seller only.
/// No standings re-check -- you already passed the check when posting.
public fun update_sell_listing<T>(
    market: &mut Market<T>,
    listing_id: u64,
    price_per_unit: u64,
    quantity: u64,
    ctx: &TxContext,
) {
    let key = SellKey { listing_id };
    assert!(dynamic_field::exists_(&market.id, key), EListingNotFound);

    let listing = dynamic_field::borrow_mut<SellKey, SellListing>(&mut market.id, key);
    assert!(listing.seller == ctx.sender(), ENotSeller);

    listing.price_per_unit = price_per_unit;
    listing.quantity = quantity;

    event::emit(SellListingUpdatedEvent {
        market_id: object::id(market),
        listing_id,
        price_per_unit,
        quantity,
    });
}

/// Cancel a sell listing. Seller only. No standings check for cancellation.
public fun cancel_sell_listing<T>(
    market: &mut Market<T>,
    listing_id: u64,
    ctx: &TxContext,
) {
    let key = SellKey { listing_id };
    assert!(dynamic_field::exists_(&market.id, key), EListingNotFound);

    let listing = dynamic_field::borrow<SellKey, SellListing>(&market.id, key);
    assert!(listing.seller == ctx.sender(), ENotSeller);

    dynamic_field::remove<SellKey, SellListing>(&mut market.id, key);

    event::emit(SellListingCancelledEvent {
        market_id: object::id(market),
        listing_id,
    });
}

// -- Buy orders (standings-gated) -----------------------------------------------

/// Post a buy order with escrowed Coin<T>. Requires standing >= min_buy.
public fun post_buy_order<T>(
    market: &mut Market<T>,
    registry: &StandingsRegistry,
    tribe_id: u32,
    char_id: u64,
    payment: Coin<T>,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(quantity > 0, EZeroQuantity);
    check_standing(market, registry, tribe_id, char_id, market.min_buy);

    let total_cost = price_per_unit * quantity;
    assert!(coin::value(&payment) >= total_cost, EInsufficientPayment);

    let order_id = market.next_buy_id;
    market.next_buy_id = order_id + 1;

    let posted_at_ms = clock.timestamp_ms();

    let record = BuyOrder {
        order_id,
        buyer: ctx.sender(),
        type_id,
        price_per_unit,
        quantity,
        original_quantity: quantity,
        posted_at_ms,
    };

    dynamic_field::add(&mut market.id, BuyKey { order_id }, record);
    dynamic_field::add(&mut market.id, BuyCoinKey { order_id }, payment);

    event::emit(BuyOrderPostedEvent {
        market_id: object::id(market),
        order_id,
        buyer: ctx.sender(),
        type_id,
        price_per_unit,
        quantity,
        posted_at_ms,
    });
}

/// Cancel a buy order. Returns escrowed coins to the buyer.
/// No standings check for cancellation.
public fun cancel_buy_order<T>(
    market: &mut Market<T>,
    order_id: u64,
    ctx: &mut TxContext,
) {
    let key = BuyKey { order_id };
    assert!(dynamic_field::exists_(&market.id, key), EOrderNotFound);

    let record = dynamic_field::borrow<BuyKey, BuyOrder>(&market.id, key);
    assert!(record.buyer == ctx.sender(), ENotBuyer);
    let buyer = record.buyer;
    let type_id = record.type_id;

    dynamic_field::remove<BuyKey, BuyOrder>(&mut market.id, key);

    let coins = dynamic_field::remove<BuyCoinKey, Coin<T>>(
        &mut market.id, BuyCoinKey { order_id },
    );
    let refund_amount = coin::value(&coins);
    transfer::public_transfer(coins, ctx.sender());

    event::emit(BuyOrderCancelledEvent {
        market_id: object::id(market),
        order_id,
        buyer,
        type_id,
        refund_amount,
    });
}

// -- Read accessors (for ssu_market_standings to call) --------------------------

public fun market_creator<T>(market: &Market<T>): address {
    market.creator
}

public fun market_fee_bps<T>(market: &Market<T>): u64 {
    market.fee_bps
}

public fun market_fee_recipient<T>(market: &Market<T>): address {
    market.fee_recipient
}

public fun next_sell_id<T>(market: &Market<T>): u64 {
    market.next_sell_id
}

public fun next_buy_id<T>(market: &Market<T>): u64 {
    market.next_buy_id
}

public fun market_registry_id<T>(market: &Market<T>): ID {
    market.registry_id
}

public fun market_min_mint<T>(market: &Market<T>): u8 {
    market.min_mint
}

public fun market_min_trade<T>(market: &Market<T>): u8 {
    market.min_trade
}

public fun market_min_buy<T>(market: &Market<T>): u8 {
    market.min_buy
}

public fun total_supply<T>(market: &Market<T>): u64 {
    coin::total_supply(&market.treasury_cap)
}

// -- Write accessors (for ssu_market_standings trade execution) -----------------

public fun borrow_sell_listing<T>(market: &Market<T>, listing_id: u64): &SellListing {
    let key = SellKey { listing_id };
    assert!(dynamic_field::exists_(&market.id, key), EListingNotFound);
    dynamic_field::borrow<SellKey, SellListing>(&market.id, key)
}

public fun borrow_sell_listing_mut<T>(
    market: &mut Market<T>, listing_id: u64,
): &mut SellListing {
    let key = SellKey { listing_id };
    assert!(dynamic_field::exists_(&market.id, key), EListingNotFound);
    dynamic_field::borrow_mut<SellKey, SellListing>(&mut market.id, key)
}

public fun remove_sell_listing<T>(
    market: &mut Market<T>, listing_id: u64,
): SellListing {
    let key = SellKey { listing_id };
    assert!(dynamic_field::exists_(&market.id, key), EListingNotFound);
    dynamic_field::remove<SellKey, SellListing>(&mut market.id, key)
}

public fun has_sell_listing<T>(market: &Market<T>, listing_id: u64): bool {
    dynamic_field::exists_(&market.id, SellKey { listing_id })
}

public fun borrow_buy_order<T>(market: &Market<T>, order_id: u64): &BuyOrder {
    let key = BuyKey { order_id };
    assert!(dynamic_field::exists_(&market.id, key), EOrderNotFound);
    dynamic_field::borrow<BuyKey, BuyOrder>(&market.id, key)
}

public fun borrow_buy_order_mut<T>(
    market: &mut Market<T>, order_id: u64,
): &mut BuyOrder {
    let key = BuyKey { order_id };
    assert!(dynamic_field::exists_(&market.id, key), EOrderNotFound);
    dynamic_field::borrow_mut<BuyKey, BuyOrder>(&mut market.id, key)
}

public fun remove_buy_order<T>(market: &mut Market<T>, order_id: u64): BuyOrder {
    let key = BuyKey { order_id };
    assert!(dynamic_field::exists_(&market.id, key), EOrderNotFound);
    dynamic_field::remove<BuyKey, BuyOrder>(&mut market.id, key)
}

public fun has_buy_order<T>(market: &Market<T>, order_id: u64): bool {
    dynamic_field::exists_(&market.id, BuyKey { order_id })
}

/// Split amount from escrowed coin for a given buy order.
public fun split_escrowed_coin<T>(
    market: &mut Market<T>, order_id: u64, amount: u64, ctx: &mut TxContext,
): Coin<T> {
    let key = BuyCoinKey { order_id };
    let escrowed = dynamic_field::borrow_mut<BuyCoinKey, Coin<T>>(&mut market.id, key);
    coin::split(escrowed, amount, ctx)
}

/// Remove and return the entire escrowed coin for a given buy order.
public fun remove_escrowed_coin<T>(market: &mut Market<T>, order_id: u64): Coin<T> {
    let key = BuyCoinKey { order_id };
    dynamic_field::remove<BuyCoinKey, Coin<T>>(&mut market.id, key)
}

// -- SellListing field accessors ------------------------------------------------

public fun listing_id(listing: &SellListing): u64 { listing.listing_id }
public fun listing_seller(listing: &SellListing): address { listing.seller }
public fun listing_ssu_id(listing: &SellListing): ID { listing.ssu_id }
public fun listing_type_id(listing: &SellListing): u64 { listing.type_id }
public fun listing_price_per_unit(listing: &SellListing): u64 { listing.price_per_unit }
public fun listing_quantity(listing: &SellListing): u64 { listing.quantity }
public fun set_listing_quantity(listing: &mut SellListing, quantity: u64) {
    listing.quantity = quantity;
}

// -- BuyOrder field accessors ---------------------------------------------------

public fun order_id(order: &BuyOrder): u64 { order.order_id }
public fun order_buyer(order: &BuyOrder): address { order.buyer }
public fun order_type_id(order: &BuyOrder): u64 { order.type_id }
public fun order_price_per_unit(order: &BuyOrder): u64 { order.price_per_unit }
public fun order_quantity(order: &BuyOrder): u64 { order.quantity }
public fun order_original_quantity(order: &BuyOrder): u64 { order.original_quantity }
public fun order_posted_at_ms(order: &BuyOrder): u64 { order.posted_at_ms }
public fun set_order_quantity(order: &mut BuyOrder, quantity: u64) {
    order.quantity = quantity;
}

// -- Tests ----------------------------------------------------------------------

#[test_only]
use sui::test_scenario;

#[test_only]
use sui::coin::CoinMetadata;

#[test_only]
/// Test-only OTW for creating a test currency.
public struct MARKET_STANDINGS has drop {}

#[test_only]
fun create_test_registry(scenario: &mut test_scenario::Scenario) {
    standings_registry::create_registry(
        b"Test Registry",
        b"TEST",
        3, // default standing = Neutral
        test_scenario::ctx(scenario),
    );
}

#[test_only]
fun create_test_market(
    scenario: &mut test_scenario::Scenario,
    registry_id: ID,
) {
    let ctx = test_scenario::ctx(scenario);
    let (treasury_cap, metadata) = coin::create_currency(
        MARKET_STANDINGS {},
        9,
        b"TEST",
        b"Test Token",
        b"A test token",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    create_market(treasury_cap, registry_id, 4, 3, 3, ctx);
}

#[test]
fun test_create_market() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);

    test_scenario::next_tx(&mut scenario, admin);
    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    test_scenario::next_tx(&mut scenario, admin);
    {
        let market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        assert!(market_creator(&market) == admin);
        assert!(market_fee_bps(&market) == 0);
        assert!(market_fee_recipient(&market) == admin);
        assert!(next_sell_id(&market) == 0);
        assert!(next_buy_id(&market) == 0);
        assert!(total_supply(&market) == 0);
        assert!(market_registry_id(&market) == reg_id);
        assert!(market_min_mint(&market) == 4);
        assert!(market_min_trade(&market) == 3);
        assert!(market_min_buy(&market) == 3);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_mint_with_sufficient_standing() {
    let admin = @0xA;
    let user = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Set admin's tribe standing to 5 (Ally) -- above min_mint=4
    standings_registry::set_tribe_standing(&mut registry, 1, 5, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Mint tokens
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        mint(&mut market, &registry, 1, 100, 1000, user, test_scenario::ctx(&mut scenario));
        assert!(total_supply(&market) == 1000);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = EStandingTooLow)]
fun test_mint_with_insufficient_standing() {
    let admin = @0xA;
    let user = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Default standing is 3 (Neutral) -- below min_mint=4
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Try to mint with insufficient standing -- should fail
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        mint(&mut market, &registry, 1, 100, 1000, user, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_burn() {
    let admin = @0xA;
    let user = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    standings_registry::set_tribe_standing(&mut registry, 1, 5, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Mint
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        mint(&mut market, &registry, 1, 100, 1000, user, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    // Burn (any holder, no standing check)
    test_scenario::next_tx(&mut scenario, user);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let coin = test_scenario::take_from_sender<Coin<MARKET_STANDINGS>>(&scenario);
        assert!(coin::value(&coin) == 1000);
        burn(&mut market, coin, test_scenario::ctx(&mut scenario));
        assert!(total_supply(&market) == 0);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_sell_listing_with_standings() {
    let admin = @0xA;
    let seller = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Set seller's tribe standing to 4 (Friendly) -- above min_trade=3
    standings_registry::set_tribe_standing(&mut registry, 2, 4, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Post sell listing
    test_scenario::next_tx(&mut scenario, seller);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let ssu_id = object::id_from_address(@0x100);
        post_sell_listing(
            &mut market, &registry, 2, 200, ssu_id, 42, 100, 10, &clock,
            test_scenario::ctx(&mut scenario),
        );

        assert!(has_sell_listing<MARKET_STANDINGS>(&market, 0));
        let listing = borrow_sell_listing<MARKET_STANDINGS>(&market, 0);
        assert!(listing_seller(listing) == seller);
        assert!(listing_type_id(listing) == 42);
        assert!(listing_price_per_unit(listing) == 100);
        assert!(listing_quantity(listing) == 10);
        assert!(next_sell_id(&market) == 1);

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    // Update listing (no standings re-check)
    test_scenario::next_tx(&mut scenario, seller);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        update_sell_listing<MARKET_STANDINGS>(&mut market, 0, 200, 5, test_scenario::ctx(&mut scenario));
        let listing = borrow_sell_listing<MARKET_STANDINGS>(&market, 0);
        assert!(listing_price_per_unit(listing) == 200);
        assert!(listing_quantity(listing) == 5);
        test_scenario::return_shared(market);
    };

    // Cancel listing (no standings check)
    test_scenario::next_tx(&mut scenario, seller);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        cancel_sell_listing<MARKET_STANDINGS>(&mut market, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_sell_listing<MARKET_STANDINGS>(&market, 0));
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = EStandingTooLow)]
fun test_sell_listing_insufficient_standing() {
    let admin = @0xA;
    let seller = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Set seller's tribe standing to 2 (Unfriendly) -- below min_trade=3
    standings_registry::set_tribe_standing(&mut registry, 2, 2, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Try to post sell listing -- should fail
    test_scenario::next_tx(&mut scenario, seller);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let ssu_id = object::id_from_address(@0x100);
        post_sell_listing(
            &mut market, &registry, 2, 200, ssu_id, 42, 100, 10, &clock,
            test_scenario::ctx(&mut scenario),
        );
        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_buy_order_with_standings() {
    let admin = @0xA;
    let buyer = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Set admin to Ally for minting, buyer to Friendly for buying
    standings_registry::set_tribe_standing(&mut registry, 1, 5, test_scenario::ctx(&mut scenario));
    standings_registry::set_tribe_standing(&mut registry, 2, 4, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Mint coins for buyer
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        mint(&mut market, &registry, 1, 100, 5000, buyer, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    // Post buy order
    test_scenario::next_tx(&mut scenario, buyer);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let coin = test_scenario::take_from_sender<Coin<MARKET_STANDINGS>>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));
        post_buy_order(
            &mut market, &registry, 2, 200, coin, 42, 100, 10, &clock,
            test_scenario::ctx(&mut scenario),
        );

        assert!(has_buy_order<MARKET_STANDINGS>(&market, 0));
        let order = borrow_buy_order<MARKET_STANDINGS>(&market, 0);
        assert!(order_buyer(order) == buyer);
        assert!(order_type_id(order) == 42);
        assert!(order_price_per_unit(order) == 100);
        assert!(order_quantity(order) == 10);
        assert!(next_buy_id(&market) == 1);

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    // Cancel buy order -- coins returned
    test_scenario::next_tx(&mut scenario, buyer);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        cancel_buy_order<MARKET_STANDINGS>(&mut market, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_buy_order<MARKET_STANDINGS>(&market, 0));
        test_scenario::return_shared(market);
    };

    // Verify coins returned to buyer
    test_scenario::next_tx(&mut scenario, buyer);
    {
        let coin = test_scenario::take_from_sender<Coin<MARKET_STANDINGS>>(&scenario);
        assert!(coin::value(&coin) == 5000);
        test_scenario::return_to_sender(&scenario, coin);
    };

    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = EStandingTooLow)]
fun test_buy_order_insufficient_standing() {
    let admin = @0xA;
    let buyer = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Admin gets Ally for minting, buyer gets Unfriendly (below min_buy=3)
    standings_registry::set_tribe_standing(&mut registry, 1, 5, test_scenario::ctx(&mut scenario));
    standings_registry::set_tribe_standing(&mut registry, 2, 2, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Mint coins for buyer
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        mint(&mut market, &registry, 1, 100, 5000, buyer, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    // Try to post buy order with insufficient standing -- should fail
    test_scenario::next_tx(&mut scenario, buyer);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let coin = test_scenario::take_from_sender<Coin<MARKET_STANDINGS>>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));
        post_buy_order(
            &mut market, &registry, 2, 200, coin, 42, 100, 10, &clock,
            test_scenario::ctx(&mut scenario),
        );
        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = ERegistryMismatch)]
fun test_registry_mismatch() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    // Create two registries
    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);
    standings_registry::create_registry(
        b"Other Registry", b"OTH", 3, test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, admin);
    let reg1 = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg2 = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg1_id = object::id(&reg1);
    test_scenario::return_shared(reg1);
    test_scenario::return_shared(reg2);

    // Create market with reg1
    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg1_id);

    // Try to mint using reg2 -- should fail
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        // Take both registries and use the wrong one
        let reg_a = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let reg_b = test_scenario::take_shared<StandingsRegistry>(&scenario);
        // Use whichever one does NOT match the market's registry_id
        let (wrong_reg, other_reg) = if (object::id(&reg_a) == reg1_id) {
            (reg_b, reg_a)
        } else {
            (reg_a, reg_b)
        };
        mint(
            &mut market, &wrong_reg, 1, 100, 1000, admin,
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(wrong_reg);
        test_scenario::return_shared(other_reg);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_update_standings_config() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Update standings config
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let new_reg_id = object::id_from_address(@0x999);
        update_standings_config(
            &mut market, new_reg_id, 5, 4, 2,
            test_scenario::ctx(&mut scenario),
        );
        assert!(market_registry_id(&market) == new_reg_id);
        assert!(market_min_mint(&market) == 5);
        assert!(market_min_trade(&market) == 4);
        assert!(market_min_buy(&market) == 2);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = ENotCreator)]
fun test_non_creator_cannot_update_config() {
    let admin = @0xA;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    // Stranger tries to update config -- should fail
    test_scenario::next_tx(&mut scenario, stranger);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        update_standings_config(
            &mut market, reg_id, 1, 1, 1,
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_check_standing_public_helper() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    standings_registry::set_tribe_standing(&mut registry, 10, 5, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    test_scenario::next_tx(&mut scenario, admin);
    {
        let market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        // Standing is 5, threshold 3 -- should pass
        check_standing(&market, &registry, 10, 999, 3);
        // Standing is 5, threshold 5 -- should pass (equal)
        check_standing(&market, &registry, 10, 999, 5);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_update_fee() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, admin);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, admin);
    create_test_market(&mut scenario, reg_id);

    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET_STANDINGS>>(&scenario);
        let fee_addr = @0xFEE;
        update_fee(&mut market, 250, fee_addr, test_scenario::ctx(&mut scenario));
        assert!(market_fee_bps(&market) == 250);
        assert!(market_fee_recipient(&market) == fee_addr);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}
