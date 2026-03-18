/// Currency Market: per-currency order book for sell listings and buy orders.
///
/// Each currency has exactly one CurrencyMarket<T> shared object. Anyone can
/// post sell listings (advertisements pointing to SSU markets) and buy orders
/// (with Coin<T> escrow). Markets are created by the currency creator via
/// TreasuryCap or OrgTreasury proof.
///
/// Sell listings are advertisements -- items stay in the SSU. Buyers visit
/// the SSU to complete the purchase. Buy orders escrow Coin<T> -- sellers
/// fill orders and receive payment (honor-based confirmation).
module currency_market::currency_market;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;
use governance::org::{Self, Organization};
use governance_ext::treasury::OrgTreasury;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotSeller: vector<u8> = b"Only the listing seller can modify this listing";

#[error(code = 1)]
const ENotBuyer: vector<u8> = b"Only the order buyer can modify this order";

#[error(code = 2)]
const EListingNotFound: vector<u8> = b"Sell listing not found";

#[error(code = 3)]
const EOrderNotFound: vector<u8> = b"Buy order not found";

#[error(code = 4)]
const EExceedsOrderQuantity: vector<u8> = b"Fill quantity exceeds remaining order quantity";

#[error(code = 5)]
const EInsufficientPayment: vector<u8> = b"Payment is less than the required escrow amount";

#[error(code = 6)]
const EZeroQuantity: vector<u8> = b"Quantity must be greater than zero";

#[error(code = 7)]
const ENotStakeholder: vector<u8> = b"Only org stakeholders can create markets from treasury";

#[error(code = 8)]
const EInvalidFeeBps: vector<u8> = b"Fee basis points must be <= 10000";

// -- Structs --------------------------------------------------------------------

/// Shared per-currency order book. One per Coin<T> type.
public struct CurrencyMarket<phantom T> has key {
    id: UID,
    creator: address,
    fee_bps: u64,
    fee_recipient: address,
    next_sell_id: u64,
    next_buy_id: u64,
}

/// Sell listing: advertisement pointing to an SSU market.
/// Items stay in the SSU -- this is a directory entry for discovery.
/// Stored as dynamic field on CurrencyMarket keyed by sell_id.
public struct SellListing has store, drop {
    listing_id: u64,
    seller: address,
    ssu_id: ID,
    market_config_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    posted_at_ms: u64,
}

/// Buy order: buyer wants to purchase items, paying Coin<T>.
/// Stored as dynamic field on CurrencyMarket keyed by buy_id.
/// Escrowed Coin<T> stored as dynamic field keyed by buy_id + 1_000_000_000.
public struct BuyOrder has store, drop {
    order_id: u64,
    buyer: address,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
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
}

public struct BuyOrderFilledEvent has copy, drop {
    market_id: ID,
    order_id: u64,
    seller: address,
    quantity: u64,
    total_paid: u64,
}

public struct BuyOrderCancelledEvent has copy, drop {
    market_id: ID,
    order_id: u64,
}

// -- Market creation ------------------------------------------------------------

/// Create a CurrencyMarket<T> by proving currency ownership via TreasuryCap.
/// For currencies where the caller still holds the TreasuryCap directly.
#[allow(lint(share_owned))]
public fun create_market<T>(
    _treasury_cap: &TreasuryCap<T>,
    fee_bps: u64,
    ctx: &mut TxContext,
) {
    assert!(fee_bps <= 10000, EInvalidFeeBps);

    let market = CurrencyMarket<T> {
        id: object::new(ctx),
        creator: ctx.sender(),
        fee_bps,
        fee_recipient: ctx.sender(),
        next_sell_id: 0,
        next_buy_id: 0,
    };

    event::emit(MarketCreatedEvent {
        market_id: object::id(&market),
        creator: ctx.sender(),
    });

    transfer::share_object(market);
}

/// Create a CurrencyMarket<T> from an OrgTreasury (TreasuryCap locked in org).
/// Requires org stakeholder authorization.
#[allow(lint(share_owned))]
public fun create_market_from_treasury<T>(
    _treasury: &OrgTreasury<T>,
    org: &Organization,
    fee_bps: u64,
    ctx: &mut TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotStakeholder);
    assert!(fee_bps <= 10000, EInvalidFeeBps);

    let market = CurrencyMarket<T> {
        id: object::new(ctx),
        creator: ctx.sender(),
        fee_bps,
        fee_recipient: ctx.sender(),
        next_sell_id: 0,
        next_buy_id: 0,
    };

    event::emit(MarketCreatedEvent {
        market_id: object::id(&market),
        creator: ctx.sender(),
    });

    transfer::share_object(market);
}

// -- Sell listings (advertisements) ---------------------------------------------

/// Post a sell listing. This is an advertisement pointing buyers to an SSU.
/// Items stay in the SSU's extension inventory -- not escrowed here.
/// Anyone can post a listing.
public fun post_sell_listing<T>(
    market: &mut CurrencyMarket<T>,
    ssu_id: ID,
    market_config_id: ID,
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
        market_config_id,
        type_id,
        price_per_unit,
        quantity,
        posted_at_ms: clock.timestamp_ms(),
    };

    dynamic_field::add(&mut market.id, listing_id, listing);

    event::emit(SellListingPostedEvent {
        market_id: object::id(market),
        listing_id,
        seller: ctx.sender(),
        ssu_id,
        type_id,
        price_per_unit,
        quantity,
    });
}

