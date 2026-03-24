/// Dual-mode private map: encrypted (invite-based) or cleartext (standings-gated).
///
/// Mode 0 (encrypted): X25519 encrypted locations with MapInviteV2 membership.
///   Write access requires: valid invite + not revoked + editor/creator.
///
/// Mode 1 (cleartext standings): Plaintext locations gated by StandingsRegistry.
///   Write access requires: standing >= min_write OR editor/creator.
///   Read access: client-enforced via min_read (on-chain data is public).
///
/// No world dependency -- callers pass tribe_id and char_id directly.
module private_map_standings::private_map_standings;

use std::string::String;
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;
use standings_registry::standings_registry::{Self, StandingsRegistry};

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotCreator: vector<u8> = b"Only the map creator can perform this action";

#[error(code = 1)]
const ELocationNotFound: vector<u8> = b"Location not found on this map";

#[error(code = 2)]
const ENotLocationOwner: vector<u8> = b"Only the creator or the address that added this location can remove it";

#[error(code = 3)]
const EInviteNotForThisMap: vector<u8> = b"MapInviteV2 does not belong to this map";

#[error(code = 4)]
const EMemberRevoked: vector<u8> = b"Member has been revoked from this map";

#[error(code = 5)]
const EAlreadyRevoked: vector<u8> = b"Address is already in the revoked list";

#[error(code = 6)]
const EInvalidPublicKeyLength: vector<u8> = b"Public key must be exactly 32 bytes";

#[error(code = 7)]
const EWrongMode: vector<u8> = b"Function called on a map with incompatible mode";

#[error(code = 8)]
const EAccessDenied: vector<u8> = b"Standing too low and not an editor/creator";

#[error(code = 9)]
const ERegistryMismatch: vector<u8> = b"Passed StandingsRegistry ID does not match map registry_id";

#[error(code = 10)]
const EInvalidStanding: vector<u8> = b"Standing value must be 0-6";

#[error(code = 11)]
const EEditorAlreadyExists: vector<u8> = b"Address is already in the editors list";

#[error(code = 12)]
const EEditorNotFound: vector<u8> = b"Address is not in the editors list";

#[error(code = 13)]
const ENotEditor: vector<u8> = b"Caller is not an editor or creator";

// -- Mode constants -------------------------------------------------------------

const MODE_ENCRYPTED: u8 = 0;
const MODE_CLEARTEXT_STANDINGS: u8 = 1;

// -- Structs --------------------------------------------------------------------

/// Shared object -- one per map. Supports dual mode.
public struct PrivateMapV2 has key {
    id: UID,
    name: String,
    creator: address,
    editors: vector<address>,
    mode: u8,
    // Encrypted mode fields (mode=0)
    public_key: vector<u8>,
    revoked: vector<address>,
    // Cleartext standings mode fields (mode=1)
    registry_id: Option<ID>,
    min_read_standing: u8,
    min_write_standing: u8,
    // Shared
    next_location_id: u64,
}

/// Owned by the invitee's address. Membership proof for encrypted mode.
public struct MapInviteV2 has key, store {
    id: UID,
    map_id: ID,
    sender: address,
    encrypted_map_key: vector<u8>,
}

/// Dynamic field key for locations.
public struct LocationKey has copy, drop, store { location_id: u64 }

/// Dynamic field value for locations.
public struct MapLocationV2 has store, drop {
    location_id: u64,
    structure_id: Option<ID>,
    data: vector<u8>,
    added_by: address,
    added_at_ms: u64,
}

// -- Events ---------------------------------------------------------------------

public struct MapCreatedEvent has copy, drop {
    map_id: ID,
    creator: address,
    name: String,
    mode: u8,
}

public struct MemberInvitedEvent has copy, drop {
    map_id: ID,
    recipient: address,
    sender: address,
}

public struct MemberRevokedEvent has copy, drop {
    map_id: ID,
    revoked_address: address,
}

public struct EditorAddedEvent has copy, drop {
    map_id: ID,
    editor: address,
}

public struct EditorRemovedEvent has copy, drop {
    map_id: ID,
    editor: address,
}

public struct LocationAddedEvent has copy, drop {
    map_id: ID,
    location_id: u64,
    added_by: address,
}

public struct LocationRemovedEvent has copy, drop {
    map_id: ID,
    location_id: u64,
    removed_by: address,
}

