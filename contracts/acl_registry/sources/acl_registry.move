/// Shared ACL Registry: standalone named access control lists.
///
/// Creates SharedAcl shared objects that any extension (gate, turret, etc.)
/// can reference. Extension-agnostic design -- no world dependency.
///
/// Flow:
///   1. Leader creates a SharedAcl via create_acl(name, is_allowlist, tribes, characters)
///   2. The object ID is the handle for referencing this ACL
///   3. Gate/turret owners configure their extensions to reference a SharedAcl by ID
///   4. Admins can add/remove tribes and characters; changes propagate instantly
module acl_registry::acl_registry;

use sui::event;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotAdmin: vector<u8> = b"Caller is not an admin of this ACL";

#[error(code = 1)]
const ENotCreator: vector<u8> = b"Only the creator can manage admins";

#[error(code = 2)]
const EAdminAlreadyExists: vector<u8> = b"Address is already an admin";

#[error(code = 3)]
const EAdminNotFound: vector<u8> = b"Address is not an admin";

#[error(code = 4)]
const ETribeAlreadyExists: vector<u8> = b"Tribe ID is already in the list";

#[error(code = 5)]
const ETribeNotFound: vector<u8> = b"Tribe ID is not in the list";

#[error(code = 6)]
const ECharacterAlreadyExists: vector<u8> = b"Character ID is already in the list";

#[error(code = 7)]
const ECharacterNotFound: vector<u8> = b"Character ID is not in the list";

#[error(code = 8)]
const ECannotRemoveCreator: vector<u8> = b"Cannot remove the creator from admins";

// -- Structs --------------------------------------------------------------------

/// Shared ACL object. Extension-agnostic -- can be referenced by gates, turrets, etc.
public struct SharedAcl has key {
    id: UID,
    name: vector<u8>,
    creator: address,
    admins: vector<address>,
    is_allowlist: bool,
    allowed_tribes: vector<u32>,
    allowed_characters: vector<u64>,
}

// -- Events ---------------------------------------------------------------------

public struct AclCreatedEvent has copy, drop {
    acl_id: ID,
    name: vector<u8>,
    creator: address,
}

public struct AclUpdatedEvent has copy, drop {
    acl_id: ID,
}

// -- Create ---------------------------------------------------------------------

/// Create a new SharedAcl. The caller becomes the creator and first admin.
#[allow(lint(share_owned))]
public fun create_acl(
    name: vector<u8>,
    is_allowlist: bool,
    tribes: vector<u32>,
    characters: vector<u64>,
    ctx: &mut TxContext,
) {
    let acl = SharedAcl {
        id: object::new(ctx),
        name,
        creator: ctx.sender(),
        admins: vector::empty(),
        is_allowlist,
        allowed_tribes: tribes,
        allowed_characters: characters,
    };

    event::emit(AclCreatedEvent {
        acl_id: object::id(&acl),
        name: acl.name,
        creator: ctx.sender(),
    });

    transfer::share_object(acl);
}

// -- Bulk update (admin only) ---------------------------------------------------

/// Bulk update the ACL mode and lists. Admin only.
public fun update_acl(
    acl: &mut SharedAcl,
    is_allowlist: bool,
    tribes: vector<u32>,
    characters: vector<u64>,
    ctx: &TxContext,
) {
    assert!(is_admin(acl, ctx), ENotAdmin);
    acl.is_allowlist = is_allowlist;
    acl.allowed_tribes = tribes;
    acl.allowed_characters = characters;

    event::emit(AclUpdatedEvent { acl_id: object::id(acl) });
}

// -- Admin management (creator only) --------------------------------------------

/// Add a co-admin address. Creator only.
public fun add_admin(
    acl: &mut SharedAcl,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == acl.creator, ENotCreator);
    assert!(!vector::contains(&acl.admins, &admin), EAdminAlreadyExists);
    vector::push_back(&mut acl.admins, admin);
}

