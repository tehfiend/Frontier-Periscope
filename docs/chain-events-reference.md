# EVE Frontier Chain Events Reference

Exhaustive catalog of all blockchain events available for Chain Sonar monitoring.
Source: world-contracts v0.0.18, deployed extension contracts, Move source analysis.

---

## How Events Work

- All events use `sui::event::emit()` and are indexed at transaction finality on Sui testnet
- Events are queried via GraphQL: `events(filter: { eventType: "{pkg}::{module}::{Event}" })`
- Move type format: `{worldPackageId}::{module}::{EventStructName}`
- Extension events use their own package ID, not the world package
- Pagination: cursor-based (`after`/`endCursor`), default limit 50 per request
- Current chain sonar polls every 15 seconds using `queryEventsGql()`

### Package IDs

| Tenant | World Package | EVE Package |
|--------|--------------|-------------|
| Stillness | `0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c` | `0x2a66a89b5a735738ffa4423ac024d23571326163f324f9051557617319e59d60` |
| Utopia | `0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75` | `0xf0446b93345c1118f21239d7ac58fb82d005219b2016e100f074e4d17162a465` |

### Extension Package IDs (Stillness)

| Contract | Package ID |
|----------|-----------|
| turret_shoot_all | `0x4ad1a19064c1d44dbb6844862f5de4e28fd4a38c3a1bc7531581e39b4f3294b9` |
| turret_priority | `0xbbca3a051fd616da4ebb34b4f67bf6d7111a32904e7fc4da29acd9a9b2bbb5ef` |
| gate_acl | `0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c` |
| gate_tribe | `0x7ce73cdc22d21410794818a31522bc85c25ef97c3685214796f7347d76fd3298` |
| gate_toll | `0xcef451bbe80afd7e495d5de87ace2989097731534ac100d0785f91a427e1f6a8` |
| gate_unified | `0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f` |
| exchange | `0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d` |
| market | `0x1755eaaebe4335fcf5f467dfaab73ba21047bdfbda1d97425e6a2cb961a055f4` |
| ssu_market | `0x35c690bb9d049b78856e990bfe439709d098922de369d0f959a1b9737b6b824e` |
| bounty_board | `0xf55f7830828c66d6402add527e9e4ff9190aaae52bbb7ab723d24f455021b4bf` |
| lease | `0x9920aff314ff7dd22e86488fd44e9db7af55479a7f2240f06c97ded05c7bc7ce` |
| acl_registry | *(deployed separately per-user)* |

---

## Category 1: Inventory Events (Currently Monitored)

These 5 events are the only ones currently monitored by chain sonar.

### ItemDepositedEvent
- **Module:** `world::inventory`
- **Move Type:** `{worldPkg}::inventory::ItemDepositedEvent`
- **Emitted When:** Player deposits an item into an SSU's extension inventory
- **Trigger:** `inventory::deposit_item()`, `storage_unit::deposit_item<Auth>()`

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Sui object ID of the storage unit |
| `assembly_key` | `TenantItemId` | `{ item_id: u64, tenant: String }` |
| `character_id` | `ID` | Sui object ID of the depositing character |
| `character_key` | `TenantItemId` | Character's tenant+item_id |
| `item_id` | `u64` | In-game item instance ID |
| `type_id` | `u64` | Item type (e.g., 77800 = Common Ore) |
| `quantity` | `u32` | Number of items deposited |

### ItemWithdrawnEvent
- **Module:** `world::inventory`
- **Move Type:** `{worldPkg}::inventory::ItemWithdrawnEvent`
- **Emitted When:** Player withdraws items from an SSU's extension inventory
- **Trigger:** `inventory::withdraw_item()`, `storage_unit::withdraw_item<Auth>()`

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Storage unit object ID |
| `assembly_key` | `TenantItemId` | Storage unit tenant+item_id |
| `character_id` | `ID` | Withdrawing character object ID |
| `character_key` | `TenantItemId` | Character tenant+item_id |
| `item_id` | `u64` | Item instance ID |
| `type_id` | `u64` | Item type ID |
| `quantity` | `u32` | Number withdrawn |

### ItemMintedEvent
- **Module:** `world::inventory`
- **Move Type:** `{worldPkg}::inventory::ItemMintedEvent`
- **Emitted When:** Game server bridges items from game -> chain (mints on-chain representation)
- **Trigger:** `inventory::mint_items()` (admin/game server only)

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Target storage unit |
| `assembly_key` | `TenantItemId` | Storage unit tenant+item_id |
| `character_id` | `ID` | Character receiving the mint |
| `character_key` | `TenantItemId` | Character tenant+item_id |
| `item_id` | `u64` | Item instance ID |
| `type_id` | `u64` | Item type ID |
| `quantity` | `u32` | Number minted |

