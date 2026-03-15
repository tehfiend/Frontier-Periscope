/// Turret extension: configurable priority-based targeting.
///
/// Implements friend/foe identification and threat-based priority weighting.
/// Configuration is baked into module constants at compile time — to change
/// targeting rules, republish the package and re-authorize on the turret.
///
/// Priority logic (evaluated per candidate):
///   1. Friendly check: if candidate's tribe or character ID is in the
///      friendly list AND they are NOT attacking → weight 0 (never shoot)
///   2. Betrayal check: if candidate IS in the friendly list but IS attacking
///      → KOS_WEIGHT + AGGRESSOR_BONUS + BETRAYAL_BONUS (highest priority —
///      a spy inside your perimeter is the most dangerous threat)
///   3. KOS check: if candidate's tribe or character ID is in the
///      KOS list → KOS_WEIGHT (shoot first)
///   4. Aggressor bonus: if candidate is_aggressor → +AGGRESSOR_BONUS
///   5. Low HP bonus: if candidate hp_ratio < LOW_HP_THRESHOLD → +LOW_HP_BONUS
///   6. Ship class bonus: if candidate group_id matches turret effectiveness → +CLASS_BONUS
///   7. Default: DEFAULT_WEIGHT for unlisted, non-special targets
///
/// Weights are summed. Highest total weight = turret's target. Ties broken
/// by candidate list order (first in list wins).
///
/// To customize: edit the constants in the `config` section below, then
/// publish a new package via `sui client publish --build-env testnet` and
/// authorize on your turret.
module turret_priority::turret_priority;

use sui::{bcs, event};
use world::{character::Character, turret::{Self, Turret, OnlineReceipt}};

#[error(code = 0)]
const EInvalidOnlineReceipt: vector<u8> = b"Invalid online receipt";

/// Typed witness for extension authorization.
public struct TurretPriorityAuth has drop {}

