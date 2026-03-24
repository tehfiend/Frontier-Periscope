# Plan: Private Map with Standings-Based Access Control

**Status:** Draft
**Created:** 2026-03-23
**Module:** contracts, chain-shared, periscope

## Overview

The current `private_map` contract uses X25519 encrypted shared objects with per-member `MapInvite` owned objects for access control. This works well for small, curated groups but does not scale -- the map creator must manually invite each member by encrypting the map's private key for their specific wallet-derived public key. For organizations with a StandingsRegistry, this is tedious: if you want to share intel with all allies, you need to invite each one individually and re-key if membership changes.

This plan introduces a new `private_map_standings` contract that adds an **unencrypted map mode** gated by standings. Rather than trying to bolt standings onto the existing encryption model (which is fundamentally incompatible -- you cannot distribute decryption keys to dynamically-changing membership), we create a dual-mode system: maps are either **encrypted** (invite-only, exactly like today) or **cleartext** (standings-gated, locations stored as plaintext). Cleartext maps reference a `StandingsRegistry` and enforce a minimum standing threshold for read/write operations. This gives organizations a way to share intel with everyone who meets their diplomatic threshold without manual key distribution.

This is a big bang replacement -- a completely new contract, not an upgrade of the existing `private_map` package. The existing contract remains on-chain and functional. The Periscope UI will be updated to support both the old encrypted maps (via the existing package) and the new standings-gated maps (via the new package).

## Current State

