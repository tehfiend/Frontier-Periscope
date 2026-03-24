/// SSU extension: standings-based inventory access control.
///
/// References a StandingsRegistry to determine if a character can deposit
/// or withdraw items from a storage unit. The extension wraps the world
/// contracts' deposit_item/withdraw_item calls with its own typed witness.
///
/// Flow:
///   1. Owner publishes this package
///   2. Owner calls storage_unit::authorize_extension<SsuStandingsAuth>(ssu, owner_cap)
///   3. Admin sets SSU config: config::set_ssu_config(config, ssu_id, ...)
///   4. Players call deposit_item() or withdraw_item() through this extension
///   5. Extension checks standing against min_deposit/min_withdraw thresholds
module ssu_standings::ssu_standings;

use world::storage_unit::{Self, StorageUnit};
use world::character::Character;
use world::inventory::Item;
use world::in_game_id;
use ssu_standings::config::{Self, SsuStandingsConfig};
use standings_registry::standings_registry::{Self, StandingsRegistry};

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ESsuNotConfigured: vector<u8> = b"SSU has no standings config set";

#[error(code = 1)]
const EAccessDenied: vector<u8> = b"Character standing is below required threshold";

#[error(code = 2)]
const ERegistryMismatch: vector<u8> = b"StandingsRegistry does not match configured registry ID";

// -- Structs --------------------------------------------------------------------

/// Typed witness for SSU extension authorization.
public struct SsuStandingsAuth has drop {}

// -- Entry points ---------------------------------------------------------------

/// Deposit an item into the storage unit's extension inventory.
/// Requires character standing >= min_deposit threshold.
public fun deposit_item(
    storage_unit: &mut StorageUnit,
    character: &Character,
    item: Item,
    config: &SsuStandingsConfig,
    registry: &StandingsRegistry,
    ctx: &mut TxContext,
) {
    let ssu_id = object::id(storage_unit);
    assert!(config::has_ssu_config(config, ssu_id), ESsuNotConfigured);

    let rule = config::get_ssu_config(config, ssu_id);

    // Verify registry matches
    assert!(object::id(registry) == config::registry_id(rule), ERegistryMismatch);

    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());
    let standing = standings_registry::get_standing(registry, char_tribe, char_id);

    // Must meet minimum deposit threshold
    assert!(standing >= config::min_deposit(rule), EAccessDenied);

    // Deposit item via extension auth
    storage_unit::deposit_item<SsuStandingsAuth>(
        storage_unit, character, item, SsuStandingsAuth {}, ctx,
    );
}

/// Withdraw an item from the storage unit's extension inventory.
/// Requires character standing >= min_withdraw threshold.
/// Returns the withdrawn Item.
public fun withdraw_item(
    storage_unit: &mut StorageUnit,
    character: &Character,
    config: &SsuStandingsConfig,
    registry: &StandingsRegistry,
    type_id: u64,
    quantity: u32,
    ctx: &mut TxContext,
): Item {
    let ssu_id = object::id(storage_unit);
    assert!(config::has_ssu_config(config, ssu_id), ESsuNotConfigured);

    let rule = config::get_ssu_config(config, ssu_id);

    // Verify registry matches
    assert!(object::id(registry) == config::registry_id(rule), ERegistryMismatch);

    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());
    let standing = standings_registry::get_standing(registry, char_tribe, char_id);

    // Must meet minimum withdraw threshold
    assert!(standing >= config::min_withdraw(rule), EAccessDenied);

    // Withdraw item via extension auth
    storage_unit::withdraw_item<SsuStandingsAuth>(
        storage_unit, character, SsuStandingsAuth {}, type_id, quantity, ctx,
    )
}
