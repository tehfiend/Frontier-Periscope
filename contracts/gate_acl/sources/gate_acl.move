/// Gate extension: ACL-based access control (allowlist / denylist).
///
/// Supports both tribe IDs AND character IDs, with allowlist or denylist mode.
/// Replaces the simpler gate_tribe extension with more flexible access control.
///
/// Flow:
///   1. Owner publishes this package once per tenant
///   2. Owner calls `gate::authorize_extension<GateAclAuth>(gate, owner_cap)`
///   3. Any admin calls `config::set_config(config, gate_id, ...)`
///   4. When a character attempts to jump, the game calls `can_jump`
///   5. Allowlist mode: only listed tribes/characters can jump
///      Denylist mode: listed tribes/characters are blocked, everyone else can jump
module gate_acl::gate_acl;

use sui::clock::Clock;
use world::{character::Character, gate::{Self, Gate}, in_game_id};
use gate_acl::config::{Self, ExtensionConfig};

#[error(code = 0)]
const EAccessDenied: vector<u8> = b"Character not authorized to use this gate";

#[error(code = 1)]
const EGateNotConfigured: vector<u8> = b"Gate has no ACL config set";

/// Typed witness for extension authorization.
public struct GateAclAuth has drop {}

/// Called by the game server when a character attempts to use this gate.
/// Checks the character against the ACL and issues a jump permit if allowed.
public fun can_jump(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    config: &ExtensionConfig,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let gate_id = object::id(source_gate);
    assert!(config::has_config(config, gate_id), EGateNotConfigured);

    let acl = config::get_config(config, gate_id);
    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());

    // Check if character is in the ACL lists
    let in_list = config::contains_tribe(acl, char_tribe)
        || config::contains_character(acl, char_id);

    if (config::is_allowlist(acl)) {
        // Allowlist mode: must be in list to pass
        assert!(in_list, EAccessDenied);
    } else {
        // Denylist mode: must NOT be in list to pass
        assert!(!in_list, EAccessDenied);
    };

    let permit_duration = config::permit_duration_ms(acl);
    let expires_at = clock.timestamp_ms() + permit_duration;

    gate::issue_jump_permit<GateAclAuth>(
        source_gate,
        destination_gate,
        character,
        GateAclAuth {},
        expires_at,
        ctx,
    );
}