/// Remove a co-admin address. Creator only. Cannot remove the creator.
public fun remove_admin(
    acl: &mut SharedAcl,
    admin: address,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == acl.creator, ENotCreator);
    assert!(admin != acl.creator, ECannotRemoveCreator);
    let (found, idx) = vector::index_of(&acl.admins, &admin);
    assert!(found, EAdminNotFound);
    vector::remove(&mut acl.admins, idx);
}

// -- Tribe management (admin only) ----------------------------------------------

/// Add a tribe ID to the ACL list. Admin only.
public fun add_tribe(
    acl: &mut SharedAcl,
    tribe_id: u32,
    ctx: &TxContext,
) {
    assert!(is_admin(acl, ctx), ENotAdmin);
    assert!(!vector::contains(&acl.allowed_tribes, &tribe_id), ETribeAlreadyExists);
    vector::push_back(&mut acl.allowed_tribes, tribe_id);

    event::emit(AclUpdatedEvent { acl_id: object::id(acl) });
}

/// Remove a tribe ID from the ACL list. Admin only.
public fun remove_tribe(
    acl: &mut SharedAcl,
    tribe_id: u32,
    ctx: &TxContext,
) {
    assert!(is_admin(acl, ctx), ENotAdmin);
    let (found, idx) = vector::index_of(&acl.allowed_tribes, &tribe_id);
    assert!(found, ETribeNotFound);
    vector::remove(&mut acl.allowed_tribes, idx);

    event::emit(AclUpdatedEvent { acl_id: object::id(acl) });
}

// -- Character management (admin only) ------------------------------------------

/// Add a character ID to the ACL list. Admin only.
public fun add_character(
    acl: &mut SharedAcl,
    char_id: u64,
    ctx: &TxContext,
) {
    assert!(is_admin(acl, ctx), ENotAdmin);
    assert!(!vector::contains(&acl.allowed_characters, &char_id), ECharacterAlreadyExists);
    vector::push_back(&mut acl.allowed_characters, char_id);

    event::emit(AclUpdatedEvent { acl_id: object::id(acl) });
}

/// Remove a character ID from the ACL list. Admin only.
public fun remove_character(
    acl: &mut SharedAcl,
    char_id: u64,
    ctx: &TxContext,
) {
    assert!(is_admin(acl, ctx), ENotAdmin);
    let (found, idx) = vector::index_of(&acl.allowed_characters, &char_id);
    assert!(found, ECharacterNotFound);
    vector::remove(&mut acl.allowed_characters, idx);

    event::emit(AclUpdatedEvent { acl_id: object::id(acl) });
}

// -- Authorization check --------------------------------------------------------

/// Check if the transaction sender is an admin (creator or co-admin).
public fun is_admin(acl: &SharedAcl, ctx: &TxContext): bool {
    let sender = ctx.sender();
    if (sender == acl.creator) return true;
    vector::contains(&acl.admins, &sender)
}

// -- Read accessors -------------------------------------------------------------

/// Get the ACL name.
public fun name(acl: &SharedAcl): &vector<u8> {
    &acl.name
}

/// Get the creator address.
public fun creator(acl: &SharedAcl): address {
    acl.creator
}

/// Get the admins list.
public fun admins(acl: &SharedAcl): &vector<address> {
    &acl.admins
}

/// Get the allowlist/denylist mode.
public fun is_allowlist(acl: &SharedAcl): bool {
    acl.is_allowlist
}

/// Get allowed tribes.
public fun allowed_tribes(acl: &SharedAcl): &vector<u32> {
    &acl.allowed_tribes
}

/// Get allowed characters.
public fun allowed_characters(acl: &SharedAcl): &vector<u64> {
    &acl.allowed_characters
}

/// Check if a tribe ID is in the allowed list.
public fun contains_tribe(acl: &SharedAcl, tribe_id: u32): bool {
    vector::contains(&acl.allowed_tribes, &tribe_id)
}

/// Check if a character ID is in the allowed list.
public fun contains_character(acl: &SharedAcl, char_id: u64): bool {
    vector::contains(&acl.allowed_characters, &char_id)
}
