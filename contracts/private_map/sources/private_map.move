/// Private Map: encrypted location sharing among trusted players.
///
/// A map is a shared object containing an X25519 public key. Members are
/// invited by receiving a MapInvite object -- which contains the map's private
/// key encrypted with the invitee's wallet-derived public key. Locations are
/// encrypted with the map's public key and stored as dynamic fields on the map.
module private_map::private_map;

use std::string::String;
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotCreator: vector<u8> = b"Only the map creator can perform this action";

#[error(code = 1)]
const ELocationNotFound: vector<u8> = b"Location not found on this map";

#[error(code = 2)]
const ENotLocationOwner: vector<u8> = b"Only the creator or the address that added this location can remove it";

#[error(code = 3)]
const EInviteNotForThisMap: vector<u8> = b"MapInvite does not belong to this map";

#[error(code = 4)]
const EMemberRevoked: vector<u8> = b"Member has been revoked from this map";

#[error(code = 5)]
const EAlreadyRevoked: vector<u8> = b"Address is already in the revoked list";

#[error(code = 6)]
const EInvalidPublicKeyLength: vector<u8> = b"Public key must be exactly 32 bytes";

// -- Structs --------------------------------------------------------------------

/// Shared object -- one per map.
public struct PrivateMap has key {
    id: UID,
    name: String,
    creator: address,
    public_key: vector<u8>,    // X25519 public key (32 bytes)
    revoked: vector<address>,  // addresses blocked from add_location
    next_location_id: u64,
}

/// Owned by the invitee's address. Serves as both key delivery and membership proof.
public struct MapInvite has key, store {
    id: UID,
    map_id: ID,
    sender: address,
    encrypted_map_key: vector<u8>,  // map's X25519 private key, sealed with recipient's public key
}

/// Dynamic field key for locations on PrivateMap.
public struct LocationKey has copy, drop, store { location_id: u64 }

/// Dynamic field value on PrivateMap.
public struct MapLocation has store, drop {
    location_id: u64,
    structure_id: Option<ID>,       // optional -- links to on-chain structure
    encrypted_data: vector<u8>,     // sealed with map's public key
    added_by: address,
    added_at_ms: u64,
}

// -- Events ---------------------------------------------------------------------

public struct MapCreatedEvent has copy, drop {
    map_id: ID,
    creator: address,
    name: String,
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

// -- Map creation ---------------------------------------------------------------

/// Create a PrivateMap and self-invite the creator.
/// The creator provides the map's X25519 public key (32 bytes) and their own
/// encrypted copy of the map's private key (self-invite).
#[allow(lint(share_owned, self_transfer))]
public fun create_map(
    name: String,
    public_key: vector<u8>,
    self_invite_encrypted_key: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(public_key.length() == 32, EInvalidPublicKeyLength);

    let creator = ctx.sender();

    let map = PrivateMap {
        id: object::new(ctx),
        name,
        creator,
        public_key,
        revoked: vector[],
        next_location_id: 0,
    };

    let map_id = object::id(&map);

    // Self-invite: creator gets a MapInvite with the map key encrypted for themselves
    let self_invite = MapInvite {
        id: object::new(ctx),
        map_id,
        sender: creator,
        encrypted_map_key: self_invite_encrypted_key,
    };

    event::emit(MapCreatedEvent {
        map_id,
        creator,
        name: map.name,
    });

    event::emit(MemberInvitedEvent {
        map_id,
        recipient: creator,
        sender: creator,
    });

    transfer::transfer(self_invite, creator);
    transfer::share_object(map);
}

// -- Member management ----------------------------------------------------------

/// Invite a member by creating a MapInvite with the map key encrypted for them.
/// Creator only.
public fun invite_member(
    map: &PrivateMap,
    recipient: address,
    encrypted_map_key: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == map.creator, ENotCreator);

    let map_id = object::id(map);

