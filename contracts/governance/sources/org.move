/// Governance Organization — four-tier membership model.
///
/// Tiers are mutually exclusive: each entity (tribe, character, address)
/// exists in at most one tier per organization.
///
/// Tier semantics:
///   stakeholders — full control (can manage all tiers)
///   members      — trusted participants
///   serfs        — taxable subjects
///   opposition   — declared hostile (KOS for turrets)
///
/// "Sole proprietorship" is a UI concept (auto-detected when stakeholders
/// has one address and members/serfs are empty), not a contract field.
module governance::org;

use sui::event;

// ── Error codes ──────────────────────────────────────────────────────────

#[error(code = 0)]
const ENotCreator: vector<u8> = b"Only the creator can manage stakeholders";

#[error(code = 1)]
const ENotStakeholder: vector<u8> = b"Only stakeholders can manage tiers";

#[error(code = 2)]
const ECannotRemoveCreator: vector<u8> = b"Cannot remove the org creator from stakeholders";

// ── Types ────────────────────────────────────────────────────────────────

public struct Organization has key {
    id: UID,
    name: vector<u8>,
    creator: address,
    stakeholders: Tier,
    members: Tier,
    serfs: Tier,
    opposition: Tier,
}

public struct Tier has store, drop, copy {
    tribes: vector<u32>,
    characters: vector<u64>,
    addresses: vector<address>,
}

// ── Events ───────────────────────────────────────────────────────────────

public struct OrgCreatedEvent has copy, drop {
    org_id: ID,
    name: vector<u8>,
    creator: address,
}

public struct TierChangedEvent has copy, drop {
    org_id: ID,
    entity_type: vector<u8>, // "tribe", "character", or "address"
    entity_id: u64,          // tribe id, character id, or 0 for address
    entity_address: address, // address or @0x0 for tribe/character
    old_tier: vector<u8>,    // "" if new
    new_tier: vector<u8>,    // "" if removed
}

// ── Constructor ──────────────────────────────────────────────────────────

public fun create_org(name: vector<u8>, ctx: &mut TxContext): Organization {
    let creator = ctx.sender();
    let mut stakeholders = empty_tier();
    stakeholders.addresses.push_back(creator);

    let org = Organization {
        id: object::new(ctx),
        name,
        creator,
        stakeholders,
        members: empty_tier(),
        serfs: empty_tier(),
        opposition: empty_tier(),
    };

    event::emit(OrgCreatedEvent {
        org_id: object::id(&org),
        name,
        creator,
    });

    org
}

/// Create and immediately share the organization.
entry fun create_and_share(name: vector<u8>, ctx: &mut TxContext) {
    let org = create_org(name, ctx);
    transfer::share_object(org);
}

// ── Stakeholder management (creator only) ────────────────────────────────

entry fun add_stakeholder_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert!(ctx.sender() == org.creator, ENotCreator);
    remove_tribe_from_all_tiers(org, tribe_id);
    org.stakeholders.tribes.push_back(tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"stakeholder");
}

entry fun add_stakeholder_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert!(ctx.sender() == org.creator, ENotCreator);
    remove_character_from_all_tiers(org, character_id);
    org.stakeholders.characters.push_back(character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"stakeholder");
}

entry fun add_stakeholder_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert!(ctx.sender() == org.creator, ENotCreator);
    remove_address_from_all_tiers(org, addr);
    org.stakeholders.addresses.push_back(addr);
    emit_tier_change(org, b"address", 0, addr, b"stakeholder");
}

entry fun remove_stakeholder_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert!(ctx.sender() == org.creator, ENotCreator);
    remove_from_vec_u32(&mut org.stakeholders.tribes, tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"");
}

entry fun remove_stakeholder_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert!(ctx.sender() == org.creator, ENotCreator);
    remove_from_vec_u64(&mut org.stakeholders.characters, character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"");
}

entry fun remove_stakeholder_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert!(ctx.sender() == org.creator, ENotCreator);
    assert!(addr != org.creator, ECannotRemoveCreator);
    remove_from_vec_addr(&mut org.stakeholders.addresses, addr);
    emit_tier_change(org, b"address", 0, addr, b"");
}

// ── Member management (any stakeholder) ──────────────────────────────────

entry fun add_member_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_tribe_from_all_tiers(org, tribe_id);
    org.members.tribes.push_back(tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"member");
}

entry fun add_member_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_character_from_all_tiers(org, character_id);
    org.members.characters.push_back(character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"member");
}

