/// SSU extension: vending machine for buying/selling items with Coin<T>.
///
/// The SSU owner stocks inventory and sets prices per item type.
/// Buyers pay Coin<T> to receive items from the SSU.
/// Generic over the payment token — works with any faction token or SUI.
module ssu_market::ssu_market;

use sui::coin::{Self, Coin};
use sui::dynamic_field;
use sui::event;

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const ENotAdmin: vector<u8> = b"Only the market admin can modify listings";

#[error(code = 1)]
const EListingNotFound: vector<u8> = b"No listing found for this item type";

#[error(code = 2)]
const EInsufficientPayment: vector<u8> = b"Payment is less than the item price";

#[error(code = 3)]
const EListingDisabled: vector<u8> = b"This listing is not currently available";

// ── Structs ────────────────────────────────────────────────────────────────

/// Typed witness for SSU extension authorization.
public struct MarketAuth has drop {}

/// Shared config object for a market SSU.
public struct MarketConfig has key {
    id: UID,
    admin: address,
    ssu_id: ID,
}

/// Per-item listing stored as a dynamic field keyed by type_id.
public struct Listing has store, drop {
    type_id: u64,
    price_per_unit: u64,
    available: bool,
}

/// Emitted when a purchase occurs.
public struct PurchaseEvent has copy, drop {
    ssu_id: ID,
    type_id: u64,
    quantity: u64,
    total_price: u64,
    buyer: address,
}

// ── Init ───────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    // MarketConfig is created per-SSU via create_market
}

/// Create a market config for an SSU. Called by the SSU owner.
public fun create_market(
    ssu_id: ID,
    ctx: &mut TxContext,
) {
    transfer::share_object(MarketConfig {
        id: object::new(ctx),
        admin: ctx.sender(),
        ssu_id,
    });
}

// ── Listing management ─────────────────────────────────────────────────────

/// Set or update a listing price for an item type.
public fun set_listing(
    config: &mut MarketConfig,
    type_id: u64,
    price_per_unit: u64,
    available: bool,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAdmin);

    let listing = Listing { type_id, price_per_unit, available };

    if (dynamic_field::exists_(&config.id, type_id)) {
        *dynamic_field::borrow_mut<u64, Listing>(&mut config.id, type_id) = listing;
    } else {
        dynamic_field::add(&mut config.id, type_id, listing);
    };
}

/// Remove a listing entirely.
public fun remove_listing(
    config: &mut MarketConfig,
    type_id: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAdmin);
    if (dynamic_field::exists_(&config.id, type_id)) {
        dynamic_field::remove<u64, Listing>(&mut config.id, type_id);
    };
}

// ── Purchase ───────────────────────────────────────────────────────────────

/// Buy items from the SSU market. Pays Coin<T>, receives items via SSU extension.
/// Note: Actual item transfer requires SSU extension integration.
/// This function handles the payment side — the calling transaction must also
/// include the SSU withdraw_item call with MarketAuth witness.
public fun buy_item<T>(
    config: &MarketConfig,
    mut payment: Coin<T>,
    type_id: u64,
    quantity: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(dynamic_field::exists_(&config.id, type_id), EListingNotFound);
    let listing = dynamic_field::borrow<u64, Listing>(&config.id, type_id);
    assert!(listing.available, EListingDisabled);

    let total_price = listing.price_per_unit * quantity;
    assert!(coin::value(&payment) >= total_price, EInsufficientPayment);

    // Split payment and send to admin
    let fee_coin = coin::split(&mut payment, total_price, ctx);
    transfer::public_transfer(fee_coin, config.admin);

    event::emit(PurchaseEvent {
        ssu_id: config.ssu_id,
        type_id,
        quantity,
        total_price,
        buyer: ctx.sender(),
    });

    // Return change
    payment
}

// ── Read accessors ─────────────────────────────────────────────────────────

public fun has_listing(config: &MarketConfig, type_id: u64): bool {
    dynamic_field::exists_(&config.id, type_id)
}

public fun listing_price(config: &MarketConfig, type_id: u64): u64 {
    dynamic_field::borrow<u64, Listing>(&config.id, type_id).price_per_unit
}

public fun listing_available(config: &MarketConfig, type_id: u64): bool {
    dynamic_field::borrow<u64, Listing>(&config.id, type_id).available
}

public fun market_admin(config: &MarketConfig): address {
    config.admin
}

public fun market_ssu_id(config: &MarketConfig): ID {
    config.ssu_id
}
