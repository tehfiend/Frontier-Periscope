/// SSU Standings -- Per-SSU standings configuration for access control.
///
/// Stores per-SSU config (standings registry + deposit/withdraw thresholds)
/// as dynamic fields on a shared config object. Any user can configure
/// their own SSU -- the first caller to set config for an SSU becomes the
/// config owner for that entry. Only the config owner can update or remove it.
///
/// No admin list required. SSU owners manage their own configs directly.
module ssu_standings::ssu_standings {
    use sui::dynamic_field as df;
    use sui::event;

    // ── Error codes ────────────────────────────────────────────────────

    const ENotConfigOwner: u64 = 0;
    const ENoConfig: u64 = 1;

    // ── Types ──────────────────────────────────────────────────────────

    /// Shared config registry. Per-SSU configs are stored as dynamic fields.
    public struct SsuStandingsConfig has key {
        id: UID,
    }

    /// Dynamic field key for per-SSU config lookup.
    public struct SsuKey has copy, drop, store {
        ssu_id: ID,
    }

    /// Per-SSU standings configuration stored as a dynamic field value.
    public struct SsuConfig has copy, drop, store {
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
        /// Address that set this config -- only they can update/remove it.
        config_owner: address,
    }

    // ── Events ─────────────────────────────────────────────────────────

    public struct ConfigRegistryCreatedEvent has copy, drop {
        config_id: ID,
    }

    public struct SsuConfigSetEvent has copy, drop {
        config_id: ID,
        ssu_id: ID,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
        config_owner: address,
    }

    public struct SsuConfigRemovedEvent has copy, drop {
        config_id: ID,
        ssu_id: ID,
    }

    // ── Init ───────────────────────────────────────────────────────────

    /// Create the shared config registry on publish.
    fun init(ctx: &mut TxContext) {
        let config = SsuStandingsConfig {
            id: object::new(ctx),
        };

        event::emit(ConfigRegistryCreatedEvent {
            config_id: object::id(&config),
        });

        transfer::share_object(config);
    }

    // ── Set / Update config ────────────────────────────────────────────

    /// Set or update standings config for an SSU.
    /// First caller becomes config owner. Only config owner can update.
    public fun set_ssu_config(
        config: &mut SsuStandingsConfig,
        ssu_id: ID,
        registry_id: ID,
        min_deposit: u8,
        min_withdraw: u8,
        ctx: &TxContext,
    ) {
        let key = SsuKey { ssu_id };
        let sender = ctx.sender();

        if (df::exists_(&config.id, key)) {
            let existing: &mut SsuConfig = df::borrow_mut(&mut config.id, key);
            assert!(existing.config_owner == sender, ENotConfigOwner);
            existing.registry_id = registry_id;
            existing.min_deposit = min_deposit;
            existing.min_withdraw = min_withdraw;
        } else {
            df::add(&mut config.id, key, SsuConfig {
                registry_id,
                min_deposit,
                min_withdraw,
                config_owner: sender,
            });
        };

        event::emit(SsuConfigSetEvent {
            config_id: object::id(config),
            ssu_id,
            registry_id,
            min_deposit,
            min_withdraw,
            config_owner: sender,
        });
    }

    // ── Remove config ──────────────────────────────────────────────────

    /// Remove standings config for an SSU. Only config owner can remove.
    public fun remove_ssu_config(
        config: &mut SsuStandingsConfig,
        ssu_id: ID,
        ctx: &TxContext,
    ) {
        let key = SsuKey { ssu_id };
        assert!(df::exists_(&config.id, key), ENoConfig);

        let existing: &SsuConfig = df::borrow(&config.id, key);
        assert!(existing.config_owner == ctx.sender(), ENotConfigOwner);

        df::remove<SsuKey, SsuConfig>(&mut config.id, key);

        event::emit(SsuConfigRemovedEvent {
            config_id: object::id(config),
            ssu_id,
        });
    }

    // ── Read helpers ───────────────────────────────────────────────────

    /// Check if an SSU has a standings config.
    public fun has_ssu_config(config: &SsuStandingsConfig, ssu_id: ID): bool {
        df::exists_(&config.id, SsuKey { ssu_id })
    }
}
