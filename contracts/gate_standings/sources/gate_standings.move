/// Gate extension: standings-based access control with optional toll.
///
/// References a StandingsRegistry to determine if a character can use a gate.
/// Three tiers of access per gate:
///   - Standing < min_access: blocked (EAccessDenied)
///   - Standing >= min_access but < free_access: must pay toll
///   - Standing >= free_access: free passage
///
/// Flow:
///   1. Owner publishes this package
///   2. Owner calls gate::authorize_extension<GateStandingsAuth>(gate, owner_cap)
///   3. Admin sets gate config: config::set_gate_config(config, gate_id, ...)
///   4. Game calls can_jump_free() or can_jump<T>() on jump attempt
#[allow(lint(self_transfer))]
module gate_standings::gate_standings;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::event;
use world::{character::Character, gate::{Self, Gate}, in_game_id};
use gate_standings::config::{Self, GateStandingsConfig};
use standings_registry::standings_registry::{Self, StandingsRegistry};

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const EGateNotConfigured: vector<u8> = b"Gate has no standings config set";

#[error(code = 1)]
const EAccessDenied: vector<u8> = b"Character standing is below minimum access threshold";

#[error(code = 2)]
const EInsufficientPayment: vector<u8> = b"Payment amount is less than the toll fee";

#[error(code = 3)]
const ERegistryMismatch: vector<u8> = b"StandingsRegistry does not match configured registry ID";

// -- Structs --------------------------------------------------------------------

/// Typed witness for extension authorization.
public struct GateStandingsAuth has drop {}

// -- Events ---------------------------------------------------------------------

/// Emitted when access is granted (for analytics).
public struct AccessGrantedEvent has copy, drop {
    gate_id: ID,
    character_id: u64,
    toll_paid: u64,
}

/// Emitted when a toll is collected.
public struct TollCollectedEvent has copy, drop {
    gate_id: ID,
    payer: address,
    amount: u64,
}

// -- Entry points ---------------------------------------------------------------

/// Jump without toll payment. For characters at/above the free_access threshold.
/// Aborts if the character's standing is below min_access or if a toll is required
/// (standing between min_access and free_access).
public fun can_jump_free(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    config: &GateStandingsConfig,
    registry: &StandingsRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let gate_id = object::id(source_gate);
    assert!(config::has_gate_config(config, gate_id), EGateNotConfigured);

    let rule = config::get_gate_config(config, gate_id);

    // Verify registry matches
    assert!(object::id(registry) == config::registry_id(rule), ERegistryMismatch);

    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());
    let standing = standings_registry::get_standing(registry, char_tribe, char_id);

    // Must meet minimum access threshold
    assert!(standing >= config::min_access(rule), EAccessDenied);

    // Must be at/above free access threshold (no toll path)
    let toll = config::toll_fee(rule);
    if (toll > 0) {
        assert!(standing >= config::free_access(rule), EInsufficientPayment);
    };

    let expires_at = clock.timestamp_ms() + config::permit_duration_ms(rule);

    gate::issue_jump_permit<GateStandingsAuth>(
        source_gate,
        destination_gate,
        character,
        GateStandingsAuth {},
        expires_at,
        ctx,
    );

    event::emit(AccessGrantedEvent {
        gate_id,
        character_id: char_id,
        toll_paid: 0,
    });
}

/// Jump with toll payment. Handles all standing levels:
///   - Below min_access: aborts with EAccessDenied
///   - At/above free_access: free (toll not collected, change returned)
///   - Between min_access and free_access: toll collected from payment
public fun can_jump<T>(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    mut payment: Coin<T>,
    config: &GateStandingsConfig,
    registry: &StandingsRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let gate_id = object::id(source_gate);
    assert!(config::has_gate_config(config, gate_id), EGateNotConfigured);

    let rule = config::get_gate_config(config, gate_id);

    // Verify registry matches
    assert!(object::id(registry) == config::registry_id(rule), ERegistryMismatch);

    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());
    let standing = standings_registry::get_standing(registry, char_tribe, char_id);

    // Must meet minimum access threshold
    assert!(standing >= config::min_access(rule), EAccessDenied);

    // Toll handling
    let toll = config::toll_fee(rule);
    let mut toll_paid = 0u64;

    if (toll > 0 && standing < config::free_access(rule)) {
        // Standing is between min_access and free_access -- must pay toll
        assert!(coin::value(&payment) >= toll, EInsufficientPayment);

        let fee_coin = coin::split(&mut payment, toll, ctx);
        let recipient = config::toll_recipient(rule);
        transfer::public_transfer(fee_coin, recipient);

        toll_paid = toll;

        event::emit(TollCollectedEvent {
            gate_id,
            payer: ctx.sender(),
            amount: toll,
        });
    };

    // Return change
    if (coin::value(&payment) > 0) {
        transfer::public_transfer(payment, ctx.sender());
    } else {
        coin::destroy_zero(payment);
    };

    let expires_at = clock.timestamp_ms() + config::permit_duration_ms(rule);

    gate::issue_jump_permit<GateStandingsAuth>(
        source_gate,
        destination_gate,
        character,
        GateStandingsAuth {},
        expires_at,
        ctx,
    );

    event::emit(AccessGrantedEvent {
        gate_id,
        character_id: char_id,
        toll_paid,
    });
}