    let invite = MapInvite {
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

/// Revoke a member by adding their address to the revoked list.
/// Creator only. Cannot delete their MapInvite (owned object), but prevents
/// future add_location calls. They can still decrypt existing data.
public fun revoke_member(
    map: &mut PrivateMap,
    addr: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == map.creator, ENotCreator);

    let (found, _) = map.revoked.index_of(&addr);
    assert!(!found, EAlreadyRevoked);

    map.revoked.push_back(addr);

    event::emit(MemberRevokedEvent {
        map_id: object::id(map),
        revoked_address: addr,
    });
}

// -- Location management --------------------------------------------------------

/// Add an encrypted location to the map.
/// Requires a valid MapInvite for this map as membership proof.
/// Sender must not be in the revoked list.
public fun add_location(
    map: &mut PrivateMap,
    invite: &MapInvite,
    structure_id: Option<ID>,
    encrypted_data: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Verify invite belongs to this map
    assert!(invite.map_id == object::id(map), EInviteNotForThisMap);

    // Check sender is not revoked
    let sender = ctx.sender();
    let (is_revoked, _) = map.revoked.index_of(&sender);
    assert!(!is_revoked, EMemberRevoked);

    let location_id = map.next_location_id;
    map.next_location_id = location_id + 1;

    let location = MapLocation {
        location_id,
        structure_id,
        encrypted_data,
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

/// Remove a location from the map.
/// Creator or the address that added the location can remove it.
public fun remove_location(
    map: &mut PrivateMap,
    location_id: u64,
    ctx: &TxContext,
) {
    let key = LocationKey { location_id };
    assert!(dynamic_field::exists_(&map.id, key), ELocationNotFound);

    let location = dynamic_field::borrow<LocationKey, MapLocation>(&map.id, key);
    let sender = ctx.sender();
    assert!(sender == map.creator || sender == location.added_by, ENotLocationOwner);

    dynamic_field::remove<LocationKey, MapLocation>(&mut map.id, key);

    event::emit(LocationRemovedEvent {
        map_id: object::id(map),
        location_id,
        removed_by: sender,
    });
}

// -- Read accessors -------------------------------------------------------------

public fun map_name(map: &PrivateMap): String {
    map.name
}

public fun map_creator(map: &PrivateMap): address {
    map.creator
}

public fun map_public_key(map: &PrivateMap): vector<u8> {
    map.public_key
}

public fun next_location_id(map: &PrivateMap): u64 {
    map.next_location_id
}

public fun borrow_location(map: &PrivateMap, location_id: u64): &MapLocation {
    let key = LocationKey { location_id };
    assert!(dynamic_field::exists_(&map.id, key), ELocationNotFound);
    dynamic_field::borrow<LocationKey, MapLocation>(&map.id, key)
}

public fun has_location(map: &PrivateMap, location_id: u64): bool {
    dynamic_field::exists_(&map.id, LocationKey { location_id })
}

// -- MapLocation field accessors ------------------------------------------------

public fun location_id(location: &MapLocation): u64 { location.location_id }
public fun location_structure_id(location: &MapLocation): Option<ID> { location.structure_id }
public fun location_encrypted_data(location: &MapLocation): vector<u8> { location.encrypted_data }
public fun location_added_by(location: &MapLocation): address { location.added_by }
public fun location_added_at_ms(location: &MapLocation): u64 { location.added_at_ms }

// -- MapInvite field accessors --------------------------------------------------

public fun invite_map_id(invite: &MapInvite): ID { invite.map_id }
public fun invite_sender(invite: &MapInvite): address { invite.sender }
public fun invite_encrypted_map_key(invite: &MapInvite): vector<u8> { invite.encrypted_map_key }

// -- Tests ----------------------------------------------------------------------

#[test_only]
use sui::test_scenario;

#[test_only]
use std::string;

#[test_only]
/// Helper: create a map with a dummy 32-byte public key and self-invite.
fun create_test_map(
    scenario: &mut test_scenario::Scenario,
    name: vector<u8>,
): ID {
    let ctx = test_scenario::ctx(scenario);
    let public_key = vector[
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
        17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ];
    let self_invite_key = b"encrypted_self_key_data_here____";
    create_map(string::utf8(name), public_key, self_invite_key, ctx);

    // Return a placeholder -- caller must take_shared to get real ID
    object::id_from_address(@0x0)
}

// -- Test: full lifecycle -------------------------------------------------------

#[test]
fun test_create_map_and_self_invite() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Alliance Intel");

    // Verify map was shared
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMap>(&scenario);
        assert!(map_creator(&map) == creator);
        assert!(map_name(&map) == string::utf8(b"Alliance Intel"));
        assert!(map_public_key(&map).length() == 32);
        assert!(next_location_id(&map) == 0);
        test_scenario::return_shared(map);
    };

    // Verify self-invite was transferred to creator
    test_scenario::next_tx(&mut scenario, creator);
    {
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        assert!(invite_sender(&invite) == creator);
        assert!(invite_encrypted_map_key(&invite) == b"encrypted_self_key_data_here____");
        test_scenario::return_to_sender(&scenario, invite);
    };

    test_scenario::end(scenario);
}

// -- Test: invite member --------------------------------------------------------

#[test]
fun test_invite_member() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Trade Routes");