### ItemBurnedEvent
- **Module:** `world::inventory`
- **Move Type:** `{worldPkg}::inventory::ItemBurnedEvent`
- **Emitted When:** Items burned from chain -> game bridge (removes on-chain representation)
- **Trigger:** `inventory::burn_items()`, `inventory::burn_items_with_proof()`

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Source storage unit |
| `assembly_key` | `TenantItemId` | Storage unit tenant+item_id |
| `character_id` | `ID` | Character burning items |
| `character_key` | `TenantItemId` | Character tenant+item_id |
| `item_id` | `u64` | Item instance ID |
| `type_id` | `u64` | Item type ID |
| `quantity` | `u32` | Number burned |

### ItemDestroyedEvent
- **Module:** `world::inventory`
- **Move Type:** `{worldPkg}::inventory::ItemDestroyedEvent`
- **Emitted When:** Entire inventory deleted -- all items destroyed (unanchor/destroy flow)
- **Trigger:** `inventory::delete()`
- **Note:** No character_id -- destruction is administrative, not player-initiated

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Storage unit being destroyed |
| `assembly_key` | `TenantItemId` | Storage unit tenant+item_id |
| `item_id` | `u64` | Item instance ID |
| `type_id` | `u64` | Item type ID |
| `quantity` | `u32` | Number destroyed |

---

## Category 2: Assembly Lifecycle Events

### AssemblyCreatedEvent
- **Module:** `world::assembly`
- **Move Type:** `{worldPkg}::assembly::AssemblyCreatedEvent`
- **Emitted When:** Generic assembly anchored (admin only)
- **Sonar Use:** Detect new structure deployments in your area

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | New assembly's Sui object ID |
| `assembly_key` | `TenantItemId` | Tenant+item_id |
| `owner_cap_id` | `ID` | OwnerCap object for this assembly |
| `type_id` | `u64` | Assembly type (see type IDs below) |

### StorageUnitCreatedEvent
- **Module:** `world::storage_unit`
- **Move Type:** `{worldPkg}::storage_unit::StorageUnitCreatedEvent`
- **Emitted When:** SSU/Protocol Depot anchored
- **Sonar Use:** Detect new storage units near you

| Field | Type | Description |
|-------|------|-------------|
| `storage_unit_id` | `ID` | New SSU's Sui object ID |
| `assembly_key` | `TenantItemId` | Tenant+item_id |
| `owner_cap_id` | `ID` | OwnerCap object ID |
| `type_id` | `u64` | 77917 (SSU), 85249 (Protocol Depot), etc. |
| `max_capacity` | `u64` | Inventory capacity |
| `location_hash` | `vector<u8>` | Poseidon2 location hash |
| `status` | `Status` | Initial status (NULL/OFFLINE) |

### GateCreatedEvent
- **Module:** `world::gate`
- **Move Type:** `{worldPkg}::gate::GateCreatedEvent`
- **Emitted When:** Gate anchored (admin)

| Field | Type | Description |
|-------|------|-------------|
| `gate_id` | `ID` | Gate Sui object ID |
| `gate_key` | `TenantItemId` | Tenant+item_id |
| `owner_cap_id` | `ID` | OwnerCap object ID |
| `type_id` | `u64` | Gate type (88086, 84955) |
| `location_hash` | `vector<u8>` | Poseidon2 location hash |
| `status` | `Status` | Initial status |

### TurretCreatedEvent
- **Module:** `world::turret`
- **Move Type:** `{worldPkg}::turret::TurretCreatedEvent`
- **Emitted When:** Turret anchored (admin)

| Field | Type | Description |
|-------|------|-------------|
| `turret_id` | `ID` | Turret Sui object ID |
| `turret_key` | `TenantItemId` | Tenant+item_id |
| `owner_cap_id` | `ID` | OwnerCap object ID |
| `type_id` | `u64` | Turret type |

### NetworkNodeCreatedEvent
- **Module:** `world::network_node`
- **Move Type:** `{worldPkg}::network_node::NetworkNodeCreatedEvent`
- **Emitted When:** Network node anchored (admin)

| Field | Type | Description |
|-------|------|-------------|
| `network_node_id` | `ID` | Node Sui object ID |
| `assembly_key` | `TenantItemId` | Tenant+item_id |
| `owner_cap_id` | `ID` | OwnerCap object ID |
| `type_id` | `u64` | Node type (88092) |
| `fuel_max_capacity` | `u64` | Max fuel units |
| `fuel_burn_rate_in_ms` | `u64` | Fuel consumption rate |
| `max_energy_production` | `u64` | Energy output capacity |

### StatusChangedEvent
- **Module:** `world::status`
- **Move Type:** `{worldPkg}::status::StatusChangedEvent`
- **Emitted When:** Any assembly changes status (anchor, online, offline, unanchor)
- **Sonar Use:** Detect when structures go online/offline, new anchoring, destruction

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Assembly Sui object ID |
| `assembly_key` | `TenantItemId` | Tenant+item_id |
| `status` | `Status` | New status: `NULL`, `OFFLINE`, `ONLINE` |
| `action` | `Action` | What triggered: `ANCHORED`, `ONLINE`, `OFFLINE`, `UNANCHORED` |