public struct StandingsConfigUpdatedEvent has copy, drop {
    map_id: ID,
    registry_id: ID,
    min_read: u8,
    min_write: u8,
}

// -- Internal helpers -----------------------------------------------------------

fun validate_standing(standing: u8) {
    assert!(standing <= 6, EInvalidStanding);
}

fun is_editor_or_creator(map: &PrivateMapV2, addr: address): bool {
    if (addr == map.creator) return true;
    map.editors.contains(&addr)
}

// -- Map creation ---------------------------------------------------------------

/// Create an encrypted map (mode=0). Creator auto-added to editors.
/// Self-invite MapInviteV2 transferred to creator.
#[allow(lint(share_owned, self_transfer))]
public fun create_encrypted_map(
    name: String,
    public_key: vector<u8>,
    self_invite_encrypted_key: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(public_key.length() == 32, EInvalidPublicKeyLength);

    let creator = ctx.sender();

    let map = PrivateMapV2 {
        id: object::new(ctx),
        name,
        creator,
        editors: vector[creator],
        mode: MODE_ENCRYPTED,
        public_key,
        revoked: vector[],
        registry_id: option::none(),
        min_read_standing: 0,
        min_write_standing: 0,
        next_location_id: 0,
    };

    let map_id = object::id(&map);

    let self_invite = MapInviteV2 {
        id: object::new(ctx),
        map_id,
        sender: creator,
        encrypted_map_key: self_invite_encrypted_key,
    };

    event::emit(MapCreatedEvent {
        map_id,
        creator,
        name: map.name,
        mode: MODE_ENCRYPTED,
    });

    event::emit(MemberInvitedEvent {
        map_id,
        recipient: creator,
        sender: creator,
    });

    transfer::transfer(self_invite, creator);
    transfer::share_object(map);
}

/// Create a standings-gated cleartext map (mode=1). Creator auto-added to editors.
/// No invite created -- access determined by standings.
#[allow(lint(share_owned))]
public fun create_standings_map(
    name: String,
    registry_id: ID,
    min_read_standing: u8,
    min_write_standing: u8,
    ctx: &mut TxContext,
) {
    validate_standing(min_read_standing);
    validate_standing(min_write_standing);

    let creator = ctx.sender();

    let map = PrivateMapV2 {
        id: object::new(ctx),
        name,
        creator,
        editors: vector[creator],
        mode: MODE_CLEARTEXT_STANDINGS,
        public_key: vector[],
        revoked: vector[],
        registry_id: option::some(registry_id),
        min_read_standing,
        min_write_standing,
        next_location_id: 0,
    };

    let map_id = object::id(&map);

    event::emit(MapCreatedEvent {
        map_id,
        creator,
        name: map.name,
        mode: MODE_CLEARTEXT_STANDINGS,
    });

    transfer::share_object(map);
}

// -- Encrypted mode member management -------------------------------------------

/// Invite a member by creating a MapInviteV2 (encrypted mode only).
/// Creator only.
public fun invite_member(
    map: &PrivateMapV2,
    recipient: address,
    encrypted_map_key: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(map.mode == MODE_ENCRYPTED, EWrongMode);
    assert!(ctx.sender() == map.creator, ENotCreator);

    let map_id = object::id(map);

    let invite = MapInviteV2 {
        id: object::new(ctx),
        map_id,
        sender: ctx.sender(),
        encrypted_map_key,
    };

    event::emit(MemberInvitedEvent {
        map_id,
        recipient,
        sender: ctx.sender(),
    });

    transfer::transfer(invite, recipient);
}

/// Revoke a member (encrypted mode only). Creator only.
public fun revoke_member(
    map: &mut PrivateMapV2,
    addr: address,
    ctx: &TxContext,
) {
    assert!(map.mode == MODE_ENCRYPTED, EWrongMode);
    assert!(ctx.sender() == map.creator, ENotCreator);

    let (found, _) = map.revoked.index_of(&addr);
    assert!(!found, EAlreadyRevoked);

    map.revoked.push_back(addr);

    event::emit(MemberRevokedEvent {
        map_id: object::id(map),
        revoked_address: addr,
    });
}

// -- Editor management (both modes) ---------------------------------------------

/// Add an editor. Creator only.
public fun add_editor(
    map: &mut PrivateMapV2,
    addr: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == map.creator, ENotCreator);
    let (found, _) = map.editors.index_of(&addr);
    assert!(!found, EEditorAlreadyExists);
    map.editors.push_back(addr);

    event::emit(EditorAddedEvent {
        map_id: object::id(map),
        editor: addr,
    });
}

