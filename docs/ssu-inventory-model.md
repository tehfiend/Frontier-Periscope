# SSU Inventory Model

**Source:** `world::storage_unit` contract (world-contracts v0.0.18+, verified 2026-03-17)

## Overview

StorageUnit inventories are **dynamic fields** keyed by `ID` values stored in the `inventory_keys` vector. There is no fixed "extension inventory" vs "owner inventory" struct — each inventory is a `dynamic_field::Field<ID, Inventory>` on the SSU object, and the **key determines access semantics**.

## Inventory Slots

### 1. SSU Owner Inventory (always exists)

- **Key:** `storage_unit.owner_cap_id` (the SSU's own OwnerCap ID)
- **Created:** At anchor time
- **Access:**
  - Owner: `deposit_by_owner()`, `withdraw_by_owner()` — requires OwnerCap + sender == character address
  - Extension: `deposit_item<Auth>()`, `withdraw_item<Auth>()` — same inventory, requires Auth witness
  - Extension: `deposit_to_owned<Auth>()` — extension can deposit into this inventory for the SSU owner
- **Key insight:** The "extension inventory" and "owner inventory" are the **same inventory**. Extension functions (`deposit_item`, `withdraw_item`) operate on `storage_unit.owner_cap_id`, identical to owner functions.

### 2. Open Storage (created at anchor or lazily)

- **Key:** `blake2b256(bcs(ssu_object_id) + b"open_inventory")` — deterministic, computed via `open_storage_key()`
- **Created:** At anchor time for new SSUs. For older SSUs, created lazily on first `deposit_to_open_inventory()` via `ensure_open_inventory()`.
- **Access:**
  - Extension only: `deposit_to_open_inventory<Auth>()`, `withdraw_from_open_inventory<Auth>()`
  - No direct owner or player access
- **Use case:** Internal extension state — escrow, faucet reserves, automated mechanics. Separate from the "public" inventory so items don't mix.

### 3. Per-Player Owned Inventories (created lazily)

- **Key:** The visiting player's `character.owner_cap_id()` (their Character's OwnerCap ID)
- **Created:** Lazily on first deposit via:
  - `deposit_to_owned<Auth>()` — extension deposits into a specific player's inventory (the `character` argument does NOT need to be the tx sender)
  - `game_item_to_chain_inventory()` — game server bridges items from game to chain for a player
- **Access:**
  - The player who owns the Character: `deposit_by_owner()`, `withdraw_by_owner()` with their OwnerCap
  - The game server: `game_item_to_chain_inventory()`, `chain_item_to_game_inventory()` with server signatures
- **Key insight:** `check_inventory_authorization()` accepts either `OwnerCap<StorageUnit>` (SSU owner) or `OwnerCap<Character>` (visiting player). A player's Character OwnerCap authorizes access to their personal inventory on the SSU.

## How `inventory_keys` Grows

```
At anchor:
  inventory_keys = [owner_cap_id, open_storage_key]

After Player A deposits (via game or extension):
  inventory_keys = [owner_cap_id, open_storage_key, player_a_owner_cap_id]

After Player B deposits:
  inventory_keys = [owner_cap_id, open_storage_key, player_a_owner_cap_id, player_b_owner_cap_id]
```

## Identifying Inventory Types

Given `inventory_keys` and the SSU object, to label each inventory:

1. **Key == `storage_unit.owner_cap_id`** → SSU Owner Inventory (also used by extension)
2. **Key == `blake2b256(bcs(ssu_id) + "open_inventory")`** → Open Storage
3. **Any other key** → Per-Player Inventory (key is that player's Character OwnerCap ID)

## Contract Functions Summary

```move
// Extension-controlled (operates on owner_cap_id inventory)
deposit_item<Auth>(su, character, item, auth, ctx)
withdraw_item<Auth>(su, character, auth, type_id, quantity, ctx): Item

// Extension → specific player's owned inventory (creates if needed)
deposit_to_owned<Auth>(su, character, item, auth, ctx)

// Extension → open storage (creates if needed)
deposit_to_open_inventory<Auth>(su, character, item, auth, ctx)
withdraw_from_open_inventory<Auth>(su, character, auth, type_id, quantity, ctx): Item

// Owner direct (requires OwnerCap + sender == character.character_address())
deposit_by_owner<T>(su, item, character, owner_cap, ctx)
withdraw_by_owner<T>(su, character, owner_cap, type_id, quantity, ctx): Item

// Game server bridging (requires AdminACL sponsor or server registry)
game_item_to_chain_inventory<T>(su, admin_acl, character, owner_cap, item_id, type_id, volume, quantity, ctx)
chain_item_to_game_inventory<T>(su, server_registry, character, owner_cap, type_id, quantity, location_proof, clock, ctx)
```

## Open Storage Key Derivation (TypeScript)

```typescript
import { blake2b } from "@noble/hashes/blake2b";
import { bcs } from "@mysten/sui/bcs";

function openStorageKey(ssuObjectId: string): string {
  const idBytes = bcs.Address.serialize(ssuObjectId).toBytes();
  const suffix = new TextEncoder().encode("open_inventory");
  const combined = new Uint8Array([...idBytes, ...suffix]);
  const digest = blake2b(combined, { dkLen: 32 });
  return "0x" + Array.from(digest).map(b => b.toString(16).padStart(2, "0")).join("");
}
```

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 0 | EStorageUnitTypeIdEmpty | TypeId is empty |
| 1 | EStorageUnitItemIdEmpty | ItemId is empty |
| 2 | EStorageUnitAlreadyExists | Duplicate item ID |
| 3 | EAssemblyNotAuthorized | OwnerCap doesn't match |
| 4 | EExtensionNotAuthorized | Auth witness doesn't match registered extension |
| 5 | EInventoryNotAuthorized | OwnerCap type check failed |
| 6 | ENotOnline | SSU must be online |
| 7 | ETenantMismatch | Cross-tenant item transfer |
| 8 | ENetworkNodeMismatch | Wrong network node |
| 9 | EStorageUnitInvalidState | SSU should be offline |
| 10 | ESenderCannotAccessCharacter | TX sender != character address |
| 11 | EItemParentMismatch | Item not from this SSU |
| 12 | EMetadataNotSet | No metadata on assembly |
| 13 | EExtensionConfigFrozen | Extension config is frozen |
| 14 | EExtensionNotConfigured | Must configure extension before freezing |
| 15 | EOpenStorageNotInitialized | No prior deposit to open storage |
