/// Per-assembly gate configuration storage.
///
/// Stores allowed tribe IDs and permit duration as a shared object
/// with dynamic fields keyed by gate object ID.
module gate_tribe::config;

use sui::dynamic_field;

/// Shared config object holding per-gate settings as dynamic fields.
public struct ExtensionConfig has key {
    id: UID,
    admin: address,
}

/// Per-gate configuration stored as a dynamic field on ExtensionConfig.
public struct GateConfig has store, drop {
    allowed_tribes: vector<u32>,
    permit_duration_ms: u64,
}

/// Create the shared config object. Called once at publish time.
fun init(ctx: &mut TxContext) {
    transfer::share_object(ExtensionConfig {
        id: object::new(ctx),
        admin: ctx.sender(),
    });
}

/// Set or update the configuration for a specific gate.
public fun set_gate_config(
    config: &mut ExtensionConfig,
    gate_id: ID,
    allowed_tribes: vector<u32>,
    permit_duration_ms: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.admin, 0);

    let gate_config = GateConfig {
        allowed_tribes,
        permit_duration_ms,
    };

    if (dynamic_field::exists_(&config.id, gate_id)) {
        *dynamic_field::borrow_mut<ID, GateConfig>(&mut config.id, gate_id) = gate_config;
    } else {
        dynamic_field::add(&mut config.id, gate_id, gate_config);
    };
}

/// Read the config for a gate. Aborts if not configured.
public fun get_gate_config(config: &ExtensionConfig, gate_id: ID): &GateConfig {
    dynamic_field::borrow<ID, GateConfig>(&config.id, gate_id)
}

/// Check if a gate has config set.
public fun has_gate_config(config: &ExtensionConfig, gate_id: ID): bool {
    dynamic_field::exists_(&config.id, gate_id)
}

/// Get allowed tribes from a gate config.
public fun allowed_tribes(config: &GateConfig): &vector<u32> {
    &config.allowed_tribes
}

/// Get permit duration from a gate config.
public fun permit_duration_ms(config: &GateConfig): u64 {
    config.permit_duration_ms
}