### Existing `private_map` contract (`contracts/private_map/sources/private_map.move`)
- **PrivateMap** shared object: `name`, `creator`, `public_key` (X25519 32 bytes), `revoked: vector<address>`, `next_location_id: u64`
- **MapInvite** owned object: `map_id`, `sender`, `encrypted_map_key` (map secret key sealed with recipient's X25519 public key)
- **MapLocation** dynamic field: `location_id`, `structure_id: Option<ID>`, `encrypted_data: vector<u8>`, `added_by`, `added_at_ms`
- Functions: `create_map()`, `invite_member()`, `revoke_member()`, `add_location()` (requires MapInvite proof + not revoked), `remove_location()`
- Published at `0x2be1058fa8b002b81d4f91fd33065f17e2a3bbd9799ea0d934b74aaff8160a17`

### Encryption pipeline (chain-shared + Periscope)
- **`packages/chain-shared/src/crypto.ts`**: `deriveMapKeyFromSignature()` (wallet sig -> SHA-256 -> X25519 keypair), `generateEphemeralX25519Keypair()`, `sealForRecipient()` / `unsealWithKey()` (NaCl sealed boxes), `getPublicKeyForAddress()` (extract Ed25519 pub from on-chain TX sigs -> convert to X25519), `encodeLocationData()` / `decodeLocationData()` (JSON serialize location).
- **`packages/chain-shared/src/private-map.ts`**: TX builders (`buildCreateMap`, `buildInviteMember`, `buildAddLocation`, `buildRemoveLocation`, `buildRevokeMember`), query functions (`queryPrivateMap`, `queryMapInvitesForUser`, `queryMapLocations`).
- **`apps/periscope/src/hooks/useStoredEncryptionKey.ts`**: Auto-derives X25519 keypair from wallet signature on connect, stores in IndexedDB settings.
- **`apps/periscope/src/chain/manifest.ts`**: `syncPrivateMapsForUser()` (discovers MapInvite objects owned by user), `decryptMapKeys()` (unseals encrypted map keys with wallet keypair), `syncMapLocations()` (fetches + decrypts location data).
- **`apps/periscope/src/views/PrivateMaps.tsx`**: UI with map list, location table, create/invite/add-location dialogs.
- **DB types** (`apps/periscope/src/db/types.ts`): `ManifestPrivateMap` (with `decryptedMapKey`, `encryptedMapKey`, `inviteId`), `ManifestMapLocation` (with decrypted `solarSystemId`, `planet`, `lPoint`, `description`).

### StandingsRegistry contract (already published)
- **`contracts/standings_registry/sources/standings_registry.move`**: Shared `StandingsRegistry` with dynamic fields `TribeKey { tribe_id: u32 } -> u8` and `CharKey { char_id: u64 } -> u8`. Standing scale: u8 0-6 (displayed as -3 to +3). Lookup priority: character > tribe > default.
- Published at `0x7d3864e7d1c1c0573cdbc044bffdb0711100f5461910c086777580d005c76341`
- Key function: `get_standing(registry, tribe_id, char_id): u8`

### Integration pattern reference (`contracts/gate_standings/`)
- References `StandingsRegistry` as `&StandingsRegistry` argument in entry functions
- Stores per-gate config with `registry_id: ID` to verify the correct registry is passed
- Config is a shared object with dynamic fields keyed by the protected object ID

### Contract addresses (`packages/chain-shared/src/config.ts`)
- `privateMap.packageId` populated for both stillness and utopia (same address)
- `standingsRegistry.packageId` populated (same address both tenants)
- `ContractAddresses` interface already includes `privateMap`, `standingsRegistry` fields

## Target State

### 1. New Move Contract: `private_map_standings` (`contracts/private_map_standings/`)

A new contract that supports **two map modes**: encrypted (invite-based, identical to current) and cleartext (standings-gated). One contract, two access models.

**Shared object: `PrivateMapV2`**
```
PrivateMapV2 {
    id: UID,
    name: String,
    creator: address,
    editors: vector<address>,        // addresses that can add locations (both modes)
    mode: u8,                        // 0 = encrypted, 1 = cleartext_standings
    // Encrypted mode fields (populated when mode=0, empty/default when mode=1):
    public_key: vector<u8>,          // X25519 public key (32 bytes); empty vector when mode=1
    revoked: vector<address>,        // revoke list for encrypted mode; empty when mode=1
    // Cleartext standings mode fields (populated when mode=1, default when mode=0):
    registry_id: Option<ID>,         // StandingsRegistry to check; option::none() when mode=0
    min_read_standing: u8,           // minimum standing to view (client-enforced); 0 when mode=0
    min_write_standing: u8,          // minimum standing to add locations; 0 when mode=0
    // Shared
    next_location_id: u64,
}
```

**Note on editors vs invite holders:** The current `private_map` contract allows any invite holder to add locations. The new contract separates "can decrypt" (has invite) from "can write" (is editor or creator). For encrypted maps, the creator must explicitly add invite recipients to the editors list to grant write access. This gives map creators finer control -- they can share read-only access by inviting without adding to editors.

**MapInviteV2** -- owned object for encrypted mode (identical to current MapInvite):
```
MapInviteV2 {
    id: UID,
    map_id: ID,
    sender: address,
    encrypted_map_key: vector<u8>,
}
```

**LocationKey** -- dynamic field key (same as current):
```
LocationKey { location_id: u64 }
```

**MapLocationV2** -- dynamic field value:
```
MapLocationV2 {
    location_id: u64,
    structure_id: Option<ID>,
    data: vector<u8>,             // encrypted (mode 0) or plaintext JSON (mode 1)
    added_by: address,
    added_at_ms: u64,
}
```

**Mode constants:**
- `MODE_ENCRYPTED: u8 = 0`
- `MODE_CLEARTEXT_STANDINGS: u8 = 1`

**Functions -- Map creation:**
- `create_encrypted_map(name: String, public_key: vector<u8>, self_invite_encrypted_key: vector<u8>, ctx: &mut TxContext)` -- `#[allow(lint(share_owned, self_transfer))]`. Creates mode=0 map. Validates 32-byte public key. Creator auto-added to editors. Self-invite MapInviteV2 transferred to creator. Map shared.
- `create_standings_map(name: String, registry_id: ID, min_read_standing: u8, min_write_standing: u8, ctx: &mut TxContext)` -- `#[allow(lint(share_owned))]`. Creates mode=1 map. Validates standings 0-6. Stores registry_id as `option::some(registry_id)`. Creator auto-added to editors. Map shared. No invite created.

**Functions -- Encrypted mode member management:**
- `invite_member(map: &PrivateMapV2, recipient: address, encrypted_map_key: vector<u8>, ctx: &mut TxContext)` -- `#[allow(lint(self_transfer))]`. Asserts mode=0 + sender is creator. Creates MapInviteV2 transferred to recipient.
- `revoke_member(map: &mut PrivateMapV2, addr: address, ctx: &TxContext)` -- asserts mode=0 + sender is creator. Adds addr to revoked list. Asserts not already revoked.

**Functions -- Editor management (both modes):**
- `add_editor(map: &mut PrivateMapV2, addr: address, ctx: &TxContext)` -- asserts sender is creator. Asserts addr not already in editors. Pushes addr to editors.
- `remove_editor(map: &mut PrivateMapV2, addr: address, ctx: &TxContext)` -- asserts sender is creator. Asserts addr in editors. Removes addr from editors.

**Functions -- Standings config (mode=1 only):**
- `update_standings_config(map: &mut PrivateMapV2, registry_id: ID, min_read_standing: u8, min_write_standing: u8, ctx: &TxContext)` -- asserts mode=1 + sender is creator. Validates standings 0-6. Updates registry_id, min_read, min_write.

**Functions -- Location management:**
- `add_location_encrypted(map: &mut PrivateMapV2, invite: &MapInviteV2, structure_id: Option<ID>, encrypted_data: vector<u8>, clock: &Clock, ctx: &mut TxContext)` -- asserts mode=0, invite.map_id matches map ID, sender not revoked, sender is editor or creator. Increments next_location_id. Adds dynamic field.
- `add_location_standings(map: &mut PrivateMapV2, registry: &StandingsRegistry, tribe_id: u32, char_id: u64, structure_id: Option<ID>, data: vector<u8>, clock: &Clock, ctx: &mut TxContext)` -- asserts mode=1, `option::is_some(&map.registry_id)`, `object::id(registry) == *option::borrow(&map.registry_id)`. Grants write if `get_standing(registry, tribe_id, char_id) >= map.min_write_standing` OR sender is editor/creator. Increments next_location_id. Adds dynamic field with plaintext data.
- `remove_location(map: &mut PrivateMapV2, location_id: u64, ctx: &TxContext)` -- both modes. Asserts location exists. Asserts sender is creator or added_by. Removes dynamic field.

**Functions -- Read accessors:**
- Standard field accessors for all PrivateMapV2 fields, MapLocationV2 fields, MapInviteV2 fields.

**Error codes:**
- `ENotCreator` (0) -- caller is not the map creator (for admin-only ops)
- `ELocationNotFound` (1) -- location_id does not exist on the map
- `ENotLocationOwner` (2) -- caller is neither creator nor the address that added the location
- `EInviteNotForThisMap` (3) -- MapInviteV2.map_id does not match the map's ID
- `EMemberRevoked` (4) -- caller is in the revoked list (encrypted mode)
- `EAlreadyRevoked` (5) -- address is already in the revoked list
- `EInvalidPublicKeyLength` (6) -- public_key is not exactly 32 bytes
- `EWrongMode` (7) -- function called on a map with incompatible mode
- `EAccessDenied` (8) -- standing too low and not an editor/creator (standings mode write)
- `ERegistryMismatch` (9) -- passed StandingsRegistry ID does not match map's registry_id
- `EInvalidStanding` (10) -- standing value > 6
- `EEditorAlreadyExists` (11) -- address is already in the editors list
- `EEditorNotFound` (12) -- address is not in the editors list
- `ENotEditor` (13) -- caller is not an editor or creator (encrypted mode write)

**Events:**
- `MapCreatedEvent { map_id, creator, name, mode }`
- `MemberInvitedEvent { map_id, recipient, sender }` (encrypted mode)
- `MemberRevokedEvent { map_id, revoked_address }` (encrypted mode)
- `EditorAddedEvent { map_id, editor }`
- `EditorRemovedEvent { map_id, editor }`
- `LocationAddedEvent { map_id, location_id, added_by }`
- `LocationRemovedEvent { map_id, location_id, removed_by }`
- `StandingsConfigUpdatedEvent { map_id, registry_id, min_read, min_write }`

**Dependencies:** Sui framework + `standings_registry` (local). No world dependency.

**Key design decision -- identity parameters:** `add_location_standings()` takes `tribe_id: u32` and `char_id: u64` as plain parameters rather than a `&Character` reference. This avoids a world dependency (which would pull in all world transitive deps). The tradeoff is that callers can pass arbitrary tribe/char IDs, but: (a) the `added_by` field records the actual TX sender (wallet address), which is tamper-proof, (b) lying about identity only affects which standing value is looked up -- if someone impersonates a higher-standing tribe, they gain write access but their real wallet address is recorded, and (c) character-level overrides in the registry can block specific addresses regardless of tribe. This is the same approach the existing system uses informally (the current `private_map` contract has no identity verification beyond wallet address).

**Key design decision -- encrypted mode write access:** The current `private_map` contract allows any invite holder to add locations. The new contract adds an `editors` list for finer-grained control. In encrypted mode, any invite holder who is NOT revoked AND is on the editors list (or is the creator) can write. The creator can control who has write access independently of who can decrypt. For backwards-compatible behavior, the creator simply adds all invite recipients to the editors list.

### 2. chain-shared Updates

**New file: `packages/chain-shared/src/private-map-standings.ts`**
- TX builders:
  - `buildCreateEncryptedMap(params)` -- same interface as current `buildCreateMap` plus packageId
  - `buildCreateStandingsMap(params)` -- name, registryId, minReadStanding, minWriteStanding, senderAddress
  - `buildInviteMemberV2(params)` -- same as current `buildInviteMember`
  - `buildRevokeMemberV2(params)` -- same as current `buildRevokeMember`
  - `buildAddEditor(params)` -- mapId, editorAddress, senderAddress
  - `buildRemoveEditor(params)` -- mapId, editorAddress, senderAddress
  - `buildUpdateStandingsConfig(params)` -- mapId, registryId, minReadStanding, minWriteStanding, senderAddress
  - `buildAddLocationEncrypted(params)` -- same interface as current `buildAddLocation`
  - `buildAddLocationStandings(params)` -- mapId, registryId, tribeId, charId, structureId?, data, senderAddress
  - `buildRemoveLocationV2(params)` -- same as current `buildRemoveLocation`
- Query functions:
  - `queryPrivateMapV2(client, mapId)` -- fetch PrivateMapV2 details
  - `queryMapInvitesV2ForUser(client, packageId, userAddress)` -- discover MapInviteV2 objects
  - `queryMapLocationsV2(client, mapId)` -- fetch all locations (returns raw data bytes, caller decrypts if needed)
  - `queryStandingsMapsForRegistry(client, packageId, registryId)` -- discover cleartext maps linked to a specific registry

**Modify `packages/chain-shared/src/types.ts`:**
- Add `PrivateMapV2Info { objectId, name, creator, editors, mode, publicKey?, registryId?, minReadStanding?, minWriteStanding?, nextLocationId }`
- Add `MapLocationV2Info { locationId, structureId, data, addedBy, addedAtMs }`
- Add `privateMapStandings?: { packageId: string }` to `ContractAddresses`

**Modify `packages/chain-shared/src/config.ts`:**
- Add `privateMapStandings: { packageId: "" }` entries (populated after publish)

**Modify `packages/chain-shared/src/index.ts`:**
- Export new `private-map-standings` module

### 3. Periscope Updates

**Modify `apps/periscope/src/db/types.ts`:**
- Add `ManifestPrivateMapV2` type:
  ```
  id, name, creator, editors, mode (0|1),
  publicKey?, decryptedMapKey?, encryptedMapKey?, inviteId?,
  registryId?, minReadStanding?, minWriteStanding?,
  tenant, cachedAt
  ```
- Reuse existing `ManifestMapLocation` type (same fields; for cleartext maps, data is already decrypted)

**Modify `apps/periscope/src/db/index.ts`:**
- Add new DB version with `manifestPrivateMapsV2` table

**Modify `apps/periscope/src/chain/manifest.ts`:**
- Add `syncPrivateMapsV2ForUser()` -- discovers both encrypted invites AND cleartext maps (by querying MapCreatedEvent events with mode=1, filtering by standing check)
- Add `syncMapLocationsV2()` -- for cleartext maps, locations are already in plaintext JSON; for encrypted maps, uses existing decrypt flow
- Keep existing functions for backwards compat with old `private_map` contract

**Replace `apps/periscope/src/views/PrivateMaps.tsx`:**
- Unified view showing both old (v1) encrypted maps and new (v2) maps
- Create Map dialog with mode selector: "Encrypted (Invite-Only)" or "Standings-Gated (Cleartext)"
- Standings-gated creation: pick a subscribed registry, set min read/write thresholds
- Map card shows mode badge: lock icon for encrypted, shield icon for standings
- For standings maps: show standings threshold info, no invite button, add-location checks standing threshold client-side

**Modify `apps/periscope/src/chain/config.ts`:**
- No extension template needed (private_map_standings is not a structure extension)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Encrypted vs cleartext | Dual-mode in one contract | Encrypted maps are essential for high-security intel sharing. Cleartext standings maps serve the organization-scale use case. Both have distinct value and cannot substitute for each other. |
| Standings for encrypted maps | Not feasible | Encryption requires per-member key distribution. Standings-based membership is dynamic and unbounded -- you cannot pre-distribute keys to everyone who might reach a standing threshold. The two models are fundamentally incompatible. |
| Cleartext location storage | Plaintext JSON in `data: vector<u8>` | For standings-gated maps, encryption adds no value since anyone meeting the threshold can read. Plaintext is simpler and allows on-chain composability. |
| Contract dependency on world | No world dependency | Pass tribe_id/char_id as parameters instead of reading from Character object. Avoids coupling to world contracts, simplifies Move.toml. Client is trusted for identity params since wallet signature is the real auth. |
| Editors list | Explicit editors list for both modes | Separates "who can read" from "who can write". For encrypted maps, editors replace the implicit "anyone with invite can write". For standings maps, editors provide fine-grained write control beyond just meeting the standing threshold. |
| Read enforcement for standings maps | Client-side only | Move contracts cannot prevent reads -- any address can query dynamic fields on a shared object. `min_read_standing` is stored on-chain for the client to enforce and as a social contract signal. |
| Big bang vs upgrade | New contract | Hackathon pace. No upgrade governance overhead. Old contract remains functional for existing maps. |
| Contract name | `private_map_standings` | Distinguishes from existing `private_map`. The "standings" suffix signals the key differentiator even though encrypted mode is also supported. |
| Mode field type | `u8` constant (0 or 1) | Simple, extensible. Could add mode 2 (e.g., standings+toll) later without changing the struct. |
| Write permission model for standings maps | Editors OR standing >= min_write | Dual path: editors are explicitly trusted writers (like org officers), while anyone meeting the write threshold can also contribute. Inclusive for large organizations. |
| Registry reference at creation | Store ID, verify at write time | `create_standings_map` stores `registry_id: ID` without taking `&StandingsRegistry`. Verification happens in `add_location_standings` which takes the actual `&StandingsRegistry` and asserts `object::id(registry) == stored registry_id`. Same pattern as gate_standings config. |

## Implementation Phases

### Phase 1: Move Contract (`contracts/private_map_standings/`)

1. Create `contracts/private_map_standings/Move.toml` with `edition = "2024"`, dependencies: `Sui` (rev `testnet-v1.66.2`), `standings_registry = { local = "../standings_registry" }`. Address: `private_map_standings = "0x0"`.
2. Create `contracts/private_map_standings/sources/private_map_standings.move` with:
   - All structs: `PrivateMapV2`, `MapInviteV2`, `LocationKey`, `MapLocationV2`
   - Mode constants: `MODE_ENCRYPTED = 0`, `MODE_CLEARTEXT_STANDINGS = 1`
   - Error codes (14 total, codes 0-13 as listed above)
   - Events (8 event types as listed above)
   - `create_encrypted_map()` -- validates 32-byte public key, creates shared PrivateMapV2 with mode=0, creates self-invite MapInviteV2, emits events. Creator auto-added to editors.
   - `create_standings_map()` -- creates shared PrivateMapV2 with mode=1, stores registry_id (ID), min_read/min_write standings (0-6 validated). No encryption, no invite. Creator auto-added to editors.
   - `invite_member()` -- asserts mode=0 + creator. Creates MapInviteV2.
   - `revoke_member()` -- asserts mode=0 + creator. Adds to revoked list.
   - `add_editor()` / `remove_editor()` -- creator only, both modes.
   - `update_standings_config()` -- asserts mode=1 + creator. Updates registry_id, min_read, min_write. Validates standings 0-6.
   - `add_location_encrypted()` -- asserts mode=0, MapInviteV2 matches map, sender not revoked, sender is editor or creator. Stores encrypted_data.
   - `add_location_standings()` -- asserts mode=1, takes `&StandingsRegistry` + `tribe_id: u32` + `char_id: u64`. Verifies `object::id(registry) == map.registry_id`. Checks `get_standing() >= min_write_standing` OR sender is editor/creator. Stores plaintext data.
   - `remove_location()` -- both modes. Creator or added_by can remove.
   - Read accessors for all fields.
3. Write comprehensive tests (at least 16 test functions):
   - `test_create_encrypted_map` -- creation, self-invite transferred to creator, mode=0, public_key length, next_location_id=0
   - `test_create_standings_map` -- creation, mode=1, registry_id set, min_read/min_write stored, no invite created
   - `test_encrypted_add_location` -- add location with valid invite proof, borrow and verify fields
   - `test_encrypted_add_location_non_editor_fails` -- invite holder who is NOT an editor cannot add -> ENotEditor
   - `test_standings_add_location` -- add location with sufficient standing, verify plaintext data stored
   - `test_standings_add_location_denied` -- standing below min_write_standing, non-editor -> EAccessDenied
   - `test_standings_add_location_as_editor` -- editor with low standing can still add (editor OR standing check)
   - `test_standings_add_location_as_creator` -- creator can always add regardless of standing
   - `test_invite_wrong_mode` -- calling invite_member on mode=1 map fails with EWrongMode
   - `test_standings_write_wrong_mode` -- calling add_location_standings on mode=0 map fails with EWrongMode
   - `test_registry_mismatch` -- wrong StandingsRegistry object passed to add_location_standings -> ERegistryMismatch
   - `test_editor_management` -- add_editor, verify in list, remove_editor, verify removed
   - `test_non_creator_cannot_add_editor` -- stranger calls add_editor -> ENotCreator
   - `test_update_standings_config` -- change registry_id and thresholds, verify updated
   - `test_update_standings_config_wrong_mode` -- update on mode=0 map -> EWrongMode
   - `test_remove_location_by_creator` -- creator removes any location
   - `test_remove_location_by_adder` -- adder removes own location
   - `test_unauthorized_remove_location` -- stranger cannot remove -> ENotLocationOwner
   - `test_revoke_encrypted_member` -- revoked member with invite cannot add location
   - `test_multiple_locations` -- add 3 locations, remove middle, verify remaining
   - `test_invalid_standing_values` -- min_read or min_write > 6 rejected at creation
4. Build and run tests: `cd contracts/private_map_standings && sui move test`

### Phase 2: chain-shared Integration

1. Create `packages/chain-shared/src/private-map-standings.ts` with all TX builders and query functions listed in Target State section 2.
2. Update `packages/chain-shared/src/types.ts`:
   - Add `PrivateMapV2Info`, `MapLocationV2Info` interfaces
   - Add `privateMapStandings` to `ContractAddresses`
3. Update `packages/chain-shared/src/config.ts`:
   - Add `privateMapStandings: { packageId: "" }` to both tenant configs
4. Update `packages/chain-shared/src/index.ts`:
   - Export from `"./private-map-standings"`
5. Run `pnpm build` to verify chain-shared compiles.

### Phase 3: Contract Publish

1. Publish `private_map_standings` to Sui testnet: `sui client publish --gas-budget 500000000`
2. Record the published package ID.
3. Update `packages/chain-shared/src/config.ts` with the published package ID for both tenants.
4. Run `pnpm build` to verify.

### Phase 4: Periscope UI

1. Add `ManifestPrivateMapV2` type to `apps/periscope/src/db/types.ts`.
2. Bump DB version in `apps/periscope/src/db/index.ts`, add `manifestPrivateMapsV2` table.
3. Add sync functions to `apps/periscope/src/chain/manifest.ts`:
   - `syncPrivateMapsV2ForUser()` -- discovers encrypted invites (MapInviteV2) for the user, plus any cleartext standings maps the user has interacted with (via MapCreatedEvent + LocationAddedEvent events). For cleartext maps that reference a subscribed registry, checks the user's standing to determine if they should see the map.
   - `syncMapLocationsV2()` -- for mode=0, same decrypt flow as existing; for mode=1, plaintext JSON decode only.
4. Update `apps/periscope/src/views/PrivateMaps.tsx`:
   - Show V1 maps (existing) and V2 maps (new) in a unified list
   - Add mode badge to map cards (lock = encrypted, shield = standings)
   - Create Map dialog: radio toggle for "Encrypted (Invite-Only)" vs "Standings-Gated"
   - Standings map creation: dropdown to select registry (from subscribed registries), sliders/inputs for min_read and min_write thresholds
   - For standings maps: "Add Location" doesn't require invite/encryption -- just builds plaintext TX
   - For standings maps: show standings info panel (registry name, thresholds, user's current standing)
5. Run `pnpm build` and `pnpm dev` to verify.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/private_map_standings/Move.toml` | Create | Package manifest with Sui + standings_registry deps |
| `contracts/private_map_standings/sources/private_map_standings.move` | Create | Dual-mode map contract (encrypted + cleartext standings) |
| `packages/chain-shared/src/private-map-standings.ts` | Create | TX builders and query functions for the new contract |
| `packages/chain-shared/src/types.ts` | Modify | Add PrivateMapV2Info, MapLocationV2Info, ContractAddresses entry |
| `packages/chain-shared/src/config.ts` | Modify | Add privateMapStandings packageId entries |
| `packages/chain-shared/src/index.ts` | Modify | Export new module |
| `apps/periscope/src/db/types.ts` | Modify | Add ManifestPrivateMapV2 type |
| `apps/periscope/src/db/index.ts` | Modify | Add DB version with manifestPrivateMapsV2 table |
| `apps/periscope/src/chain/manifest.ts` | Modify | Add syncPrivateMapsV2ForUser, syncMapLocationsV2 |
| `apps/periscope/src/views/PrivateMaps.tsx` | Modify | Unified view for V1 + V2 maps, mode selector, standings UI |

## Open Questions

1. **Should cleartext standings maps also support a "public" mode (no standing check, anyone can read/write)?**
   - **Option A: No, always require a registry reference** -- Pros: simpler contract, consistent model. Cons: requires creating a registry even for truly open maps.
   - **Option B: Add a MODE_PUBLIC (mode=2) with no standings check** -- Pros: covers "open intel board" use case. Cons: scope creep, can be done later since mode is a u8.
   - **Recommendation:** Option A for now. A registry with default_standing=6 effectively makes it public. Mode=2 can be added later without contract changes (the u8 mode field is extensible).

2. **Should `add_location_standings` verify identity via a world `Character` object reference?**
   - **Option A: Pass tribe_id/char_id as raw u32/u64 parameters** -- Pros: no world dependency, simpler Move.toml, faster builds. Cons: caller can pass incorrect identity (though wallet signature is still required).
   - **Option B: Take `&Character` reference and extract tribe_id/char_id** -- Pros: trustless identity verification. Cons: adds world dependency, larger contract binary, all world transitive deps.
   - **Recommendation:** Option A. The wallet signature is the real authorization. Lying about tribe_id/char_id only affects which standing value is looked up -- and if someone passes a tribe with higher standing than their real one, the standings registry admin can set character-level overrides. The security model does not meaningfully degrade.

3. **How should Periscope discover cleartext standings maps the user can access?**
   - **Option A: Discover via MapCreatedEvent events for mode=1 maps, filter by standing client-side** -- Pros: finds all standings maps ever created. Cons: potentially large event scan, privacy concern (broadcasts intent to check standings maps).
   - **Option B: Registry-based discovery -- user subscribes to registries, Periscope discovers maps linked to those registries** -- Pros: scoped discovery, user controls what they see. Cons: requires knowing which registries to subscribe to.
   - **Option C: Manual map ID entry + bookmark system** -- Pros: simplest, user explicitly adds maps they know about. Cons: no automatic discovery.
   - **Recommendation:** Option B as primary, with Option C as fallback. Registry subscription is already in the standings system (plan 12). Periscope can query `MapCreatedEvent` events filtered to maps whose `registry_id` matches a subscribed registry, then check the user's standing to determine visibility. Manual map ID entry covers edge cases.

## Deferred

- **Standings + encryption hybrid** -- A mode where standings determines who gets invited, but data is still encrypted. Would require an off-chain key distribution service (e.g., creator's Periscope auto-invites anyone who reaches the threshold). Significantly more complex; punt to post-hackathon.
- **Map toll** -- Charging for access to cleartext maps (like gate toll). Could be a future mode.
- **Map categories/tags** -- Organizing maps by type (trade routes, hostiles, resources). Purely UI concern, can be added to Periscope without contract changes.
- **Batch location operations** -- Adding multiple locations in one TX. Nice-to-have, not blocking.
- **Location update (in-place edit)** -- Currently must remove + re-add. Could add `update_location()` later.
- **Transfer map ownership** -- Currently creator is immutable. Could add `transfer_ownership()` later.