entry fun add_member_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_address_from_all_tiers(org, addr);
    org.members.addresses.push_back(addr);
    emit_tier_change(org, b"address", 0, addr, b"member");
}

entry fun remove_member_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_u32(&mut org.members.tribes, tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"");
}

entry fun remove_member_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_u64(&mut org.members.characters, character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"");
}

entry fun remove_member_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_addr(&mut org.members.addresses, addr);
    emit_tier_change(org, b"address", 0, addr, b"");
}

// ── Serf management (any stakeholder) ────────────────────────────────────

entry fun add_serf_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_tribe_from_all_tiers(org, tribe_id);
    org.serfs.tribes.push_back(tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"serf");
}

entry fun add_serf_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_character_from_all_tiers(org, character_id);
    org.serfs.characters.push_back(character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"serf");
}

entry fun add_serf_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_address_from_all_tiers(org, addr);
    org.serfs.addresses.push_back(addr);
    emit_tier_change(org, b"address", 0, addr, b"serf");
}

entry fun remove_serf_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_u32(&mut org.serfs.tribes, tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"");
}

entry fun remove_serf_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_u64(&mut org.serfs.characters, character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"");
}

entry fun remove_serf_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_addr(&mut org.serfs.addresses, addr);
    emit_tier_change(org, b"address", 0, addr, b"");
}

// ── Opposition management (any stakeholder) ──────────────────────────────

entry fun add_opposition_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_tribe_from_all_tiers(org, tribe_id);
    org.opposition.tribes.push_back(tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"opposition");
}

entry fun add_opposition_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_character_from_all_tiers(org, character_id);
    org.opposition.characters.push_back(character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"opposition");
}

entry fun add_opposition_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_address_from_all_tiers(org, addr);
    org.opposition.addresses.push_back(addr);
    emit_tier_change(org, b"address", 0, addr, b"opposition");
}

entry fun remove_opposition_tribe(org: &mut Organization, tribe_id: u32, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_u32(&mut org.opposition.tribes, tribe_id);
    emit_tier_change(org, b"tribe", (tribe_id as u64), @0x0, b"");
}

entry fun remove_opposition_character(org: &mut Organization, character_id: u64, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_u64(&mut org.opposition.characters, character_id);
    emit_tier_change(org, b"character", character_id, @0x0, b"");
}

entry fun remove_opposition_address(org: &mut Organization, addr: address, ctx: &TxContext) {
    assert_stakeholder(org, ctx);
    remove_from_vec_addr(&mut org.opposition.addresses, addr);
    emit_tier_change(org, b"address", 0, addr, b"");
}

// ── Read functions ───────────────────────────────────────────────────────

public fun is_stakeholder_tribe(org: &Organization, tribe_id: u32): bool {
    org.stakeholders.tribes.contains(&tribe_id)
}

public fun is_stakeholder_character(org: &Organization, character_id: u64): bool {
    org.stakeholders.characters.contains(&character_id)
}

public fun is_stakeholder_address(org: &Organization, addr: address): bool {
    org.stakeholders.addresses.contains(&addr)
}

public fun is_member_tribe(org: &Organization, tribe_id: u32): bool {
    org.members.tribes.contains(&tribe_id)
}

public fun is_member_character(org: &Organization, character_id: u64): bool {
    org.members.characters.contains(&character_id)
}

public fun is_member_address(org: &Organization, addr: address): bool {
    org.members.addresses.contains(&addr)
}

public fun is_serf_tribe(org: &Organization, tribe_id: u32): bool {
    org.serfs.tribes.contains(&tribe_id)
}

public fun is_serf_character(org: &Organization, character_id: u64): bool {
    org.serfs.characters.contains(&character_id)
}

public fun is_serf_address(org: &Organization, addr: address): bool {
    org.serfs.addresses.contains(&addr)
}

public fun is_opposition_tribe(org: &Organization, tribe_id: u32): bool {
    org.opposition.tribes.contains(&tribe_id)
}

public fun is_opposition_character(org: &Organization, character_id: u64): bool {
    org.opposition.characters.contains(&character_id)
}

public fun is_opposition_address(org: &Organization, addr: address): bool {
    org.opposition.addresses.contains(&addr)
}

/// Returns true if the entity is in stakeholders, members, or serfs.
public fun is_friendly_tribe(org: &Organization, tribe_id: u32): bool {
    is_stakeholder_tribe(org, tribe_id) ||
    is_member_tribe(org, tribe_id) ||
    is_serf_tribe(org, tribe_id)
}

