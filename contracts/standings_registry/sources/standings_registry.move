/// Shared Standings Registry: named diplomatic standings for tribes and characters.
///
/// Creates StandingsRegistry shared objects that any extension (gate, SSU, etc.)
/// can reference. Extension-agnostic design -- no world dependency.
///
/// Standing scale (u8 0-6, displayed as -3 to +3):
///   0 = Opposition (-3), 1 = Hostile (-2), 2 = Unfriendly (-1),
///   3 = Neutral (0), 4 = Friendly (+1), 5 = Ally (+2), 6 = Full Trust (+3)
///
/// Flow:
///   1. Leader creates a StandingsRegistry via create_registry(name, ticker, default_standing)
///   2. The object ID is the handle for referencing this registry
///   3. Gate/SSU owners configure their extensions to reference a StandingsRegistry by ID
///   4. Admins can set/remove tribe and character standings; changes propagate instantly
///   5. Extensions call get_standing(registry, tribe_id, char_id) for access control decisions
module standings_registry::standings_registry;

use sui::dynamic_field;
use sui::event;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotAdmin: vector<u8> = b"Caller is not an admin of this registry";

#[error(code = 1)]
const ENotOwner: vector<u8> = b"Only the owner can perform this action";

#[error(code = 2)]
const EInvalidStanding: vector<u8> = b"Standing value must be 0-6";

#[error(code = 3)]
const EInvalidTicker: vector<u8> = b"Ticker contains invalid characters (must be A-Z or 0-9)";

#[error(code = 4)]
const EAdminAlreadyExists: vector<u8> = b"Address is already an admin";

#[error(code = 5)]
const EAdminNotFound: vector<u8> = b"Address is not an admin";

#[error(code = 6)]
const ECannotRemoveOwner: vector<u8> = b"Cannot remove the owner from admins";

#[error(code = 7)]
const EStandingNotFound: vector<u8> = b"Standing entry does not exist";

#[error(code = 8)]
const ETickerTooShort: vector<u8> = b"Ticker must be at least 3 characters";

#[error(code = 9)]
const ETickerTooLong: vector<u8> = b"Ticker must be at most 6 characters";

#[error(code = 10)]
const EBatchLengthMismatch: vector<u8> = b"Batch vectors must have the same length";

// -- Structs --------------------------------------------------------------------

/// Shared standings registry object. Extension-agnostic -- can be referenced by
/// gates, SSUs, turrets, etc.
///
/// Per-entity standings stored as dynamic fields:
///   TribeKey { tribe_id } -> u8
///   CharKey { char_id } -> u8
public struct StandingsRegistry has key {
    id: UID,
    owner: address,
    admins: vector<address>,
    name: vector<u8>,
    ticker: vector<u8>,
    default_standing: u8,
}

/// Dynamic field key for tribe standings.
public struct TribeKey has copy, drop, store {
    tribe_id: u32,
}

/// Dynamic field key for character standings.
public struct CharKey has copy, drop, store {
    char_id: u64,
}

// -- Events ---------------------------------------------------------------------

public struct RegistryCreatedEvent has copy, drop {
    registry_id: ID,
    name: vector<u8>,
    ticker: vector<u8>,
    creator: address,
}

/// kind: 0 = tribe, 1 = character
public struct StandingUpdatedEvent has copy, drop {
    registry_id: ID,
    kind: u8,
    entity_id: u64,
    standing: u8,
}

/// kind: 0 = tribe, 1 = character
public struct StandingRemovedEvent has copy, drop {
    registry_id: ID,
    kind: u8,
    entity_id: u64,
}

// -- Internal helpers -----------------------------------------------------------

/// Validate ticker: must be 3-6 characters, each byte A-Z (65-90) or 0-9 (48-57).
fun validate_ticker(ticker: &vector<u8>) {
    let len = ticker.length();
    assert!(len >= 3, ETickerTooShort);
    assert!(len <= 6, ETickerTooLong);

    let mut i = 0;
    while (i < len) {
        let b = *vector::borrow(ticker, i);
        let valid = (b >= 65 && b <= 90) || (b >= 48 && b <= 57);
        assert!(valid, EInvalidTicker);
        i = i + 1;
    };
}

/// Validate standing value is in range 0-6.
fun validate_standing(standing: u8) {
    assert!(standing <= 6, EInvalidStanding);
}

