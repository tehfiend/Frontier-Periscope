/// Unified Market<T>: treasury + order book + authorization in one object.
///
/// Consuming the TreasuryCap on creation locks minting authority inside the
/// Market. Authorized addresses can mint; any holder can burn. Sell listings
/// and buy orders live as dynamic fields on the Market, keyed by typed wrapper
/// structs to avoid collisions.
module market::market;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotCreator: vector<u8> = b"Only the market creator can manage authorized list";

#[error(code = 1)]
const ENotAuthorized: vector<u8> = b"Only authorized addresses can mint";

#[error(code = 2)]
const ENotSeller: vector<u8> = b"Only the listing seller can modify this listing";

#[error(code = 3)]
const ENotBuyer: vector<u8> = b"Only the order buyer can modify this order";

#[error(code = 4)]
const EListingNotFound: vector<u8> = b"Sell listing not found";

#[error(code = 5)]
const EOrderNotFound: vector<u8> = b"Buy order not found";

#[error(code = 6)]
const EExceedsOrderQuantity: vector<u8> = b"Fill quantity exceeds remaining order quantity";

#[error(code = 7)]
const EInsufficientPayment: vector<u8> = b"Payment is less than the required escrow amount";

#[error(code = 8)]
const EZeroQuantity: vector<u8> = b"Quantity must be greater than zero";

#[error(code = 9)]
const EInvalidFeeBps: vector<u8> = b"Fee basis points must be <= 10000";

#[error(code = 10)]
const EAlreadyAuthorized: vector<u8> = b"Address is already in the authorized list";

// -- Structs --------------------------------------------------------------------

/// Unified market object: treasury + order book + authorization.
public struct Market<phantom T> has key {
    id: UID,
    creator: address,
    authorized: vector<address>,
    treasury_cap: TreasuryCap<T>,
    fee_bps: u64,
    fee_recipient: address,
    next_sell_id: u64,
    next_buy_id: u64,
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

public struct AuthorizedAddedEvent has copy, drop {
    market_id: ID,
    addr: address,
}

public struct AuthorizedRemovedEvent has copy, drop {
    market_id: ID,
    addr: address,
}

// -- Market creation ------------------------------------------------------------

/// Create a Market<T> by consuming TreasuryCap. TreasuryCap is locked inside
/// the Market and cannot be extracted. The creator is added to the authorized
/// list and set as the fee recipient.
#[allow(lint(share_owned))]
public fun create_market<T>(
    treasury_cap: TreasuryCap<T>,
    ctx: &mut TxContext,
) {
    let creator = ctx.sender();
    let market = Market<T> {
        id: object::new(ctx),
        creator,
        authorized: vector[creator],
        treasury_cap,
        fee_bps: 0,
        fee_recipient: creator,
        next_sell_id: 0,
        next_buy_id: 0,
    };

    event::emit(MarketCreatedEvent {
        market_id: object::id(&market),
        creator,
    });

    transfer::share_object(market);
}

// -- Mint/burn (authorized access) ----------------------------------------------

/// Mint new tokens. Only authorized addresses can call this.
public fun mint<T>(
    market: &mut Market<T>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let sender = ctx.sender();
    assert!(market.authorized.contains(&sender), ENotAuthorized);

    let minted = coin::mint(&mut market.treasury_cap, amount, ctx);
    transfer::public_transfer(minted, recipient);

    event::emit(MintEvent {
        market_id: object::id(market),
        amount,
        recipient,
        minter: sender,
    });
}

/// Burn tokens. Any holder can burn.
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

// -- Authorization management (creator only) ------------------------------------

/// Add an address to the authorized list. Creator only.
public fun add_authorized<T>(
    market: &mut Market<T>,
    addr: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == market.creator, ENotCreator);
    let (found, _) = market.authorized.index_of(&addr);
    assert!(!found, EAlreadyAuthorized);
    market.authorized.push_back(addr);

    event::emit(AuthorizedAddedEvent {
        market_id: object::id(market),
        addr,
    });
}