/// Update price and quantity on an existing sell listing. Seller only.
public fun update_sell_listing<T>(
    market: &mut CurrencyMarket<T>,
    listing_id: u64,
    price_per_unit: u64,
    quantity: u64,
    ctx: &TxContext,
) {
    assert!(dynamic_field::exists_(&market.id, listing_id), EListingNotFound);

    let listing = dynamic_field::borrow_mut<u64, SellListing>(&mut market.id, listing_id);
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
    market: &mut CurrencyMarket<T>,
    listing_id: u64,
    ctx: &TxContext,
) {
    assert!(dynamic_field::exists_(&market.id, listing_id), EListingNotFound);

    let listing = dynamic_field::borrow<u64, SellListing>(&market.id, listing_id);
    assert!(listing.seller == ctx.sender(), ENotSeller);

    dynamic_field::remove<u64, SellListing>(&mut market.id, listing_id);

    event::emit(SellListingCancelledEvent {
        market_id: object::id(market),
        listing_id,
    });
}

// -- Buy orders (coin escrow) ---------------------------------------------------

/// Post a buy order. Escrowed Coin<T> is locked until fill or cancel.
/// Anyone can post a buy order.
public fun post_buy_order<T>(
    market: &mut CurrencyMarket<T>,
    payment: Coin<T>,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    ctx: &mut TxContext,
) {
    assert!(quantity > 0, EZeroQuantity);
    let total_cost = price_per_unit * quantity;
    assert!(coin::value(&payment) >= total_cost, EInsufficientPayment);

    let order_id = market.next_buy_id;
    market.next_buy_id = order_id + 1;

    let record = BuyOrder {
        order_id,
        buyer: ctx.sender(),
        type_id,
        price_per_unit,
        quantity,
    };

    dynamic_field::add(&mut market.id, order_id, record);

    // Escrow coins with offset key (same pattern as bounty_board / ssu_market)
    let coin_key = order_id + 1_000_000_000;
    dynamic_field::add(&mut market.id, coin_key, payment);

    event::emit(BuyOrderPostedEvent {
        market_id: object::id(market),
        order_id,
        buyer: ctx.sender(),
        type_id,
        price_per_unit,
        quantity,
    });
}

/// Fill a buy order. Buyer confirms that the seller delivered items.
/// Releases escrowed payment to the seller. Honor-based confirmation model.
/// Supports partial fills -- fill_quantity can be less than total order quantity.
public fun fill_buy_order<T>(
    market: &mut CurrencyMarket<T>,
    order_id: u64,
    seller: address,
    fill_quantity: u64,
    ctx: &mut TxContext,
) {
    assert!(dynamic_field::exists_(&market.id, order_id), EOrderNotFound);

    let record = dynamic_field::borrow<u64, BuyOrder>(&market.id, order_id);
    assert!(record.buyer == ctx.sender(), ENotBuyer);
    assert!(fill_quantity <= record.quantity, EExceedsOrderQuantity);

    let payment_amount = record.price_per_unit * fill_quantity;

    // Pay seller from escrowed coins
    let coin_key = order_id + 1_000_000_000;
    let escrowed = dynamic_field::borrow_mut<u64, Coin<T>>(&mut market.id, coin_key);
    let payment = coin::split(escrowed, payment_amount, ctx);
    transfer::public_transfer(payment, seller);

    // Update or remove order based on remaining quantity
    let remaining_qty = {
        let record = dynamic_field::borrow_mut<u64, BuyOrder>(&mut market.id, order_id);
        record.quantity = record.quantity - fill_quantity;
        record.quantity
    };

    if (remaining_qty == 0) {
        dynamic_field::remove<u64, BuyOrder>(&mut market.id, order_id);
        // Return any remaining dust coins to buyer
        let remaining = dynamic_field::remove<u64, Coin<T>>(&mut market.id, coin_key);
        if (coin::value(&remaining) > 0) {
            transfer::public_transfer(remaining, ctx.sender());
        } else {
            coin::destroy_zero(remaining);
        };
    };

    event::emit(BuyOrderFilledEvent {
        market_id: object::id(market),
        order_id,
        seller,
        quantity: fill_quantity,
        total_paid: payment_amount,
    });
}

/// Cancel a buy order. Returns escrowed coins to the buyer.
public fun cancel_buy_order<T>(
    market: &mut CurrencyMarket<T>,
    order_id: u64,
    ctx: &mut TxContext,
) {
    assert!(dynamic_field::exists_(&market.id, order_id), EOrderNotFound);

    let record = dynamic_field::borrow<u64, BuyOrder>(&market.id, order_id);
    assert!(record.buyer == ctx.sender(), ENotBuyer);

    dynamic_field::remove<u64, BuyOrder>(&mut market.id, order_id);

    let coin_key = order_id + 1_000_000_000;
    let coins = dynamic_field::remove<u64, Coin<T>>(&mut market.id, coin_key);
    transfer::public_transfer(coins, ctx.sender());

    event::emit(BuyOrderCancelledEvent {
        market_id: object::id(market),
        order_id,
    });
}

// -- Read accessors -------------------------------------------------------------

/// Get the market creator address.
public fun market_creator<T>(market: &CurrencyMarket<T>): address {
    market.creator
}

/// Get the fee in basis points.
public fun market_fee_bps<T>(market: &CurrencyMarket<T>): u64 {
    market.fee_bps
}

/// Get the fee recipient address.
public fun market_fee_recipient<T>(market: &CurrencyMarket<T>): address {
    market.fee_recipient
}

/// Get the next sell listing ID (also the count of listings ever created).
public fun next_sell_id<T>(market: &CurrencyMarket<T>): u64 {
    market.next_sell_id
}

/// Get the next buy order ID (also the count of orders ever created).
public fun next_buy_id<T>(market: &CurrencyMarket<T>): u64 {
    market.next_buy_id
}