/// Remove an editor. Creator only.
public fun remove_editor(
    map: &mut PrivateMapV2,
    addr: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == map.creator, ENotCreator);
    let (found, idx) = map.editors.index_of(&addr);
    assert!(found, EEditorNotFound);
    map.editors.remove(idx);

    event::emit(EditorRemovedEvent {
        map_id: object::id(map),
        editor: addr,
    });
}

// -- Standings config (mode=1 only) ---------------------------------------------

/// Update standings configuration. Mode=1 + creator only.
public fun update_standings_config(
    map: &mut PrivateMapV2,
    registry_id: ID,
    min_read_standing: u8,
    min_write_standing: u8,
    ctx: &TxContext,
) {
    assert!(map.mode == MODE_CLEARTEXT_STANDINGS, EWrongMode);
    assert!(ctx.sender() == map.creator, ENotCreator);
    validate_standing(min_read_standing);
    validate_standing(min_write_standing);

    map.registry_id = option::some(registry_id);
    map.min_read_standing = min_read_standing;
    map.min_write_standing = min_write_standing;

    event::emit(StandingsConfigUpdatedEvent {
        map_id: object::id(map),
        registry_id,
        min_read: min_read_standing,
        min_write: min_write_standing,
    });
}

// -- Location management --------------------------------------------------------

/// Add an encrypted location (mode=0 only).
/// Requires: valid MapInviteV2, sender not revoked, sender is editor or creator.
public fun add_location_encrypted(
    map: &mut PrivateMapV2,
    invite: &MapInviteV2,
    structure_id: Option<ID>,
    encrypted_data: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(map.mode == MODE_ENCRYPTED, EWrongMode);
    assert!(invite.map_id == object::id(map), EInviteNotForThisMap);

    let sender = ctx.sender();

    // Check not revoked
    let (is_revoked, _) = map.revoked.index_of(&sender);
    assert!(!is_revoked, EMemberRevoked);

    // Check editor or creator
    assert!(is_editor_or_creator(map, sender), ENotEditor);

    let location_id = map.next_location_id;
    map.next_location_id = location_id + 1;

    let location = MapLocationV2 {
        location_id,
        structure_id,
        data: encrypted_data,
        added_by: sender,
        added_at_ms: clock.timestamp_ms(),
    };

    dynamic_field::add(&mut map.id, LocationKey { location_id }, location);

    event::emit(LocationAddedEvent {
        map_id: object::id(map),
        location_id,
        added_by: sender,
    });
}

/// Add a cleartext location (mode=1 only).
/// Grants write if: standing >= min_write OR sender is editor/creator.
/// Takes &StandingsRegistry + tribe_id + char_id for standings lookup.
public fun add_location_standings(
    map: &mut PrivateMapV2,
    registry: &StandingsRegistry,
    tribe_id: u32,
    char_id: u64,
    structure_id: Option<ID>,
    data: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(map.mode == MODE_CLEARTEXT_STANDINGS, EWrongMode);

    let sender = ctx.sender();

    // Verify registry matches
    assert!(option::is_some(&map.registry_id), ERegistryMismatch);
    assert!(object::id(registry) == *option::borrow(&map.registry_id), ERegistryMismatch);

    // Check access: editor/creator OR sufficient standing
    if (!is_editor_or_creator(map, sender)) {
        let standing = standings_registry::get_standing(registry, tribe_id, char_id);
        assert!(standing >= map.min_write_standing, EAccessDenied);
    };

    let location_id = map.next_location_id;
    map.next_location_id = location_id + 1;

    let location = MapLocationV2 {
        location_id,
        structure_id,
        data,
        added_by: sender,
        added_at_ms: clock.timestamp_ms(),
    };

    dynamic_field::add(&mut map.id, LocationKey { location_id }, location);

    event::emit(LocationAddedEvent {
        map_id: object::id(map),
        location_id,
        added_by: sender,
    });
}

