/// Gate Toll Custom -- Extension for charging gate tolls in custom Coin<T> currencies.
///
/// Per-gate config is stored as phantom-typed dynamic fields keyed by
/// GateKey<T>, allowing a single gate to have configs for multiple
/// currencies. Admin functions use <T> to address the correct config.
///
/// Two toll-collection entry points are published:
/// - request_access<T>: transfers toll coin to tollRecipient address
/// - request_access_to_treasury<T>: deposits toll coin into a Treasury object
///
/// Free-access path (request_free_access<T>) skips toll for high-standing characters.
module gate_toll_custom::gate_toll_custom {
    use sui::coin::{Self, Coin};
    use sui::dynamic_field as df;
    use sui::event;
    use treasury::treasury::Treasury;

    // ── Error codes ────────────────────────────────────────────────────

    const ENotOwner: u64 = 0;
    const ENotAuthorized: u64 = 1;
    const ENoConfig: u64 = 2;
    const EInsufficientToll: u64 = 3;
    const EAdminAlreadyExists: u64 = 4;
    const EAdminNotFound: u64 = 5;

    // ── Types ──────────────────────────────────────────────────────────

    /// Shared config object. Owner + admins can manage per-gate toll configs.
    public struct GateTollCustomConfig has key, store {
        id: UID,
        owner: address,
        admins: vector<address>,
    }

    /// Phantom-typed key for per-gate config dynamic fields.
    /// Each (gate_id, CoinType) pair is a distinct dynamic field.
    public struct GateKey<phantom T> has copy, drop, store {
        gate_id: ID,
    }

    /// Per-gate toll configuration stored as a dynamic field value.
    public struct GateConfig has copy, drop, store {
        registry_id: ID,
        min_access: u8,
        free_access: u8,
        toll_amount: u64,
        toll_recipient: address,
        permit_duration_ms: u64,
    }

    // ── Events ─────────────────────────────────────────────────────────

    public struct ConfigCreatedEvent has copy, drop {
        config_id: ID,
        owner: address,
    }

    public struct GateConfigSetEvent has copy, drop {
        config_id: ID,
        gate_id: ID,
        toll_amount: u64,
        toll_recipient: address,
    }

    public struct TollCollectedEvent has copy, drop {
        config_id: ID,
        gate_id: ID,
        payer: address,
        amount: u64,
        recipient: address,
    }

    public struct TollDepositedToTreasuryEvent has copy, drop {
        config_id: ID,
        gate_id: ID,
        payer: address,
        amount: u64,
        treasury_id: ID,
    }

    public struct FreeAccessGrantedEvent has copy, drop {
        config_id: ID,
        gate_id: ID,
        traveler: address,
    }

    // ── Create config ──────────────────────────────────────────────────

    /// Create a new shared GateTollCustomConfig. Sender becomes owner.
    public fun create_config(ctx: &mut TxContext) {
        let config = GateTollCustomConfig {
            id: object::new(ctx),
            owner: ctx.sender(),
            admins: vector::empty(),
        };

        event::emit(ConfigCreatedEvent {
            config_id: object::id(&config),
            owner: ctx.sender(),
        });

        transfer::share_object(config);
    }

    // ── Admin management ───────────────────────────────────────────────

    public fun add_admin(
        config: &mut GateTollCustomConfig,
        admin: address,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        assert!(!config.admins.contains(&admin), EAdminAlreadyExists);
        config.admins.push_back(admin);
    }

    public fun remove_admin(
        config: &mut GateTollCustomConfig,
        admin: address,
        ctx: &TxContext,
    ) {
        assert!(config.owner == ctx.sender(), ENotOwner);
        let (found, idx) = config.admins.index_of(&admin);
        assert!(found, EAdminNotFound);
        config.admins.remove(idx);
    }

    // ── Gate config management (admin) ─────────────────────────────────

    /// Set or update the toll config for a gate with Coin<T> currency.
    public fun set_gate_config<T>(
        config: &mut GateTollCustomConfig,
        gate_id: ID,
        registry_id: ID,
        min_access: u8,
        free_access: u8,
        toll_amount: u64,
        toll_recipient: address,
        permit_duration_ms: u64,
        ctx: &TxContext,
    ) {
        assert!(is_authorized(config, ctx.sender()), ENotAuthorized);

        let key = GateKey<T> { gate_id };
        let gate_config = GateConfig {
            registry_id,
            min_access,
            free_access,
            toll_amount,
            toll_recipient,
            permit_duration_ms,
        };

        if (df::exists_(&config.id, key)) {
            *df::borrow_mut(&mut config.id, key) = gate_config;
        } else {
            df::add(&mut config.id, key, gate_config);
        };

        event::emit(GateConfigSetEvent {
            config_id: object::id(config),
            gate_id,
            toll_amount,
            toll_recipient,
        });
    }

    /// Remove toll config for a gate. Admin only.
    public fun remove_gate_config<T>(
        config: &mut GateTollCustomConfig,
        gate_id: ID,
        ctx: &TxContext,
    ) {
        assert!(is_authorized(config, ctx.sender()), ENotAuthorized);
        let key = GateKey<T> { gate_id };
        if (df::exists_(&config.id, key)) {
            df::remove<GateKey<T>, GateConfig>(&mut config.id, key);
        };
    }

