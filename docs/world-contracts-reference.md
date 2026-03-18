# EVE Frontier World Contracts Reference (v0.0.18)

Source: https://github.com/evefrontier/world-contracts
Package: `world`, edition `2024.beta`, Sui testnet-v1.66.2

## Published Package IDs (chain-id `4c78adac`)

| Environment | Package ID |
|---|---|
| testnet | `0x920e577e1bf078bad19385aaa82e7332ef92b4973dcf8534797b129f9814d631` |
| testnet_internal | `0x353988e063b4683580e3603dbe9e91fefd8f6a06263a646d43fd3a2f3ef6b8c1` |
| testnet_utopia | `0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75` |
| testnet_stillness | `0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c` |

---

## Architecture Overview

Three-layer architecture:

1. **Layer 1: Composable Primitives** — `energy`, `fuel`, `inventory`, `location`, `metadata`, `status`, `in_game_id`. Digital physics of the game world. Package-scoped, not directly exposed to builders.
2. **Layer 2: Game-Defined Assemblies** — `assembly`, `gate`, `storage_unit`, `turret`, `network_node`. Shared objects with capability-based access control. Builders interact at this layer.
3. **Layer 3: Player Extensions** — Custom packages that register typed auth witnesses on assemblies. Type-based authorization: only the defining module can create its witness type.

**Key patterns:**
- All assemblies are shared objects (concurrent access by game + players)
- `AdminACL` for game operations, `OwnerCap<T>` for owner operations
- Locations stored as cryptographic hashes (Poseidon2), verified via server signature proofs
- Deterministic object IDs via `ObjectRegistry` + `TenantItemId`

---

## Module: `world` (world.move)

Minimal top-level module. Creates `GovernorCap` at publish time and transfers to deployer.

```move
public struct GovernorCap has key, store { id: UID }
```

---

## Module: `world::access` (access/access_control.move)

### Structs

| Struct | Abilities | Fields |
|---|---|---|
| `AdminACL` | `key` | `id: UID` |
| `OwnerCap<T: key>` | `key, store` | `id: UID, for_id: ID` |
| `ReturnOwnerCapReceipt` | *(hot potato)* | `owner_cap_id: ID, return_address: address` |
| `ServerAddressRegistry` | `key` | `id: UID, authorized_addresses: VecSet<address>` |

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `EUnauthorizedSponsor` | "Unauthorized sponsor" |
| 1 | `EOwnerCapMismatch` | "OwnerCap does not match the expected ID" |
| 2 | `EReturnAddressMismatch` | "Return address does not match the expected address" |

### Public Functions

```move
// Check if OwnerCap authorizes access to object with given ID
public fun is_authorized<T: key>(owner_cap: &OwnerCap<T>, id: ID): bool

// Verify transaction sender is an authorized sponsor (aborts if not)
public fun verify_sponsor(admin_acl: &AdminACL, ctx: &TxContext)

// Receive an OwnerCap sent to an object (for borrow pattern)
public fun receive_owner_cap<T: key>(parent: &mut UID, ticket: Receiving<OwnerCap<T>>): OwnerCap<T>

// Create a return receipt (pairs with return_owner_cap_to_object)
public fun create_return_receipt(owner_cap_id: ID, return_address: address): ReturnOwnerCapReceipt

// Return borrowed OwnerCap to its parent object
public fun return_owner_cap_to_object<T: key>(
    owner_cap: OwnerCap<T>, receipt: ReturnOwnerCapReceipt, expected_address: address)

// Check if address is in the authorized server list
public fun is_authorized_server(registry: &ServerAddressRegistry, addr: address): bool
```

### Admin Functions

```move
public fun create_owner_cap_by_id<T: key>(id: ID, _: &AdminACL, ctx: &mut TxContext): OwnerCap<T>
public fun transfer_owner_cap<T: key>(owner_cap: OwnerCap<T>, recipient: address)
public fun transfer_admin_acl(admin_acl: AdminACL, recipient: address)
public fun add_authorized_server(registry: &mut ServerAddressRegistry, _: &AdminACL, addr: address, ctx: &TxContext)
public fun remove_authorized_server(registry: &mut ServerAddressRegistry, _: &AdminACL, addr: address, ctx: &TxContext)
```

---

## Module: `world::assembly` (assemblies/assembly.move)

Generic assembly type for structures without specialized behavior.

### Struct

```move
public struct Assembly has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    status: AssemblyStatus,
    location: Location,
    energy_source_id: Option<ID>,
    metadata: Option<Metadata>,
}
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `EAssemblyTypeIdEmpty` | "Assembly type ID cannot be empty" |
| 1 | `EAssemblyItemIdEmpty` | "Assembly item ID cannot be empty" |
| 2 | `EAssemblyAlreadyExists` | "Assembly with this item ID already exists" |
| 3 | `ENotOnline` | "Assembly is not online" |
| 4 | `ENotOffline` | "Assembly is not offline" |
| 5 | `ENetworkNodeMismatch` | "Network node ID does not match" |
| 6 | `EAssemblyNotAuthorized` | "Assembly access not authorized" |
| 7 | `EMetadataNotSet` | "Metadata not set on assembly" |
| 8 | `EAssemblyHasEnergySource` | "Assembly still has energy source" |

### Events

```move
AssemblyCreatedEvent { assembly_id, assembly_key, owner_cap_id, type_id }
```

### Key Functions

```move
// Owner operations (require OwnerCap<Assembly>)
public fun online(assembly, network_node, energy_config, owner_cap)
public fun offline(assembly, mut offline_assemblies, network_node, energy_config): OfflineAssemblies
public fun update_metadata_name(assembly, owner_cap, name)
public fun update_metadata_description(assembly, owner_cap, description)
public fun update_metadata_url(assembly, owner_cap, url)

