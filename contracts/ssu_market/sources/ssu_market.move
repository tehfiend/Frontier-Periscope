/// SSU extension: vending machine for buying/selling items with Coin<T>.
///
/// The SSU owner stocks inventory and sets prices per item type.
/// Buyers pay Coin<T> to receive items from the SSU.
/// Generic over the payment token -- works with any faction token or SUI.
///
/// v2: Adds OrgMarket buy orders, stock_items, and buy_and_withdraw.
module ssu_market::ssu_market;

use sui::coin::{Self, Coin};
use sui::dynamic_field;
use sui::event;
use governance::org::{Self, Organization};
use world::storage_unit::{Self, StorageUnit};
use world::character::Character;
use world::inventory::Item;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotAdmin: vector<u8> = b"Only the market admin can modify listings";

#[error(code = 1)]
const EListingNotFound: vector<u8> = b"No listing found for this item type";

#[error(code = 2)]
const EInsufficientPayment: vector<u8> = b"Payment is less than the item price";

#[error(code = 3)]
const EListingDisabled: vector<u8> = b"This listing is not currently available";

#[error(code = 4)]
const EOrgMismatch: vector<u8> = b"Organization does not match this market";

#[error(code = 5)]
const EExceedsOrderQuantity: vector<u8> = b"Fill quantity exceeds remaining order quantity";

#[error(code = 6)]
const ENotAuthorizedSSU: vector<u8> = b"SSU is not authorized for this org market";

// -- Structs --------------------------------------------------------------------

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

/// Per-org market: manages buy orders across multiple SSUs.
/// Created once per org. Stakeholders manage authorized SSUs and buy orders.
public struct OrgMarket has key {
    id: UID,
    org_id: ID,
    admin: address,
    authorized_ssus: vector<ID>,
    next_order_id: u64,
}

/// Buy order: org wants to purchase items, paying Coin<T>.
/// Stored as dynamic field on OrgMarket keyed by order_id.
/// `ssu_id` tracks which SSU items should be delivered to (for UI display).
public struct BuyOrder has store, drop {
    order_id: u64,
    ssu_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    poster: address,
}

// -- Events ---------------------------------------------------------------------

/// Emitted when a purchase occurs.
public struct PurchaseEvent has copy, drop {
    ssu_id: ID,
    type_id: u64,
    quantity: u64,
    total_price: u64,
    buyer: address,
}

public struct OrgMarketCreatedEvent has copy, drop {
    org_market_id: ID,
    org_id: ID,
    admin: address,
}

public struct BuyOrderCreatedEvent has copy, drop {
    org_market_id: ID,
    order_id: u64,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    poster: address,
}

public struct BuyOrderFilledEvent has copy, drop {
    org_market_id: ID,
    order_id: u64,
    ssu_id: ID,
    type_id: u64,
    quantity: u64,
    total_paid: u64,
    seller: address,
}

// -- Init -----------------------------------------------------------------------

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

// -- Listing management ---------------------------------------------------------

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

// -- Purchase -------------------------------------------------------------------

/// Buy items from the SSU market. Pays Coin<T>, receives items via SSU extension.
/// Note: Actual item transfer requires SSU extension integration.
/// This function handles the payment side -- the calling transaction must also
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

// -- OrgMarket management -------------------------------------------------------

/// Create an OrgMarket for an organization. One per org.
public fun create_org_market(
    org: &Organization,
    ctx: &mut TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    let market = OrgMarket {
        id: object::new(ctx),
        org_id: object::id(org),
        admin: ctx.sender(),
        authorized_ssus: vector::empty(),
        next_order_id: 0,
    };

    event::emit(OrgMarketCreatedEvent {
        org_market_id: object::id(&market),
        org_id: object::id(org),
        admin: ctx.sender(),
    });

    transfer::share_object(market);
}

/// Add an SSU as an authorized delivery point. Stakeholders only.
/// The SSU must already have authorize_extension<MarketAuth>() called by its owner.
public fun add_authorized_ssu(
    market: &mut OrgMarket,
    org: &Organization,
    ssu_id: ID,
    ctx: &TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    market.authorized_ssus.push_back(ssu_id);
}

/// Remove an SSU from authorized delivery points.
public fun remove_authorized_ssu(
    market: &mut OrgMarket,
    org: &Organization,
    ssu_id: ID,
    ctx: &TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    let (found, idx) = market.authorized_ssus.index_of(&ssu_id);
    if (found) { market.authorized_ssus.remove(idx); };
}

// -- Buy orders -----------------------------------------------------------------