/// Remove an address from the authorized list. Creator only.
public fun remove_authorized<T>(
    market: &mut Market<T>,
    addr: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == market.creator, ENotCreator);
    let (found, idx) = market.authorized.index_of(&addr);
    if (found) {
        market.authorized.remove(idx);
        event::emit(AuthorizedRemovedEvent {
            market_id: object::id(market),
            addr,
        });
    };
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

// -- Sell listings (anyone can post) --------------------------------------------

/// Post a sell listing. Anyone can post. Items stay in the SSU -- this is a
/// directory entry for discovery.
public fun post_sell_listing<T>(
    market: &mut Market<T>,
    ssu_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(quantity > 0, EZeroQuantity);

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

/// Cancel a sell listing. Seller only.
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

// -- Buy orders (anyone can post, with coin escrow) -----------------------------

/// Post a buy order with escrowed Coin<T>. Anyone can post.
public fun post_buy_order<T>(
    market: &mut Market<T>,
    payment: Coin<T>,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(quantity > 0, EZeroQuantity);
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
public fun cancel_buy_order<T>(
    market: &mut Market<T>,
    order_id: u64,
    ctx: &mut TxContext,
) {
    let key = BuyKey { order_id };
    assert!(dynamic_field::exists_(&market.id, key), EOrderNotFound);

    // Extract fields before removing the dynamic field
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

// -- Read accessors (for ssu_market to call) ------------------------------------

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

public fun is_authorized<T>(market: &Market<T>, addr: address): bool {
    market.authorized.contains(&addr)
}

public fun total_supply<T>(market: &Market<T>): u64 {
    coin::total_supply(&market.treasury_cap)
}

// -- Write accessors (for ssu_market trade execution) ---------------------------

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
public struct MARKET has drop {}

#[test_only]
fun create_test_market(scenario: &mut test_scenario::Scenario) {
    let ctx = test_scenario::ctx(scenario);
    let (treasury_cap, metadata) = coin::create_currency(
        MARKET {},
        9,
        b"TEST",
        b"Test Token",
        b"A test token",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    create_market(treasury_cap, ctx);
}

#[test]
fun test_create_market() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    create_test_market(&mut scenario);

    test_scenario::next_tx(&mut scenario, admin);
    {
        let market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        assert!(market_creator(&market) == admin);
        assert!(is_authorized(&market, admin));
        assert!(market_fee_bps(&market) == 0);
        assert!(market_fee_recipient(&market) == admin);
        assert!(next_sell_id(&market) == 0);
        assert!(next_buy_id(&market) == 0);
        assert!(total_supply(&market) == 0);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_mint_burn() {
    let admin = @0xA;
    let user = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_market(&mut scenario);

    // Mint tokens
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        mint(&mut market, 1000, user, test_scenario::ctx(&mut scenario));
        assert!(total_supply(&market) == 1000);
        test_scenario::return_shared(market);
    };

    // Burn tokens
    test_scenario::next_tx(&mut scenario, user);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        let coin = test_scenario::take_from_sender<Coin<MARKET>>(&scenario);
        assert!(coin::value(&coin) == 1000);
        burn(&mut market, coin, test_scenario::ctx(&mut scenario));
        assert!(total_supply(&market) == 0);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_unauthorized_mint() {
    let admin = @0xA;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(admin);

    create_test_market(&mut scenario);

    // Stranger tries to mint -- should fail
    test_scenario::next_tx(&mut scenario, stranger);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        mint(&mut market, 1000, stranger, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_sell_listing_lifecycle() {
    let admin = @0xA;
    let seller = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_market(&mut scenario);

    // Post listing
    test_scenario::next_tx(&mut scenario, seller);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));
        let ssu_id = object::id_from_address(@0x100);
        post_sell_listing(&mut market, ssu_id, 42, 100, 10, &clock, test_scenario::ctx(&mut scenario));

        assert!(has_sell_listing<MARKET>(&market, 0));
        let listing = borrow_sell_listing<MARKET>(&market, 0);
        assert!(listing_seller(listing) == seller);
        assert!(listing_type_id(listing) == 42);
        assert!(listing_price_per_unit(listing) == 100);
        assert!(listing_quantity(listing) == 10);
        assert!(next_sell_id(&market) == 1);

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(market);
    };

    // Update listing
    test_scenario::next_tx(&mut scenario, seller);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        update_sell_listing<MARKET>(&mut market, 0, 200, 5, test_scenario::ctx(&mut scenario));
        let listing = borrow_sell_listing<MARKET>(&market, 0);
        assert!(listing_price_per_unit(listing) == 200);
        assert!(listing_quantity(listing) == 5);
        test_scenario::return_shared(market);
    };

    // Cancel listing
    test_scenario::next_tx(&mut scenario, seller);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        cancel_sell_listing<MARKET>(&mut market, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_sell_listing<MARKET>(&market, 0));
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_buy_order_lifecycle() {
    let admin = @0xA;
    let buyer = @0xB;
    let mut scenario = test_scenario::begin(admin);

    create_test_market(&mut scenario);

    // Mint coins for buyer
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        mint(&mut market, 5000, buyer, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(market);
    };

    // Post buy order
    test_scenario::next_tx(&mut scenario, buyer);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        let coin = test_scenario::take_from_sender<Coin<MARKET>>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));
        post_buy_order(&mut market, coin, 42, 100, 10, &clock, test_scenario::ctx(&mut scenario));

        assert!(has_buy_order<MARKET>(&market, 0));
        let order = borrow_buy_order<MARKET>(&market, 0);
        assert!(order_buyer(order) == buyer);
        assert!(order_type_id(order) == 42);
        assert!(order_price_per_unit(order) == 100);
        assert!(order_quantity(order) == 10);
        assert!(order_original_quantity(order) == 10);
        assert!(order_posted_at_ms(order) == 0); // clock starts at 0 in tests
        assert!(next_buy_id(&market) == 1);

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(market);
    };

    // Cancel buy order -- coins returned
    test_scenario::next_tx(&mut scenario, buyer);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        cancel_buy_order<MARKET>(&mut market, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_buy_order<MARKET>(&market, 0));
        test_scenario::return_shared(market);
    };

    // Verify coins returned to buyer
    test_scenario::next_tx(&mut scenario, buyer);
    {
        let coin = test_scenario::take_from_sender<Coin<MARKET>>(&scenario);
        assert!(coin::value(&coin) == 5000);
        test_scenario::return_to_sender(&scenario, coin);
    };

    test_scenario::end(scenario);
}

