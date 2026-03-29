module ssu_unified::ssu_unified {
    use sui::event;
    use sui::coin::Coin;
    use sui::clock::Clock;
    use world::storage_unit::{Self, StorageUnit};
    use world::character::Character;
    use world::inventory::Item;

    // Error constants
    const ENotOwner: u64 = 0;
    const EDelegateAlreadyExists: u64 = 1;
    const EDelegateNotFound: u64 = 2;
    const ENotAuthorized: u64 = 3;
    const EQuantityOverflow: u64 = 4;

    // ── Types ──────────────────────────────────────────────────────────

    /// Per-user owned SSU config. No `store` ability -- prevents unauthorized transfer.
    public struct SsuUnifiedConfig has key {
        id: UID,
        owner: address,
        ssu_id: ID,
        delegates: vector<address>,
        market_id: Option<ID>,
        is_public: bool,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
    }

    /// Witness struct for extension authorization.
    public struct SsuUnifiedAuth has drop {}

    // ── Events ───────────────────────��─────────────────────────────────

    public struct ConfigCreatedEvent has copy, drop {
        config_id: ID,
        owner: address,
        ssu_id: ID,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
        market_id: Option<ID>,
    }

    public struct MarketLinkedEvent has copy, drop {
        config_id: ID,
        market_id: ID,
    }

    public struct MarketUnlinkedEvent has copy, drop {
        config_id: ID,
    }

    public struct StandingsConfigUpdatedEvent has copy, drop {
        config_id: ID,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
    }

    public struct DelegateAddedEvent has copy, drop {
        config_id: ID,
        delegate: address,
    }

    public struct DelegateRemovedEvent has copy, drop {
        config_id: ID,
        delegate: address,
    }

    public struct VisibilityChangedEvent has copy, drop {
        config_id: ID,
        is_public: bool,
    }

    // ── Authorization Helper ─────────��──────────────────────────────────

    /// Check that the sender is the config owner or a delegate.
    fun assert_authorized(config: &SsuUnifiedConfig, ctx: &TxContext) {
        let sender = ctx.sender();
        if (config.owner == sender) return;
        let (found, _) = config.delegates.index_of(&sender);
        assert!(found, ENotAuthorized);
    }

    // ─��� Create Config ───────────────────��──────────────────────────────

    /// Create a new SsuUnifiedConfig and transfer to caller.
    public fun create_config(
        ssu_id: ID,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
        ctx: &mut TxContext,
    ) {
        let config = SsuUnifiedConfig {
            id: object::new(ctx),
            owner: ctx.sender(),
            ssu_id,
            delegates: vector[],
            market_id: option::none(),
            is_public: false,
            registry_id,
            min_deposit,
            min_withdraw,
        };

        event::emit(ConfigCreatedEvent {
            config_id: object::id(&config),
            owner: ctx.sender(),
            ssu_id,
            registry_id,
            min_deposit,
            min_withdraw,
            market_id: option::none(),
        });

        transfer::share_object(config);
    }

    /// Create a new SsuUnifiedConfig with a market pre-linked.
    public fun create_config_with_market(
        ssu_id: ID,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
        market_id: ID,
        ctx: &mut TxContext,
    ) {
        let mkt = option::some(market_id);
        let config = SsuUnifiedConfig {
            id: object::new(ctx),
            owner: ctx.sender(),
            ssu_id,
            delegates: vector[],
            market_id: mkt,
            is_public: false,
            registry_id,
            min_deposit,
            min_withdraw,
        };

        event::emit(ConfigCreatedEvent {
            config_id: object::id(&config),
            owner: ctx.sender(),
            ssu_id,
            registry_id,
            min_deposit,
            min_withdraw,
            market_id: mkt,
        });

        transfer::share_object(config);
    }

    // ─�� Standings Config ───────────────────────────────────────────────

    /// Update standings thresholds. Owner only.
    public fun set_standings_config(
        config: &mut SsuUnifiedConfig,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        config.registry_id = registry_id;
        config.min_deposit = min_deposit;
        config.min_withdraw = min_withdraw;

        event::emit(StandingsConfigUpdatedEvent {
            config_id: object::id(config),
            registry_id,
            min_deposit,
            min_withdraw,
        });
    }

    // ── Market Link ────────────────────────────────────────────────────

    /// Link a market to this config. Owner only.
    public fun set_market(
        config: &mut SsuUnifiedConfig,
        market_id: ID,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        config.market_id = option::some(market_id);

        event::emit(MarketLinkedEvent {
            config_id: object::id(config),
            market_id,
        });
    }

    /// Unlink market from this config. Owner only.
    public fun remove_market(
        config: &mut SsuUnifiedConfig,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        config.market_id = option::none();

        event::emit(MarketUnlinkedEvent {
            config_id: object::id(config),
        });
    }

    // ── Delegate Management ─��──────────────────────────────���───────────

    /// Add a delegate. Owner only.
    public fun add_delegate(
        config: &mut SsuUnifiedConfig,
        delegate: address,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        let (exists, _) = config.delegates.index_of(&delegate);
        assert!(!exists, EDelegateAlreadyExists);
        config.delegates.push_back(delegate);

        event::emit(DelegateAddedEvent {
            config_id: object::id(config),
            delegate,
        });
    }

    /// Remove a delegate. Owner only.
    public fun remove_delegate(
        config: &mut SsuUnifiedConfig,
        delegate: address,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        let (exists, idx) = config.delegates.index_of(&delegate);
        assert!(exists, EDelegateNotFound);
        config.delegates.remove(idx);

        event::emit(DelegateRemovedEvent {
            config_id: object::id(config),
            delegate,
        });
    }

    // ── Visibility ────���────────────────────────────────────────────────

    /// Set visibility. Owner only.
    public fun set_visibility(
        config: &mut SsuUnifiedConfig,
        is_public: bool,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        config.is_public = is_public;

        event::emit(VisibilityChangedEvent {
            config_id: object::id(config),
            is_public,
        });
    }

    // ── Inventory Management: Admin Functions ──────────────────────────
    //
    // These use the SsuUnifiedAuth witness to manipulate SSU inventories
    // via the world package's extension-authenticated functions.
    // Caller must be the config owner or a delegate.

    /// Admin: move items from owner inventory to open/escrow inventory.
    public fun admin_to_escrow(
        config: &SsuUnifiedConfig,
        storage_unit: &mut StorageUnit,
        character: &Character,
        type_id: u64,
        quantity: u32,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        let item = storage_unit::withdraw_item(
            storage_unit, character, SsuUnifiedAuth {}, type_id, quantity, ctx,
        );
        storage_unit::deposit_to_open_inventory(
            storage_unit, character, item, SsuUnifiedAuth {}, ctx,
        );
    }

    /// Admin: move items from open/escrow inventory to owner inventory.
    public fun admin_from_escrow(
        config: &SsuUnifiedConfig,
        storage_unit: &mut StorageUnit,
        character: &Character,
        type_id: u64,
        quantity: u32,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        let item = storage_unit::withdraw_from_open_inventory(
            storage_unit, character, SsuUnifiedAuth {}, type_id, quantity, ctx,
        );
        storage_unit::deposit_item(
            storage_unit, character, item, SsuUnifiedAuth {}, ctx,
        );
    }

    /// Admin: move items from owner inventory to a player's owned inventory.
    public fun admin_to_player(
        config: &SsuUnifiedConfig,
        storage_unit: &mut StorageUnit,
        character: &Character,
        recipient: &Character,
        type_id: u64,
        quantity: u32,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        let item = storage_unit::withdraw_item(
            storage_unit, character, SsuUnifiedAuth {}, type_id, quantity, ctx,
        );
        storage_unit::deposit_to_owned(
            storage_unit, recipient, item, SsuUnifiedAuth {}, ctx,
        );
    }

    /// Admin: move items from open/escrow inventory to the sender's owned inventory.
    public fun admin_escrow_to_self(
        config: &SsuUnifiedConfig,
        storage_unit: &mut StorageUnit,
        character: &Character,
        type_id: u64,
        quantity: u32,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        let item = storage_unit::withdraw_from_open_inventory(
            storage_unit, character, SsuUnifiedAuth {}, type_id, quantity, ctx,
        );
        storage_unit::deposit_to_owned(
            storage_unit, character, item, SsuUnifiedAuth {}, ctx,
        );
    }

    /// Admin: move items from open/escrow inventory to a player's owned inventory.
    public fun admin_escrow_to_player(
        config: &SsuUnifiedConfig,
        storage_unit: &mut StorageUnit,
        character: &Character,
        recipient: &Character,
        type_id: u64,
        quantity: u32,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        let item = storage_unit::withdraw_from_open_inventory(
            storage_unit, character, SsuUnifiedAuth {}, type_id, quantity, ctx,
        );
        storage_unit::deposit_to_owned(
            storage_unit, recipient, item, SsuUnifiedAuth {}, ctx,
        );
    }

    // ── Inventory Management: Player Functions ─────────���───────────────
    //
    // These allow any player to deposit a pre-withdrawn item into the
    // SSU's owner or open inventory. The player first withdraws from
    // their own slot via OwnerCap, then calls one of these to deposit.
    // No authorization check -- the player can only deposit items they
    // already own (withdrew from their slot).

    /// Player: deposit a pre-withdrawn item into the open/escrow inventory.
    public fun player_to_escrow(
        _config: &SsuUnifiedConfig,
        storage_unit: &mut StorageUnit,
        character: &Character,
        item: Item,
        ctx: &mut TxContext,
    ) {
        storage_unit::deposit_to_open_inventory(
            storage_unit, character, item, SsuUnifiedAuth {}, ctx,
        );
    }

    /// Player: deposit a pre-withdrawn item into the owner inventory.
    public fun player_to_owner(
        _config: &SsuUnifiedConfig,
        storage_unit: &mut StorageUnit,
        character: &Character,
        item: Item,
        ctx: &mut TxContext,
    ) {
        storage_unit::deposit_item(
            storage_unit, character, item, SsuUnifiedAuth {}, ctx,
        );
    }

    // ── Composite Trade Functions ─────────────────────────────────────
    //
    // These atomically combine market operations with inventory transfers
    // so that listing/buying/cancelling and item movement happen in a
    // single transaction -- preventing desync between market state and
    // SSU inventory.

    /// Admin: atomically escrow items from owner inventory and create a sell listing.
    public fun escrow_and_list<T>(
        config: &SsuUnifiedConfig,
        market: &mut market::market::Market<T>,
        storage_unit: &mut StorageUnit,
        character: &Character,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        assert!(quantity <= 0xFFFFFFFF, EQuantityOverflow);
        // Move items from owner inventory to escrow
        let item = storage_unit::withdraw_item(
            storage_unit, character, SsuUnifiedAuth {}, type_id, (quantity as u32), ctx,
        );
        storage_unit::deposit_to_open_inventory(
            storage_unit, character, item, SsuUnifiedAuth {}, ctx,
        );
        // Create listing on market
        market::market::post_sell_listing(market, config.ssu_id, type_id, price_per_unit, quantity, clock, ctx);
    }

    /// Buyer: atomically purchase items and receive them into owned inventory.
    /// No admin check -- payment IS the authorization.
    public fun buy_and_receive<T>(
        _config: &SsuUnifiedConfig,
        market: &mut market::market::Market<T>,
        storage_unit: &mut StorageUnit,
        character: &Character,
        recipient: &Character,
        listing_id: u64,
        quantity: u64,
        payment: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<T> {
        assert!(quantity <= 0xFFFFFFFF, EQuantityOverflow);
        // Read type_id from listing in a scope block so the immutable borrow drops
        let type_id = {
            let listing = market::market::borrow_sell_listing(market, listing_id);
            market::market::listing_type_id(listing)
        };
        // Execute purchase -- handles payment, fees, seller proceeds
        let change = market::market::buy_from_listing(market, listing_id, quantity, payment, clock, ctx);
        // Transfer items from escrow to buyer's owned inventory
        let item = storage_unit::withdraw_from_open_inventory(
            storage_unit, character, SsuUnifiedAuth {}, type_id, (quantity as u32), ctx,
        );
        storage_unit::deposit_to_owned(
            storage_unit, recipient, item, SsuUnifiedAuth {}, ctx,
        );
        change
    }

    /// Admin: atomically cancel a sell listing and return items from escrow to owner inventory.
    public fun cancel_and_unescrow<T>(
        config: &SsuUnifiedConfig,
        market: &mut market::market::Market<T>,
        storage_unit: &mut StorageUnit,
        character: &Character,
        listing_id: u64,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        // Read listing data in a scope block so the immutable borrow drops before cancel
        let (type_id, quantity) = {
            let listing = market::market::borrow_sell_listing(market, listing_id);
            (market::market::listing_type_id(listing), market::market::listing_quantity(listing))
        };
        assert!(quantity <= 0xFFFFFFFF, EQuantityOverflow);
        // Cancel listing on market
        market::market::cancel_sell_listing(market, listing_id, ctx);
        // Return items from escrow to owner inventory
        let item = storage_unit::withdraw_from_open_inventory(
            storage_unit, character, SsuUnifiedAuth {}, type_id, (quantity as u32), ctx,
        );
        storage_unit::deposit_item(
            storage_unit, character, item, SsuUnifiedAuth {}, ctx,
        );
    }

    /// Admin: atomically fill a buy order (get paid) and deliver items to buyer.
    public fun fill_and_deliver<T>(
        config: &SsuUnifiedConfig,
        market: &mut market::market::Market<T>,
        storage_unit: &mut StorageUnit,
        character: &Character,
        buyer_character: &Character,
        order_id: u64,
        type_id: u64,
        quantity: u64,
        ctx: &mut TxContext,
    ) {
        assert_authorized(config, ctx);
        assert!(quantity <= 0xFFFFFFFF, EQuantityOverflow);
        // Fill buy order -- pays seller from escrowed coins
        market::market::fill_buy_order(market, order_id, type_id, quantity, ctx);
        // Deliver items from owner inventory to buyer
        let item = storage_unit::withdraw_item(
            storage_unit, character, SsuUnifiedAuth {}, type_id, (quantity as u32), ctx,
        );
        storage_unit::deposit_to_owned(
            storage_unit, buyer_character, item, SsuUnifiedAuth {}, ctx,
        );
    }
}