// View
public fun status(assembly): &AssemblyStatus
public fun location(assembly): &Location
public fun is_online(assembly): bool
public fun owner_cap_id(assembly): ID
public fun energy_source_id(assembly): &Option<ID>
public fun type_id(assembly): u64

// Admin (require AdminACL)
public fun anchor(registry, network_node, character, admin_acl, item_id, type_id, location_hash, ctx): Assembly
public fun share_assembly(assembly, admin_acl, ctx)
public fun unanchor(assembly, network_node, energy_config, admin_acl, ctx)
public fun update_energy_source(assembly, network_node, admin_acl, ctx)
```

---

## Module: `world::gate` (assemblies/gate.move)

### Struct

```move
public struct Gate has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    linked_gate_id: Option<ID>,
    status: AssemblyStatus,
    location: Location,
    energy_source_id: Option<ID>,
    metadata: Option<Metadata>,
    extension: Option<TypeName>,
}
```

### Key Structs

```move
public struct JumpPermit has key { id: UID, character_id: ID, route_hash: vector<u8>, expires_at_timestamp_ms: u64 }
public struct GateDistanceProofMessage has drop { ... } // server-signed distance proof
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `EGateTypeIdEmpty` | "Gate type ID is empty" |
| 1 | `EGateItemIdEmpty` | "Gate item ID is empty" |
| 2 | `EGateAlreadyExists` | "Gate already exists" |
| 3 | `ENotOnline` | "Not online" |
| 4 | `ENotOffline` | "Not offline" |
| 5 | `EExtensionConfigured` | "Extension already configured" |
| 6 | `ENoExtensionConfigured` | "No extension configured" |
| 7 | `EInvalidExtensionType` | "Extension type mismatch" |
| 8 | `ENetworkNodeMismatch` | "Network node mismatch" |
| 9 | `ERouteHashMismatch` | "Route hash mismatch" |
| 10 | `EPermitExpired` | "Permit expired" |
| 11 | `EPermitCharacterMismatch` | "Permit character mismatch" |
| 12 | `EGateNotLinked` | "Gate not linked" |
| 13 | `EGateAlreadyLinked` | "Gate already linked" |
| 14 | `EGateNotAuthorized` | "Gate access not authorized" |
| 15 | `EMetadataNotSet` | "Metadata not set" |
| 16 | `EGateHasEnergySource` | "Gate has energy source" |
| 17 | `EGatesOutOfRange` | "Gates out of range" |

### Events

```move
GateCreatedEvent { gate_id, gate_key, owner_cap_id, type_id }
GateLinkedEvent { source_gate_id, destination_gate_id }
JumpEvent { character_id, source_gate_id, destination_gate_id }
ExtensionAuthorizedEvent { gate_id, extension_type }
ExtensionRemovedEvent { gate_id }
```

### Key Functions

```move
// Extension management (Owner — OwnerCap<Gate>)
public fun authorize_extension<Auth: drop>(gate, owner_cap)
public fun remove_extension(gate, owner_cap)
public fun freeze_extension_config(gate, owner_cap)  // IRREVERSIBLE

// Jump (no extension — admin only)
public fun jump(source_gate, destination_gate, character, admin_acl, ctx)

// Jump with permit (extension flow)
public fun jump_with_permit(source_gate, destination_gate, character, permit, admin_acl, clock, ctx)

// Issue permit (extensions call this with their Auth witness)
public fun issue_jump_permit<Auth: drop>(source_gate, destination_gate, character, auth, expires_at_timestamp_ms, ctx)

// Online/Offline (Owner)
public fun online(gate, network_node, energy_config, owner_cap)
public fun offline(gate, mut offline_assemblies, network_node, energy_config): OfflineAssemblies

// Linking (Admin)
public fun link(source_gate, destination_gate, server_registry, proof_bytes, max_distance, admin_acl, ctx)
public fun unlink(gate, admin_acl, ctx)

// View
public fun status(gate): &AssemblyStatus
public fun location(gate): &Location
public fun is_online(gate): bool
public fun owner_cap_id(gate): ID
public fun linked_gate_id(gate): &Option<ID>
public fun extension_type(gate): TypeName
public fun is_extension_configured(gate): bool
public fun is_extension_frozen(gate): bool
public fun type_id(gate): u64

// Reveal location (Admin — temporary until offchain service)
public fun reveal_location(gate, registry, admin_acl, solarsystem, x, y, z, ctx)
```

### Route Hash

Gates compute `route_hash` as SHA256 of `(source_gate_id || destination_gate_id)`. Permits bind to this hash.

---

## Module: `world::storage_unit` (assemblies/storage_unit.move)

### Struct

```move
public struct StorageUnit has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    status: AssemblyStatus,
    location: Location,
    energy_source_id: Option<ID>,
    inventory: Inventory,              // extension-controlled
    owner_inventory: Inventory,        // owner-controlled
    open_inventory: Inventory,         // code-only (extension deposits/withdraws)
    metadata: Option<Metadata>,
    extension: Option<TypeName>,
}
```

### Three-Inventory Model