#[test]
fun test_authorization_management() {
    let admin = @0xA;
    let user1 = @0xB;
    let user2 = @0xC;
    let mut scenario = test_scenario::begin(admin);

    create_test_market(&mut scenario);

    // Add authorized addresses
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        assert!(is_authorized(&market, admin));
        assert!(!is_authorized(&market, user1));

        add_authorized(&mut market, user1, test_scenario::ctx(&mut scenario));
        assert!(is_authorized(&market, user1));

        add_authorized(&mut market, user2, test_scenario::ctx(&mut scenario));
        assert!(is_authorized(&market, user2));

        test_scenario::return_shared(market);
    };

    // Remove authorized address
    test_scenario::next_tx(&mut scenario, admin);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        remove_authorized(&mut market, user1, test_scenario::ctx(&mut scenario));
        assert!(!is_authorized(&market, user1));
        assert!(is_authorized(&market, user2));
        test_scenario::return_shared(market);
    };

    // Authorized user can mint
    test_scenario::next_tx(&mut scenario, user2);
    {
        let mut market = test_scenario::take_shared<Market<MARKET>>(&scenario);
        mint(&mut market, 500, user2, test_scenario::ctx(&mut scenario));
        assert!(total_supply(&market) == 500);
        test_scenario::return_shared(market);
    };

    test_scenario::end(scenario);
}