### MetadataChangedEvent
- **Module:** `world::metadata`
- **Move Type:** `{worldPkg}::metadata::MetadataChangedEvent`
- **Emitted When:** Assembly name/description/url updated
- **Sonar Use:** Detect structure renaming

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Assembly Sui object ID |
| `assembly_key` | `TenantItemId` | Tenant+item_id |
| `name` | `String` | Current name |
| `description` | `String` | Current description |
| `url` | `String` | Current URL |

---

## Category 3: Gate & Travel Events

### JumpEvent
- **Module:** `world::gate`
- **Move Type:** `{worldPkg}::gate::JumpEvent`
- **Emitted When:** Character jumps through a gate (with or without permit)
- **Sonar Use:** Track player movement, gate traffic, jump frequency
- **High Value:** Core intel event for tracking who goes where

| Field | Type | Description |
|-------|------|-------------|
| `source_gate_id` | `ID` | Origin gate object ID |
| `source_gate_key` | `TenantItemId` | Origin gate tenant+item_id |
| `destination_gate_id` | `ID` | Destination gate object ID |
| `destination_gate_key` | `TenantItemId` | Destination gate tenant+item_id |
| `character_id` | `ID` | Jumping character object ID |
| `character_key` | `TenantItemId` | Character tenant+item_id |

### GateLinkedEvent
- **Module:** `world::gate`
- **Move Type:** `{worldPkg}::gate::GateLinkedEvent`
- **Emitted When:** Two gates are linked by owner
- **Sonar Use:** Detect new jump routes opening

| Field | Type | Description |
|-------|------|-------------|
| `source_gate_id` | `ID` | First gate |
| `source_gate_key` | `TenantItemId` | First gate tenant+item_id |
| `destination_gate_id` | `ID` | Second gate |
| `destination_gate_key` | `TenantItemId` | Second gate tenant+item_id |

### GateUnlinkedEvent
- **Module:** `world::gate`
- **Move Type:** `{worldPkg}::gate::GateUnlinkedEvent`
- **Emitted When:** Gate link severed by owner
- **Sonar Use:** Detect jump routes closing

| Field | Type | Description |
|-------|------|-------------|
| `source_gate_id` | `ID` | First gate |
| `source_gate_key` | `TenantItemId` | First gate tenant+item_id |
| `destination_gate_id` | `ID` | Second gate |
| `destination_gate_key` | `TenantItemId` | Second gate tenant+item_id |

---

## Category 4: Extension Authorization Events

These fire when assembly owners configure extensions on their structures.

### ExtensionAuthorizedEvent (Gate)
- **Module:** `world::gate`
- **Move Type:** `{worldPkg}::gate::ExtensionAuthorizedEvent`
- **Emitted When:** Gate owner authorizes an extension (toll, tribe filter, ACL, etc.)

| Field | Type | Description |
|-------|------|-------------|
| `gate_id` | `ID` | Gate object ID |
| `extension_type` | `TypeName` | Move type of the authorized extension witness |

### ExtensionRemovedEvent (Gate)
- **Module:** `world::gate`
- **Move Type:** `{worldPkg}::gate::ExtensionRemovedEvent`
- **Emitted When:** Gate owner removes an extension

| Field | Type | Description |
|-------|------|-------------|
| `gate_id` | `ID` | Gate object ID |

### ExtensionAuthorizedEvent (StorageUnit)
- **Module:** `world::storage_unit`
- **Move Type:** `{worldPkg}::storage_unit::ExtensionAuthorizedEvent`

| Field | Type | Description |
|-------|------|-------------|
| `storage_unit_id` | `ID` | SSU object ID |
| `extension_type` | `TypeName` | Extension witness type |

### ExtensionRemovedEvent (StorageUnit)
- **Module:** `world::storage_unit`
- **Move Type:** `{worldPkg}::storage_unit::ExtensionRemovedEvent`

| Field | Type | Description |
|-------|------|-------------|
| `storage_unit_id` | `ID` | SSU object ID |

### ExtensionAuthorizedEvent (Turret)
- **Module:** `world::turret`
- **Move Type:** `{worldPkg}::turret::ExtensionAuthorizedEvent`

| Field | Type | Description |
|-------|------|-------------|
| `turret_id` | `ID` | Turret object ID |
| `extension_type` | `TypeName` | Extension witness type |

---

## Category 5: Energy & Fuel Events

### FuelEvent
- **Module:** `world::fuel`
- **Move Type:** `{worldPkg}::fuel::FuelEvent`
- **Emitted When:** Fuel deposited, withdrawn, burning started/stopped, or node destroyed
- **Sonar Use:** Monitor fuel levels on network nodes, detect refueling activity

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Network node object ID |
| `assembly_key` | `TenantItemId` | Node tenant+item_id |
| `type_id` | `u64` | Fuel type ID (see table below) |
| `old_quantity` | `u64` | Previous fuel quantity |
| `new_quantity` | `u64` | New fuel quantity |
| `is_burning` | `bool` | Whether fuel is actively burning |
| `action` | `Action` | One of: `DEPOSITED`, `WITHDRAWN`, `BURNING_STARTED`, `BURNING_STOPPED`, `BURNING_UPDATED`, `DELETED` |

