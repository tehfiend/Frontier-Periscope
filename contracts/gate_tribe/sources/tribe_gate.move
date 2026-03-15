/// Gate extension: tribe-restricted access control.
///
/// Only characters belonging to allowed tribes can receive a jump permit.
/// Config is stored per-gate in a shared ExtensionConfig object.
///
/// Flow:
///   1. Owner publishes this package once per tenant
///   2. Owner calls `gate::authorize_extension<TribeGateAuth>(gate, owner_cap)`
///   3. Owner calls `config::set_gate_config(config, gate_id, tribes, duration)`
///   4. When a character attempts to jump, the game calls `can_jump`
///   5. If the character's tribe is in the allowed list, a jump permit is issued
module gate_tribe::tribe_gate;

use sui::clock::Clock;
use world::{character::Character, gate::{Self, Gate}};
use gate_tribe::config::{Self, ExtensionConfig};

#[error(code = 0)]
const ETribeNotAllowed: vector<u8> = b"Character tribe not in allowed list";

#[error(code = 1)]
const EGateNotConfigured: vector<u8> = b"Gate has no tribe config set";

/// Typed witness for extension authorization.
public struct TribeGateAuth has drop {}

/// Called by the game server when a character attempts to use this gate.
/// Issues a jump permit if the character's tribe is in the allowed list.
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

    let gate_config = config::get_gate_config(config, gate_id);
    let allowed = config::allowed_tribes(gate_config);
    let char_tribe = character.tribe();

    // Check if character's tribe is in the allowed list
    let mut found = false;
    let mut i = 0;
    let len = allowed.length();
    while (i < len) {
        if (allowed[i] == char_tribe) {
            found = true;
            break
        };
        i = i + 1;
    };
    assert!(found, ETribeNotAllowed);

    let permit_duration = config::permit_duration_ms(gate_config);
    let expires_at = clock.timestamp_ms() + permit_duration;

    gate::issue_jump_permit<TribeGateAuth>(
        source_gate,
        destination_gate,
        character,
        TribeGateAuth {},
        expires_at,
        ctx,
    );
}
