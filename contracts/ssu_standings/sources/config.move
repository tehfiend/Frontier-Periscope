/// Per-SSU standings configuration with multi-admin support.
///
/// Stores per-SSU standings rules as dynamic fields on a shared
/// SsuStandingsConfig object. Each SSU rule references a StandingsRegistry
/// and defines standing thresholds for deposit and withdraw operations.
module ssu_standings::config;

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

/// Shared config object holding per-SSU standings rules as dynamic fields.
public struct SsuStandingsConfig has key {
    id: UID,
    owner: address,
    admins: vector<address>,
}

/// Per-SSU standings rule stored as dynamic field keyed by SSU ID.
public struct SsuStandingsRule has store, drop {
    /// Which StandingsRegistry to check
    registry_id: ID,
    /// Minimum standing required to deposit items
    min_deposit: u8,
    /// Minimum standing required to withdraw items
    min_withdraw: u8,
}

// -- Init -----------------------------------------------------------------------

/// Create the shared config object. Called once at publish time.
fun init(ctx: &mut TxContext) {
    transfer::share_object(SsuStandingsConfig {
        id: object::new(ctx),
        owner: ctx.sender(),
        admins: vector::empty(),
    });
}

// -- Admin management (owner only) ----------------------------------------------

/// Add a co-admin wallet address. Owner only.
public fun add_admin(
    config: &mut SsuStandingsConfig,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(!vector::contains(&config.admins, &admin), EAdminAlreadyExists);
    vector::push_back(&mut config.admins, admin);
}

/// Remove a co-admin wallet address. Owner only.
public fun remove_admin(
    config: &mut SsuStandingsConfig,
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
public fun is_authorized(config: &SsuStandingsConfig, ctx: &TxContext): bool {
    let sender = ctx.sender();
    if (sender == config.owner) return true;
    vector::contains(&config.admins, &sender)
}

// -- SSU config management ------------------------------------------------------

/// Set or update the standings rule for a specific SSU. Requires authorization.
public fun set_ssu_config(
    config: &mut SsuStandingsConfig,
    ssu_id: ID,
    registry_id: ID,
    min_deposit: u8,
    min_withdraw: u8,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);

    let rule = SsuStandingsRule {
        registry_id,
        min_deposit,
        min_withdraw,
    };

    if (dynamic_field::exists_(&config.id, ssu_id)) {
        *dynamic_field::borrow_mut<ID, SsuStandingsRule>(&mut config.id, ssu_id) = rule;
    } else {
        dynamic_field::add(&mut config.id, ssu_id, rule);
    };
}

/// Remove the standings rule for an SSU. Requires authorization.
public fun remove_ssu_config(
    config: &mut SsuStandingsConfig,
    ssu_id: ID,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);
    if (dynamic_field::exists_(&config.id, ssu_id)) {
        dynamic_field::remove<ID, SsuStandingsRule>(&mut config.id, ssu_id);
    };
}

// -- Read accessors -------------------------------------------------------------

/// Check if an SSU has a standings rule set.
public fun has_ssu_config(config: &SsuStandingsConfig, ssu_id: ID): bool {
    dynamic_field::exists_(&config.id, ssu_id)
}

/// Read the standings rule for an SSU. Aborts if not configured.
public fun get_ssu_config(config: &SsuStandingsConfig, ssu_id: ID): &SsuStandingsRule {
    dynamic_field::borrow<ID, SsuStandingsRule>(&config.id, ssu_id)
}

/// Get the registry ID from an SSU standings rule.
public fun registry_id(rule: &SsuStandingsRule): ID { rule.registry_id }

/// Get the minimum deposit standing.
public fun min_deposit(rule: &SsuStandingsRule): u8 { rule.min_deposit }

/// Get the minimum withdraw standing.
public fun min_withdraw(rule: &SsuStandingsRule): u8 { rule.min_withdraw }

/// Get the owner address.
public fun owner(config: &SsuStandingsConfig): address { config.owner }

/// Get the admins list.
public fun admins(config: &SsuStandingsConfig): &vector<address> { &config.admins }

// -- Test helpers ---------------------------------------------------------------

#[test_only]
/// Create a SsuStandingsConfig for testing (bypasses init).
public fun create_config_for_testing(ctx: &mut TxContext): SsuStandingsConfig {
    SsuStandingsConfig {
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
    let ssu_id = object::id_from_address(@0x1234);
    let registry_id_val = object::id_from_address(@0x5678);

    set_ssu_config(
        &mut config, ssu_id, registry_id_val,
        2, 4,
        scenario.ctx(),
    );

    assert!(has_ssu_config(&config, ssu_id));

    let rule = get_ssu_config(&config, ssu_id);
    assert!(registry_id(rule) == registry_id_val);
    assert!(min_deposit(rule) == 2);
    assert!(min_withdraw(rule) == 4);

    transfer::share_object(config);
    scenario.end();
}

#[test]
fun test_config_update() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());
    let ssu_id = object::id_from_address(@0x1234);
    let registry_id_val = object::id_from_address(@0x5678);

    // Set initial config
    set_ssu_config(
        &mut config, ssu_id, registry_id_val,
        2, 4,
        scenario.ctx(),
    );

    // Update to new values
    set_ssu_config(
        &mut config, ssu_id, registry_id_val,
        3, 5,
        scenario.ctx(),
    );

    let rule = get_ssu_config(&config, ssu_id);
    assert!(min_deposit(rule) == 3);
    assert!(min_withdraw(rule) == 5);

    transfer::share_object(config);
    scenario.end();
}

#[test]
fun test_config_remove() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    let mut config = create_config_for_testing(scenario.ctx());
    let ssu_id = object::id_from_address(@0x1234);
    let registry_id_val = object::id_from_address(@0x5678);

    set_ssu_config(
        &mut config, ssu_id, registry_id_val,
        2, 4,
        scenario.ctx(),
    );

    assert!(has_ssu_config(&config, ssu_id));
    remove_ssu_config(&mut config, ssu_id, scenario.ctx());
    assert!(!has_ssu_config(&config, ssu_id));

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

    let mut config = scenario.take_shared<SsuStandingsConfig>();
    let ssu_id = object::id_from_address(@0x1234);
    let registry_id_val = object::id_from_address(@0x5678);

    // Admin should be able to set config
    set_ssu_config(
        &mut config, ssu_id, registry_id_val,
        2, 4,
        scenario.ctx(),
    );
    assert!(has_ssu_config(&config, ssu_id));

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

    let mut config = scenario.take_shared<SsuStandingsConfig>();
    let ssu_id = object::id_from_address(@0x1234);
    let registry_id_val = object::id_from_address(@0x5678);

    // Non-admin should fail
    set_ssu_config(
        &mut config, ssu_id, registry_id_val,
        2, 4,
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

    let mut config = scenario.take_shared<SsuStandingsConfig>();
    // Admin (non-owner) should not be able to add admins
    add_admin(&mut config, @0xD, scenario.ctx());

    test_scenario::return_shared(config);
    scenario.end();
}
