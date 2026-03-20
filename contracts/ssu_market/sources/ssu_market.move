/// SSU extension: per-SSU configuration, inventory transfers, and trade execution.
///
/// SsuConfig replaces MarketConfig -- supports owner + delegates authorization
/// and optional Market<T> link for trade functions.
///
/// Transfer functions work without any market link (SsuConfig only).
/// Trade functions (escrow_and_list, cancel_listing, buy_from_listing,
/// fill_buy_order) require the market_id to be set and take &mut Market<T>.
module ssu_market::ssu_market;

use sui::coin::{Self, Coin};
use sui::event;
use sui::clock::Clock;
use market::market::{Self, Market};
use world::storage_unit::{Self, StorageUnit};
use world::character::Character;
use world::inventory::Item;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotAuthorized: vector<u8> = b"Only the owner or delegates can perform this action";

#[error(code = 1)]
const ENotOwner: vector<u8> = b"Only the owner can manage delegates and market link";

#[error(code = 2)]
const ESSUMismatch: vector<u8> = b"SSU does not match this config";

#[error(code = 3)]
const EMarketNotLinked: vector<u8> = b"Market is not linked to this config";

#[error(code = 4)]
const EMarketMismatch: vector<u8> = b"Market does not match the linked market_id";

#[error(code = 5)]
const EInsufficientPayment: vector<u8> = b"Payment is less than the required amount";

#[error(code = 6)]
const EInsufficientQuantity: vector<u8> = b"Requested quantity exceeds available quantity";

#[error(code = 7)]
const EZeroQuantity: vector<u8> = b"Quantity must be greater than zero";

#[error(code = 8)]
const ENotListingSeller: vector<u8> = b"Caller is not the listing seller";

// -- Structs --------------------------------------------------------------------

/// Typed witness for SSU extension authorization.
public struct MarketAuth has drop {}

/// Per-SSU configuration with owner, delegates, and optional market link.
public struct SsuConfig has key {
    id: UID,
    ssu_id: ID,
    owner: address,
    delegates: vector<address>,
    market_id: Option<ID>,
}

// -- Events ---------------------------------------------------------------------

public struct SsuConfigCreatedEvent has copy, drop {
    config_id: ID,
    owner: address,
    ssu_id: ID,
}

public struct DelegateAddedEvent has copy, drop {
    config_id: ID,
    delegate: address,
}

public struct DelegateRemovedEvent has copy, drop {
    config_id: ID,
    delegate: address,
}

public struct MarketSetEvent has copy, drop {
    config_id: ID,
    market_id: ID,
}

public struct MarketRemovedEvent has copy, drop {
    config_id: ID,
}

public struct TransferEvent has copy, drop {
    config_id: ID,
    ssu_id: ID,
    from_slot: vector<u8>,
    to_slot: vector<u8>,
    type_id: u64,
    quantity: u64,
    sender: address,
}

public struct SellListingCancelledEvent has copy, drop {
    config_id: ID,
    ssu_id: ID,
    listing_id: u64,
    type_id: u64,
    quantity: u64,
}

public struct BuyOrderFilledEvent has copy, drop {
    config_id: ID,
    ssu_id: ID,
    order_id: u64,
    type_id: u64,
    quantity: u64,
    total_paid: u64,
    seller: address,
}

// -- Authorization helpers ------------------------------------------------------

fun assert_authorized(config: &SsuConfig, ssu: &StorageUnit, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(sender == config.owner || config.delegates.contains(&sender), ENotAuthorized);
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
}

fun assert_market_linked(config: &SsuConfig, market_id: ID) {
    assert!(option::is_some(&config.market_id), EMarketNotLinked);
    assert!(*option::borrow(&config.market_id) == market_id, EMarketMismatch);
}

// -- SsuConfig management -------------------------------------------------------

/// Create an SsuConfig for an SSU. Called by the SSU owner.
public fun create_ssu_config(
    ssu_id: ID,
    ctx: &mut TxContext,
) {
    let config = SsuConfig {
        id: object::new(ctx),
        ssu_id,
        owner: ctx.sender(),
        delegates: vector::empty(),
        market_id: option::none(),
    };

    event::emit(SsuConfigCreatedEvent {
        config_id: object::id(&config),
        owner: ctx.sender(),
        ssu_id,
    });

    transfer::share_object(config);
}

/// Add a delegate. Owner only.
public fun add_delegate(
    config: &mut SsuConfig,
    addr: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    config.delegates.push_back(addr);

    event::emit(DelegateAddedEvent {
        config_id: object::id(config),
        delegate: addr,
    });
}

/// Remove a delegate. Owner only.
public fun remove_delegate(
    config: &mut SsuConfig,
    addr: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    let (found, idx) = config.delegates.index_of(&addr);
    if (found) { config.delegates.remove(idx); };

    event::emit(DelegateRemovedEvent {
        config_id: object::id(config),
        delegate: addr,
    });
}

/// Link this SSU config to a Market. Owner only.
public fun set_market(
    config: &mut SsuConfig,
    market_id: ID,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    config.market_id = option::some(market_id);

    event::emit(MarketSetEvent {
        config_id: object::id(config),
        market_id,
    });
}