    // Creator invites member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMap>(&scenario);
        invite_member(
            &map,
            member,
            b"encrypted_key_for_member",
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(map);
    };

    // Verify invite was transferred to member
    test_scenario::next_tx(&mut scenario, member);
    {
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        assert!(invite_sender(&invite) == creator);
        assert!(invite_encrypted_map_key(&invite) == b"encrypted_key_for_member");
        test_scenario::return_to_sender(&scenario, invite);
    };

    test_scenario::end(scenario);
}

// -- Test: non-creator cannot invite --------------------------------------------

#[test]
#[expected_failure(abort_code = ENotCreator)]
fun test_non_creator_cannot_invite() {
    let creator = @0xA;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Test Map");

    // Stranger tries to invite -- should fail
    test_scenario::next_tx(&mut scenario, stranger);
    {
        let map = test_scenario::take_shared<PrivateMap>(&scenario);
        invite_member(
            &map,
            @0xD,
            b"key",
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: add and borrow location ----------------------------------------------

#[test]
fun test_add_location() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Add location using self-invite
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location(
            &mut map,
            &invite,
            option::some(object::id_from_address(@0x100)),
            b"encrypted_location_data",
            &clock,
            test_scenario::ctx(&mut scenario),
        );

        assert!(next_location_id(&map) == 1);
        assert!(has_location(&map, 0));

        let location = borrow_location(&map, 0);
        assert!(location_id(location) == 0);
        assert!(location_structure_id(location) == option::some(object::id_from_address(@0x100)));
        assert!(location_encrypted_data(location) == b"encrypted_location_data");
        assert!(location_added_by(location) == creator);

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: add location with wrong invite ---------------------------------------

#[test]
#[expected_failure(abort_code = EInviteNotForThisMap)]
fun test_add_location_wrong_invite() {
    let creator_a = @0xA;
    let creator_b = @0xB;
    let mut scenario = test_scenario::begin(creator_a);

    // Creator A creates Map One
    create_test_map(&mut scenario, b"Map One");

    // Creator B creates Map Two
    test_scenario::next_tx(&mut scenario, creator_b);
    create_test_map(&mut scenario, b"Map Two");

    // Creator A takes Map Two (shared) and tries to add with their Map One invite
    test_scenario::next_tx(&mut scenario, creator_a);
    {
        // take_shared returns one of the two maps -- take it, then get the other
        let map_first = test_scenario::take_shared<PrivateMap>(&scenario);
        let map_second = test_scenario::take_shared<PrivateMap>(&scenario);

        // Determine which is Map Two (created by creator_b)
        let (mut map_two, map_one) = if (map_creator(&map_first) == creator_b) {
            (map_first, map_second)
        } else {
            (map_second, map_first)
        };

        // Creator A's invite is for Map One
        let invite_a = test_scenario::take_from_sender<MapInvite>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        // This should fail: invite_a.map_id is Map One's ID, but we pass Map Two
        add_location(
            &mut map_two,
            &invite_a,
            option::none(),
            b"data",
            &clock,
            test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite_a);
        test_scenario::return_shared(map_two);
        test_scenario::return_shared(map_one);
    };

    test_scenario::end(scenario);
}

// -- Test: remove location by creator -------------------------------------------

#[test]
fun test_remove_location_by_creator() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Add location
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location(
            &mut map,
            &invite,
            option::none(),
            b"data",
            &clock,
            test_scenario::ctx(&mut scenario),
        );

        assert!(has_location(&map, 0));

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    // Remove location (by creator)
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_location(&map, 0));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: remove location by added_by address ----------------------------------

#[test]
fun test_remove_location_by_adder() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Creator invites member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMap>(&scenario);
        invite_member(
            &map,
            member,
            b"member_key",
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(map);
    };

    // Member adds a location
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location(
            &mut map,
            &invite,
            option::none(),
            b"member_data",
            &clock,
            test_scenario::ctx(&mut scenario),
        );

        sui::clock::destroy_for_testing(clock);
        test_scenario::return_to_sender(&scenario, invite);
        test_scenario::return_shared(map);
    };

    // Member removes their own location
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        assert!(!has_location(&map, 0));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: unauthorized remove --------------------------------------------------

#[test]
#[expected_failure(abort_code = ENotLocationOwner)]
fun test_unauthorized_remove_location() {
    let creator = @0xA;
    let member = @0xB;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Creator invites member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMap>(&scenario);
        invite_member(
            &map,
            member,
            b"member_key",
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(map);
    };

    // Member adds a location
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location(
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

    // Stranger tries to remove -- should fail (not creator, not added_by)
    test_scenario::next_tx(&mut scenario, stranger);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: revoke member --------------------------------------------------------

#[test]
fun test_revoke_member() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Creator invites member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMap>(&scenario);
        invite_member(
            &map,
            member,
            b"member_key",
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(map);
    };

    // Creator revokes member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        revoke_member(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: non-creator cannot revoke --------------------------------------------

#[test]
#[expected_failure(abort_code = ENotCreator)]
fun test_non_creator_cannot_revoke() {
    let creator = @0xA;
    let stranger = @0xC;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Stranger tries to revoke -- should fail
    test_scenario::next_tx(&mut scenario, stranger);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        revoke_member(&mut map, @0xD, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: revoked member cannot add location -----------------------------------

#[test]
#[expected_failure(abort_code = EMemberRevoked)]
fun test_revoked_member_cannot_add_location() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Creator invites member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let map = test_scenario::take_shared<PrivateMap>(&scenario);
        invite_member(
            &map,
            member,
            b"member_key",
            test_scenario::ctx(&mut scenario),
        );
        test_scenario::return_shared(map);
    };

    // Creator revokes member
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        revoke_member(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Revoked member tries to add location -- should fail
    test_scenario::next_tx(&mut scenario, member);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location(
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

// -- Test: double revoke fails --------------------------------------------------

#[test]
#[expected_failure(abort_code = EAlreadyRevoked)]
fun test_double_revoke_fails() {
    let creator = @0xA;
    let member = @0xB;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Revoke member once
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        revoke_member(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    // Try to revoke again -- should fail
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        revoke_member(&mut map, member, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}

// -- Test: invalid public key length --------------------------------------------

#[test]
#[expected_failure(abort_code = EInvalidPublicKeyLength)]
fun test_invalid_public_key_length() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    let ctx = test_scenario::ctx(&mut scenario);
    // 16 bytes instead of 32 -- should fail
    let short_key = vector[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    create_map(string::utf8(b"Bad Map"), short_key, b"key", ctx);

    test_scenario::end(scenario);
}

// -- Test: multiple locations ---------------------------------------------------

#[test]
fun test_multiple_locations() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    // Add three locations
    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        let invite = test_scenario::take_from_sender<MapInvite>(&scenario);
        let clock = sui::clock::create_for_testing(test_scenario::ctx(&mut scenario));

        add_location(
            &mut map, &invite, option::none(), b"loc0",
            &clock, test_scenario::ctx(&mut scenario),
        );
        add_location(
            &mut map, &invite, option::some(object::id_from_address(@0x200)), b"loc1",
            &clock, test_scenario::ctx(&mut scenario),
        );
        add_location(
            &mut map, &invite, option::none(), b"loc2",
            &clock, test_scenario::ctx(&mut scenario),
        );

        assert!(next_location_id(&map) == 3);
        assert!(has_location(&map, 0));
        assert!(has_location(&map, 1));
        assert!(has_location(&map, 2));
        assert!(!has_location(&map, 3));

        // Verify each location's data
        assert!(location_encrypted_data(borrow_location(&map, 0)) == b"loc0");
        assert!(location_encrypted_data(borrow_location(&map, 1)) == b"loc1");
        assert!(location_encrypted_data(borrow_location(&map, 2)) == b"loc2");
        assert!(
            location_structure_id(borrow_location(&map, 1))
                == option::some(object::id_from_address(@0x200)),
        );

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

// -- Test: location not found ---------------------------------------------------

#[test]
#[expected_failure(abort_code = ELocationNotFound)]
fun test_remove_nonexistent_location() {
    let creator = @0xA;
    let mut scenario = test_scenario::begin(creator);

    create_test_map(&mut scenario, b"Intel Map");

    test_scenario::next_tx(&mut scenario, creator);
    {
        let mut map = test_scenario::take_shared<PrivateMap>(&scenario);
        // No locations added -- should fail
        remove_location(&mut map, 0, test_scenario::ctx(&mut scenario));
        test_scenario::return_shared(map);
    };

    test_scenario::end(scenario);
}