public struct PriorityListUpdatedEvent has copy, drop {
    turret_id: ID,
    target_count: u64,
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIG — Edit these constants to customize targeting behaviour.
// After editing, republish the package and re-authorize on your turret.
// ══════════════════════════════════════════════════════════════════════════

// ── Weight constants ────────────────────────────────────────────────────
// Base weight for unlisted targets (not friendly, not KOS).
const DEFAULT_WEIGHT: u64 = 30;
// Weight assigned to KOS targets (overrides default).
const KOS_WEIGHT: u64 = 100;
// Bonus added when target is actively attacking.
const AGGRESSOR_BONUS: u64 = 40;
// Bonus for a "friendly" who is attacking — traitor/spy gets maximum priority.
// Stacks on top of KOS_WEIGHT + AGGRESSOR_BONUS, making them THE top target.
const BETRAYAL_BONUS: u64 = 50;
// Bonus added when target HP is below LOW_HP_THRESHOLD.
const LOW_HP_BONUS: u64 = 20;
// HP percentage threshold (0-100) below which LOW_HP_BONUS applies.
const LOW_HP_THRESHOLD: u64 = 40;
// Bonus added when target ship class matches turret effectiveness.
const CLASS_BONUS: u64 = 25;

// ── Friendly tribes (weight → 0, never shoot) ──────────────────────────
// Add your tribe ID and allied tribe IDs here.
// Example: const FRIENDLY_TRIBE_0: u32 = 42;
// Set to 0 to disable a slot.
const FRIENDLY_TRIBE_0: u32 = 0;
const FRIENDLY_TRIBE_1: u32 = 0;
const FRIENDLY_TRIBE_2: u32 = 0;
const FRIENDLY_TRIBE_3: u32 = 0;
const FRIENDLY_TRIBE_4: u32 = 0;
const FRIENDLY_TRIBE_5: u32 = 0;
const FRIENDLY_TRIBE_6: u32 = 0;
const FRIENDLY_TRIBE_7: u32 = 0;

// ── Friendly characters (weight → 0, never shoot) ──────────────────────
// Individual character IDs to never target (e.g., alts, specific allies).
// Set to 0 to disable a slot.
const FRIENDLY_CHAR_0: u64 = 0;
const FRIENDLY_CHAR_1: u64 = 0;
const FRIENDLY_CHAR_2: u64 = 0;
const FRIENDLY_CHAR_3: u64 = 0;
const FRIENDLY_CHAR_4: u64 = 0;
const FRIENDLY_CHAR_5: u64 = 0;
const FRIENDLY_CHAR_6: u64 = 0;
const FRIENDLY_CHAR_7: u64 = 0;

// ── KOS tribes (weight → KOS_WEIGHT, shoot on sight) ───────────────────
// Tribe IDs to always prioritize.
// Set to 0 to disable a slot.
const KOS_TRIBE_0: u32 = 0;
const KOS_TRIBE_1: u32 = 0;
const KOS_TRIBE_2: u32 = 0;
const KOS_TRIBE_3: u32 = 0;

// ── KOS characters (weight → KOS_WEIGHT, shoot on sight) ───────────────
// Individual character IDs to always prioritize.
// Set to 0 to disable a slot.
const KOS_CHAR_0: u64 = 0;
const KOS_CHAR_1: u64 = 0;
const KOS_CHAR_2: u64 = 0;
const KOS_CHAR_3: u64 = 0;

// ── Ship class effectiveness ────────────────────────────────────────────
// Set the group_id this turret is effective against for CLASS_BONUS.
// Ship class group IDs:
//   31  = Shuttle
//   237 = Corvette
//   25  = Frigate
//   420 = Destroyer
//   26  = Cruiser
//   419 = Combat Battlecruiser
//
// Turret types and their effective targets:
//   Autocannon (92402) → Shuttle (31), Corvette (237)
//   Plasma (92403)     → Frigate (25), Destroyer (420)
//   Howitzer (92484)   → Cruiser (26), Combat Battlecruiser (419)
//
// Set to 0 to disable ship class bonus.
const EFFECTIVE_CLASS_0: u64 = 0;
const EFFECTIVE_CLASS_1: u64 = 0;

// ══════════════════════════════════════════════════════════════════════════
// END CONFIG
// ══════════════════════════════════════════════════════════════════════════

/// Called by the game server via devInspect on behaviour change.
/// Returns BCS-encoded priority list with calculated weights per target.
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
        let char_tribe = candidate.character_tribe();
        let char_id = (candidate.character_id() as u64);
        let group_id = candidate.group_id();

        // 1. Check friendly list
        let is_friendly = is_friendly_tribe(char_tribe) || is_friendly_character(char_id);

        if (is_friendly && !candidate.is_aggressor()) {
            // Friendly and not attacking — safe, weight 0
            return_list.push_back(turret::new_return_target_priority_list(
                candidate.item_id(),
                0,
            ));
            i = i + 1;
            continue
        };

        // 2. Start with base weight
        let mut weight = DEFAULT_WEIGHT;

        // 3. Betrayal check — friendly who IS attacking gets maximum priority.
        // A spy inside your defense perimeter is the most dangerous threat.
        if (is_friendly && candidate.is_aggressor()) {
            weight = KOS_WEIGHT + AGGRESSOR_BONUS + BETRAYAL_BONUS;
            // Skip remaining checks — traitor is already max priority
            return_list.push_back(turret::new_return_target_priority_list(
                candidate.item_id(),
                weight,
            ));
            i = i + 1;
            continue
        };

        // 4. KOS check — override base weight
        let is_kos = is_kos_tribe(char_tribe) || is_kos_character(char_id);
        if (is_kos) {
            weight = KOS_WEIGHT;
        };

        // 5. Aggressor bonus
        if (candidate.is_aggressor()) {
            weight = weight + AGGRESSOR_BONUS;
        };

        // 6. Low HP bonus — hp_ratio() not available in world-contracts v0.0.18.
        // When CCP exposes hp_ratio on TargetCandidate, uncomment:
        // if (candidate.hp_ratio() < LOW_HP_THRESHOLD && candidate.hp_ratio() > 0) {
        //     weight = weight + LOW_HP_BONUS;
        // };

