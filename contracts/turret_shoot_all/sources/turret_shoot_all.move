/// Turret extension: shoot all targets regardless of tribe.
///
/// Returns ALL candidates with equal priority weight, fixing the default
/// behaviour where turrets in starter corp won't fire on same-tribe players.
///
/// Flow:
///   1. Owner publishes this package once per tenant
///   2. Owner calls `turret::authorize_extension<ShootAllAuth>(turret, owner_cap)`
///   3. Game server invokes `get_target_priority_list` via devInspect on behaviour change
///   4. All candidates returned with priority_weight = 100
module turret_shoot_all::turret_shoot_all;

use sui::{bcs, event};
use world::{character::Character, turret::{Self, Turret, OnlineReceipt}};

#[error(code = 0)]
const EInvalidOnlineReceipt: vector<u8> = b"Invalid online receipt";

/// Typed witness for extension authorization.
public struct ShootAllAuth has drop {}

public struct PriorityListUpdatedEvent has copy, drop {
    turret_id: ID,
    target_count: u64,
}

/// Called by the game server via devInspect when a turret behaviour change occurs.
/// Returns BCS-encoded `vector<ReturnTargetPriorityList>` with all candidates at equal weight.
public fun get_target_priority_list(
    turret: &Turret,
    _character: &Character,
    target_candidate_list: vector<u8>,
    receipt: OnlineReceipt,
): vector<u8> {
    assert!(receipt.turret_id() == object::id(turret), EInvalidOnlineReceipt);

    let candidates = turret::unpack_candidate_list(target_candidate_list);
    let mut return_list = vector::empty<turret::ReturnTargetPriorityList>();

    let mut i = 0;
    let len = candidates.length();
    while (i < len) {
        let candidate = &candidates[i];
        return_list.push_back(turret::new_return_target_priority_list(
            candidate.item_id(),
            100, // Equal priority for all targets
        ));
        i = i + 1;
    };

    let result = bcs::to_bytes(&return_list);

    turret::destroy_online_receipt(receipt, ShootAllAuth {});

    event::emit(PriorityListUpdatedEvent {
        turret_id: object::id(turret),
        target_count: len,
    });

    result
}