**Fuel Type IDs:**

| Type ID | Name | Efficiency |
|---------|------|-----------|
| 78437 | EU-90 | 90% |
| 78515 | SOF-80 | 80% |
| 78516 | EU-40 | 40% |
| 84868 | D2-40 | 40% |
| 88319 | D2-15 | 15% |
| 88335 | F-10 | 10% |

### FuelEfficiencySetEvent
- **Module:** `world::fuel`
- **Move Type:** `{worldPkg}::fuel::FuelEfficiencySetEvent`
- **Emitted When:** Admin sets fuel efficiency for a type (rare, admin-only)

| Field | Type | Description |
|-------|------|-------------|
| `fuel_type_id` | `u64` | Fuel type |
| `efficiency` | `u64` | Efficiency percentage (10-100) |

### FuelEfficiencyRemovedEvent
- **Module:** `world::fuel`
- **Move Type:** `{worldPkg}::fuel::FuelEfficiencyRemovedEvent`
- **Emitted When:** Admin removes fuel efficiency config

| Field | Type | Description |
|-------|------|-------------|
| `fuel_type_id` | `u64` | Fuel type |

### StartEnergyProductionEvent
- **Module:** `world::energy`
- **Move Type:** `{worldPkg}::energy::StartEnergyProductionEvent`
- **Emitted When:** Network node starts producing energy (node comes online)

| Field | Type | Description |
|-------|------|-------------|
| `energy_source_id` | `ID` | Network node object ID |
| `current_energy_production` | `u64` | Energy now being produced |

### StopEnergyProductionEvent
- **Module:** `world::energy`
- **Move Type:** `{worldPkg}::energy::StopEnergyProductionEvent`
- **Emitted When:** Network node stops energy production (goes offline)

| Field | Type | Description |
|-------|------|-------------|
| `energy_source_id` | `ID` | Network node object ID |

### EnergyReservedEvent
- **Module:** `world::energy`
- **Move Type:** `{worldPkg}::energy::EnergyReservedEvent`
- **Emitted When:** Assembly connects to network node and reserves energy

| Field | Type | Description |
|-------|------|-------------|
| `energy_source_id` | `ID` | Network node object ID |
| `assembly_type_id` | `u64` | Type of assembly reserving energy |
| `energy_reserved` | `u64` | Amount reserved by this assembly |
| `total_reserved_energy` | `u64` | Total reserved across all assemblies |

### EnergyReleasedEvent
- **Module:** `world::energy`
- **Move Type:** `{worldPkg}::energy::EnergyReleasedEvent`
- **Emitted When:** Assembly disconnects from network node, releasing energy

| Field | Type | Description |
|-------|------|-------------|
| `energy_source_id` | `ID` | Network node object ID |
| `assembly_type_id` | `u64` | Type of assembly releasing energy |
| `energy_released` | `u64` | Amount released |
| `total_reserved_energy` | `u64` | Remaining total reserved |

---

## Category 6: Character & Killmail Events

### CharacterCreatedEvent
- **Module:** `world::character`
- **Move Type:** `{worldPkg}::character::CharacterCreatedEvent`
- **Emitted When:** Game server creates a new character (admin)
- **Sonar Use:** Discover new players, map character -> wallet address
- **Note:** Currently used by manifest discovery (`discoverCharactersFromEvents`)

| Field | Type | Description |
|-------|------|-------------|
| `character_id` | `ID` | Character Sui object ID |
| `key` | `TenantItemId` | Character tenant+item_id |
| `tribe_id` | `u32` | Character's tribe/faction |
| `character_address` | `address` | Wallet address controlling this character |

### KillmailCreatedEvent
- **Module:** `world::killmail`
- **Move Type:** `{worldPkg}::killmail::KillmailCreatedEvent`
- **Emitted When:** Kill recorded by game server (ship or structure destruction)
- **Sonar Use:** Kill feed, combat alerts, threat assessment
- **High Value:** Critical intel for security monitoring

| Field | Type | Description |
|-------|------|-------------|
| `key` | `TenantItemId` | Killmail tenant+item_id |
| `killer_id` | `TenantItemId` | Killer's tenant+item_id |
| `victim_id` | `TenantItemId` | Victim's tenant+item_id |
| `reported_by_character_id` | `TenantItemId` | Reporter's tenant+item_id |
| `loss_type` | `LossType` | `SHIP` (1) or `STRUCTURE` (2) |
| `kill_timestamp` | `u64` | When the kill happened (ms epoch) |
| `solar_system_id` | `TenantItemId` | System where kill occurred |

---

## Category 7: Location Events

### LocationRevealedEvent
- **Module:** `world::location`
- **Move Type:** `{worldPkg}::location::LocationRevealedEvent`
- **Emitted When:** Game server publishes structure coordinates on-chain after player clicks "Publish Location" in-game
- **Sonar Use:** Map structure locations, spatial awareness, manifest location cache
- **Trigger:** Player clicks "Publish Location" in game client -> game server calls `{assembly_type}::reveal_location()` -> verifies `AdminACL` -> stores `Coordinates` in `LocationRegistry` -> emits event
- **Note:** Available on all assembly types: Assembly, Gate, StorageUnit, Turret, NetworkNode. Admin-only (game server) operation. Coordinates stored permanently in `LocationRegistry` (shared object, `Table<ID, Coordinates>` keyed by assembly object ID). Can be queried via `location::get_location(registry, assembly_id)`.

