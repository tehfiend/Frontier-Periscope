/// Per-gate standings configuration with multi-admin support.
///
/// Stores per-gate standings rules as dynamic fields on a shared
/// GateStandingsConfig object. Each gate rule references a StandingsRegistry
/// and defines standing thresholds for access and toll-free passage.
module gate_standings::config;

use sui::dynamic_field;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotAuthorized: vector<u8> = b"Caller is not authorized to modify config";

#[error(code = 1)]
const ENotOwner: vector<u8> = b"Only the owner can manage admins";

#[error(code = 2)]
const EAdminAlreadyExists: vector<u8> = b"Address is already an admin";

#[error(code = 3)]
const EAdminNotFound: vector<u8> = b"Address is not an admin";

#[error(code = 4)]
const ECannotRemoveOwner: vector<u8> = b"Cannot remove the owner from admins";

// -- Structs --------------------------------------------------------------------

/// Shared config object holding per-gate standings rules as dynamic fields.
public struct GateStandingsConfig has key {
    id: UID,
    owner: address,
    admins: vector<address>,
}

/// Per-gate standings rule stored as dynamic field keyed by gate ID.
public struct GateStandingsRule has store, drop {
    /// Which StandingsRegistry to check
    registry_id: ID,
    /// Minimum standing to pass (below = blocked)
    min_access: u8,
    /// Minimum standing for free passage (at/above = no toll)
    free_access: u8,
    /// Toll fee for standings between min_access and free_access (0 = no toll)
    toll_fee: u64,
    /// Where toll payments are sent
    toll_recipient: address,
    /// Jump permit validity duration in milliseconds
    permit_duration_ms: u64,
}

// -- Init -----------------------------------------------------------------------

/// Create the shared config object. Called once at publish time.
fun init(ctx: &mut TxContext) {
    transfer::share_object(GateStandingsConfig {
        id: object::new(ctx),
        owner: ctx.sender(),
        admins: vector::empty(),
    });
}

// -- Admin management (owner only) ----------------------------------------------

/// Add a co-admin wallet address. Owner only.
public fun add_admin(
    config: &mut GateStandingsConfig,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(!vector::contains(&config.admins, &admin), EAdminAlreadyExists);
    vector::push_back(&mut config.admins, admin);
}

/// Remove a co-admin wallet address. Owner only.
public fun remove_admin(
    config: &mut GateStandingsConfig,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(admin != config.owner, ECannotRemoveOwner);
    let (found, idx) = vector::index_of(&config.admins, &admin);
    assert!(found, EAdminNotFound);
    vector::remove(&mut config.admins, idx);
}

// -- Authorization checks -------------------------------------------------------

/// Check if the transaction sender is authorized (owner or co-admin).
public fun is_authorized(config: &GateStandingsConfig, ctx: &TxContext): bool {
    let sender = ctx.sender();
    if (sender == config.owner) return true;
    vector::contains(&config.admins, &sender)
}

// -- Gate config management -----------------------------------------------------

/// Set or update the standings rule for a specific gate. Requires authorization.
public fun set_gate_config(
    config: &mut GateStandingsConfig,
    gate_id: ID,
    registry_id: ID,
    min_access: u8,
    free_access: u8,
    toll_fee: u64,
    toll_recipient: address,
    permit_duration_ms: u64,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);

    let rule = GateStandingsRule {
        registry_id,
        min_access,
        free_access,
        toll_fee,
        toll_recipient,
        permit_duration_ms,
    };

    if (dynamic_field::exists_(&config.id, gate_id)) {
        *dynamic_field::borrow_mut<ID, GateStandingsRule>(&mut config.id, gate_id) = rule;
    } else {
        dynamic_field::add(&mut config.id, gate_id, rule);
    };
}

/// Remove the standings rule for a gate. Requires authorization.
public fun remove_gate_config(
    config: &mut GateStandingsConfig,
    gate_id: ID,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);
    if (dynamic_field::exists_(&config.id, gate_id)) {
        dynamic_field::remove<ID, GateStandingsRule>(&mut config.id, gate_id);
    };
}

// -- Read accessors -------------------------------------------------------------

/// Check if a gate has a standings rule set.
public fun has_gate_config(config: &GateStandingsConfig, gate_id: ID): bool {
    dynamic_field::exists_(&config.id, gate_id)
}

/// Read the standings rule for a gate. Aborts if not configured.
public fun get_gate_config(config: &GateStandingsConfig, gate_id: ID): &GateStandingsRule {
    dynamic_field::borrow<ID, GateStandingsRule>(&config.id, gate_id)
}

/// Get the registry ID from a gate standings rule.
public fun registry_id(rule: &GateStandingsRule): ID { rule.registry_id }

/// Get the minimum access standing.
public fun min_access(rule: &GateStandingsRule): u8 { rule.min_access }

/// Get the free access standing threshold.
public fun free_access(rule: &GateStandingsRule): u8 { rule.free_access }

/// Get the toll fee.
public fun toll_fee(rule: &GateStandingsRule): u64 { rule.toll_fee }

/// Get the toll recipient address.
public fun toll_recipient(rule: &GateStandingsRule): address { rule.toll_recipient }

/// Get the permit duration in milliseconds.
public fun permit_duration_ms(rule: &GateStandingsRule): u64 { rule.permit_duration_ms }

