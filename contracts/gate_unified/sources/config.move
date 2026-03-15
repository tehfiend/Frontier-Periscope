/// Unified gate config: groups, ACL, and toll in one contract.
///
/// Groups are named collections of tribes and characters that simplify
/// access management. Instead of managing flat lists per gate, you create
/// groups once and reference them across all your gates.
///
/// Per-gate config supports:
///   - Allowlist / denylist mode using groups
///   - Optional toll with configurable fee, currency, and recipient
///   - Groups marked as toll-exempt (allies jump free)
///   - Multi-admin delegation (address + tribe based)
module gate_unified::config;

use sui::dynamic_field;

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const ENotAuthorized: vector<u8> = b"Caller is not authorized to modify config";

#[error(code = 1)]
const ENotOwner: vector<u8> = b"Only the owner can manage admins";

#[error(code = 2)]
const EAdminAlreadyExists: vector<u8> = b"Address is already an admin";

#[error(code = 3)]
const EAdminNotFound: vector<u8> = b"Address is not an admin";

#[error(code = 4)]
const ETribeAlreadyAdmin: vector<u8> = b"Tribe is already an admin tribe";

#[error(code = 5)]
const ETribeNotAdmin: vector<u8> = b"Tribe is not an admin tribe";

#[error(code = 6)]
const EGroupNotFound: vector<u8> = b"Group does not exist";

#[error(code = 8)]
const EMaxGroupsReached: vector<u8> = b"Maximum number of groups reached";

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_GROUPS: u64 = 32;

// ── Structs ────────────────────────────────────────────────────────────────

/// Shared config object. Holds groups and per-gate settings as dynamic fields.
public struct ExtensionConfig has key {
    id: UID,
    owner: address,
    admins: vector<address>,
    admin_tribes: vector<u32>,
    /// Group definitions. Index = group ID for referencing in gate configs.
    groups: vector<Group>,
}

/// A named group of tribes and characters.
public struct Group has store, drop, copy {
    name: vector<u8>,
    tribes: vector<u32>,
    characters: vector<u64>,
}

/// Per-gate configuration stored as dynamic field keyed by gate ID.
public struct GateConfig has store, drop {
    /// true = allowlist (only listed groups can jump), false = denylist
    is_allowlist: bool,
    /// Indices into ExtensionConfig.groups that define access
    access_group_ids: vector<u64>,
    /// Jump permit validity duration in milliseconds
    permit_duration_ms: u64,
    /// Toll fee (0 = no toll)
    toll_fee: u64,
    /// Where toll payments are sent
    toll_recipient: address,
    /// Group indices whose members are exempt from toll
    toll_exempt_group_ids: vector<u64>,
}

// ── Init ───────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(ExtensionConfig {
        id: object::new(ctx),
        owner: ctx.sender(),
        admins: vector::empty(),
        admin_tribes: vector::empty(),
        groups: vector::empty(),
    });
}

// ── Admin management (owner only) ──────────────────────────────────────────

public fun add_admin(config: &mut ExtensionConfig, admin: address, ctx: &TxContext) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(!vector::contains(&config.admins, &admin), EAdminAlreadyExists);
    vector::push_back(&mut config.admins, admin);
}

public fun remove_admin(config: &mut ExtensionConfig, admin: address, ctx: &TxContext) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    let (found, idx) = vector::index_of(&config.admins, &admin);
    assert!(found, EAdminNotFound);
    vector::remove(&mut config.admins, idx);
}

public fun add_admin_tribe(config: &mut ExtensionConfig, tribe_id: u32, ctx: &TxContext) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(!vector::contains(&config.admin_tribes, &tribe_id), ETribeAlreadyAdmin);
    vector::push_back(&mut config.admin_tribes, tribe_id);
}

public fun remove_admin_tribe(config: &mut ExtensionConfig, tribe_id: u32, ctx: &TxContext) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    let (found, idx) = vector::index_of(&config.admin_tribes, &tribe_id);
    assert!(found, ETribeNotAdmin);
    vector::remove(&mut config.admin_tribes, idx);
}

// ── Authorization checks ───────────────────────────────────────────────────

public fun is_authorized(config: &ExtensionConfig, ctx: &TxContext): bool {
    let sender = ctx.sender();
    if (sender == config.owner) return true;
    vector::contains(&config.admins, &sender)
}

public fun is_tribe_authorized(config: &ExtensionConfig, char_tribe: u32): bool {
    vector::contains(&config.admin_tribes, &char_tribe)
}

// ── Group management ───────────────────────────────────────────────────────