/// Remove a location (both modes). Creator or added_by can remove.
public fun remove_location(
    map: &mut PrivateMapV2,
    location_id: u64,
    ctx: &TxContext,
) {
    let key = LocationKey { location_id };
    assert!(dynamic_field::exists_(&map.id, key), ELocationNotFound);

    let location = dynamic_field::borrow<LocationKey, MapLocationV2>(&map.id, key);
    let sender = ctx.sender();
    assert!(sender == map.creator || sender == location.added_by, ENotLocationOwner);

    dynamic_field::remove<LocationKey, MapLocationV2>(&mut map.id, key);

    event::emit(LocationRemovedEvent {
        map_id: object::id(map),
        location_id,
        removed_by: sender,
    });
}

// -- Read accessors -------------------------------------------------------------

public fun map_name(map: &PrivateMapV2): String { map.name }
public fun map_creator(map: &PrivateMapV2): address { map.creator }
public fun map_editors(map: &PrivateMapV2): &vector<address> { &map.editors }
public fun map_mode(map: &PrivateMapV2): u8 { map.mode }
public fun map_public_key(map: &PrivateMapV2): &vector<u8> { &map.public_key }
public fun map_revoked(map: &PrivateMapV2): &vector<address> { &map.revoked }
public fun map_registry_id(map: &PrivateMapV2): &Option<ID> { &map.registry_id }
public fun map_min_read_standing(map: &PrivateMapV2): u8 { map.min_read_standing }
public fun map_min_write_standing(map: &PrivateMapV2): u8 { map.min_write_standing }
public fun map_next_location_id(map: &PrivateMapV2): u64 { map.next_location_id }

public fun borrow_location(map: &PrivateMapV2, location_id: u64): &MapLocationV2 {
    let key = LocationKey { location_id };
    assert!(dynamic_field::exists_(&map.id, key), ELocationNotFound);
    dynamic_field::borrow<LocationKey, MapLocationV2>(&map.id, key)
}

public fun has_location(map: &PrivateMapV2, location_id: u64): bool {
    dynamic_field::exists_(&map.id, LocationKey { location_id })
}

// -- MapLocationV2 field accessors ----------------------------------------------

public fun location_id(location: &MapLocationV2): u64 { location.location_id }
public fun location_structure_id(location: &MapLocationV2): Option<ID> { location.structure_id }
public fun location_data(location: &MapLocationV2): &vector<u8> { &location.data }
public fun location_added_by(location: &MapLocationV2): address { location.added_by }
public fun location_added_at_ms(location: &MapLocationV2): u64 { location.added_at_ms }

// -- MapInviteV2 field accessors ------------------------------------------------

public fun invite_map_id(invite: &MapInviteV2): ID { invite.map_id }
public fun invite_sender(invite: &MapInviteV2): address { invite.sender }
public fun invite_encrypted_map_key(invite: &MapInviteV2): &vector<u8> { &invite.encrypted_map_key }

// -- Tests ----------------------------------------------------------------------

#[test_only]
use sui::test_scenario;

#[test_only]
use std::string;

#[test_only]
/// Dummy 32-byte public key for tests.
fun test_public_key(): vector<u8> {
    vector[
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ]
}

#[test_only]
fun create_test_registry(scenario: &mut test_scenario::Scenario) {
    standings_registry::create_registry(
        b"Test Registry",
        b"TEST",
        3, // default standing = Neutral
        test_scenario::ctx(scenario),
    );
}

// -- Test: create encrypted map -------------------------------------------------

#[test]
fun test_create_encrypted_map() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Alliance Intel"),
        test_public_key(),
        b"encrypted_self_key_data_here____",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        assert!(map_creator(&map) == creator);
        assert!(map_name(&map) == string::utf8(b"Alliance Intel"));
        assert!(map_mode(&map) == 0);
        assert!(map_public_key(&map).length() == 32);
        assert!(map_next_location_id(&map) == 0);
        assert!(map_editors(&map).length() == 1);
        assert!(*map_editors(&map).borrow(0) == creator);
        assert!(option::is_none(map_registry_id(&map)));
        test_scenario::return_shared(map);
    };

    // Verify self-invite
    test_scenario::next_tx(&mut scenario, creator);
    {
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        assert!(invite_sender(&invite) == creator);
        assert!(invite_encrypted_map_key(&invite) == &b"encrypted_self_key_data_here____");
        test_scenario::return_to_sender(&scenario, invite);
    };

    test_scenario::end(scenario);
}

// -- Test: create standings map -------------------------------------------------