/// Get the owner address.
public fun owner(config: &GateStandingsConfig): address { config.owner }

/// Get the admins list.
public fun admins(config: &GateStandingsConfig): &vector<address> { &config.admins }

// -- Test helpers ---------------------------------------------------------------

#[test_only]
/// Create a GateStandingsConfig for testing (bypasses init).
public fun create_config_for_testing(ctx: &mut TxContext): GateStandingsConfig {
    GateStandingsConfig {
        id: object::new(ctx),
        owner: ctx.sender(),
        admins: vector::empty(),
    }
}

// -- Tests ----------------------------------------------------------------------

#[test]
fun test_config_set_and_get() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());
    let gate_id = object::id_from_address(@0x1234);
    let registry_id = object::id_from_address(@0x5678);

    set_gate_config(
        &mut config, gate_id, registry_id,
        2, 5, 1000, @0xFEE, 60000,
        scenario.ctx(),
    );

    assert!(has_gate_config(&config, gate_id));

    let rule = get_gate_config(&config, gate_id);
    assert!(registry_id(rule) == registry_id);
    assert!(min_access(rule) == 2);
    assert!(free_access(rule) == 5);
    assert!(toll_fee(rule) == 1000);
    assert!(toll_recipient(rule) == @0xFEE);
    assert!(permit_duration_ms(rule) == 60000);

    transfer::share_object(config);
    scenario.end();
}

#[test]
fun test_config_update() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());
    let gate_id = object::id_from_address(@0x1234);
    let registry_id = object::id_from_address(@0x5678);

    // Set initial config
    set_gate_config(
        &mut config, gate_id, registry_id,
        2, 5, 1000, @0xFEE, 60000,
        scenario.ctx(),
    );

    // Update to new values
    set_gate_config(
        &mut config, gate_id, registry_id,
        3, 6, 2000, @0xBEE, 120000,
        scenario.ctx(),
    );

    let rule = get_gate_config(&config, gate_id);
    assert!(min_access(rule) == 3);
    assert!(free_access(rule) == 6);
    assert!(toll_fee(rule) == 2000);
    assert!(toll_recipient(rule) == @0xBEE);
    assert!(permit_duration_ms(rule) == 120000);

    transfer::share_object(config);
    scenario.end();
}

#[test]
fun test_config_remove() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());
    let gate_id = object::id_from_address(@0x1234);
    let registry_id = object::id_from_address(@0x5678);

    set_gate_config(
        &mut config, gate_id, registry_id,
        2, 5, 1000, @0xFEE, 60000,
        scenario.ctx(),
    );

    assert!(has_gate_config(&config, gate_id));
    remove_gate_config(&mut config, gate_id, scenario.ctx());
    assert!(!has_gate_config(&config, gate_id));

    transfer::share_object(config);
    scenario.end();
}

#[test]
fun test_admin_management() {
    use sui::test_scenario;

    let owner = @0xA;
    let admin1 = @0xB;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());

    assert!(owner(&config) == owner);
    assert!(is_authorized(&config, scenario.ctx()));
    assert!(admins(&config).length() == 0);

    // Add admin
    add_admin(&mut config, admin1, scenario.ctx());
    assert!(admins(&config).length() == 1);

    // Remove admin
    remove_admin(&mut config, admin1, scenario.ctx());
    assert!(admins(&config).length() == 0);

    transfer::share_object(config);
    scenario.end();
}

#[test]
fun test_admin_can_set_config() {
    use sui::test_scenario;

    let owner = @0xA;
    let admin1 = @0xB;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());
    add_admin(&mut config, admin1, scenario.ctx());

    transfer::share_object(config);
    scenario.next_tx(admin1);

    let mut config = scenario.take_shared<GateStandingsConfig>();
    let gate_id = object::id_from_address(@0x1234);
    let registry_id = object::id_from_address(@0x5678);

    // Admin should be able to set config
    set_gate_config(
        &mut config, gate_id, registry_id,
        2, 5, 1000, @0xFEE, 60000,
        scenario.ctx(),
    );
    assert!(has_gate_config(&config, gate_id));

    test_scenario::return_shared(config);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_non_admin_cannot_set_config() {
    use sui::test_scenario;

    let owner = @0xA;
    let non_admin = @0xC;
    let mut scenario = test_scenario::begin(owner);

    let config = create_config_for_testing(scenario.ctx());
    transfer::share_object(config);
    scenario.next_tx(non_admin);

    let mut config = scenario.take_shared<GateStandingsConfig>();
    let gate_id = object::id_from_address(@0x1234);
    let registry_id = object::id_from_address(@0x5678);

    // Non-admin should fail
    set_gate_config(
        &mut config, gate_id, registry_id,
        2, 5, 1000, @0xFEE, 60000,
        scenario.ctx(),
    );

    test_scenario::return_shared(config);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotOwner)]
fun test_non_owner_cannot_add_admin() {
    use sui::test_scenario;

    let owner = @0xA;
    let admin1 = @0xB;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());
    add_admin(&mut config, admin1, scenario.ctx());

    transfer::share_object(config);
    scenario.next_tx(admin1);

    let mut config = scenario.take_shared<GateStandingsConfig>();
    // Admin (non-owner) should not be able to add admins
    add_admin(&mut config, @0xD, scenario.ctx());

    test_scenario::return_shared(config);
    scenario.end();
}