/// Unlink the Market from this SSU config. Owner only.
public fun remove_market(
    config: &mut SsuConfig,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    config.market_id = option::none();

    event::emit(MarketRemovedEvent {
        config_id: object::id(config),
    });
}

// -- SsuConfig read accessors ---------------------------------------------------

public fun config_owner(config: &SsuConfig): address { config.owner }
public fun config_ssu_id(config: &SsuConfig): ID { config.ssu_id }
public fun config_market_id(config: &SsuConfig): Option<ID> { config.market_id }
public fun config_delegates(config: &SsuConfig): vector<address> { config.delegates }

// -- Inventory transfers --------------------------------------------------------

/// Admin/delegate: move items from owner inventory to escrow (open inventory).
public fun admin_to_escrow(
    config: &SsuConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    let item = storage_unit::withdraw_item<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_open_inventory<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        config_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"owner", to_slot: b"escrow",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin/delegate: move items from escrow back to owner inventory.
public fun admin_from_escrow(
    config: &SsuConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        config_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"escrow", to_slot: b"owner",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin/delegate: move items from owner inventory directly to a player's inventory.
public fun admin_to_player(
    config: &SsuConfig, ssu: &mut StorageUnit, admin_character: &Character,
    recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    let item = storage_unit::withdraw_item<MarketAuth>(ssu, admin_character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_owned<MarketAuth>(ssu, recipient_character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        config_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"owner", to_slot: b"player",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin/delegate: move items from escrow directly to a player's inventory.
public fun admin_escrow_to_player(
    config: &SsuConfig, ssu: &mut StorageUnit, admin_character: &Character,
    recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, admin_character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_owned<MarketAuth>(ssu, recipient_character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        config_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"escrow", to_slot: b"player",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Admin/delegate: move items from escrow to own player inventory.
public fun admin_escrow_to_self(
    config: &SsuConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
    storage_unit::deposit_to_owned<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        config_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"escrow", to_slot: b"player",
        type_id, quantity: (quantity as u64), sender: ctx.sender(),
    });
}

/// Player: deposit an Item to escrow. SSU mismatch check only -- no owner/delegate
/// check because any player must be able to deposit items they want to sell.
public fun player_to_escrow(
    config: &SsuConfig, ssu: &mut StorageUnit, character: &Character,
    item: Item, ctx: &mut TxContext,
) {
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
    let qty = (item.quantity() as u64);
    let type_id = item.type_id();
    storage_unit::deposit_to_open_inventory<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        config_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"player", to_slot: b"escrow",
        type_id, quantity: qty, sender: ctx.sender(),
    });
}

/// Player: deposit an Item to owner inventory. SSU mismatch check only (no owner/delegate check).
public fun player_to_owner(
    config: &SsuConfig, ssu: &mut StorageUnit, character: &Character,
    item: Item, ctx: &mut TxContext,
) {
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
    let qty = (item.quantity() as u64);
    let type_id = item.type_id();
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
    event::emit(TransferEvent {
        config_id: object::id(config), ssu_id: config.ssu_id,
        from_slot: b"player", to_slot: b"owner",
        type_id, quantity: qty, sender: ctx.sender(),
    });
}

// -- Trade execution functions --------------------------------------------------

/// Escrow items from owner inventory into extension inventory, then post a
/// sell listing on the Market. Authorized users only.
public fun escrow_and_list<T>(
    config: &SsuConfig, market: &mut Market<T>,
    ssu: &mut StorageUnit, character: &Character,
    item: Item, price_per_unit: u64, clock: &Clock, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    assert_market_linked(config, object::id(market));

    let type_id = item.type_id();
    let qty = (item.quantity() as u64);

    // Escrow: move items into SSU extension inventory
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);

    // Post listing on the Market
    market::post_sell_listing<T>(market, config.ssu_id, type_id, price_per_unit, qty, clock, ctx);
}

/// Cancel a sell listing on Market and return items from extension inventory
/// to owner inventory. Authorized users only.
public fun cancel_listing<T>(
    config: &SsuConfig, market: &mut Market<T>,
    ssu: &mut StorageUnit, character: &Character,
    listing_id: u64, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    assert_market_linked(config, object::id(market));

    // Read listing to get type_id + quantity before removing
    let listing = market::borrow_sell_listing(market, listing_id);
    assert!(market::listing_seller(listing) == ctx.sender(), ENotListingSeller);
    let type_id = market::listing_type_id(listing);
    let quantity = market::listing_quantity(listing);

    // Remove listing from market (uses write accessor to avoid redundant seller check)
    market::remove_sell_listing<T>(market, listing_id);

    // Withdraw items from extension inventory
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, character, MarketAuth {}, type_id, (quantity as u32), ctx,
    );
    // Return to owner inventory
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);

    event::emit(SellListingCancelledEvent {
        config_id: object::id(config),
        ssu_id: config.ssu_id,
        listing_id,
        type_id,
        quantity,
    });
}