#[test]
fun test_create_standings_map() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Org Intel"),
        reg_id,
        4, // min_read
        5, // min_write
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        assert!(map_creator(&map) == creator);
        assert!(map_mode(&map) == 1);
        assert!(map_public_key(&map).length() == 0);
        assert!(map_min_read_standing(&map) == 4);
        assert!(map_min_write_standing(&map) == 5);
        assert!(option::is_some(map_registry_id(&map)));
        assert!(*option::borrow(map_registry_id(&map)) == reg_id);
        assert!(map_editors(&map).length() == 1);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: encrypted add location -----------------------------------------------

#[test]
fun test_encrypted_add_location() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Intel"),
        test_public_key(),
        b"self_key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_encrypted(
            &mut map,
            &invite,
            option::some(object::id_from_address(@0x100)),
            b"encrypted_location_data",
            &clock,
            test_scenario::ctx(&mut scenario),
        );

        assert!(map_next_location_id(&map) == 1);
        assert!(has_location(&map, 0));

        let location = borrow_location(&map, 0);
        assert!(location_id(location) == 0);
        assert!(location_structure_id(location) == option::some(object::id_from_address(@0x100)));
        assert!(location_data(location) == &b"encrypted_location_data");
        assert!(location_added_by(location) == creator);

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: encrypted add location non-editor fails ------------------------------