public fun is_friendly_character(org: &Organization, character_id: u64): bool {
    is_stakeholder_character(org, character_id) ||
    is_member_character(org, character_id) ||
    is_serf_character(org, character_id)
}

public fun is_friendly_address(org: &Organization, addr: address): bool {
    is_stakeholder_address(org, addr) ||
    is_member_address(org, addr) ||
    is_serf_address(org, addr)
}

/// Accessor: organization name
public fun name(org: &Organization): vector<u8> { org.name }

/// Accessor: organization creator
public fun creator(org: &Organization): address { org.creator }

/// Accessor: tier data
public fun stakeholders(org: &Organization): &Tier { &org.stakeholders }
public fun members(org: &Organization): &Tier { &org.members }
public fun serfs(org: &Organization): &Tier { &org.serfs }
public fun opposition(org: &Organization): &Tier { &org.opposition }

/// Tier accessors
public fun tribes(tier: &Tier): &vector<u32> { &tier.tribes }
public fun characters(tier: &Tier): &vector<u64> { &tier.characters }
public fun addresses(tier: &Tier): &vector<address> { &tier.addresses }

// ── Internal helpers ─────────────────────────────────────────────────────

fun empty_tier(): Tier {
    Tier {
        tribes: vector::empty(),
        characters: vector::empty(),
        addresses: vector::empty(),
    }
}

fun assert_stakeholder(org: &Organization, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(org.stakeholders.addresses.contains(&sender), ENotStakeholder);
}

fun emit_tier_change(org: &Organization, entity_type: vector<u8>, entity_id: u64, entity_address: address, new_tier: vector<u8>) {
    event::emit(TierChangedEvent {
        org_id: object::id(org),
        entity_type,
        entity_id,
        entity_address,
        old_tier: b"", // Simplified: old tier not tracked in Phase 1
        new_tier,
    });
}

fun remove_tribe_from_all_tiers(org: &mut Organization, tribe_id: u32) {
    remove_from_vec_u32(&mut org.stakeholders.tribes, tribe_id);
    remove_from_vec_u32(&mut org.members.tribes, tribe_id);
    remove_from_vec_u32(&mut org.serfs.tribes, tribe_id);
    remove_from_vec_u32(&mut org.opposition.tribes, tribe_id);
}

fun remove_character_from_all_tiers(org: &mut Organization, character_id: u64) {
    remove_from_vec_u64(&mut org.stakeholders.characters, character_id);
    remove_from_vec_u64(&mut org.members.characters, character_id);
    remove_from_vec_u64(&mut org.serfs.characters, character_id);
    remove_from_vec_u64(&mut org.opposition.characters, character_id);
}

fun remove_address_from_all_tiers(org: &mut Organization, addr: address) {
    remove_from_vec_addr(&mut org.stakeholders.addresses, addr);
    remove_from_vec_addr(&mut org.members.addresses, addr);
    remove_from_vec_addr(&mut org.serfs.addresses, addr);
    remove_from_vec_addr(&mut org.opposition.addresses, addr);
}

fun remove_from_vec_u32(v: &mut vector<u32>, val: u32) {
    let len = v.length();
    let mut i = 0;
    while (i < len) {
        if (v[i] == val) {
            v.swap_remove(i);
            return
        };
        i = i + 1;
    };
}

fun remove_from_vec_u64(v: &mut vector<u64>, val: u64) {
    let len = v.length();
    let mut i = 0;
    while (i < len) {
        if (v[i] == val) {
            v.swap_remove(i);
            return
        };
        i = i + 1;
    };
}

fun remove_from_vec_addr(v: &mut vector<address>, val: address) {
    let len = v.length();
    let mut i = 0;
    while (i < len) {
        if (v[i] == val) {
            v.swap_remove(i);
            return
        };
        i = i + 1;
    };
}

// ── Test Helpers ─────────────────────────────────────────────────────────

#[test_only]
public fun share_for_testing(org: Organization) {
    transfer::share_object(org);
}

// ── Tests ────────────────────────────────────────────────────────────────

#[test_only]
use sui::test_scenario;

#[test]
fun test_create_org() {
    let creator = @0xCAFE;
    let mut scenario = test_scenario::begin(creator);

    // Create org
    let org = create_org(b"Test Org", scenario.ctx());
    assert!(org.name == b"Test Org");
    assert!(org.creator == creator);
    assert!(org.stakeholders.addresses.contains(&creator));
    assert!(org.stakeholders.addresses.length() == 1);
    assert!(org.members.addresses.length() == 0);
    assert!(org.serfs.addresses.length() == 0);
    assert!(org.opposition.addresses.length() == 0);

    transfer::share_object(org);
    scenario.end();
}