| Field | Type | Description |
|-------|------|-------------|
| `assembly_id` | `ID` | Assembly object ID |
| `assembly_key` | `TenantItemId` | Tenant+item_id |
| `type_id` | `u64` | Assembly type (77917=SSU, 88086/84955=Gate, etc.) |
| `owner_cap_id` | `ID` | OwnerCap for this assembly |
| `location_hash` | `vector<u8>` | Poseidon2 hash of the location |
| `solarsystem` | `u64` | Solar system ID |
| `x` | `String` | X coordinate (high-precision decimal string) |
| `y` | `String` | Y coordinate (high-precision decimal string) |
| `z` | `String` | Z coordinate (high-precision decimal string) |

---

## Category 8: Turret Combat Events

### PriorityListUpdatedEvent (World)
- **Module:** `world::turret`
- **Move Type:** `{worldPkg}::turret::PriorityListUpdatedEvent`
- **Emitted When:** Turret recalculates targeting priorities (default logic, no extension)
- **Sonar Use:** Monitor turret engagement activity

| Field | Type | Description |
|-------|------|-------------|
| `turret_id` | `ID` | Turret object ID |
| `priority_list` | `vector<TargetCandidate>` | Full targeting list with all candidates |

**TargetCandidate struct:**

| Field | Type | Description |
|-------|------|-------------|
| `item_id` | `u64` | Target's in-game item ID |
| `type_id` | `u64` | Target's ship type |
| `group_id` | `u64` | Ship group (31=Shuttle, 237=Corvette, 25=Frigate, 420=Destroyer, 26=Cruiser, 419=Battlecruiser) |
| `character_id` | `u32` | Target character's in-game ID |
| `character_tribe` | `u32` | Target's tribe/faction |
| `hp_ratio` | `u64` | HP percentage (exists but NO public getter) |
| `shield_ratio` | `u64` | Shield percentage (exists but NO public getter) |
| `armor_ratio` | `u64` | Armor percentage (exists but NO public getter) |
| `is_aggressor` | `bool` | Whether target attacked the turret owner |
| `priority_weight` | `u64` | Computed targeting weight (higher = targeted first) |
| `behaviour_change` | `BehaviourChangeReason` | `UNSPECIFIED`(0), `ENTERED`(1), `STARTED_ATTACK`(2), `STOPPED_ATTACK`(3) |

### PriorityListUpdatedEvent (Extension -- Shoot All)
- **Module:** `turret_shoot_all::turret_shoot_all`
- **Move Type:** `{turretShootAllPkg}::turret_shoot_all::PriorityListUpdatedEvent`
- **Emitted When:** Shoot-all turret recalculates targeting

| Field | Type | Description |
|-------|------|-------------|
| `turret_id` | `ID` | Turret object ID |
| `target_count` | `u64` | Number of targets in priority list |

### PriorityListUpdatedEvent (Extension -- Priority)
- **Module:** `turret_priority::turret_priority`
- **Move Type:** `{turretPriorityPkg}::turret_priority::PriorityListUpdatedEvent`
- **Emitted When:** Priority turret recalculates targeting

| Field | Type | Description |
|-------|------|-------------|
| `turret_id` | `ID` | Turret object ID |
| `target_count` | `u64` | Number of targets in priority list |

---

## Category 9: Market & Trading Events

### SSU Market Events

#### PurchaseEvent (DEPRECATED)
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::PurchaseEvent`
- **Emitted When:** Legacy direct purchase from SSU
- **Note:** Deprecated in favor of sell order system

| Field | Type | Description |
|-------|------|-------------|
| `ssu_id` | `ID` | Storage unit object ID |
| `type_id` | `u64` | Item type purchased |
| `quantity` | `u64` | Amount purchased |
| `total_price` | `u64` | Total cost in EVE |
| `buyer` | `address` | Buyer's wallet address |

#### SellOrderCreatedEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::SellOrderCreatedEvent`
- **Emitted When:** Player lists items for sale at an SSU market
- **Sonar Use:** Track market listings, price discovery

| Field | Type | Description |
|-------|------|-------------|
| `market_id` | `ID` | Market object ID |
| `ssu_id` | `ID` | SSU hosting the market |
| `type_id` | `u64` | Item type for sale |
| `price_per_unit` | `u64` | Price per unit in EVE (9 decimals) |
| `quantity` | `u64` | Number of units listed |
| `seller` | `address` | Seller's wallet address |

#### SellOrderFilledEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::SellOrderFilledEvent`
- **Emitted When:** Buyer purchases from a sell order
- **Sonar Use:** Track trades, volume, price history