| Inventory | Deposit | Withdraw | Access |
|---|---|---|---|
| **Extension** (`inventory`) | `deposit_item<Auth>()` | `withdraw_item<Auth>()` | Auth witness from extension |
| **Owner** (`owner_inventory`) | `deposit_by_owner<T>()` | `withdraw_by_owner<T>()` | OwnerCap + character address |
| **Open** (`open_inventory`) | `deposit_to_open_inventory<Auth>()` | `withdraw_from_open_inventory<Auth>()` | Extension-only, contract-controlled |

Also: `deposit_to_owned<Auth>()` — extension deposits into owner inventory (cross-player transfers)

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `EStorageUnitTypeIdEmpty` | "Type ID empty" |
| 1 | `EStorageUnitItemIdEmpty` | "Item ID empty" |
| 2 | `EStorageUnitAlreadyExists` | "Already exists" |
| 3 | `ENotOnline` | "Not online" |
| 4 | `ENotOffline` | "Not offline" |
| 5 | `EExtensionConfigured` | "Extension already configured" |
| 6 | `ENoExtensionConfigured` | "No extension configured" |
| 7 | `EInvalidExtensionType` | "Extension type mismatch" |
| 8 | `ENetworkNodeMismatch` | "Network node mismatch" |
| 9 | `EStorageUnitNotAuthorized` | "Not authorized" |
| 10 | `EMetadataNotSet` | "Metadata not set" |
| 11 | `EStorageUnitHasEnergySource` | "Has energy source" |

### Events

```move
StorageUnitCreatedEvent { storage_unit_id, storage_unit_key, owner_cap_id, type_id }
ExtensionAuthorizedEvent { storage_unit_id, extension_type }
ExtensionRemovedEvent { storage_unit_id }
```

### Key Functions

```move
// Extension inventory (require Auth witness)
public fun deposit_item<Auth: drop>(su, character, item, auth, ctx)
public fun withdraw_item<Auth: drop>(su, character, type_id, quantity, auth, ctx): Item
public fun deposit_to_owned<Auth: drop>(su, character, item, auth, ctx)  // extension → owner inventory
public fun deposit_to_open_inventory<Auth: drop>(su, character, item, auth, ctx)
public fun withdraw_from_open_inventory<Auth: drop>(su, character, type_id, quantity, auth, ctx): Item

// Owner inventory (require OwnerCap)
public fun deposit_by_owner<T: key>(su, character, owner_cap, item, ctx)
public fun withdraw_by_owner<T: key>(su, character, owner_cap, type_id, quantity, ctx): Item

// Chain ↔ Game bridging (Admin — sig verified)
public fun chain_item_to_game_inventory<T: key>(su, character, owner_cap, type_id, quantity,
    server_registry, location_proof, admin_acl, clock, ctx)
public fun game_item_to_chain_inventory<T: key>(su, character, owner_cap, admin_acl,
    tenant, item_id, type_id, volume, quantity, ctx)

// Extension management (Owner)
public fun authorize_extension<Auth: drop>(su, owner_cap)
public fun remove_extension(su, owner_cap)
public fun freeze_extension_config(su, owner_cap)  // IRREVERSIBLE

// Online/Offline (Owner)
public fun online(su, network_node, energy_config, owner_cap)
public fun offline(su, mut offline_assemblies, network_node, energy_config): OfflineAssemblies

// Metadata (Owner)
public fun update_metadata_name(su, owner_cap, name)
public fun update_metadata_description(su, owner_cap, description)
public fun update_metadata_url(su, owner_cap, url)

// View
public fun status(su): &AssemblyStatus
public fun location(su): &Location
public fun is_online(su): bool
public fun owner_cap_id(su): ID
public fun extension_type(su): TypeName
public fun is_extension_configured(su): bool
public fun is_extension_frozen(su): bool
public fun type_id(su): u64
public fun inventory_contains(su, type_id): bool
public fun owner_inventory_contains(su, type_id): bool
public fun open_inventory_contains(su, type_id): bool
```

---

## Module: `world::turret` (assemblies/turret.move)

### Struct

```move
public struct Turret has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    status: AssemblyStatus,
    location: Location,
    energy_source_id: Option<ID>,
    metadata: Option<Metadata>,
    extension: Option<TypeName>,
}
```

### TargetCandidate (BCS-deserialized)

```move
public struct TargetCandidate has copy, drop, store {
    item_id: u64,
    type_id: u64,
    group_id: u64,
    character_id: u32,
    character_tribe: u32,
    hp_ratio: u64,         // ← EXISTS in struct, NO public getter
    shield_ratio: u64,     // ← EXISTS in struct, NO public getter
    armor_ratio: u64,      // ← EXISTS in struct, NO public getter
    is_aggressor: bool,
    priority_weight: u64,
    behaviour_change: BehaviourChangeReason,
}
```

**BCS field order:** item_id(u64), type_id(u64), group_id(u64), character_id(u32), character_tribe(u32), hp_ratio(u64), shield_ratio(u64), armor_ratio(u64), is_aggressor(bool), priority_weight(u64), behaviour_change(u8)

### BehaviourChangeReason

```move
public enum BehaviourChangeReason has copy, drop, store {
    UNSPECIFIED,       // 0
    ENTERED,           // 1
    STARTED_ATTACK,    // 2
    STOPPED_ATTACK,    // 3
}
```

### OnlineReceipt (hot potato)

