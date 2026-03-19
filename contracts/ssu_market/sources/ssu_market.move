/// SSU extension: vending machine for buying/selling items with Coin<T>.
///
/// The SSU owner stocks inventory and sets prices per item type.
/// Buyers pay Coin<T> to receive items from the SSU.
/// Generic over the payment token -- works with any faction token or SUI.
///
/// v3: Escrow-based sell orders — create_sell_order atomically escrows items,
/// cancel returns them, buy delivers to buyer. Replaces the old Listing flow.
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

#[error(code = 7)]
const ESellOrderNotFound: vector<u8> = b"No sell order found for this item type";

#[error(code = 8)]
const EInsufficientQuantity: vector<u8> = b"Requested quantity exceeds sell order quantity";

#[error(code = 9)]
const EZeroQuantity: vector<u8> = b"Quantity must be greater than zero";

#[error(code = 10)]
const ESSUMismatch: vector<u8> = b"SSU does not match this market config";

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
/// DEPRECATED: Kept for upgrade compatibility. Use SellOrder instead.
public struct Listing has store, drop {
    type_id: u64,
    price_per_unit: u64,
    available: bool,
}

/// Escrow-based sell order stored as dynamic field keyed by type_id.
/// Items are held in the SSU extension inventory while the order is active.
public struct SellOrder has store, drop {
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
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

/// Emitted when a legacy purchase occurs.
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

// -- Sell Order Events ----------------------------------------------------------

public struct SellOrderCreatedEvent has copy, drop {
    market_id: ID,
    ssu_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    seller: address,
}

public struct SellOrderCancelledEvent has copy, drop {
    market_id: ID,
    ssu_id: ID,
    type_id: u64,
    quantity_cancelled: u64,
    remaining: u64,
}

public struct SellOrderFilledEvent has copy, drop {
    market_id: ID,
    ssu_id: ID,
    type_id: u64,
    quantity: u64,
    total_paid: u64,
    buyer: address,
    seller: address,
}

public struct SellPriceUpdatedEvent has copy, drop {
    market_id: ID,
    type_id: u64,
    old_price: u64,
    new_price: u64,
}

public struct TransferEvent has copy, drop {
    market_id: ID,
    ssu_id: ID,
    from_slot: vector<u8>,
    to_slot: vector<u8>,
    type_id: u64,
    quantity: u64,
    sender: address,
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

// -- Listing management (DEPRECATED — kept for upgrade compatibility) -----------

/// DEPRECATED: Use create_sell_order instead.
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

/// DEPRECATED: Use cancel_sell_order instead.
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

// -- Purchase (DEPRECATED) ------------------------------------------------------

/// DEPRECATED: Use buy_sell_order instead.
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

// -- Sell Orders (v3 escrow) ----------------------------------------------------

/// Create a sell order by escrowing items from owner inventory to extension inventory.
/// If a SellOrder already exists for this type_id, adds to quantity and updates price.
/// Called in a PTB: borrow_owner_cap -> withdraw_by_owner -> create_sell_order -> return_owner_cap.
public fun create_sell_order(
    config: &mut MarketConfig,
    ssu: &mut StorageUnit,
    character: &Character,
    item: Item,
    price_per_unit: u64,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAdmin);
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);

    let type_id = item.type_id();
    let qty = (item.quantity() as u64);
    assert!(qty > 0, EZeroQuantity);

    // Escrow: move items into SSU extension inventory
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);

    // Create or update SellOrder
    if (dynamic_field::exists_with_type<u64, SellOrder>(&config.id, type_id)) {
        let order = dynamic_field::borrow_mut<u64, SellOrder>(&mut config.id, type_id);
        order.quantity = order.quantity + qty;
        order.price_per_unit = price_per_unit;
    } else {
        // Remove orphaned Listing if one exists for this key
        if (dynamic_field::exists_with_type<u64, Listing>(&config.id, type_id)) {
            dynamic_field::remove<u64, Listing>(&mut config.id, type_id);
        };
        dynamic_field::add(&mut config.id, type_id, SellOrder {
            type_id, price_per_unit, quantity: qty,
        });
    };

    event::emit(SellOrderCreatedEvent {
        market_id: object::id(config),
        ssu_id: config.ssu_id,
        type_id, price_per_unit, quantity: qty,
        seller: ctx.sender(),
    });
}