| Field | Type | Description |
|-------|------|-------------|
| `market_id` | `ID` | Market object ID |
| `ssu_id` | `ID` | SSU hosting the market |
| `type_id` | `u64` | Item type traded |
| `quantity` | `u64` | Units purchased |
| `total_paid` | `u64` | Total EVE paid |
| `buyer` | `address` | Buyer wallet |
| `seller` | `address` | Seller wallet |

#### SellOrderCancelledEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::SellOrderCancelledEvent`

| Field | Type | Description |
|-------|------|-------------|
| `market_id` | `ID` | Market object ID |
| `ssu_id` | `ID` | SSU hosting the market |
| `type_id` | `u64` | Item type |
| `quantity_cancelled` | `u64` | Units removed from listing |
| `remaining` | `u64` | Units still listed |

#### BuyOrderPostedEvent
- **Module:** `market::market`
- **Move Type:** `{marketPkg}::market::BuyOrderPostedEvent`
- **Emitted When:** Buy order posted to a market

| Field | Type | Description |
|-------|------|-------------|
| `market_id` | `ID` | Market object ID |
| `order_id` | `u64` | Order sequence number |
| `buyer` | `address` | Buyer's wallet address |
| `type_id` | `u64` | Item type wanted |
| `price_per_unit` | `u64` | Bid price in EVE |
| `quantity` | `u64` | Units wanted |

#### BuyOrderFilledEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::BuyOrderFilledEvent`
- **Emitted When:** Player fills a buy order by delivering items

| Field | Type | Description |
|-------|------|-------------|
| `config_id` | `ID` | SsuConfig object ID |
| `ssu_id` | `ID` | SSU where delivery happened |
| `order_id` | `u64` | Order being filled |
| `type_id` | `u64` | Item type delivered |
| `quantity` | `u64` | Units delivered |
| `total_paid` | `u64` | Total EVE paid to seller |
| `seller` | `address` | Delivering player's wallet |

#### TransferEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::TransferEvent`
- **Emitted When:** Items transferred between SSU inventory slots via admin or player functions
- **Added in:** Plan 21 rewrite

| Field | Type | Description |
|-------|------|-------------|
| `config_id` | `ID` | SsuConfig object ID |
| `ssu_id` | `ID` | SSU where transfer happened |
| `from_slot` | `vector<u8>` | Source slot: `b"owner"`, `b"escrow"`, or `b"player"` |
| `to_slot` | `vector<u8>` | Destination slot: `b"owner"`, `b"escrow"`, or `b"player"` |
| `type_id` | `u64` | Item type transferred |
| `quantity` | `u64` | Units transferred |
| `sender` | `address` | Transaction sender wallet |

#### SsuConfigCreatedEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::SsuConfigCreatedEvent`
- **Emitted When:** New SsuConfig created for an SSU

| Field | Type | Description |
|-------|------|-------------|
| `config_id` | `ID` | New SsuConfig object ID |
| `owner` | `address` | Config owner wallet |
| `ssu_id` | `ID` | Associated SSU object ID |

#### DelegateAddedEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::DelegateAddedEvent`
- **Emitted When:** Delegate added to an SsuConfig

| Field | Type | Description |
|-------|------|-------------|
| `config_id` | `ID` | SsuConfig object ID |
| `delegate` | `address` | Delegate wallet added |

#### DelegateRemovedEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::DelegateRemovedEvent`
- **Emitted When:** Delegate removed from an SsuConfig

| Field | Type | Description |
|-------|------|-------------|
| `config_id` | `ID` | SsuConfig object ID |
| `delegate` | `address` | Delegate wallet removed |

#### MarketSetEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::MarketSetEvent`
- **Emitted When:** Market linked to an SsuConfig

| Field | Type | Description |
|-------|------|-------------|
| `config_id` | `ID` | SsuConfig object ID |
| `market_id` | `ID` | Market object ID linked |

#### SellListingCancelledEvent
- **Module:** `ssu_market::ssu_market`
- **Move Type:** `{ssuMarketPkg}::ssu_market::SellListingCancelledEvent`
- **Emitted When:** Sell listing cancelled at an SSU

| Field | Type | Description |
|-------|------|-------------|
| `config_id` | `ID` | SsuConfig object ID |
| `ssu_id` | `ID` | SSU hosting the listing |
| `listing_id` | `u64` | Cancelled listing ID |
| `type_id` | `u64` | Item type |
| `quantity` | `u64` | Units cancelled |

### Exchange Events (Order Book)

#### OrderPlacedEvent
- **Module:** `exchange::exchange`
- **Move Type:** `{exchangePkg}::exchange::OrderPlacedEvent`
- **Emitted When:** Bid or ask placed on an order book

| Field | Type | Description |
|-------|------|-------------|
| `book_id` | `ID` | Order book object ID |
| `order_id` | `u64` | Order sequence number |
| `owner` | `address` | Order placer's wallet |
| `price` | `u64` | Order price |
| `amount` | `u64` | Order amount |
| `is_bid` | `bool` | true = buy, false = sell |

#### OrderCancelledEvent
- **Module:** `exchange::exchange`
- **Move Type:** `{exchangePkg}::exchange::OrderCancelledEvent`