```move
public struct OnlineReceipt { turret_id: ID }
// MUST be consumed by: turret::destroy_online_receipt<Auth>(receipt, auth_witness)
```

### ReturnTargetPriorityList

```move
public struct ReturnTargetPriorityList has copy, drop, store {
    target_item_id: u64,
    priority_weight: u64,
}
```

### Constants

```move
const STARTED_ATTACK_WEIGHT_INCREMENT: u64 = 1000;
const ENTERED_WEIGHT_INCREMENT: u64 = 500;
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `ETurretTypeIdEmpty` | "Type ID empty" |
| 1 | `ETurretItemIdEmpty` | "Item ID empty" |
| 2 | `ETurretAlreadyExists` | "Already exists" |
| 3 | `ENotOnline` | "Not online" |
| 4 | `ENotOffline` | "Not offline" |
| 5 | `EExtensionConfigured` | "Extension already configured" |
| 6 | `ENoExtensionConfigured` | "No extension configured" |
| 7 | `EInvalidExtensionType` | "Extension type mismatch" |
| 8 | `ENetworkNodeMismatch` | "Network node mismatch" |
| 9 | `EInvalidOnlineReceipt` | "Invalid online receipt" |
| 10 | `ETurretNotAuthorized` | "Not authorized" |
| 11 | `EMetadataNotSet` | "Metadata not set" |
| 12 | `ETurretHasEnergySource` | "Has energy source" |

### Events

```move
TurretCreatedEvent { turret_id, turret_key, owner_cap_id, type_id }
PriorityListUpdatedEvent { turret_id, priority_list: vector<TargetCandidate> }
```

### Default Targeting Rules (no extension)

The built-in `get_target_priority_list` applies:
1. **Exclude owner** (matching `character_id`)
2. **Exclude same tribe + non-aggressor**
3. **Exclude STOPPED_ATTACK** behaviour
4. **STARTED_ATTACK** → add +1000 to priority weight
5. **ENTERED** (different tribe or aggressor) → add +500 to priority weight
6. Higher weight = higher priority target; ties broken by list order

### Key Functions

```move
// Default targeting (NO extension)
public fun get_target_priority_list(turret, owner_character, target_candidate_list: vector<u8>, receipt): vector<u8>

// Consume OnlineReceipt (extensions MUST call this)
public fun destroy_online_receipt<Auth: drop>(receipt, auth)

// Verify turret is online → get receipt
public fun verify_online(turret): OnlineReceipt

// BCS helpers
public fun unpack_candidate_list(bytes): vector<TargetCandidate>
public fun unpack_priority_list(bytes): vector<TargetCandidate>  // alias
public fun unpack_return_priority_list(bytes): vector<ReturnTargetPriorityList>
public fun peel_target_candidate(bytes): TargetCandidate
public fun new_return_target_priority_list(target_item_id, priority_weight): ReturnTargetPriorityList

// TargetCandidate getters (note: NO getters for hp_ratio, shield_ratio, armor_ratio)
public fun is_aggressor(candidate): bool
public fun item_id(candidate): u64
public fun target_type_id(candidate): u64
public fun group_id(candidate): u64
public fun character_id(candidate): u32
public fun character_tribe(candidate): u32
public fun priority_weight(candidate): u64
public fun behaviour_change(candidate): BehaviourChangeReason

// ReturnTargetPriorityList getters
public fun return_target_item_id(entry): u64
public fun return_priority_weight(entry): u64

// OnlineReceipt getter
public fun turret_id(receipt): ID

// Extension management (Owner)
public fun authorize_extension<Auth: drop>(turret, owner_cap)
public fun remove_extension(turret, owner_cap)
public fun freeze_extension_config(turret, owner_cap)  // IRREVERSIBLE

// Online/Offline (Owner)
public fun online(turret, network_node, energy_config, owner_cap)
public fun offline(turret, mut offline_assemblies, network_node, energy_config): OfflineAssemblies

// View
public fun status(turret): &AssemblyStatus
public fun location(turret): &Location
public fun is_online(turret): bool
public fun owner_cap_id(turret): ID
public fun energy_source_id(turret): &Option<ID>
public fun extension_type(turret): TypeName
public fun is_extension_configured(turret): bool
public fun is_extension_frozen(turret): bool
public fun type_id(turret): u64

// Metadata (Owner)
public fun update_metadata_name(turret, owner_cap, name)
public fun update_metadata_description(turret, owner_cap, description)
public fun update_metadata_url(turret, owner_cap, url)

// Reveal location (Admin — temporary)
public fun reveal_location(turret, registry, admin_acl, solarsystem, x, y, z, ctx)
```

### Ship Group IDs & Turret Specializations

| Ship Class | Group ID |
|---|---|
| Shuttle | 31 |
| Corvette | 237 |
| Frigate | 25 |
| Destroyer | 420 |
| Cruiser | 26 |
| Combat Battlecruiser | 419 |

| Turret Type | Type ID | Specialized Against |
|---|---|---|
| Autocannon | 92402 | Shuttle (31), Corvette (237) |
| Plasma | 92403 | Frigate (25), Destroyer (420) |
| Howitzer | 92484 | Cruiser (26), Combat Battlecruiser (419) |

---

## Module: `world::extension_freeze` (assemblies/extension_freeze.move)

Adds an **irreversible** freeze marker as a dynamic field on an assembly's UID.

```move
public struct ExtensionFrozenMarker has copy, drop, store {}