/// Buyer purchases items from a sell listing. Atomic: payment -> seller,
/// items -> buyer. Any buyer can call (no assert_authorized).
/// Returns change coin.
#[allow(lint(self_transfer))]
public fun buy_from_listing<T>(
    config: &SsuConfig, market: &mut Market<T>,
    ssu: &mut StorageUnit, buyer_character: &Character,
    listing_id: u64, quantity: u32, mut payment: Coin<T>,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
    assert_market_linked(config, object::id(market));
    assert!((quantity as u64) > 0, EZeroQuantity);

    // Read listing data
    let listing = market::borrow_sell_listing(market, listing_id);
    let price_per_unit = market::listing_price_per_unit(listing);
    let available = market::listing_quantity(listing);
    let seller = market::listing_seller(listing);
    let type_id = market::listing_type_id(listing);
    assert!((quantity as u64) <= available, EInsufficientQuantity);

    let total_price = price_per_unit * (quantity as u64);
    assert!(coin::value(&payment) >= total_price, EInsufficientPayment);

    // Calculate fee
    let fee_bps = market::market_fee_bps(market);
    let fee_recipient = market::market_fee_recipient(market);
    let fee_amount = total_price / 10000 * fee_bps;
    let seller_amount = total_price - fee_amount;

    // Split payment: fee to fee_recipient, net to seller
    if (fee_amount > 0) {
        let fee_coin = coin::split(&mut payment, fee_amount, ctx);
        transfer::public_transfer(fee_coin, fee_recipient);
    };
    let seller_coin = coin::split(&mut payment, seller_amount, ctx);
    transfer::public_transfer(seller_coin, seller);

    // Withdraw items from extension inventory and deposit to buyer's owned inventory
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, buyer_character, MarketAuth {}, type_id, quantity, ctx,
    );
    storage_unit::deposit_to_owned<MarketAuth>(ssu, buyer_character, item, MarketAuth {}, ctx);

    // Update or remove listing
    let remaining = available - (quantity as u64);
    if (remaining == 0) {
        market::remove_sell_listing<T>(market, listing_id);
    } else {
        let listing_mut = market::borrow_sell_listing_mut(market, listing_id);
        market::set_listing_quantity(listing_mut, remaining);
    };

    // Return change
    payment
}

/// Seller fills a buy order by providing items from the SSU.
/// Items deposited to open inventory (for buyer to claim).
/// Escrowed payment released to seller (minus fee).
#[allow(lint(self_transfer))]
public fun fill_buy_order<T>(
    config: &SsuConfig, market: &mut Market<T>,
    ssu: &mut StorageUnit, seller_character: &Character,
    order_id: u64, quantity: u32, ctx: &mut TxContext,
) {
    assert_authorized(config, ssu, ctx);
    assert_market_linked(config, object::id(market));
    assert!((quantity as u64) > 0, EZeroQuantity);

    // Read buy order data
    let order = market::borrow_buy_order(market, order_id);
    let price_per_unit = market::order_price_per_unit(order);
    let available = market::order_quantity(order);
    let type_id = market::order_type_id(order);
    let buyer = market::order_buyer(order);
    assert!((quantity as u64) <= available, EInsufficientQuantity);

    let total_price = price_per_unit * (quantity as u64);

    // Calculate fee
    let fee_bps = market::market_fee_bps(market);
    let fee_recipient = market::market_fee_recipient(market);
    let fee_amount = total_price / 10000 * fee_bps;
    let seller_amount = total_price - fee_amount;

    // Split escrowed payment from market
    if (fee_amount > 0) {
        let fee_coin = market::split_escrowed_coin<T>(market, order_id, fee_amount, ctx);
        transfer::public_transfer(fee_coin, fee_recipient);
    };
    let seller_coin = market::split_escrowed_coin<T>(market, order_id, seller_amount, ctx);
    transfer::public_transfer(seller_coin, ctx.sender());

    // Withdraw items from extension inventory and deposit to open inventory
    // (buyer can claim from open inventory later)
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, seller_character, MarketAuth {}, type_id, quantity, ctx,
    );
    storage_unit::deposit_to_open_inventory<MarketAuth>(ssu, seller_character, item, MarketAuth {}, ctx);

    // Update or remove buy order
    let remaining = available - (quantity as u64);
    if (remaining == 0) {
        market::remove_buy_order<T>(market, order_id);
        // Return any remaining dust coins to buyer
        let remaining_coins = market::remove_escrowed_coin<T>(market, order_id);
        if (coin::value(&remaining_coins) > 0) {
            transfer::public_transfer(remaining_coins, buyer);
        } else {
            remaining_coins.destroy_zero();
        };
    } else {
        let order_mut = market::borrow_buy_order_mut(market, order_id);
        market::set_order_quantity(order_mut, remaining);
    };

    event::emit(BuyOrderFilledEvent {
        config_id: object::id(config),
        ssu_id: config.ssu_id,
        order_id,
        type_id,
        quantity: (quantity as u64),
        total_paid: total_price,
        seller: ctx.sender(),
    });
}
