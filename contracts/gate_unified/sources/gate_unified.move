/// Unified gate extension: group-based ACL + toll in one contract.
///
/// Combines access control (allowlist/denylist) and toll payment into a
/// single extension. Uses a group system for managing tribes and characters.
///
/// Access modes:
///   - Allowlist: only characters in access groups can jump
///   - Denylist: characters in access groups are blocked, all others can jump
///   - Toll: non-exempt characters must pay a fee (Coin<T>)
///   - Combined: ACL check first, then toll for non-exempt passers
///
/// Flow:
///   1. Owner publishes this package
///   2. Owner calls gate::authorize_extension<GateUnifiedAuth>(gate, owner_cap)
///   3. Admin creates groups: config::create_group(config, name, tribes, chars)
///   4. Admin sets gate config: config::set_gate_config(config, gate_id, ...)
///   5. Game calls can_jump() or can_jump_with_toll<T>() on jump attempt
#[allow(lint(self_transfer))]
module gate_unified::gate_unified;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::event;
use world::{character::Character, gate::{Self, Gate}, in_game_id};
use gate_unified::config::{Self, ExtensionConfig};

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const EAccessDenied: vector<u8> = b"Character not authorized to use this gate";

#[error(code = 1)]
const EGateNotConfigured: vector<u8> = b"Gate has no config set";

#[error(code = 2)]
const EInsufficientPayment: vector<u8> = b"Payment amount is less than the toll fee";

// ── Structs ────────────────────────────────────────────────────────────────

/// Typed witness for extension authorization.
public struct GateUnifiedAuth has drop {}

/// Emitted when a toll is collected.
public struct TollCollectedEvent has copy, drop {
    gate_id: ID,
    payer: address,
    amount: u64,
}

/// Emitted when access is granted (for analytics).
public struct AccessGrantedEvent has copy, drop {
    gate_id: ID,
    character_id: u64,
    toll_paid: u64,
}

// ── Entry points ──────────────────────────────────────────────────────────

/// Jump without toll payment. For gates with no toll or toll-exempt characters.
/// If the gate has a toll configured and the character is not exempt, this aborts.
public fun can_jump(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    config: &ExtensionConfig,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let gate_id = object::id(source_gate);
    assert!(config::has_gate_config(config, gate_id), EGateNotConfigured);

    let gc = config::get_gate_config(config, gate_id);
    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());

    // ACL check
    check_access(config, gc, char_tribe, char_id);

    // Toll check: if toll > 0 and not exempt, this path fails
    // Characters must use can_jump_with_toll instead
    let toll = config::toll_fee(gc);
    if (toll > 0) {
        let exempt = config::is_in_groups(
            config,
            config::toll_exempt_group_ids(gc),
            char_tribe,
            char_id,
        );
        assert!(exempt, EInsufficientPayment);
    };

    let expires_at = clock.timestamp_ms() + config::permit_duration_ms(gc);

    gate::issue_jump_permit<GateUnifiedAuth>(
        source_gate,
        destination_gate,
        character,
        GateUnifiedAuth {},
        expires_at,
        ctx,
    );

    event::emit(AccessGrantedEvent {
        gate_id,
        character_id: char_id,
        toll_paid: 0,
    });
}

/// Jump with toll payment. Handles both toll and toll-exempt characters.
public fun can_jump_with_toll<T>(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    mut payment: Coin<T>,
    config: &ExtensionConfig,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let gate_id = object::id(source_gate);
    assert!(config::has_gate_config(config, gate_id), EGateNotConfigured);

    let gc = config::get_gate_config(config, gate_id);
    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());

    // ACL check
    check_access(config, gc, char_tribe, char_id);

    // Toll handling
    let toll = config::toll_fee(gc);
    let mut toll_paid = 0u64;

    if (toll > 0) {
        let exempt = config::is_in_groups(
            config,
            config::toll_exempt_group_ids(gc),
            char_tribe,
            char_id,
        );

        if (!exempt) {
            assert!(coin::value(&payment) >= toll, EInsufficientPayment);

            let fee_coin = coin::split(&mut payment, toll, ctx);
            let recipient = config::toll_recipient(gc);
            transfer::public_transfer(fee_coin, recipient);

            toll_paid = toll;

            event::emit(TollCollectedEvent {
                gate_id,
                payer: ctx.sender(),
                amount: toll,
            });
        };
    };

    // Return change
    if (coin::value(&payment) > 0) {
        transfer::public_transfer(payment, ctx.sender());
    } else {
        coin::destroy_zero(payment);
    };

    let expires_at = clock.timestamp_ms() + config::permit_duration_ms(gc);

    gate::issue_jump_permit<GateUnifiedAuth>(
        source_gate,
        destination_gate,
        character,
        GateUnifiedAuth {},
        expires_at,
        ctx,
    );

    event::emit(AccessGrantedEvent {
        gate_id,
        character_id: char_id,
        toll_paid,
    });
}

// ── Internal ──────────────────────────────────────────────────────────────

/// Check ACL access. Aborts with EAccessDenied if denied.
fun check_access(
    config: &ExtensionConfig,
    gc: &config::GateConfig,
    char_tribe: u32,
    char_id: u64,
) {
    let access_groups = config::access_group_ids(gc);

    // If no access groups configured, gate is open (no ACL filtering)
    if (access_groups.length() == 0) return;

    let in_list = config::is_in_groups(config, access_groups, char_tribe, char_id);

    if (config::is_allowlist(gc)) {
        // Allowlist: must be in a listed group
        assert!(in_list, EAccessDenied);
    } else {
        // Denylist: must NOT be in a listed group
        assert!(!in_list, EAccessDenied);
    };
}