/// Set a tribe standing (internal, no auth check).
fun set_tribe_standing_internal(registry: &mut StandingsRegistry, tribe_id: u32, standing: u8) {
    validate_standing(standing);
    let key = TribeKey { tribe_id };
    if (dynamic_field::exists_(&registry.id, key)) {
        *dynamic_field::borrow_mut<TribeKey, u8>(&mut registry.id, key) = standing;
    } else {
        dynamic_field::add(&mut registry.id, key, standing);
    };

    event::emit(StandingUpdatedEvent {
        registry_id: object::id(registry),
        kind: 0,
        entity_id: (tribe_id as u64),
        standing,
    });
}

/// Set a character standing (internal, no auth check).
fun set_character_standing_internal(
    registry: &mut StandingsRegistry,
    char_id: u64,
    standing: u8,
) {
    validate_standing(standing);
    let key = CharKey { char_id };
    if (dynamic_field::exists_(&registry.id, key)) {
        *dynamic_field::borrow_mut<CharKey, u8>(&mut registry.id, key) = standing;
    } else {
        dynamic_field::add(&mut registry.id, key, standing);
    };

    event::emit(StandingUpdatedEvent {
        registry_id: object::id(registry),
        kind: 1,
        entity_id: char_id,
        standing,
    });
}

// -- Create ---------------------------------------------------------------------

/// Create a new StandingsRegistry. The caller becomes the owner and first admin.
#[allow(lint(share_owned))]
public fun create_registry(
    name: vector<u8>,
    ticker: vector<u8>,
    default_standing: u8,
    ctx: &mut TxContext,
) {
    validate_ticker(&ticker);
    validate_standing(default_standing);

    let registry = StandingsRegistry {
        id: object::new(ctx),
        owner: ctx.sender(),
        admins: vector::empty(),
        name,
        ticker,
        default_standing,
    };

    event::emit(RegistryCreatedEvent {
        registry_id: object::id(&registry),
        name: registry.name,
        ticker: registry.ticker,
        creator: ctx.sender(),
    });

    transfer::share_object(registry);
}

// -- Standing CRUD (admin only) -------------------------------------------------

/// Set standing for a tribe. Admin only. Validates standing 0-6.
public fun set_tribe_standing(
    registry: &mut StandingsRegistry,
    tribe_id: u32,
    standing: u8,
    ctx: &TxContext,
) {
    assert!(is_admin(registry, ctx), ENotAdmin);
    set_tribe_standing_internal(registry, tribe_id, standing);
}

/// Set standing for a character. Admin only. Validates standing 0-6.
public fun set_character_standing(
    registry: &mut StandingsRegistry,
    char_id: u64,
    standing: u8,
    ctx: &TxContext,
) {
    assert!(is_admin(registry, ctx), ENotAdmin);
    set_character_standing_internal(registry, char_id, standing);
}

/// Remove tribe standing (entity reverts to default_standing). Admin only.
public fun remove_tribe_standing(
    registry: &mut StandingsRegistry,
    tribe_id: u32,
    ctx: &TxContext,
) {
    assert!(is_admin(registry, ctx), ENotAdmin);
    let key = TribeKey { tribe_id };
    assert!(dynamic_field::exists_(&registry.id, key), EStandingNotFound);
    dynamic_field::remove<TribeKey, u8>(&mut registry.id, key);

    event::emit(StandingRemovedEvent {
        registry_id: object::id(registry),
        kind: 0,
        entity_id: (tribe_id as u64),
    });
}

/// Remove character standing (entity reverts to default_standing). Admin only.
public fun remove_character_standing(
    registry: &mut StandingsRegistry,
    char_id: u64,
    ctx: &TxContext,
) {
    assert!(is_admin(registry, ctx), ENotAdmin);
    let key = CharKey { char_id };
    assert!(dynamic_field::exists_(&registry.id, key), EStandingNotFound);
    dynamic_field::remove<CharKey, u8>(&mut registry.id, key);

    event::emit(StandingRemovedEvent {
        registry_id: object::id(registry),
        kind: 1,
        entity_id: char_id,
    });
}

// -- Batch operations (admin only) ----------------------------------------------