#[test]
#[expected_failure(abort_code = ENotEditor)]
fun test_encrypted_add_location_non_editor_fails() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Intel"),
        test_public_key(),
        b"self_key",
        test_scenario::ctx(&mut scenario),
    );

    // Invite member (but do NOT add as editor)
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        invite_member(&map, member, b"member_key", test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Member tries to add location -- should fail (not editor)
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_encrypted(
            &mut map,
            &invite,
            option::none(),
            b"data",
            &clock,
            test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: standings add location -----------------------------------------------

#[test]
fun test_standings_add_location() {
    let creator = @0xA;
    let writer = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Set writer's tribe standing to 5 (above min_write=4)
    standings_registry::set_tribe_standing(&mut registry, 10, 5, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Org Intel"),
        reg_id,
        3, // min_read
        4, // min_write
        test_scenario::ctx(&mut scenario),
    );

    // Writer adds location via standing
    test_scenario::next_tx(&mut scenario, writer);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_standings(
            &mut map,
            &registry,
            10, // tribe_id
            500, // char_id
            option::none(),
            b"plaintext_location_data",
            &clock,
            test_scenario::ctx(&mut scenario),
        );

        assert!(has_location(&map, 0));
        let location = borrow_location(&map, 0);
        assert!(location_data(location) == &b"plaintext_location_data");
        assert!(location_added_by(location) == writer);

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: standings add location denied ----------------------------------------

#[test]
#[expected_failure(abort_code = EAccessDenied)]
fun test_standings_add_location_denied() {
    let creator = @0xA;
    let writer = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Set writer's tribe standing to 2 (below min_write=4)
    standings_registry::set_tribe_standing(&mut registry, 10, 2, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Org Intel"),
        reg_id,
        3,
        4, // min_write
        test_scenario::ctx(&mut scenario),
    );

    // Writer tries to add with low standing and is NOT an editor -- should fail
    test_scenario::next_tx(&mut scenario, writer);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_standings(
            &mut map, &registry,
            10, 500,
            option::none(), b"data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: standings add location as editor -------------------------------------

#[test]
fun test_standings_add_location_as_editor() {
    let creator = @0xA;
    let editor = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let mut registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Set editor's tribe standing to 1 (way below min_write=5)
    standings_registry::set_tribe_standing(&mut registry, 10, 1, test_scenario::ctx(&mut scenario));
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Org Intel"),
        reg_id,
        3,
        5, // min_write
        test_scenario::ctx(&mut scenario),
    );

    // Add editor
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        add_editor(&mut map, editor, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Editor can add despite low standing
    test_scenario::next_tx(&mut scenario, editor);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_standings(
            &mut map, &registry,
            10, 500,
            option::none(), b"editor_data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        assert!(has_location(&map, 0));

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: standings add location as creator ------------------------------------

#[test]
fun test_standings_add_location_as_creator() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    // Default standing is 3 (below min_write=6), but creator bypasses
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Org Intel"),
        reg_id,
        3,
        6, // min_write = max
        test_scenario::ctx(&mut scenario),
    );

    // Creator can add regardless of standing
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_standings(
            &mut map, &registry,
            99, 999,
            option::none(), b"creator_data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        assert!(has_location(&map, 0));

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: invite wrong mode ----------------------------------------------------

#[test]
#[expected_failure(abort_code = EWrongMode)]
fun test_invite_wrong_mode() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Standings Map"),
        reg_id,
        3, 3,
        test_scenario::ctx(&mut scenario),
    );

    // Try to invite on mode=1 map -- should fail
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        invite_member(&map, @0xB, b"key", test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: standings write wrong mode -------------------------------------------

#[test]
#[expected_failure(abort_code = EWrongMode)]
fun test_standings_write_wrong_mode() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    create_encrypted_map(
        string::utf8(b"Encrypted Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    // Try to add standings location on mode=0 map -- should fail
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_standings(
            &mut map, &registry,
            1, 100,
            option::none(), b"data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: registry mismatch ----------------------------------------------------

#[test]
#[expected_failure(abort_code = ERegistryMismatch)]
fun test_registry_mismatch() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    // Create two registries
    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);
    standings_registry::create_registry(
        b"Other Registry", b"OTH", 3, test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    let reg1 = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg2 = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg1_id = object::id(&reg1);
    test_scenario::return_shared(reg1);
    test_scenario::return_shared(reg2);

    // Create standings map with reg1
    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Map"),
        reg1_id,
        3, 3,
        test_scenario::ctx(&mut scenario),
    );

    // Try to add location with wrong registry
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let reg_a = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let reg_b = test_scenario::take_shared<StandingsRegistry>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        // Use whichever registry does NOT match
        let (wrong_reg, other_reg) = if (object::id(&reg_a) == reg1_id) {
            (reg_b, reg_a)
        } else {
            (reg_a, reg_b)
        };

        add_location_standings(
            &mut map, &wrong_reg,
            1, 100,
            option::none(), b"data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_shared(wrong_reg);
        test_scenario::return_shared(other_reg);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: editor management ----------------------------------------------------

#[test]
fun test_editor_management() {
    let creator = @0xA;
    let editor = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);

        // Creator is already in editors
        assert!(map_editors(&map).length() == 1);

        // Add editor
        add_editor(&mut map, editor, test_scenario::ctx(&mut scenario));
        assert!(map_editors(&map).length() == 2);
        assert!(map_editors(&map).contains(&editor));

        // Remove editor
        remove_editor(&mut map, editor, test_scenario::ctx(&mut scenario));
        assert!(map_editors(&map).length() == 1);
        assert!(!map_editors(&map).contains(&editor));

        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: non-creator cannot add editor ----------------------------------------

#[test]
#[expected_failure(abort_code = ENotCreator)]
fun test_non_creator_cannot_add_editor() {
    let creator = @0xA;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, stranger);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        add_editor(&mut map, @0xD, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: update standings config ----------------------------------------------

#[test]
fun test_update_standings_config() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    create_standings_map(
        string::utf8(b"Map"),
        reg_id,
        3, 4,
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let new_reg_id = object::id_from_address(@0x999);
        update_standings_config(
            &mut map, new_reg_id, 5, 6,
            test_scenario::ctx(&mut scenario),
        );
        assert!(*option::borrow(map_registry_id(&map)) == new_reg_id);
        assert!(map_min_read_standing(&map) == 5);
        assert!(map_min_write_standing(&map) == 6);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: update standings config wrong mode -----------------------------------

#[test]
#[expected_failure(abort_code = EWrongMode)]
fun test_update_standings_config_wrong_mode() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Encrypted"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let reg_id = object::id_from_address(@0x999);
        update_standings_config(
            &mut map, reg_id, 3, 3,
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: remove location by creator -------------------------------------------

#[test]
fun test_remove_location_by_creator() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_encrypted(
            &mut map, &invite, option::none(), b"data",
            &clock, test_scenario::ctx(&mut scenario),
        );
        assert!(has_location(&map, 0));

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_location(&map, 0));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: remove location by adder ---------------------------------------------

#[test]
fun test_remove_location_by_adder() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    // Invite member and add as editor
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        invite_member(&map, member, b"member_key", test_scenario::ctx(&mut scenario));
        add_editor(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Member adds a location
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_encrypted(
            &mut map, &invite, option::none(), b"member_data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    // Member removes their own location
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_location(&map, 0));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: unauthorized remove location -----------------------------------------

#[test]
#[expected_failure(abort_code = ENotLocationOwner)]
fun test_unauthorized_remove_location() {
    let creator = @0xA;
    let member = @0xB;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    // Add member as editor and invite
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        invite_member(&map, member, b"member_key", test_scenario::ctx(&mut scenario));
        add_editor(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Member adds location
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_encrypted(
            &mut map, &invite, option::none(), b"data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    // Stranger tries to remove -- should fail
    test_scenario::next_tx(&mut scenario, stranger);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: revoke encrypted member ----------------------------------------------

#[test]
#[expected_failure(abort_code = EMemberRevoked)]
fun test_revoke_encrypted_member() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    // Invite member and add as editor
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        invite_member(&map, member, b"member_key", test_scenario::ctx(&mut scenario));
        add_editor(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Revoke member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        revoke_member(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Revoked member tries to add -- should fail
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_encrypted(
            &mut map, &invite, option::none(), b"data",
            &clock, test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: multiple locations ---------------------------------------------------

#[test]
fun test_multiple_locations() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        let invite = test_scenario::take_from_sender<MapInviteV2>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location_encrypted(
            &mut map, &invite, option::none(), b"loc0",
            &clock, test_scenario::ctx(&mut scenario),
        );
        add_location_encrypted(
            &mut map, &invite,
            option::some(object::id_from_address(@0x200)), b"loc1",
            &clock, test_scenario::ctx(&mut scenario),
        );
        add_location_encrypted(
            &mut map, &invite, option::none(), b"loc2",
            &clock, test_scenario::ctx(&mut scenario),
        );

        assert!(map_next_location_id(&map) == 3);
        assert!(has_location(&map, 0));
        assert!(has_location(&map, 1));
        assert!(has_location(&map, 2));
        assert!(!has_location(&map, 3));

        // Verify data
        assert!(location_data(borrow_location(&map, 0)) == &b"loc0");
        assert!(location_data(borrow_location(&map, 1)) == &b"loc1");
        assert!(location_data(borrow_location(&map, 2)) == &b"loc2");

        // Remove middle location
        remove_location(&mut map, 1, test_scenario::ctx(&mut scenario));
        assert!(!has_location(&map, 1));
        assert!(has_location(&map, 0));
        assert!(has_location(&map, 2));

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: invalid standing values ----------------------------------------------

#[test]
#[expected_failure(abort_code = EInvalidStanding)]
fun test_invalid_standing_values() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_registry(&mut scenario);
    test_scenario::next_tx(&mut scenario, creator);

    let registry = test_scenario::take_shared<StandingsRegistry>(&scenario);
    let reg_id = object::id(&registry);
    test_scenario::return_shared(registry);

    test_scenario::next_tx(&mut scenario, creator);
    // min_read=7 exceeds 6 -- should fail
    create_standings_map(
        string::utf8(b"Bad Map"),
        reg_id,
        7, // invalid
        3,
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::end(scenario);
}

// -- Test: invalid public key length --------------------------------------------

#[test]
#[expected_failure(abort_code = EInvalidPublicKeyLength)]
fun test_invalid_public_key_length() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    let short_key = vector[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    create_encrypted_map(
        string::utf8(b"Bad Map"),
        short_key,
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::end(scenario);
}

// -- Test: double revoke fails --------------------------------------------------

#[test]
#[expected_failure(abort_code = EAlreadyRevoked)]
fun test_double_revoke_fails() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        revoke_member(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        revoke_member(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: location not found ---------------------------------------------------

#[test]
#[expected_failure(abort_code = ELocationNotFound)]
fun test_remove_nonexistent_location() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: editor already exists ------------------------------------------------

#[test]
#[expected_failure(abort_code = EEditorAlreadyExists)]
fun test_editor_already_exists() {
    let creator = @0xA;
    let editor = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        add_editor(&mut map, editor, test_scenario::ctx(&mut scenario));
        // Try to add again -- should fail
        add_editor(&mut map, editor, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: editor not found on remove -------------------------------------------

#[test]
#[expected_failure(abort_code = EEditorNotFound)]
fun test_editor_not_found_on_remove() {
    let creator = @0xA;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(creator);

    create_encrypted_map(
        string::utf8(b"Map"),
        test_public_key(),
        b"key",
        test_scenario::ctx(&mut scenario),
    );

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMapV2>(&scenario);
        // Try to remove someone who isn't an editor -- should fail
        remove_editor(&mut map, stranger, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}