/// Create a new group. Returns its index.
public fun create_group(
    config: &mut ExtensionConfig,
    name: vector<u8>,
    tribes: vector<u32>,
    characters: vector<u64>,
    ctx: &TxContext,
): u64 {
    assert!(is_authorized(config, ctx), ENotAuthorized);
    assert!(config.groups.length() < MAX_GROUPS, EMaxGroupsReached);

    let group = Group { name, tribes, characters };
    vector::push_back(&mut config.groups, group);
    config.groups.length() - 1
}

/// Update an existing group's members.
public fun update_group(
    config: &mut ExtensionConfig,
    group_id: u64,
    name: vector<u8>,
    tribes: vector<u32>,
    characters: vector<u64>,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);
    assert!(group_id < config.groups.length(), EGroupNotFound);

    let group = vector::borrow_mut(&mut config.groups, group_id);
    group.name = name;
    group.tribes = tribes;
    group.characters = characters;
}

/// Remove a group by index. Shifts subsequent group indices.
/// WARNING: This invalidates gate configs referencing higher group IDs.
/// Prefer clearing group members instead of removing if gates reference it.
public fun remove_group(
    config: &mut ExtensionConfig,
    group_id: u64,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);
    assert!(group_id < config.groups.length(), EGroupNotFound);
    vector::remove(&mut config.groups, group_id);
}

/// Check if a character (by tribe + character ID) is in any of the specified groups.
public fun is_in_groups(
    config: &ExtensionConfig,
    group_ids: &vector<u64>,
    char_tribe: u32,
    char_id: u64,
): bool {
    let mut i = 0;
    let len = group_ids.length();
    while (i < len) {
        let gid = *vector::borrow(group_ids, i);
        if (gid < config.groups.length()) {
            let group = vector::borrow(&config.groups, gid);
            if (vector::contains(&group.tribes, &char_tribe)) return true;
            if (vector::contains(&group.characters, &char_id)) return true;
        };
        i = i + 1;
    };
    false
}

// ── Gate config management ────────────────────────────────────────────────

/// Set or update the full config for a gate.
public fun set_gate_config(
    config: &mut ExtensionConfig,
    gate_id: ID,
    is_allowlist: bool,
    access_group_ids: vector<u64>,
    permit_duration_ms: u64,
    toll_fee: u64,
    toll_recipient: address,
    toll_exempt_group_ids: vector<u64>,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);

    let gate_config = GateConfig {
        is_allowlist,
        access_group_ids,
        permit_duration_ms,
        toll_fee,
        toll_recipient,
        toll_exempt_group_ids,
    };

    if (dynamic_field::exists_(&config.id, gate_id)) {
        *dynamic_field::borrow_mut<ID, GateConfig>(&mut config.id, gate_id) = gate_config;
    } else {
        dynamic_field::add(&mut config.id, gate_id, gate_config);
    };
}

/// Remove the config for a gate.
public fun remove_gate_config(
    config: &mut ExtensionConfig,
    gate_id: ID,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);
    if (dynamic_field::exists_(&config.id, gate_id)) {
        dynamic_field::remove<ID, GateConfig>(&mut config.id, gate_id);
    };
}

// ── Read accessors ─────────────────────────────────────────────────────────

public fun has_gate_config(config: &ExtensionConfig, gate_id: ID): bool {
    dynamic_field::exists_(&config.id, gate_id)
}

public fun get_gate_config(config: &ExtensionConfig, gate_id: ID): &GateConfig {
    dynamic_field::borrow<ID, GateConfig>(&config.id, gate_id)
}

public fun is_allowlist(gc: &GateConfig): bool { gc.is_allowlist }
public fun access_group_ids(gc: &GateConfig): &vector<u64> { &gc.access_group_ids }
public fun permit_duration_ms(gc: &GateConfig): u64 { gc.permit_duration_ms }
public fun toll_fee(gc: &GateConfig): u64 { gc.toll_fee }
public fun toll_recipient(gc: &GateConfig): address { gc.toll_recipient }
public fun toll_exempt_group_ids(gc: &GateConfig): &vector<u64> { &gc.toll_exempt_group_ids }

public fun owner(config: &ExtensionConfig): address { config.owner }
public fun admins(config: &ExtensionConfig): &vector<address> { &config.admins }
public fun admin_tribes(config: &ExtensionConfig): &vector<u32> { &config.admin_tribes }
public fun group_count(config: &ExtensionConfig): u64 { config.groups.length() }
public fun get_group(config: &ExtensionConfig, idx: u64): &Group { vector::borrow(&config.groups, idx) }
public fun group_name(group: &Group): &vector<u8> { &group.name }
public fun group_tribes(group: &Group): &vector<u32> { &group.tribes }
public fun group_characters(group: &Group): &vector<u64> { &group.characters }