| Field | Type | Description |
|-------|------|-------------|
| `book_id` | `ID` | Order book object ID |
| `order_id` | `u64` | Cancelled order ID |

#### TradeEvent
- **Module:** `exchange::exchange`
- **Move Type:** `{exchangePkg}::exchange::TradeEvent`
- **Note:** Struct defined but NOT currently emitted -- reserved for future match engine

| Field | Type | Description |
|-------|------|-------------|
| `book_id` | `ID` | Order book |
| `bid_order_id` | `u64` | Matched buy order |
| `ask_order_id` | `u64` | Matched sell order |
| `price` | `u64` | Execution price |
| `amount` | `u64` | Matched amount |

---

## Category 10: Bounty Board Events

#### BountyPostedEvent
- **Module:** `bounty_board::bounty_board`
- **Move Type:** `{bountyBoardPkg}::bounty_board::BountyPostedEvent`
- **Emitted When:** Player posts a bounty on a target character

| Field | Type | Description |
|-------|------|-------------|
| `board_id` | `ID` | Bounty board object ID |
| `bounty_id` | `u64` | Bounty sequence number |
| `poster` | `address` | Poster's wallet |
| `target_character_id` | `u64` | Target's in-game character ID |
| `reward_amount` | `u64` | Reward in EVE tokens |
| `expires_at` | `u64` | Expiration timestamp (ms) |

#### BountyClaimedEvent
- **Module:** `bounty_board::bounty_board`
- **Move Type:** `{bountyBoardPkg}::bounty_board::BountyClaimedEvent`
- **Emitted When:** Hunter claims a bounty with killmail proof

| Field | Type | Description |
|-------|------|-------------|
| `board_id` | `ID` | Bounty board object ID |
| `bounty_id` | `u64` | Claimed bounty ID |
| `hunter` | `address` | Hunter's wallet |
| `reward_amount` | `u64` | Reward paid |

#### BountyCancelledEvent
- **Module:** `bounty_board::bounty_board`
- **Move Type:** `{bountyBoardPkg}::bounty_board::BountyCancelledEvent`
- **Emitted When:** Poster cancels their bounty

| Field | Type | Description |
|-------|------|-------------|
| `board_id` | `ID` | Bounty board object ID |
| `bounty_id` | `u64` | Cancelled bounty ID |

---

## Category 11: Gate Extension Events

### TollCollectedEvent (gate_toll)
- **Module:** `gate_toll::gate_toll`
- **Move Type:** `{gateTollPkg}::gate_toll::TollCollectedEvent`
- **Emitted When:** Player pays toll to jump through a toll gate
- **Sonar Use:** Track gate revenue, jump activity

| Field | Type | Description |
|-------|------|-------------|
| `gate_id` | `ID` | Gate object ID |
| `payer` | `address` | Payer's wallet address |
| `amount` | `u64` | Toll amount in EVE tokens |

### TollCollectedEvent (gate_unified)
- **Module:** `gate_unified::gate_unified`
- **Move Type:** `{gateUnifiedPkg}::gate_unified::TollCollectedEvent`

| Field | Type | Description |
|-------|------|-------------|
| `gate_id` | `ID` | Gate object ID |
| `payer` | `address` | Payer's wallet |
| `amount` | `u64` | Toll amount |

### AccessGrantedEvent (gate_unified)
- **Module:** `gate_unified::gate_unified`
- **Move Type:** `{gateUnifiedPkg}::gate_unified::AccessGrantedEvent`
- **Emitted When:** Player granted access through unified gate (after ACL + optional toll check)

| Field | Type | Description |
|-------|------|-------------|
| `gate_id` | `ID` | Gate object ID |
| `character_id` | `u64` | Character's in-game ID |
| `toll_paid` | `u64` | Toll amount (0 if ally/exempt) |

---

## Category 12: Lease Events

### LeaseCreatedEvent
- **Module:** `lease::lease`
- **Move Type:** `{leasePkg}::lease::LeaseCreatedEvent`
- **Emitted When:** Assembly owner leases their structure to a tenant

| Field | Type | Description |
|-------|------|-------------|
| `registry_id` | `ID` | Lease registry object ID |
| `assembly_id` | `ID` | Leased assembly |
| `tenant` | `address` | Tenant's wallet |
| `rate_per_day` | `u64` | Daily rate in EVE tokens |

### RentCollectedEvent
- **Module:** `lease::lease`
- **Move Type:** `{leasePkg}::lease::RentCollectedEvent`
- **Emitted When:** Rent automatically collected from tenant's balance

| Field | Type | Description |
|-------|------|-------------|
| `registry_id` | `ID` | Lease registry |
| `assembly_id` | `ID` | Leased assembly |
| `amount` | `u64` | Rent amount collected |
| `remaining_balance` | `u64` | Tenant's remaining prepaid balance |

### LeaseCancelledEvent
- **Module:** `lease::lease`
- **Move Type:** `{leasePkg}::lease::LeaseCancelledEvent`
- **Emitted When:** Lease terminated (by owner or tenant)