        // 7. Ship class effectiveness bonus
        if (is_effective_class(group_id)) {
            weight = weight + CLASS_BONUS;
        };

        return_list.push_back(turret::new_return_target_priority_list(
            candidate.item_id(),
            weight,
        ));

        i = i + 1;
    };

    let result = bcs::to_bytes(&return_list);

    turret::destroy_online_receipt(receipt, TurretPriorityAuth {});

    event::emit(PriorityListUpdatedEvent {
        turret_id: object::id(turret),
        target_count: len,
    });

    result
}

// ── Lookup helpers ──────────────────────────────────────────────────────
// Linear scan through constant slots. Slots set to 0 are ignored.

fun is_friendly_tribe(tribe: u32): bool {
    if (tribe == 0) return false;
    (FRIENDLY_TRIBE_0 != 0 && tribe == FRIENDLY_TRIBE_0) ||
    (FRIENDLY_TRIBE_1 != 0 && tribe == FRIENDLY_TRIBE_1) ||
    (FRIENDLY_TRIBE_2 != 0 && tribe == FRIENDLY_TRIBE_2) ||
    (FRIENDLY_TRIBE_3 != 0 && tribe == FRIENDLY_TRIBE_3) ||
    (FRIENDLY_TRIBE_4 != 0 && tribe == FRIENDLY_TRIBE_4) ||
    (FRIENDLY_TRIBE_5 != 0 && tribe == FRIENDLY_TRIBE_5) ||
    (FRIENDLY_TRIBE_6 != 0 && tribe == FRIENDLY_TRIBE_6) ||
    (FRIENDLY_TRIBE_7 != 0 && tribe == FRIENDLY_TRIBE_7)
}

fun is_friendly_character(char_id: u64): bool {
    if (char_id == 0) return false;
    (FRIENDLY_CHAR_0 != 0 && char_id == FRIENDLY_CHAR_0) ||
    (FRIENDLY_CHAR_1 != 0 && char_id == FRIENDLY_CHAR_1) ||
    (FRIENDLY_CHAR_2 != 0 && char_id == FRIENDLY_CHAR_2) ||
    (FRIENDLY_CHAR_3 != 0 && char_id == FRIENDLY_CHAR_3) ||
    (FRIENDLY_CHAR_4 != 0 && char_id == FRIENDLY_CHAR_4) ||
    (FRIENDLY_CHAR_5 != 0 && char_id == FRIENDLY_CHAR_5) ||
    (FRIENDLY_CHAR_6 != 0 && char_id == FRIENDLY_CHAR_6) ||
    (FRIENDLY_CHAR_7 != 0 && char_id == FRIENDLY_CHAR_7)
}

fun is_kos_tribe(tribe: u32): bool {
    if (tribe == 0) return false;
    (KOS_TRIBE_0 != 0 && tribe == KOS_TRIBE_0) ||
    (KOS_TRIBE_1 != 0 && tribe == KOS_TRIBE_1) ||
    (KOS_TRIBE_2 != 0 && tribe == KOS_TRIBE_2) ||
    (KOS_TRIBE_3 != 0 && tribe == KOS_TRIBE_3)
}

fun is_kos_character(char_id: u64): bool {
    if (char_id == 0) return false;
    (KOS_CHAR_0 != 0 && char_id == KOS_CHAR_0) ||
    (KOS_CHAR_1 != 0 && char_id == KOS_CHAR_1) ||
    (KOS_CHAR_2 != 0 && char_id == KOS_CHAR_2) ||
    (KOS_CHAR_3 != 0 && char_id == KOS_CHAR_3)
}

fun is_effective_class(group_id: u64): bool {
    if (group_id == 0) return false;
    (EFFECTIVE_CLASS_0 != 0 && group_id == EFFECTIVE_CLASS_0) ||
    (EFFECTIVE_CLASS_1 != 0 && group_id == EFFECTIVE_CLASS_1)
}