/// Set standings for multiple tribes in one call. Admin only.
/// Vectors must have the same length.
public fun set_tribe_standings_batch(
    registry: &mut StandingsRegistry,
    tribe_ids: vector<u32>,
    standings: vector<u8>,
    ctx: &TxContext,
) {
    assert!(is_admin(registry, ctx), ENotAdmin);
    let len = tribe_ids.length();
    assert!(len == standings.length(), EBatchLengthMismatch);

    let mut i = 0;
    while (i < len) {
        let tribe_id = *vector::borrow(&tribe_ids, i);
        let standing = *vector::borrow(&standings, i);
        set_tribe_standing_internal(registry, tribe_id, standing);
        i = i + 1;
    };
}

/// Set standings for multiple characters in one call. Admin only.
/// Vectors must have the same length.
public fun set_character_standings_batch(
    registry: &mut StandingsRegistry,
    char_ids: vector<u64>,
    standings: vector<u8>,
    ctx: &TxContext,
) {
    assert!(is_admin(registry, ctx), ENotAdmin);
    let len = char_ids.length();
    assert!(len == standings.length(), EBatchLengthMismatch);

    let mut i = 0;
    while (i < len) {
        let char_id = *vector::borrow(&char_ids, i);
        let standing = *vector::borrow(&standings, i);
        set_character_standing_internal(registry, char_id, standing);
        i = i + 1;
    };
}

// -- Standing lookups -----------------------------------------------------------

/// Primary lookup: check character standing first, then tribe, fall back to default.
/// This is the main function used by extension contracts for access control.
public fun get_standing(registry: &StandingsRegistry, tribe_id: u32, char_id: u64): u8 {
    // Character-level override takes priority
    let char_key = CharKey { char_id };
    if (dynamic_field::exists_(&registry.id, char_key)) {
        return *dynamic_field::borrow<CharKey, u8>(&registry.id, char_key)
    };

    // Tribe-level standing
    let tribe_key = TribeKey { tribe_id };
    if (dynamic_field::exists_(&registry.id, tribe_key)) {
        return *dynamic_field::borrow<TribeKey, u8>(&registry.id, tribe_key)
    };

    // Default standing for unregistered entities
    registry.default_standing
}

/// Get standing for a specific tribe. Returns default_standing if not found.
public fun get_tribe_standing(registry: &StandingsRegistry, tribe_id: u32): u8 {
    let key = TribeKey { tribe_id };
    if (dynamic_field::exists_(&registry.id, key)) {
        *dynamic_field::borrow<TribeKey, u8>(&registry.id, key)
    } else {
        registry.default_standing
    }
}

/// Get standing for a specific character. Returns default_standing if not found.
public fun get_character_standing(registry: &StandingsRegistry, char_id: u64): u8 {
    let key = CharKey { char_id };
    if (dynamic_field::exists_(&registry.id, key)) {
        *dynamic_field::borrow<CharKey, u8>(&registry.id, key)
    } else {
        registry.default_standing
    }
}

// -- Owner-only management ------------------------------------------------------

/// Set the default standing for unregistered entities. Owner only.
public fun set_default_standing(
    registry: &mut StandingsRegistry,
    standing: u8,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == registry.owner, ENotOwner);
    validate_standing(standing);
    registry.default_standing = standing;
}

/// Update registry name and ticker. Owner only.
public fun update_info(
    registry: &mut StandingsRegistry,
    name: vector<u8>,
    ticker: vector<u8>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == registry.owner, ENotOwner);
    validate_ticker(&ticker);
    registry.name = name;
    registry.ticker = ticker;
}

/// Add a co-admin address. Owner only.
public fun add_admin(
    registry: &mut StandingsRegistry,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == registry.owner, ENotOwner);
    assert!(!vector::contains(&registry.admins, &admin), EAdminAlreadyExists);
    vector::push_back(&mut registry.admins, admin);
}

/// Remove a co-admin address. Owner only. Cannot remove the owner.
public fun remove_admin(
    registry: &mut StandingsRegistry,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == registry.owner, ENotOwner);
    assert!(admin != registry.owner, ECannotRemoveOwner);
    let (found, idx) = vector::index_of(&registry.admins, &admin);
    assert!(found, EAdminNotFound);
    vector::remove(&mut registry.admins, idx);
}

// -- Authorization check --------------------------------------------------------

/// Check if the transaction sender is an admin (owner or co-admin).
public fun is_admin(registry: &StandingsRegistry, ctx: &TxContext): bool {
    let sender = ctx.sender();
    if (sender == registry.owner) return true;
    vector::contains(&registry.admins, &sender)
}

// -- Read accessors -------------------------------------------------------------

/// Get the owner address.
public fun owner(registry: &StandingsRegistry): address {
    registry.owner
}