| Field | Type | Description |
|-------|------|-------------|
| `registry_id` | `ID` | Lease registry |
| `assembly_id` | `ID` | Assembly being unleased |
| `refund_amount` | `u64` | Remaining balance refunded to tenant |

---

## Category 13: ACL Registry Events

### AclCreatedEvent
- **Module:** `acl_registry::acl_registry`
- **Move Type:** `{aclRegistryPkg}::acl_registry::AclCreatedEvent`
- **Emitted When:** New ACL created for gate/structure access control
- **Note:** Package ID per-deployer; not a globally shared contract

| Field | Type | Description |
|-------|------|-------------|
| `acl_id` | `ID` | New ACL object ID |
| `name` | `vector<u8>` | ACL name (bytes) |
| `creator` | `address` | Creator's wallet |

### AclUpdatedEvent
- **Module:** `acl_registry::acl_registry`
- **Move Type:** `{aclRegistryPkg}::acl_registry::AclUpdatedEvent`
- **Emitted When:** ACL modified (add/remove tribe, add/remove character, bulk update)

| Field | Type | Description |
|-------|------|-------------|
| `acl_id` | `ID` | Modified ACL object ID |

---

## Shared Data Structures

### TenantItemId
```
{ item_id: u64, tenant: String }
```
Used in most events as `assembly_key`, `character_key`, etc. The `item_id` is the in-game numeric ID. `tenant` is `"stillness"`, `"utopia"`, etc.

### Status (enum)
- `NULL` -- freshly created, not yet initialized
- `OFFLINE` -- anchored but not powered
- `ONLINE` -- powered and operational

### Action (status module enum)
- `ANCHORED` -- structure placed in world
- `ONLINE` -- structure powered up
- `OFFLINE` -- structure powered down
- `UNANCHORED` -- structure removed from world

### Action (fuel module enum)
- `DEPOSITED` -- fuel added
- `WITHDRAWN` -- fuel removed
- `BURNING_STARTED` -- fuel consumption began
- `BURNING_STOPPED` -- fuel consumption paused
- `BURNING_UPDATED` -- fuel updated during consumption
- `DELETED` -- fuel record destroyed

### LossType (killmail enum)
- `SHIP` (value 1) -- player ship destroyed
- `STRUCTURE` (value 2) -- structure destroyed

---

## Implementation Priority for Chain Sonar

### Tier 1 -- High-Value Intel (implement first)
| Event | Why |
|-------|-----|
| **JumpEvent** | Track who's moving where, gate traffic patterns |
| **KillmailCreatedEvent** | Combat alerts, threat assessment, kill feed |
| **StatusChangedEvent** | Structure online/offline, new deployments, destruction |
| **SellOrderFilledEvent** | Trade execution, market activity |
| **BountyPostedEvent** | Bounty alerts for owned characters |

### Tier 2 -- Operational Awareness
| Event | Why |
|-------|-----|
| **FuelEvent** | Fuel monitoring for owned nodes |
| **GateLinkedEvent / GateUnlinkedEvent** | Route topology changes |
| **SellOrderCreatedEvent** | New market listings |
| **BuyOrderPostedEvent / BuyOrderFilledEvent** | Supply/demand signals |
| **TollCollectedEvent** | Gate revenue tracking |

### Tier 3 -- Administrative / Rare
| Event | Why |
|-------|-----|
| **CharacterCreatedEvent** | New player discovery (already used for manifest) |
| **LocationRevealedEvent** | Structure location mapping |
| **ExtensionAuthorizedEvent** | Track who's configuring what |
| **MetadataChangedEvent** | Structure renaming |
| **Energy events** | Node power management |
| **Lease events** | Structure rental tracking |

### Tier 4 -- Specialized
| Event | Why |
|-------|-----|
| **PriorityListUpdatedEvent** | Turret engagement monitoring (very noisy) |
| **ItemDestroyedEvent** | Structure destruction cleanup |
| **FuelEfficiency events** | Admin-only, very rare |
| **AclUpdatedEvent** | ACL changes (per-deployer package) |

---

## Event Count Summary

| Source | Event Types | Notes |
|--------|------------|-------|
| World core modules | 25 | Inventory (5), Status (1), Fuel (3), Energy (4), Gate (5), Assembly (1), StorageUnit (3), Turret (3), NetworkNode (1), Character (1), Killmail (1), Location (1), Metadata (1) |
| SSU Market | 8 | Sell orders (4), Buy orders (2), Org market (1), Legacy purchase (1) |
| Exchange | 3 | Orders (2), Trade (1, not emitted yet) |
| Bounty Board | 3 | Post, claim, cancel |
| Gate Extensions | 3 | Toll collected (2 contracts), Access granted (1) |
| Turret Extensions | 2 | Priority list updated (2 contracts) |
| Lease | 3 | Create, collect, cancel |
| ACL Registry | 2 | Create, update |
| **TOTAL** | **49** | 46 actively emitted, 1 defined but unused (TradeEvent), 2 admin-only rare |