/// Cancel (partially or fully) a sell order. Returns items to admin's owned inventory.
public fun cancel_sell_order(
    config: &mut MarketConfig,
    ssu: &mut StorageUnit,
    character: &Character,
    type_id: u64,
    quantity: u32,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAdmin);
    assert!((quantity as u64) > 0, EZeroQuantity);
    assert!(
        dynamic_field::exists_with_type<u64, SellOrder>(&config.id, type_id),
        ESellOrderNotFound,
    );

    let order = dynamic_field::borrow<u64, SellOrder>(&config.id, type_id);
    assert!((quantity as u64) <= order.quantity, EInsufficientQuantity);

    // Withdraw from extension inventory
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, character, MarketAuth {}, type_id, quantity, ctx,
    );
    // Return to admin's owned inventory on this SSU
    storage_unit::deposit_to_owned<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);

    // Update or remove the sell order
    let remaining = {
        let order = dynamic_field::borrow_mut<u64, SellOrder>(&mut config.id, type_id);
        order.quantity = order.quantity - (quantity as u64);
        order.quantity
    };

    if (remaining == 0) {
        dynamic_field::remove<u64, SellOrder>(&mut config.id, type_id);
    };

    event::emit(SellOrderCancelledEvent {
        market_id: object::id(config),
        ssu_id: config.ssu_id,
        type_id,
        quantity_cancelled: (quantity as u64),
        remaining,
    });
}

/// Buy items from a sell order. Pays Coin<T>, items deposited to buyer's owned inventory.
/// Returns change coin.
public fun buy_sell_order<T>(
    config: &mut MarketConfig,
    ssu: &mut StorageUnit,
    buyer_character: &Character,
    mut payment: Coin<T>,
    type_id: u64,
    quantity: u32,
    ctx: &mut TxContext,
): Coin<T> {
    assert!((quantity as u64) > 0, EZeroQuantity);
    assert!(
        dynamic_field::exists_with_type<u64, SellOrder>(&config.id, type_id),
        ESellOrderNotFound,
    );

    let order = dynamic_field::borrow<u64, SellOrder>(&config.id, type_id);
    assert!((quantity as u64) <= order.quantity, EInsufficientQuantity);

    let total_price = order.price_per_unit * (quantity as u64);
    assert!(coin::value(&payment) >= total_price, EInsufficientPayment);

    // Withdraw from extension inventory and deposit to buyer's owned inventory
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, buyer_character, MarketAuth {}, type_id, quantity, ctx,
    );
    storage_unit::deposit_to_owned<MarketAuth>(ssu, buyer_character, item, MarketAuth {}, ctx);

    // Split payment and send to admin
    let fee_coin = coin::split(&mut payment, total_price, ctx);
    transfer::public_transfer(fee_coin, config.admin);

    // Update or remove sell order
    let remaining = {
        let order = dynamic_field::borrow_mut<u64, SellOrder>(&mut config.id, type_id);
        order.quantity = order.quantity - (quantity as u64);
        order.quantity
    };

    if (remaining == 0) {
        dynamic_field::remove<u64, SellOrder>(&mut config.id, type_id);
    };

    event::emit(SellOrderFilledEvent {
        market_id: object::id(config),
        ssu_id: config.ssu_id,
        type_id,
        quantity: (quantity as u64),
        total_paid: total_price,
        buyer: ctx.sender(),
        seller: config.admin,
    });

    payment
}

/// Update the price of an existing sell order.
public fun update_sell_price(
    config: &mut MarketConfig,
    type_id: u64,
    price_per_unit: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAdmin);
    assert!(
        dynamic_field::exists_with_type<u64, SellOrder>(&config.id, type_id),
        ESellOrderNotFound,
    );

    let order = dynamic_field::borrow_mut<u64, SellOrder>(&mut config.id, type_id);
    let old_price = order.price_per_unit;
    order.price_per_unit = price_per_unit;

    event::emit(SellPriceUpdatedEvent {
        market_id: object::id(config),
        type_id, old_price, new_price: price_per_unit,
    });
}