    // ── Toll-paying access (transfer to address) ───────────────────────

    /// Pay toll in Coin<T> and transfer to tollRecipient address.
    /// DEPRECATED: transfers the entire coin, any overpayment is lost.
    /// Use request_access_v2 instead, which splits exact toll and returns change.
    public fun request_access<T>(
        config: &GateTollCustomConfig,
        gate_id: ID,
        coin: Coin<T>,
        ctx: &TxContext,
    ) {
        let key = GateKey<T> { gate_id };
        assert!(df::exists_(&config.id, key), ENoConfig);

        let gate_config: &GateConfig = df::borrow(&config.id, key);
        assert!(coin.value() >= gate_config.toll_amount, EInsufficientToll);

        let recipient = gate_config.toll_recipient;

        event::emit(TollCollectedEvent {
            config_id: object::id(config),
            gate_id,
            payer: ctx.sender(),
            amount: coin.value(),
            recipient,
        });

        transfer::public_transfer(coin, recipient);
    }

    /// Pay toll in Coin<T>, split exact amount, return change to sender.
    /// Preferred over request_access which transfers the entire coin.
    public fun request_access_v2<T>(
        config: &GateTollCustomConfig,
        gate_id: ID,
        mut coin: Coin<T>,
        ctx: &mut TxContext,
    ) {
        let key = GateKey<T> { gate_id };
        assert!(df::exists_(&config.id, key), ENoConfig);

        let gate_config: &GateConfig = df::borrow(&config.id, key);
        let toll_amount = gate_config.toll_amount;
        assert!(coin.value() >= toll_amount, EInsufficientToll);

        let recipient = gate_config.toll_recipient;

        // Split exact toll amount, return change to sender
        let toll_coin = coin::split(&mut coin, toll_amount, ctx);

        event::emit(TollCollectedEvent {
            config_id: object::id(config),
            gate_id,
            payer: ctx.sender(),
            amount: toll_amount,
            recipient,
        });

        transfer::public_transfer(toll_coin, recipient);
        transfer::public_transfer(coin, ctx.sender());
    }

    // ── Toll-paying access (deposit to treasury) ───────────────────────

    /// Pay toll in Coin<T> and deposit into a Treasury shared object.
    /// DEPRECATED: deposits the entire coin, any overpayment is lost.
    /// Use request_access_to_treasury_v2 instead.
    public fun request_access_to_treasury<T>(
        config: &GateTollCustomConfig,
        gate_id: ID,
        coin: Coin<T>,
        treasury: &mut Treasury,
        ctx: &TxContext,
    ) {
        let key = GateKey<T> { gate_id };
        assert!(df::exists_(&config.id, key), ENoConfig);

        let gate_config: &GateConfig = df::borrow(&config.id, key);
        assert!(coin.value() >= gate_config.toll_amount, EInsufficientToll);

        event::emit(TollDepositedToTreasuryEvent {
            config_id: object::id(config),
            gate_id,
            payer: ctx.sender(),
            amount: coin.value(),
            treasury_id: object::id(treasury),
        });

        treasury::treasury::deposit(treasury, coin, ctx);
    }

    /// Pay toll in Coin<T>, split exact amount, deposit to treasury, return change.
    /// Preferred over request_access_to_treasury which deposits the entire coin.
    public fun request_access_to_treasury_v2<T>(
        config: &GateTollCustomConfig,
        gate_id: ID,
        mut coin: Coin<T>,
        treasury: &mut Treasury,
        ctx: &mut TxContext,
    ) {
        let key = GateKey<T> { gate_id };
        assert!(df::exists_(&config.id, key), ENoConfig);

        let gate_config: &GateConfig = df::borrow(&config.id, key);
        let toll_amount = gate_config.toll_amount;
        assert!(coin.value() >= toll_amount, EInsufficientToll);

        // Split exact toll amount, return change to sender
        let toll_coin = coin::split(&mut coin, toll_amount, ctx);

        event::emit(TollDepositedToTreasuryEvent {
            config_id: object::id(config),
            gate_id,
            payer: ctx.sender(),
            amount: toll_amount,
            treasury_id: object::id(treasury),
        });

        treasury::treasury::deposit(treasury, toll_coin, ctx);
        transfer::public_transfer(coin, ctx.sender());
    }

    // ── Free access (high standing) ────────────────────────────────────

    /// Grant free access (no toll) for characters with standing >= free_access.
    /// Standing check is done client-side; this entry point just emits the event.
    public fun request_free_access<T>(
        config: &GateTollCustomConfig,
        gate_id: ID,
        ctx: &TxContext,
    ) {
        let key = GateKey<T> { gate_id };
        assert!(df::exists_(&config.id, key), ENoConfig);

        event::emit(FreeAccessGrantedEvent {
            config_id: object::id(config),
            gate_id,
            traveler: ctx.sender(),
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    fun is_authorized(config: &GateTollCustomConfig, addr: address): bool {
        config.owner == addr || config.admins.contains(&addr)
    }
}