/// Get the admins list.
public fun admins(registry: &StandingsRegistry): &vector<address> {
    &registry.admins
}

/// Get the registry name.
public fun name(registry: &StandingsRegistry): &vector<u8> {
    &registry.name
}

/// Get the ticker.
public fun ticker(registry: &StandingsRegistry): &vector<u8> {
    &registry.ticker
}

/// Get the default standing.
public fun default_standing(registry: &StandingsRegistry): u8 {
    registry.default_standing
}

// -- Tests ----------------------------------------------------------------------

#[test]
fun test_create_registry() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    // Create registry
    create_registry(b"Test Registry", b"TEST", 3, scenario.ctx());

    // Advance to next tx to access the shared object
    scenario.next_tx(owner);

    let registry = scenario.take_shared<StandingsRegistry>();
    assert!(registry.owner == owner);
    assert!(registry.name == b"Test Registry");
    assert!(registry.ticker == b"TEST");
    assert!(registry.default_standing == 3);
    assert!(registry.admins.length() == 0);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ETickerTooShort)]
fun test_invalid_ticker_too_short() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);
    create_registry(b"Bad", b"AB", 3, scenario.ctx());
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ETickerTooLong)]
fun test_invalid_ticker_too_long() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);
    create_registry(b"Bad", b"TOOLONG1", 3, scenario.ctx());
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EInvalidTicker)]
fun test_invalid_ticker_lowercase() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);
    create_registry(b"Bad", b"abc", 3, scenario.ctx());
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EInvalidTicker)]
fun test_invalid_ticker_special_chars() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);
    create_registry(b"Bad", b"A-B", 3, scenario.ctx());
    scenario.end();
}

#[test]
fun test_set_and_get_standings() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Diplomacy", b"DIP", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();

    // Set tribe standing
    set_tribe_standing(&mut registry, 100, 5, scenario.ctx());
    assert!(get_tribe_standing(&registry, 100) == 5);

    // Set character standing
    set_character_standing(&mut registry, 42, 1, scenario.ctx());
    assert!(get_character_standing(&registry, 42) == 1);

    // Update existing standing
    set_tribe_standing(&mut registry, 100, 6, scenario.ctx());
    assert!(get_tribe_standing(&registry, 100) == 6);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun test_standing_priority() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Priority", b"PRI", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();

    // Set tribe standing to Ally (5)
    set_tribe_standing(&mut registry, 10, 5, scenario.ctx());

    // Character in tribe 10 gets tribe standing
    assert!(get_standing(&registry, 10, 999) == 5);

    // Set character-specific override to Hostile (1)
    set_character_standing(&mut registry, 999, 1, scenario.ctx());

    // Character standing overrides tribe standing
    assert!(get_standing(&registry, 10, 999) == 1);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun test_default_standing() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Defaults", b"DEF", 3, scenario.ctx());
    scenario.next_tx(owner);

    let registry = scenario.take_shared<StandingsRegistry>();

    // Unregistered tribe gets default
    assert!(get_tribe_standing(&registry, 999) == 3);

    // Unregistered character gets default
    assert!(get_character_standing(&registry, 12345) == 3);

    // get_standing also returns default for unregistered entities
    assert!(get_standing(&registry, 999, 12345) == 3);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun test_remove_standing() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Remove", b"REM", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();

    // Set and then remove tribe standing
    set_tribe_standing(&mut registry, 50, 6, scenario.ctx());
    assert!(get_tribe_standing(&registry, 50) == 6);
    remove_tribe_standing(&mut registry, 50, scenario.ctx());
    assert!(get_tribe_standing(&registry, 50) == 3); // reverts to default

    // Set and then remove character standing
    set_character_standing(&mut registry, 200, 0, scenario.ctx());
    assert!(get_character_standing(&registry, 200) == 0);
    remove_character_standing(&mut registry, 200, scenario.ctx());
    assert!(get_character_standing(&registry, 200) == 3); // reverts to default

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun test_admin_management() {
    use sui::test_scenario;

    let owner = @0xA;
    let admin1 = @0xB;
    let non_admin = @0xC;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Admin", b"ADM", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();

    // Owner is admin by default
    assert!(is_admin(&registry, scenario.ctx()));

    // Add admin
    add_admin(&mut registry, admin1, scenario.ctx());
    assert!(registry.admins.length() == 1);

    // Admin can set standings
    test_scenario::return_shared(registry);
    scenario.next_tx(admin1);
    let mut registry = scenario.take_shared<StandingsRegistry>();
    assert!(is_admin(&registry, scenario.ctx()));
    set_tribe_standing(&mut registry, 1, 5, scenario.ctx());

    // Non-admin cannot set standings
    test_scenario::return_shared(registry);
    scenario.next_tx(non_admin);
    let registry = scenario.take_shared<StandingsRegistry>();
    assert!(!is_admin(&registry, scenario.ctx()));

    // Remove admin (from owner)
    test_scenario::return_shared(registry);
    scenario.next_tx(owner);
    let mut registry = scenario.take_shared<StandingsRegistry>();
    remove_admin(&mut registry, admin1, scenario.ctx());
    assert!(registry.admins.length() == 0);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotAdmin)]