public(package) fun freeze_extension(id: &mut UID)
public(package) fun is_extension_frozen(id: &UID): bool
public(package) fun remove_frozen_marker_if_present(id: &mut UID)  // only for unanchor cleanup
```

Once frozen, the owner **cannot** change or remove the extension. Only `remove_frozen_marker_if_present` (called during unanchor/destroy) can clean it up.

---

## Module: `world::character` (character/character.move)

### Structs

```move
public struct Character has key {
    id: UID,
    key: TenantItemId,
    tribe_id: u32,
    character_address: address,
    metadata: Option<Metadata>,
    owner_cap_id: ID,
}

// Wallet-owned pointer (transferred to character_address for by-wallet queries)
public struct PlayerProfile has key {
    id: UID,
    character_id: ID,
}
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `EGameCharacterIdEmpty` | "Game character ID is empty" |
| 1 | `ETribeIdEmpty` | "Tribe ID is empty" |
| 2 | `ECharacterAlreadyExists` | "Character already exists" |
| 3 | `ETenantEmpty` | "Tenant name cannot be empty" |
| 4 | `EAddressEmpty` | "Address cannot be empty" |
| 5 | `ESenderCannotAccessCharacter` | "Sender cannot access Character" |
| 6 | `EMetadataNotSet` | "Metadata not set on character" |
| 7 | `ECharacterNotAuthorized` | "Character access not authorized" |

### Events

```move
CharacterCreatedEvent { character_id, key, tribe_id, character_address }
```

### Key Functions

```move
// Borrow-Return OwnerCap pattern
public fun borrow_owner_cap<T: key>(character, owner_cap_ticket: Receiving<OwnerCap<T>>, ctx): (OwnerCap<T>, ReturnOwnerCapReceipt)
public fun return_owner_cap<T: key>(character, owner_cap, receipt)
// NOTE: borrow_owner_cap asserts ctx.sender() == character.character_address

// View
public fun id(character): ID
public fun key(character): TenantItemId
public fun character_address(character): address
public fun tenant(character): String
public fun tribe(character): u32
public fun owner_cap_id(character): ID

// Metadata (Owner)
public fun update_metadata_name(character, owner_cap, name)
public fun update_metadata_description(character, owner_cap, description)
public fun update_metadata_url(character, owner_cap, url)

// Admin
public fun create_character(registry, admin_acl, game_character_id: u32, tenant, tribe_id, character_address, name, ctx): Character
public fun share_character(character, admin_acl, ctx)
public fun update_tribe(character, admin_acl, tribe_id, ctx)
public fun update_address(character, admin_acl, character_address, ctx)
public fun delete_character(character, admin_acl, ctx)
```

---

## Module: `world::energy` (primitives/energy.move)

### Structs

```move
public struct EnergyConfig has key { id: UID, assembly_energy: Table<u64, u64> }
public struct EnergySource has store { max_energy_production: u64, current_energy_production: u64, total_reserved_energy: u64 }
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `ETypeIdEmpty` | "Assembly type id cannot be empty" |
| 1 | `EInvalidEnergyAmount` | "Energy amount must be > 0" |
| 2 | `EIncorrectAssemblyType` | "Energy requirement not configured" |
| 3 | `EInsufficientAvailableEnergy` | "Insufficient available energy" |
| 4 | `EInvalidMaxEnergyProduction` | "Max energy production must be > 0" |
| 5 | `ENotProducingEnergy` | "Not producing energy" |
| 6 | `EProducingEnergy` | "Already producing energy" |

### Events

```move
StartEnergyProductionEvent { energy_source_id, current_energy_production }
StopEnergyProductionEvent { energy_source_id }
EnergyReservedEvent { energy_source_id, assembly_type_id, energy_reserved, total_reserved_energy }
EnergyReleasedEvent { energy_source_id, assembly_type_id, energy_released, total_reserved_energy }
```

### View Functions

```move
public fun assembly_energy(config, type_id): u64
public fun total_reserved_energy(source): u64
public fun available_energy(source): u64
public fun current_energy_production(source): u64
public fun max_energy_production(source): u64
```

### Admin Functions

```move
public fun set_energy_config(config, admin_acl, assembly_type_id, energy_required, ctx)
public fun remove_energy_config(config, admin_acl, assembly_type_id, ctx)
```

---

## Module: `world::fuel` (primitives/fuel.move)

### Constants

```move
const MIN_BURN_RATE_SECONDS: u64 = 60;
const MILLISECONDS_PER_SECOND: u64 = 1000;
const MIN_BURN_RATE_MS: u64 = 60000;
const MIN_FUEL_EFFICIENCY: u64 = 10;
const MAX_FUEL_EFFICIENCY: u64 = 100;
const PERCENTAGE_DIVISOR: u64 = 100;
```

### Structs

```move
public struct FuelConfig has key { id: UID, fuel_efficiency: Table<u64, u64> }
public struct Fuel has store {
    max_capacity: u64, burn_rate_in_ms: u64, type_id: Option<u64>, unit_volume: Option<u64>,
    quantity: u64, is_burning: bool, previous_cycle_elapsed_time: u64,
    burn_start_time: u64, last_updated: u64
}
public enum Action has copy, drop, store { DEPOSITED, WITHDRAWN, BURNING_STARTED, BURNING_STOPPED, BURNING_UPDATED, DELETED }
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `ETypeIdEmtpy` | "Fuel Type Id cannot be empty" |
| 1 | `EInvalidFuelEfficiency` | "Invalid Fuel Efficiency" |
| 2 | `EIncorrectFuelType` | "Fuel Efficiency not configured" |
| 3 | `EInsufficientFuel` | "Insufficient fuel quantity" |
| 4 | `EInvalidDepositQuantity` | "Deposit quantity must be > 0" |
| 5 | `EInvalidWithdrawQuantity` | "Withdraw quantity must be > 0" |
| 6 | `EFuelCapacityExceeded` | "Fuel capacity would be exceeded" |
| 7 | `EInvalidMaxCapacity` | "Max capacity must be > 0" |
| 8 | `EInvalidVolume` | "Volume must be > 0" |
| 9 | `EFuelTypeMismatch` | "Cannot deposit different fuel type" |
| 10 | `EInvalidBurnRate` | "Burn rate below minimum" |
| 11 | `EFuelNotBurning` | "Not burning" |
| 12 | `EFuelAlreadyBurning` | "Already burning" |
| 13 | `ENoFuelToBurn` | "No fuel to burn" |