// -- Inventory transfers --------------------------------------------------------

fun assert_admin(config: &MarketConfig, ssu: &StorageUnit, ctx: &TxContext) {
    assert!(ctx.sender() == config.admin, ENotAdmin);
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
}

/// Admin: move items from owner inventory to escrow (open inventory).
public fun admin_to_escrow(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_admin(config, ssu, ctx);
    let item = storage_unit::withdraw_item<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_open_inventory<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        market_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"owner", to_slot: b"escrow",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin: move items from escrow back to owner inventory.
public fun admin_from_escrow(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_admin(config, ssu, ctx);
    let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        market_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"escrow", to_slot: b"owner",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin: move items from owner inventory directly to a player's inventory.
public fun admin_to_player(
    config: &MarketConfig, ssu: &mut StorageUnit, admin_character: &Character,
    recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_admin(config, ssu, ctx);
    let item = storage_unit::withdraw_item<MarketAuth>(ssu, admin_character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_owned<MarketAuth>(ssu, recipient_character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        market_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"owner", to_slot: b"player",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin: move items from escrow directly to a player's inventory.
public fun admin_escrow_to_player(
    config: &MarketConfig, ssu: &mut StorageUnit, admin_character: &Character,
    recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_admin(config, ssu, ctx);
    let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, admin_character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_owned<MarketAuth>(ssu, recipient_character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        market_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"escrow", to_slot: b"player",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin: move items from escrow to own player inventory.
public fun admin_escrow_to_self(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_admin(config, ssu, ctx);
    let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_owned<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        market_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"escrow", to_slot: b"player",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Player: deposit an Item to escrow. Item must be provided (e.g., from withdraw_by_owner in the same PTB).
public fun player_to_escrow(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    item: Item, ctx: &mut TxContext,
) {
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
    let qty = (item.quantity() as u64);
    let type_id = item.type_id();
    storage_unit::deposit_to_open_inventory<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        market_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"player", to_slot: b"escrow",
        type_id, quantity: qty, sender: ctx.sender(),
    });
}

/// Player: deposit an Item to owner inventory. Item must be provided (e.g., from withdraw_by_owner in the same PTB).
public fun player_to_owner(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    item: Item, ctx: &mut TxContext,
) {
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
    let qty = (item.quantity() as u64);
    let type_id = item.type_id();
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        market_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"player", to_slot: b"owner",
        type_id, quantity: qty, sender: ctx.sender(),
    });
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

// -- SSU item operations (DEPRECATED — kept for upgrade compatibility) ----------

/// DEPRECATED: Use create_sell_order instead.
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

/// DEPRECATED: Use buy_sell_order instead.
public fun buy_and_withdraw<T>(
    config: &MarketConfig,
    ssu: &mut StorageUnit,
    character: &Character,
    payment: Coin<T>,
    type_id: u64,
    quantity: u32,
    ctx: &mut TxContext,
): (Item, Coin<T>) {
    let change = buy_item<T>(config, payment, type_id, (quantity as u64), ctx);
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, character, MarketAuth {}, type_id, quantity, ctx,
    );
    (item, change)
}

// -- Read accessors (legacy — kept for upgrade compatibility) -------------------

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

// -- Sell Order Read Accessors --------------------------------------------------

public fun has_sell_order(config: &MarketConfig, type_id: u64): bool {
    dynamic_field::exists_with_type<u64, SellOrder>(&config.id, type_id)
}

public fun sell_order_price(config: &MarketConfig, type_id: u64): u64 {
    dynamic_field::borrow<u64, SellOrder>(&config.id, type_id).price_per_unit
}

public fun sell_order_quantity(config: &MarketConfig, type_id: u64): u64 {
    dynamic_field::borrow<u64, SellOrder>(&config.id, type_id).quantity
}