fun test_non_admin_rejected() {
    use sui::test_scenario;

    let owner = @0xA;
    let non_admin = @0xC;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Reject", b"REJ", 3, scenario.ctx());
    scenario.next_tx(non_admin);

    let mut registry = scenario.take_shared<StandingsRegistry>();
    set_tribe_standing(&mut registry, 1, 5, scenario.ctx());

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun test_owner_only_operations() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Owner", b"OWN", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();

    // Owner can set default standing
    set_default_standing(&mut registry, 4, scenario.ctx());
    assert!(registry.default_standing == 4);

    // Owner can update info
    update_info(&mut registry, b"New Name", b"NEW", scenario.ctx());
    assert!(registry.name == b"New Name");
    assert!(registry.ticker == b"NEW");

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotOwner)]
fun test_non_owner_cannot_set_default() {
    use sui::test_scenario;

    let owner = @0xA;
    let non_owner = @0xB;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Test", b"TST", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();
    add_admin(&mut registry, non_owner, scenario.ctx());

    test_scenario::return_shared(registry);
    scenario.next_tx(non_owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();
    // Admin (non-owner) cannot set default standing
    set_default_standing(&mut registry, 5, scenario.ctx());

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotOwner)]
fun test_non_owner_cannot_add_admin() {
    use sui::test_scenario;

    let owner = @0xA;
    let admin1 = @0xB;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Test", b"TST", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();
    add_admin(&mut registry, admin1, scenario.ctx());

    test_scenario::return_shared(registry);
    scenario.next_tx(admin1);

    let mut registry = scenario.take_shared<StandingsRegistry>();
    // Admin cannot add other admins (owner-only)
    add_admin(&mut registry, @0xD, scenario.ctx());

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EInvalidStanding)]
fun test_invalid_standing_value() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Test", b"TST", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();
    set_tribe_standing(&mut registry, 1, 7, scenario.ctx()); // 7 > 6, invalid

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
fun test_batch_set_standings() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Batch", b"BAT", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();

    // Batch set tribe standings
    let tribe_ids = vector[10u32, 20u32, 30u32];
    let tribe_standings = vector[5u8, 1u8, 6u8];
    set_tribe_standings_batch(&mut registry, tribe_ids, tribe_standings, scenario.ctx());

    assert!(get_tribe_standing(&registry, 10) == 5);
    assert!(get_tribe_standing(&registry, 20) == 1);
    assert!(get_tribe_standing(&registry, 30) == 6);

    // Batch set character standings
    let char_ids = vector[100u64, 200u64];
    let char_standings = vector[0u8, 4u8];
    set_character_standings_batch(&mut registry, char_ids, char_standings, scenario.ctx());

    assert!(get_character_standing(&registry, 100) == 0);
    assert!(get_character_standing(&registry, 200) == 4);

    test_scenario::return_shared(registry);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EBatchLengthMismatch)]
fun test_batch_length_mismatch() {
    use sui::test_scenario;

    let owner = @0xA;
    let mut scenario = test_scenario::begin(owner);

    create_registry(b"Mismatch", b"MIS", 3, scenario.ctx());
    scenario.next_tx(owner);

    let mut registry = scenario.take_shared<StandingsRegistry>();

    // Mismatched lengths should fail
    let tribe_ids = vector[10u32, 20u32];
    let tribe_standings = vector[5u8, 1u8, 6u8]; // 3 standings but only 2 IDs
    set_tribe_standings_batch(&mut registry, tribe_ids, tribe_standings, scenario.ctx());

    test_scenario::return_shared(registry);
    scenario.end();
}
