/// Per-gate ACL configuration with multi-admin support.
///
/// Stores per-gate access control lists (allowlist or denylist) as dynamic
/// fields on a shared ExtensionConfig object. Supports both address-based
/// and tribe-based admin delegation.
module gate_acl::config;

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
const ECannotRemoveOwner: vector<u8> = b"Cannot remove the owner from admins";

// ── Structs ────────────────────────────────────────────────────────────────

/// Shared config object holding per-gate ACL settings as dynamic fields.
/// Supports multi-admin via address list and tribe-based admin delegation.
public struct ExtensionConfig has key {
    id: UID,
    owner: address,
    admins: vector<address>,
    admin_tribes: vector<u32>,
}

/// Per-gate ACL configuration stored as a dynamic field on ExtensionConfig.
public struct AclConfig has store, drop {
    is_allowlist: bool,
    allowed_tribes: vector<u32>,
    allowed_characters: vector<u64>,
    permit_duration_ms: u64,
}

// ── Init ───────────────────────────────────────────────────────────────────

/// Create the shared config object. Called once at publish time.
fun init(ctx: &mut TxContext) {
    transfer::share_object(ExtensionConfig {
        id: object::new(ctx),
        owner: ctx.sender(),
        admins: vector::empty(),
        admin_tribes: vector::empty(),
    });
}

// ── Admin management (owner only) ──────────────────────────────────────────

/// Add a co-admin wallet address. Owner only.
public fun add_admin(
    config: &mut ExtensionConfig,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(!vector::contains(&config.admins, &admin), EAdminAlreadyExists);
    vector::push_back(&mut config.admins, admin);
}

/// Remove a co-admin wallet address. Owner only.
public fun remove_admin(
    config: &mut ExtensionConfig,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(admin != config.owner, ECannotRemoveOwner);
    let (found, idx) = vector::index_of(&config.admins, &admin);
    assert!(found, EAdminNotFound);
    vector::remove(&mut config.admins, idx);
}

/// Add an admin tribe. Any character in this tribe can configure gates.
public fun add_admin_tribe(
    config: &mut ExtensionConfig,
    tribe_id: u32,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    assert!(!vector::contains(&config.admin_tribes, &tribe_id), ETribeAlreadyAdmin);
    vector::push_back(&mut config.admin_tribes, tribe_id);
}

/// Remove an admin tribe. Owner only.
public fun remove_admin_tribe(
    config: &mut ExtensionConfig,
    tribe_id: u32,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.owner, ENotOwner);
    let (found, idx) = vector::index_of(&config.admin_tribes, &tribe_id);
    assert!(found, ETribeNotAdmin);
    vector::remove(&mut config.admin_tribes, idx);
}

// ── Authorization checks ───────────────────────────────────────────────────

/// Check if the transaction sender is authorized (owner or co-admin by address).
public fun is_authorized(config: &ExtensionConfig, ctx: &TxContext): bool {
    let sender = ctx.sender();
    if (sender == config.owner) return true;
    vector::contains(&config.admins, &sender)
}

/// Check if a character's tribe is in the admin_tribes list.
/// Used when the caller is not directly in the admins list but their
/// character belongs to an authorized tribe.
public fun is_tribe_authorized(config: &ExtensionConfig, char_tribe: u32): bool {
    vector::contains(&config.admin_tribes, &char_tribe)
}

// ── ACL config management ──────────────────────────────────────────────────

/// Set or update the ACL config for a specific gate. Requires authorization.
public fun set_config(
    config: &mut ExtensionConfig,
    gate_id: ID,
    is_allowlist: bool,
    tribes: vector<u32>,
    characters: vector<u64>,
    permit_duration_ms: u64,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);

    let acl = AclConfig {
        is_allowlist,
        allowed_tribes: tribes,
        allowed_characters: characters,
        permit_duration_ms,
    };

    if (dynamic_field::exists_(&config.id, gate_id)) {
        *dynamic_field::borrow_mut<ID, AclConfig>(&mut config.id, gate_id) = acl;
    } else {
        dynamic_field::add(&mut config.id, gate_id, acl);
    };
}

/// Remove the ACL config for a gate. Requires authorization.
public fun remove_config(
    config: &mut ExtensionConfig,
    gate_id: ID,
    ctx: &TxContext,
) {
    assert!(is_authorized(config, ctx), ENotAuthorized);
    if (dynamic_field::exists_(&config.id, gate_id)) {
        dynamic_field::remove<ID, AclConfig>(&mut config.id, gate_id);
    };
}

// ── Read accessors ─────────────────────────────────────────────────────────

/// Check if a gate has ACL config set.
public fun has_config(config: &ExtensionConfig, gate_id: ID): bool {
    dynamic_field::exists_(&config.id, gate_id)
}

/// Read the ACL config for a gate. Aborts if not configured.
public fun get_config(config: &ExtensionConfig, gate_id: ID): &AclConfig {
    dynamic_field::borrow<ID, AclConfig>(&config.id, gate_id)
}

/// Get the allowlist/denylist mode.
public fun is_allowlist(acl: &AclConfig): bool {
    acl.is_allowlist
}

/// Get allowed tribes from the ACL config.
public fun allowed_tribes(acl: &AclConfig): &vector<u32> {
    &acl.allowed_tribes
}

/// Get allowed characters from the ACL config.
public fun allowed_characters(acl: &AclConfig): &vector<u64> {
    &acl.allowed_characters
}

/// Get permit duration from the ACL config.
public fun permit_duration_ms(acl: &AclConfig): u64 {
    acl.permit_duration_ms
}

/// Check if a tribe ID is in the allowed list.
public fun contains_tribe(acl: &AclConfig, tribe_id: u32): bool {
    vector::contains(&acl.allowed_tribes, &tribe_id)
}

/// Check if a character ID is in the allowed list.
public fun contains_character(acl: &AclConfig, char_id: u64): bool {
    vector::contains(&acl.allowed_characters, &char_id)
}

/// Get the owner address.
public fun owner(config: &ExtensionConfig): address {
    config.owner
}

/// Get the admins list.
public fun admins(config: &ExtensionConfig): &vector<address> {
    &config.admins
}

/// Get the admin tribes list.
public fun admin_tribes(config: &ExtensionConfig): &vector<u32> {
    &config.admin_tribes
}