### Events

```move
FuelEvent { assembly_id, assembly_key, type_id, old_quantity, new_quantity, is_burning, action }
FuelEfficiencySetEvent { fuel_type_id, efficiency }
FuelEfficiencyRemovedEvent { fuel_type_id }
```

### View Functions

```move
public fun fuel_efficiency(config, fuel_type_id): u64
public fun quantity(fuel): u64
public fun type_id(fuel): Option<u64>
public fun volume(fuel): Option<u64>
public fun is_burning(fuel): bool
public fun has_enough_fuel(fuel, config, clock): bool
public fun need_update(fuel, config, clock): bool
```

### Fuel Burn Formula

`actualConsumptionRate = burn_rate_in_ms * (fuel_efficiency / 100)`

Named fuels: EU-90 (90%), SOF-80 (80%), EU-40 (40%), D2 (15%)

---

## Module: `world::in_game_id` (primitives/in_game_id.move)

```move
public struct TenantItemId has copy, drop, store { item_id: u64, tenant: String }

public fun item_id(key: &TenantItemId): u64
public fun tenant(key: &TenantItemId): String
public(package) fun create_key(item_id: u64, tenant: String): TenantItemId
```

---

## Module: `world::inventory` (primitives/inventory.move)

### Structs

```move
public struct Inventory has store { max_capacity: u64, used_capacity: u64, items: VecMap<u64, ItemEntry> }
public struct ItemEntry has copy, drop, store { tenant: String, type_id: u64, item_id: u64, volume: u64, quantity: u32 }
public struct Item has key, store { id: UID, parent_id: ID, tenant: String, type_id: u64, item_id: u64, volume: u64, quantity: u32, location: Location }
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `ETypeIdEmpty` | "Type ID cannot be empty" |
| 1 | `EInventoryInvalidCapacity` | "Capacity cannot be 0" |
| 2 | `EInventoryInsufficientCapacity` | "Insufficient capacity" |
| 3 | `EItemDoesNotExist` | "Item not found" |
| 4 | `EInventoryInsufficientQuantity` | "Insufficient quantity" |
| 6 | `ETypeIdMismatch` | "Type ID must match for join" |
| 7 | `ESplitQuantityInvalid` | "Split quantity invalid" |

### Events

```move
ItemMintedEvent { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemBurnedEvent { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemDepositedEvent { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemWithdrawnEvent { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemDestroyedEvent { assembly_id, assembly_key, item_id, type_id, quantity }
```

### View Functions

```move
public fun tenant(item): String
public fun contains_item(inventory, type_id): bool
public fun get_item_location_hash(item): vector<u8>
public fun parent_id(item): ID
public fun max_capacity(inventory): u64
public fun type_id(item): u64
public fun quantity(item): u32
```

---

## Module: `world::location` (primitives/location.move)

### Structs

```move
public struct Location has store { location_hash: vector<u8> }
public struct LocationRegistry has key { id: UID, locations: Table<ID, Coordinates> }
public struct Coordinates has copy, drop, store { solarsystem: u64, x: String, y: String, z: String }
public struct LocationProofMessage has drop { server_address, player_address, source_structure_id, source_location_hash, target_structure_id, target_location_hash, distance, data, deadline_ms }
public struct LocationProof has drop { message: LocationProofMessage, signature: vector<u8> }
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `ENotInProximity` | "Not in proximity" |
| 1 | `EInvalidHashLength` | "Invalid SHA256 length" |
| 2 | `EUnverifiedSender` | "Proof not signed for sender" |
| 3 | `EInvalidLocationHash` | "Invalid location hash" |
| 4 | `EUnauthorizedServer` | "Unauthorized server" |
| 5 | `ESignatureVerificationFailed` | "Sig verification failed" |
| 6 | `EDeadlineExpired` | "Deadline expired" |
| 7 | `EOutOfRange` | "Invalid distance" |

### Events

```move
LocationRevealedEvent { assembly_id, assembly_key, type_id, owner_cap_id, location_hash, solarsystem, x, y, z }
```

### Key Functions

```move
public fun create_location_proof(server_address, player_address, source_id, source_hash, target_id, target_hash, distance, data, deadline_ms, signature): LocationProof
public fun verify_proximity(location, proof, server_registry, clock, ctx)
public fun verify_proximity_proof_from_bytes(server_registry, location, proof_bytes, clock, ctx)
public fun verify_distance(location, server_registry, proof_bytes, max_distance, ctx)
public fun verify_same_location(location_a_hash, location_b_hash)
public fun hash(location): vector<u8>
public fun get_location(registry, assembly_id): Option<Coordinates>
public fun solarsystem(coords): u64
public fun x(coords): String
public fun y(coords): String
public fun z(coords): String
```

---

## Module: `world::metadata` (primitives/metadata.move)

```move
public struct Metadata has store { assembly_id: ID, name: String, description: String, url: String }

// Events
MetadataChangedEvent { assembly_id, assembly_key, name, description, url }

// All functions are package-scoped
public(package) fun create_metadata(id, key, name, description, url): Metadata
public(package) fun delete(metadata)
public(package) fun update_name(metadata, key, name)
public(package) fun update_description(metadata, key, description)
public(package) fun update_url(metadata, key, url)
```

---

## Module: `world::status` (primitives/status.move)

```move
public enum Status has copy, drop, store { NULL, OFFLINE, ONLINE }
public enum Action has copy, drop, store { ANCHORED, ONLINE, OFFLINE, UNANCHORED }
public struct AssemblyStatus has store { status: Status }

// Events
StatusChangedEvent { assembly_id, assembly_key, status, action }

// View
public fun status(s): Status
public fun is_online(s): bool

// Package-only lifecycle
public(package) fun anchor(id, key): AssemblyStatus
public(package) fun unanchor(s, id, key)
public(package) fun online(s, id, key)
public(package) fun offline(s, id, key)
```

---

## Module: `world::object_registry` (registry/object_registry.move)

```move
public struct ObjectRegistry has key { id: UID }
public fun object_exists(registry, key: TenantItemId): bool
public(package) fun borrow_registry_id(registry): &mut UID
```

Deterministic object ID derivation: `derived_object::claim(registry_id, tenant_item_id)` → UID.

---

## Module: `world::killmail_registry` (registry/killmail_registry.move)

```move
public struct KillmailRegistry has key { id: UID }
public fun object_exists(registry, key: TenantItemId): bool
public(package) fun borrow_registry_id(registry): &mut UID
```

---

## Module: `world::killmail` (killmail/killmail.move)

```move
public enum LossType has copy, drop, store { SHIP, STRUCTURE }

public struct Killmail has key {
    id: UID, key: TenantItemId, killer_id: TenantItemId, victim_id: TenantItemId,
    reported_by_character_id: TenantItemId, kill_timestamp: u64,
    loss_type: LossType, solar_system_id: TenantItemId
}

// Events
KillmailCreatedEvent { key, killer_id, victim_id, reported_by_character_id, loss_type, kill_timestamp, solar_system_id }

// Admin only
public fun create_killmail(registry, admin_acl, item_id, killer_id, victim_id, reported_by_character, kill_timestamp, loss_type: u8, solar_system_id, ctx)
// loss_type: 1=SHIP, 2=STRUCTURE (0 aborts)
```

---

## Module: `world::network_node` (network_node/network_node.move)

### Struct

```move
public struct NetworkNode has key {
    id: UID, key: TenantItemId, owner_cap_id: ID, type_id: u64,
    status: AssemblyStatus, location: Location, fuel: Fuel,
    energy_source: EnergySource, metadata: Option<Metadata>,
    connected_assembly_ids: vector<ID>
}
```

### Hot Potato Types

```move
public struct OfflineAssemblies { assembly_ids: vector<ID> }
public struct HandleOrphanedAssemblies { assembly_ids: vector<ID> }
public struct UpdateEnergySources { assembly_ids: vector<ID> }
```

### Errors

| Code | Name | Message |
|---|---|---|
| 0 | `ENetworkNodeTypeIdEmpty` | "TypeId empty" |
| 1 | `ENetworkNodeItemIdEmpty` | "ItemId empty" |
| 2 | `ENetworkNodeAlreadyExists` | "Already exists" |
| 3 | `ENetworkNodeNotAuthorized` | "Not authorized" |
| 4 | `EAssemblyAlreadyConnected` | "Already connected" |
| 5 | `EAssemblyNotConnected` | "Not connected" |
| 6 | `EAssembliesConnected` | "Disconnect before unanchor" |
| 7 | `ENetworkNodeOffline` | "Offline" |
| 8 | `EUpdateEnergySourcesNotProcessed` | "Energy sources must be updated" |
| 9 | `EOrphanedAssembliesNotOfflined` | "Orphaned assemblies must be offlined" |
| 10 | `EMetadataNotSet` | "Metadata not set" |

### Events

```move
NetworkNodeCreatedEvent { network_node_id, assembly_key, owner_cap_id, type_id, fuel_max_capacity, fuel_burn_rate_in_ms, max_energy_production }
```

### Key Functions

```move
// Owner (require OwnerCap<NetworkNode>)
public fun deposit_fuel(nwn, admin_acl, owner_cap, type_id, volume, quantity, clock, ctx)
public fun withdraw_fuel(nwn, admin_acl, owner_cap, type_id, quantity, ctx)
public fun online(nwn, owner_cap, clock)
public fun offline(nwn, fuel_config, owner_cap, clock): OfflineAssemblies
public fun update_metadata_name(nwn, owner_cap, name)
public fun update_metadata_description(nwn, owner_cap, description)
public fun update_metadata_url(nwn, owner_cap, url)

// View
public fun connected_assemblies(nwn): vector<ID>
public fun is_assembly_connected(nwn, assembly_id): bool
public fun is_network_node_online(nwn): bool
public fun owner_cap_id(nwn): ID
public fun fuel_quantity(nwn): u64
public fun ids_length(offline): u64
public fun orphaned_assemblies_length(orphaned): u64
public fun update_energy_sources_ids_length(update): u64
public fun need_update(nwn, fuel_config, clock): bool

// Hot potato destroyers
public fun destroy_offline_assemblies(offline)
public fun destroy_update_energy_sources(update)
public fun destroy_orphaned_assemblies(orphaned)

// Admin
public fun anchor(registry, character, admin_acl, item_id, type_id, location_hash, fuel_max_capacity, fuel_burn_rate_in_ms, max_energy_production, ctx): NetworkNode
public fun share_network_node(nwn, admin_acl, ctx)
public fun connect_assemblies(nwn, admin_acl, assembly_ids, ctx): UpdateEnergySources
public fun unanchor(nwn, admin_acl, ctx): HandleOrphanedAssemblies
public fun destroy_network_node(nwn, orphaned, admin_acl, ctx)
public fun update_fuel(nwn, fuel_config, admin_acl, clock, ctx): OfflineAssemblies
public fun reveal_location(nwn, registry, admin_acl, solarsystem, x, y, z, ctx)
```

---

## Module: `world::sig_verify` (crypto/sig_verify.move)

```move
const ED25519_FLAG: u8 = 0x00;
const ED25519_SIG_LEN: u64 = 64;
const ED25519_PK_LEN: u64 = 32;

public fun derive_address_from_public_key(public_key: vector<u8>): address
public fun verify_signature(message: vector<u8>, signature: vector<u8>, expected_address: address): bool
```

**Implementation:** Uses Sui PersonalMessage intent prefix `0x030000` prepended to raw message bytes, then Blake2b256 hash before Ed25519 verification.

---

## Assets Package: `assets::EVE` (EVE.move)

```move
const DECIMALS: u8 = 9;
const TOTAL_SUPPLY: u64 = 10_000_000_000;  // 10B tokens
const INITIAL_DEPLOYER_ALLOCATION: u64 = 10_000_000;  // 10M to deployer
const SCALE: u64 = 1_000_000_000;  // 10^9

public struct EVE has drop {}           // One-time witness
public struct AdminCap has key, store { id: UID }
public struct EveTreasury has key { id: UID, balance: Balance<EVE> }
```

### Functions

```move
public fun complete_registration(registry, currency: Receiving<Currency<EVE>>, ctx)
public fun treasury_balance(treasury): u64
public fun update_description(admin_cap, currency, metadata_cap, description)
public fun update_icon_url(admin_cap, currency, metadata_cap, icon_url)
public fun transfer_from_treasury(treasury, admin_cap, amount, recipient, ctx)
public fun burn_from_treasury(treasury, currency, admin_cap, amount, ctx)
```

---

## Extension Examples

### `extension_examples::config`

Shared `ExtensionConfig` + `AdminCap` + `XAuth` witness. Dynamic field helpers:

```move
public fun has_rule<K>(config, key): bool
public fun borrow_rule<K, V>(config, key): &V
public fun borrow_rule_mut<K, V>(config, admin_cap, key): &mut V
public fun add_rule<K, V>(config, admin_cap, key, value)
public fun set_rule<K, V>(config, admin_cap, key, value)  // upsert
public fun remove_rule<K, V>(config, admin_cap, key): V
```

### `extension_examples::tribe_permit`

Gate extension: checks `character.tribe() == config.tribe`, issues 5-day `JumpPermit<XAuth>`.

### `extension_examples::corpse_gate_bounty`

Gate + StorageUnit extension: withdraws item from player inventory, validates against bounty type, deposits to extension inventory, issues permit.

### `extension_examples::turret`

Turret extension skeleton: receives candidates, returns empty priority list. Shows `destroy_online_receipt(receipt, TurretAuth {})` pattern.

---

## Key Discoveries & Notes

1. **hp_ratio, shield_ratio, armor_ratio** — Fields EXIST on `TargetCandidate` and are deserialized from BCS, but **no public getter functions** are exposed. Extensions cannot read these values through the public API. The game sends them but they're inaccessible to custom turret logic.

2. **Extension freeze is irreversible** — `freeze_extension_config()` adds a dynamic field marker. Cannot be removed except during unanchor (object destruction).

3. **Deterministic object IDs** — All game objects use `derived_object::claim(registry_id, TenantItemId)` for deterministic ID generation. Pre-computable given registry ID and tenant+item_id.

4. **Hot potato pattern** — `OnlineReceipt` (turret), `OfflineAssemblies` (network_node offline), `HandleOrphanedAssemblies` (network_node unanchor), `UpdateEnergySources` (connect assemblies) must all be consumed in the same transaction.

5. **Location privacy** — All locations are Poseidon2 hashes. Proximity verification requires server-signed proofs with deadline. Future: ZK proofs.

6. **Signature verification** — Uses Sui PersonalMessage intent prefix (`0x030000`), Blake2b256 hash, Ed25519.

7. **AdminACL.verify_sponsor()** — Many admin functions require `ctx.sender()` to be an authorized sponsor. This is how the game server authorizes state mutations.

8. **PlayerProfile** — Wallet-owned object pointing at Character. Enables querying characters by wallet address. Described as "temporary" — will be replaced by OwnerCap-to-wallet flow.