/// Create a buy order on the org market. Stakeholders only.
/// `ssu_id` indicates which SSU players should deliver items to.
/// Escrowed Coin<T> stored as dynamic field on OrgMarket.
public fun create_buy_order<T>(
    market: &mut OrgMarket,
    org: &Organization,
    payment: Coin<T>,
    ssu_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    ctx: &mut TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    let total_cost = price_per_unit * quantity;
    assert!(coin::value(&payment) >= total_cost, EInsufficientPayment);

    let order_id = market.next_order_id;
    market.next_order_id = order_id + 1;

    let record = BuyOrder {
        order_id, ssu_id, type_id, price_per_unit, quantity,
        poster: ctx.sender(),
    };

    dynamic_field::add(&mut market.id, order_id, record);
    // Escrow coins with offset key (same pattern as bounty_board)
    let coin_key = order_id + 1_000_000_000;
    dynamic_field::add(&mut market.id, coin_key, payment);

    event::emit(BuyOrderCreatedEvent {
        org_market_id: object::id(market), order_id, type_id,
        price_per_unit, quantity, poster: ctx.sender(),
    });
}

/// Fill a buy order (hackathon: manual confirmation model).
///
/// Flow: Player deposits items to the SSU via game client first. Then a stakeholder
/// calls confirm_buy_order_fill to release payment. This avoids the SSU item binding
/// constraint (items can't be programmatically transferred between SSUs).
///
/// For the hackathon, this is a stakeholder-confirmed fill. The stakeholder verifies
/// items were delivered (off-chain check) and releases payment to the seller.
/// Automated fill (checking extension inventory on-chain) deferred to post-hackathon.
public fun confirm_buy_order_fill<T>(
    market: &mut OrgMarket,
    org: &Organization,
    order_id: u64,
    seller: address,
    quantity_filled: u64,
    ctx: &mut TxContext,
) {
    assert!(object::id(org) == market.org_id, EOrgMismatch);
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);

    // Validate buy order exists
    let record = dynamic_field::borrow<u64, BuyOrder>(&market.id, order_id);
    assert!(quantity_filled <= record.quantity, EExceedsOrderQuantity);

    let payment_amount = record.price_per_unit * quantity_filled;

    let type_id = record.type_id;

    // Pay seller from escrowed coins
    let coin_key = order_id + 1_000_000_000;
    let escrowed = dynamic_field::borrow_mut<u64, Coin<T>>(&mut market.id, coin_key);
    let payment = coin::split(escrowed, payment_amount, ctx);
    transfer::public_transfer(payment, seller);

    // Update or remove order based on remaining quantity
    // NOTE: Must read remaining_qty into a local before the conditional remove,
    // otherwise the mutable borrow of `record` conflicts with `dynamic_field::remove`.
    let remaining_qty = {
        let record = dynamic_field::borrow_mut<u64, BuyOrder>(&mut market.id, order_id);
        record.quantity = record.quantity - quantity_filled;
        record.quantity
    }; // record reference dropped here

    if (remaining_qty == 0) {
        dynamic_field::remove<u64, BuyOrder>(&mut market.id, order_id);
        // Return any remaining dust coins to admin
        let remaining = dynamic_field::remove<u64, Coin<T>>(&mut market.id, coin_key);
        if (coin::value(&remaining) > 0) {
            transfer::public_transfer(remaining, ctx.sender());
        } else {
            coin::destroy_zero(remaining);
        };
    };

    event::emit(BuyOrderFilledEvent {
        org_market_id: object::id(market), order_id,
        ssu_id: object::id_from_address(@0x0), // SSU tracked off-chain for hackathon
        type_id, quantity: quantity_filled,
        total_paid: payment_amount, seller,
    });
}

/// Cancel a buy order. Returns escrowed coins to poster.
public fun cancel_buy_order<T>(
    market: &mut OrgMarket,
    org: &Organization,
    order_id: u64,
    ctx: &mut TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    dynamic_field::remove<u64, BuyOrder>(&mut market.id, order_id);
    let coin_key = order_id + 1_000_000_000;
    let coins = dynamic_field::remove<u64, Coin<T>>(&mut market.id, coin_key);
    transfer::public_transfer(coins, ctx.sender());
}

// -- SSU item operations --------------------------------------------------------

/// Stock items into the SSU extension inventory for sell orders.
/// The market admin moves items from owner inventory to extension inventory.
/// Called in a PTB after borrow_owner_cap -> withdraw_by_owner -> stock_items -> return_owner_cap.
/// Item must have parent_id matching the SSU (same-SSU items only -- see item binding constraint).
public fun stock_items(
    config: &MarketConfig,
    ssu: &mut StorageUnit,
    character: &Character,
    item: Item,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAdmin);
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
}

/// Atomically buy items from a sell listing: pay Coin<T>, receive items.
/// Constructs MarketAuth {} to withdraw items from the SSU extension inventory.
/// Items must be stocked first via stock_items().
public fun buy_and_withdraw<T>(
    config: &MarketConfig,
    ssu: &mut StorageUnit,
    character: &Character,
    payment: Coin<T>,
    type_id: u64,
    quantity: u32,
    ctx: &mut TxContext,
): (Item, Coin<T>) {
    // Same payment logic as buy_item<T> (validate listing, split payment, send to admin)
    let change = buy_item<T>(config, payment, type_id, (quantity as u64), ctx);
    // Withdraw items from SSU extension inventory
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, character, MarketAuth {}, type_id, quantity, ctx,
    );
    (item, change)
}

// -- Read accessors -------------------------------------------------------------

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