#[test]
fun test_add_member() {
    let creator = @0xCAFE;
    let mut scenario = test_scenario::begin(creator);

    let org = create_org(b"Test Org", scenario.ctx());
    transfer::share_object(org);

    scenario.next_tx(creator);
    let mut org = scenario.take_shared<Organization>();
    add_member_character(&mut org, 12345, scenario.ctx());
    assert!(is_member_character(&org, 12345));
    assert!(!is_stakeholder_character(&org, 12345));
    assert!(is_friendly_character(&org, 12345));
    test_scenario::return_shared(org);

    scenario.end();
}

#[test]
fun test_tier_exclusivity() {
    let creator = @0xCAFE;
    let mut scenario = test_scenario::begin(creator);

    let org = create_org(b"Test Org", scenario.ctx());
    transfer::share_object(org);

    // Add as member first
    scenario.next_tx(creator);
    let mut org = scenario.take_shared<Organization>();
    add_member_character(&mut org, 42, scenario.ctx());
    assert!(is_member_character(&org, 42));

    // Move to serfs — should remove from members
    add_serf_character(&mut org, 42, scenario.ctx());
    assert!(!is_member_character(&org, 42));
    assert!(is_serf_character(&org, 42));
    assert!(is_friendly_character(&org, 42));
    test_scenario::return_shared(org);

    scenario.end();
}

#[test]
fun test_remove_stakeholder() {
    let creator = @0xCAFE;
    let other = @0xBEEF;
    let mut scenario = test_scenario::begin(creator);

    let org = create_org(b"Test Org", scenario.ctx());
    transfer::share_object(org);

    // Add another stakeholder
    scenario.next_tx(creator);
    let mut org = scenario.take_shared<Organization>();
    add_stakeholder_address(&mut org, other, scenario.ctx());
    assert!(is_stakeholder_address(&org, other));

    // Remove the other stakeholder
    remove_stakeholder_address(&mut org, other, scenario.ctx());
    assert!(!is_stakeholder_address(&org, other));
    test_scenario::return_shared(org);

    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotCreator, location = Self)]
fun test_only_creator_manages_stakeholders() {
    let creator = @0xCAFE;
    let intruder = @0xBAD;
    let mut scenario = test_scenario::begin(creator);

    let org = create_org(b"Test Org", scenario.ctx());
    transfer::share_object(org);

    // Intruder tries to add stakeholder — should fail
    scenario.next_tx(intruder);
    let mut org = scenario.take_shared<Organization>();
    add_stakeholder_address(&mut org, intruder, scenario.ctx());
    test_scenario::return_shared(org);

    scenario.end();
}

#[test]
fun test_stakeholder_can_manage_tiers() {
    let creator = @0xCAFE;
    let stakeholder2 = @0xBEEF;
    let mut scenario = test_scenario::begin(creator);

    let org = create_org(b"Test Org", scenario.ctx());
    transfer::share_object(org);

    // Creator adds another stakeholder
    scenario.next_tx(creator);
    let mut org = scenario.take_shared<Organization>();
    add_stakeholder_address(&mut org, stakeholder2, scenario.ctx());
    test_scenario::return_shared(org);

    // The other stakeholder manages members
    scenario.next_tx(stakeholder2);
    let mut org = scenario.take_shared<Organization>();
    add_member_tribe(&mut org, 999, scenario.ctx());
    assert!(is_member_tribe(&org, 999));
    test_scenario::return_shared(org);

    scenario.end();
}

#[test]
fun test_is_friendly() {
    let creator = @0xCAFE;
    let mut scenario = test_scenario::begin(creator);

    let org = create_org(b"Test Org", scenario.ctx());
    transfer::share_object(org);

    scenario.next_tx(creator);
    let mut org = scenario.take_shared<Organization>();
    add_member_character(&mut org, 1, scenario.ctx());
    add_serf_character(&mut org, 2, scenario.ctx());
    add_opposition_character(&mut org, 3, scenario.ctx());

    // Stakeholder, member, serf are friendly
    assert!(is_friendly_address(&org, creator));
    assert!(is_friendly_character(&org, 1));
    assert!(is_friendly_character(&org, 2));
    // Opposition is NOT friendly
    assert!(!is_friendly_character(&org, 3));
    // Unknown is NOT friendly
    assert!(!is_friendly_character(&org, 999));
    test_scenario::return_shared(org);

    scenario.end();
}
