# Plan: Private Map System
**Status:** Pending
**Created:** 2026-03-21
**Module:** contracts, chain-shared, periscope, ssu-dapp

## Overview

The Private Map system enables encrypted location sharing among trusted players in EVE Frontier. A map is a shared on-chain object containing an X25519 public key. Members are invited by receiving a `MapInvite` object -- which contains the map's private key encrypted with the invitee's wallet-derived public key. Locations (structures or custom POIs) are encrypted with the map's public key and stored as dynamic fields on the map object. Only members who can decrypt their invite can read locations.

This system is completely stateless on the client side -- no keys are stored locally. All key material lives on-chain in encrypted form. Users derive their X25519 key deterministically from their wallet via `signPersonalMessage`, and all map access flows through this single derivation. This makes the system work seamlessly across devices.

The primary use cases are alliance intel maps (shared SSU/gate locations), trade route maps (market locations + waypoints), and personal maps (structures shared with alts or trusted friends). The system is standalone -- it does not depend on any existing custom contracts, only the Sui framework.

## Current State

**No private map functionality exists.** Location sharing is limited to:

1. **Public SSU locations** come from the game's `LocationRegistry` via the in-game "Publish Location" button, which calls `storage_unit::reveal_location()` (AdminACL, game server handles it). These are visible to all players.

2. **Periscope local locations** (`apps/periscope/src/views/Locations.tsx`) are stored in a local Dexie database (`db.locations` table with `LocationIntel` type defined in `apps/periscope/src/db/types.ts`). These are purely local bookmarks with categories (bookmark, POI, station, danger zone, scout report), system IDs, coordinates, notes, and tags. They are not shared.

3. **No on-chain encrypted location storage** exists anywhere in the codebase.

**Relevant existing patterns:**

- **Move contracts** follow the pattern in `contracts/market/sources/market.move` -- shared objects with dynamic fields, event emission, error codes as typed constants, and comprehensive test coverage.
- **Move.toml** follows the pattern in `contracts/market/Move.toml` -- depends on Sui framework via git (rev `testnet-v1.66.2`), uses `edition = "2024"`.
- **chain-shared TX builders** follow the pattern in `packages/chain-shared/src/market.ts` and `packages/chain-shared/src/ssu-market.ts` -- typed param interfaces, `Transaction` construction, GraphQL queries for discovery.
- **chain-shared types** are defined in `packages/chain-shared/src/types.ts` and re-exported via `packages/chain-shared/src/index.ts`.
- **chain-shared config** at `packages/chain-shared/src/config.ts` stores per-tenant contract addresses in `CONTRACT_ADDRESSES` with a `ContractAddresses` type.
- **Periscope hooks** use `useSuiClient()` (`apps/periscope/src/hooks/useSuiClient.ts`) for GraphQL queries.
- **ssu-dapp hooks** use `useSignAndExecute()` (`apps/ssu-dapp/src/hooks/useSignAndExecute.ts`) for TX execution.
- **@noble/hashes** is already a dependency of `apps/ssu-dapp` (used for crypto).

## Target State

### On-Chain Data Model (Move)

New contract package at `contracts/private_map/`:

```move
// Shared object -- one per map
public struct PrivateMap has key {
    id: UID,
    name: String,
    creator: address,
    public_key: vector<u8>,    // X25519 public key (32 bytes)
    revoked: vector<address>,  // addresses blocked from add_location
    next_location_id: u64,
}

// Owned by the invitee's address
public struct MapInvite has key, store {
    id: UID,
    map_id: ID,
    sender: address,
    encrypted_map_key: vector<u8>,  // map's X25519 private key, sealed with recipient's wallet public key
}

// Dynamic field key for locations on PrivateMap
public struct LocationKey has copy, drop, store { location_id: u64 }

// Dynamic field value on PrivateMap
public struct MapLocation has store, drop {
    location_id: u64,
    structure_id: Option<ID>,       // optional -- links to on-chain structure
    encrypted_data: vector<u8>,     // sealed with map's public key
    added_by: address,
    added_at_ms: u64,
}
```

### Crypto Flow

1. **Key derivation:** `dAppKit.signPersonalMessage({ message: encode("TehFrontier Map Key v1") })` -> SHA-256 hash of the 64-byte Ed25519 signature -> use 32-byte hash as X25519 seed via `x25519.keygen(seed)`. Ed25519 signatures are deterministic, so same wallet = same derived key every time across devices.
2. **Map creation:** Generate ephemeral X25519 keypair in memory. Store public key on-chain. Self-invite (seal private key with own wallet-derived X25519 public key). Discard ephemeral private key.
3. **Inviting members:** Decrypt own invite to recover map private key. Re-encrypt map private key with invitee's X25519 public key. How the inviter obtains the invitee's public key depends on Open Question 1 (registry, out-of-band, or invite link).
4. **Adding locations:** Read map public key from the on-chain `PrivateMap.public_key` field. Encrypt location data with `crypto_box_seal(plaintext, mapPublicKey)` -- only the map's public key is needed for encryption. Submit TX with encrypted bytes + `&MapInvite` for on-chain membership proof.
5. **Reading locations:** Decrypt own MapInvite to recover map secret key (step 1 of any read operation). For each location, call `crypto_box_seal_open(ciphertext, mapPublicKey, mapSecretKey)` to decrypt `encrypted_data`.

### Client-Side Crypto Library

Use `tweetnacl` + `tweetnacl-sealedbox-js` for NaCl sealed boxes (`crypto_box_seal` / `crypto_box_seal_open`). Note: `tweetnacl` alone only has `crypto_box` (authenticated encryption); sealed boxes are a libsodium extension provided by `tweetnacl-sealedbox-js`. Use `@noble/hashes` (already a dependency of ssu-dapp) for SHA-256 key derivation. Use `@noble/curves` `x25519` export for key generation -- `x25519.keygen(seed?)` generates a keypair, `x25519.getPublicKey(secretKey)` derives a public key from a secret key.

### New Files

- `contracts/private_map/Move.toml` -- package manifest
- `contracts/private_map/sources/private_map.move` -- contract module
- `packages/chain-shared/src/private-map.ts` -- TX builders + queries
- `packages/chain-shared/src/crypto.ts` -- wallet key derivation, seal/unseal helpers
- Periscope integration (future phase)
- ssu-dapp integration (future phase)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Key derivation message | `"TehFrontier Map Key v1"` | Versioned message allows future key rotation. Deterministic derivation means no local key storage. |
| Encryption scheme | NaCl `crypto_box_seal` (X25519 + XSalsa20-Poly1305) | Anonymous sealed boxes -- only the recipient's public key is needed. Well-audited. Requires `tweetnacl` + `tweetnacl-sealedbox-js` (tweetnacl alone lacks sealed boxes). |
| X25519 key operations | `@noble/curves` `x25519.keygen(seed?)` / `x25519.getPublicKey(sk)` | Noble x25519 export handles keypair generation from seed and public key derivation. No separate ed25519->x25519 conversion needed -- we derive X25519 keys directly from SHA-256 hash of wallet signature. |
| MapInvite as owned object | Transfer to invitee's address | Owned objects are only visible to the owner. GraphQL `address.objects` query finds them. Natural access control. |
| Location storage | Dynamic fields on PrivateMap keyed by `LocationKey { location_id: u64 }` | Follows established pattern from `market.move` (SellKey, BuyKey). Avoids vector size limits. |
| Structure ID field | `Option<ID>` on MapLocation | Allows both structure-linked locations (SSU, gate) and custom POIs (no structure). |
| Encrypted data format | JSON `{solar_system_id, planet, l_point, description}` serialized then sealed | Flexible schema. Client-side parsing. Can add fields without contract changes. |
| No member list on-chain | Members discovered via MapInvite objects (query by type + map_id) | Avoids maintaining a vector on the shared object. MapInvite objects serve as both key delivery and membership proof. |
| Creator-only invite | Only the map creator can send invites | Simplifies trust model. Members can read but not expand the group. Can be relaxed later with an `admins` vector. |
| Public key distribution | Open question -- registry vs out-of-band vs invite link | See Open Question 1. Decision deferred until UX requirements are clearer. All three options are technically feasible. |
| Contract independence | No dependency on market, ssu_market, or world contracts | Private Map is a pure utility -- location data is opaque bytes. Structure IDs are stored as `Option<ID>` but not validated on-chain. |
| Single deployment for all tenants | Same package ID in both stillness and utopia config entries | No tenant-specific dependencies. Maps are cross-tenant (a map created on one tenant's data works identically on the other). |
| Location removal | Creator or the address that added the location can remove it | Allows map housekeeping without concentrating all control on the creator. |
| Soft revocation via blacklist | `revoke_member` adds address to `revoked` vector on PrivateMap | Cannot delete another user's owned object in Sui. `revoked` list blocks `add_location` calls. Cannot prevent decryption of existing data -- true revocation requires creating a new map. Documented limitation. |
| Crypto libraries | `tweetnacl` + `tweetnacl-sealedbox-js` + `@noble/hashes` + `@noble/curves` | tweetnacl for NaCl primitives, tweetnacl-sealedbox-js for sealed box extension. Noble for SHA-256 hashing and x25519 key generation. All audited, small footprint. |
| Wallet key derivation | `dAppKit.signPersonalMessage({ message })` via `useDAppKit()` | dapp-kit-react exposes `signPersonalMessage` on the DAppKit instance (not a separate hook). Already used pattern in the codebase. |

## Implementation Phases

### Phase 1: Move Contract (`contracts/private_map/`)

1. Create `contracts/private_map/Move.toml` with Sui framework dependency (same pattern as `contracts/market/Move.toml`), `edition = "2024"`, `private_map = "0x0"` placeholder address.
2. Create `contracts/private_map/sources/private_map.move` with:
   - Error codes: `ENotCreator`, `ELocationNotFound`, `ENotLocationOwner`, `EInviteNotForThisMap`, `EMemberRevoked`, `EAlreadyRevoked`
   - Structs: `PrivateMap`, `MapInvite`, `LocationKey`, `MapLocation` (as specified in Target State)
   - `create_map(name: String, public_key: vector<u8>, self_invite_encrypted_key: vector<u8>, ctx: &mut TxContext)` -- `#[allow(lint(share_owned))]` attribute (same as market.move). Creates shared `PrivateMap` with `revoked: vector[]`, transfers self-`MapInvite` to sender
   - `invite_member(map: &PrivateMap, recipient: address, encrypted_map_key: vector<u8>, ctx: &mut TxContext)` -- creator only. Creates `MapInvite` owned by `recipient`.
   - `add_location(map: &mut PrivateMap, invite: &MapInvite, structure_id: Option<ID>, encrypted_data: vector<u8>, clock: &Clock, ctx: &mut TxContext)` -- requires `&MapInvite` with matching `map_id` (prevents spam from non-members). Asserts `invite.map_id == object::id(map)`. Also asserts sender is not in `revoked` list. Increments `next_location_id`, adds `MapLocation` as dynamic field.
   - `remove_location(map: &mut PrivateMap, location_id: u64, ctx: &TxContext)` -- creator or `added_by` address can remove.
   - `revoke_member(map: &mut PrivateMap, addr: address, ctx: &TxContext)` -- creator only. Adds address to `revoked` vector on the map. Does NOT delete their `MapInvite` (can't consume another user's owned object). Prevents the revoked address from calling `add_location`. They can still decrypt existing data -- true revocation requires creating a new map.
   - Read accessors: `map_name`, `map_creator`, `map_public_key`, `next_location_id`, `borrow_location`, `has_location`
   - Events: `MapCreatedEvent`, `MemberInvitedEvent`, `LocationAddedEvent`, `LocationRemovedEvent`, `MemberRevokedEvent`
3. Write comprehensive tests covering:
   - Map creation with self-invite (verify PrivateMap shared, MapInvite transferred to creator)
   - Member invitation (creator only, non-creator should fail with `ENotCreator`)
   - Location add with valid MapInvite (verify dynamic field creation, `next_location_id` increment)
   - Location add with wrong map's invite (should fail with `EInviteNotForThisMap`)
   - Location remove by creator and by `added_by` address
   - Location remove by unauthorized address (should fail with `ENotLocationOwner`)
   - Member revocation (add to `revoked` list, verify `add_location` fails with `EMemberRevoked`)
   - Event emission verification for all operations

### Phase 2: Client-Side Crypto (`packages/chain-shared/src/crypto.ts`)

1. Create `packages/chain-shared/src/crypto.ts` with:
   - `deriveMapKeyFromSignature(signature: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array }` -- SHA-256 hash of signature bytes (via `@noble/hashes/sha256`), then `x25519.keygen(hash)` to produce X25519 keypair. The `x25519` export from `@noble/curves/ed25519` accepts an optional 32-byte seed.
   - `generateEphemeralX25519Keypair(): { publicKey: Uint8Array; secretKey: Uint8Array }` -- `x25519.keygen()` (no seed = random). Used for new map creation.
   - `sealForRecipient(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array` -- uses `tweetnacl-sealedbox-js` `seal(plaintext, recipientPublicKey)`
   - `unsealWithKey(ciphertext: Uint8Array, recipientPublicKey: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array` -- uses `tweetnacl-sealedbox-js` `open(ciphertext, recipientPublicKey, recipientSecretKey)`
   - `encodeLocationData(data: { solarSystemId: number; planet: number; lPoint: number; description?: string }): Uint8Array` -- JSON serialize + UTF-8 encode
   - `decodeLocationData(plaintext: Uint8Array): { solarSystemId: number; planet: number; lPoint: number; description?: string }` -- UTF-8 decode + JSON parse
2. Add `tweetnacl`, `tweetnacl-sealedbox-js`, and `@noble/curves` as dependencies of `packages/chain-shared`. `@noble/hashes` is already a transitive dependency but should be added explicitly.
3. Export from `packages/chain-shared/src/index.ts`.
4. Write unit tests for crypto round-trip (seal -> unseal), key derivation determinism, and location data encoding.

### Phase 3: Chain-Shared TX Builders + Queries (`packages/chain-shared/src/private-map.ts`)

1. Create `packages/chain-shared/src/private-map.ts` with:
   - **Types:** `PrivateMapInfo`, `MapInviteInfo`, `MapLocationInfo` (matching on-chain structs)
   - **TX builders:**
     - `buildCreateMap(params: { packageId, name, publicKey, selfInviteEncryptedKey, senderAddress })` -- calls `private_map::create_map`
     - `buildInviteMember(params: { packageId, mapId, recipient, encryptedMapKey, senderAddress })` -- calls `private_map::invite_member`
     - `buildAddLocation(params: { packageId, mapId, inviteId, structureId?, encryptedData, senderAddress })` -- calls `private_map::add_location` with `&MapInvite` reference
     - `buildRemoveLocation(params: { packageId, mapId, locationId, senderAddress })` -- calls `private_map::remove_location`
     - `buildRevokeMember(params: { packageId, mapId, memberAddress, senderAddress })` -- calls `private_map::revoke_member`
   - **Queries:**
     - `queryPrivateMap(client, mapId)` -- fetch map details via `getObjectJson`
     - `queryMapInvitesForUser(client, packageId, userAddress)` -- discover all `MapInvite` objects owned by user via GraphQL `objects(filter: { type, owner })` query
     - `queryMapLocations(client, mapId)` -- list all locations via `listDynamicFieldsGql`, filter by `LocationKey` type
2. Add types to `packages/chain-shared/src/types.ts`:
   ```typescript
   export interface PrivateMapInfo {
       objectId: string;
       name: string;
       creator: string;
       publicKey: string;       // hex-encoded X25519 public key
       nextLocationId: number;
   }

   export interface MapInviteInfo {
       objectId: string;
       mapId: string;
       sender: string;
       encryptedMapKey: string;  // hex-encoded
   }

   export interface MapLocationInfo {
       locationId: number;
       structureId: string | null;
       encryptedData: string;    // hex-encoded
       addedBy: string;
       addedAtMs: number;
   }
   ```
3. Add `privateMap` entry to `ContractAddresses` in `packages/chain-shared/src/types.ts`:
   ```typescript
   privateMap?: { packageId: string };
   ```
4. Export from `packages/chain-shared/src/index.ts`.

### Phase 4: Contract Deployment + Config

1. Publish `contracts/private_map` to Sui testnet.
2. Update `contracts/private_map/Move.toml` with published-at address.
3. Update `packages/chain-shared/src/config.ts` -- add `privateMap.packageId` to both tenant entries in `CONTRACT_ADDRESSES`.

### Phase 5: Periscope Integration (maps management UI)

1. Create `apps/periscope/src/views/Maps.tsx` -- main view for managing private maps:
   - List all maps the user is invited to (via `queryMapInvitesForUser`)
   - "Create Map" dialog with name field
   - Per-map view showing decrypted locations, members, "Invite Member" action
   - "Add Location" dialog with system selector, planet/L-point fields, optional structure ID, description
   - "Remove Location" action per location row
   - Key derivation via `dAppKit.signPersonalMessage({ message })` using `useDAppKit()` from dapp-kit-react
2. Add `useMapKey` hook (`apps/periscope/src/hooks/useMapKey.ts`) -- derives X25519 keypair from wallet, caches in React state (not persisted). Uses `signPersonalMessage` + `deriveMapKeyFromSignature`.
3. Add `usePrivateMaps` hook (`apps/periscope/src/hooks/usePrivateMaps.ts`) -- fetches user's MapInvites, resolves map details, decrypts location data.
4. Add route `/maps` to `apps/periscope/src/router.tsx`.
5. Add navigation entry in sidebar.

### Phase 6: ssu-dapp Integration (publish SSU to map)

1. Add "Publish to Map" button in `apps/ssu-dapp/src/views/SsuView.tsx` header area (visible when wallet is connected and user has map invites).
2. Create `apps/ssu-dapp/src/components/PublishToMapDialog.tsx` -- dialog that lists user's maps, encrypts the SSU's location data, and calls `buildAddLocation`.
3. Add `useMapKey` hook to ssu-dapp (same pattern as periscope).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/private_map/Move.toml` | Create | Package manifest with Sui framework dependency |
| `contracts/private_map/sources/private_map.move` | Create | Core contract: PrivateMap, MapInvite, MapLocation, CRUD functions |
| `packages/chain-shared/src/crypto.ts` | Create | Wallet key derivation, X25519, seal/unseal helpers |
| `packages/chain-shared/src/private-map.ts` | Create | TX builders + GraphQL queries for private maps |
| `packages/chain-shared/src/types.ts` | Modify | Add PrivateMapInfo, MapInviteInfo, MapLocationInfo, ContractAddresses.privateMap |
| `packages/chain-shared/src/index.ts` | Modify | Add exports for crypto.ts and private-map.ts |
| `packages/chain-shared/src/config.ts` | Modify | Add privateMap packageId to both tenant entries (after deploy) |
| `packages/chain-shared/package.json` | Modify | Add tweetnacl, tweetnacl-sealedbox-js, @noble/curves, @noble/hashes dependencies |
| `apps/periscope/src/views/Maps.tsx` | Create | Private maps management UI |
| `apps/periscope/src/hooks/useMapKey.ts` | Create | Wallet-derived X25519 key hook |
| `apps/periscope/src/hooks/usePrivateMaps.ts` | Create | Fetch + decrypt private maps hook |
| `apps/periscope/src/router.tsx` | Modify | Add /maps route |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | Add Maps nav entry |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Modify | Add "Publish to Map" button |
| `apps/ssu-dapp/src/components/PublishToMapDialog.tsx` | Create | Dialog for publishing SSU location to a map |
| `apps/ssu-dapp/src/hooks/useMapKey.ts` | Create | Wallet-derived X25519 key hook (duplicate of periscope) |

## Open Questions

1. **How does the inviter obtain the invitee's X25519 public key?**
   - **Option A: On-chain public key registry** -- Users register their X25519 public key in a shared object (e.g., `PublicKeyRegistry` with address -> public_key mapping). Inviter queries the registry by address. Pros: fully self-service, no out-of-band coordination. Cons: extra contract, extra on-chain storage, privacy concern (public key visible to all).
   - **Option B: Out-of-band exchange** -- Invitee shares their X25519 public key (e.g., via Discord, in-game chat). Inviter pastes it into the invite dialog. Pros: no extra contract, no on-chain privacy leak. Cons: requires manual coordination, error-prone.
   - **Option C: Invite link pattern** -- Creator generates an invite with a temporary symmetric key. Invitee opens the link, which triggers `signPersonalMessage` to derive their key, then a second TX stores their public key and receives the real map key. Pros: smooth UX. Cons: more complex, two TXs per invite.
   - **Recommendation:** Option A (public key registry) for V1. The privacy concern is minimal -- an X25519 public key doesn't reveal anything actionable, and it's a one-time registration. The UX is vastly simpler. Could be a dynamic field on PrivateMap or a separate `KeyRegistry` shared object. Lean toward a global `KeyRegistry` so users only register once.

2. **Should location add be permissionless or require MapInvite proof?**
   - **RESOLVED: Option B (require MapInvite).** `add_location` takes `&MapInvite` and asserts `invite.map_id == object::id(map)`. This prevents spam and ensures only invited members can contribute. Owned objects can be passed as immutable references by their owner in Sui PTBs.

3. **How should member removal work given Sui's owned object model?**
   - **RESOLVED: Option B (revoked blacklist) + Option C (new map for full revocation).** `revoke_member` adds address to `revoked: vector<address>` on PrivateMap. `add_location` checks this list. Cannot delete another user's owned object, so the MapInvite persists -- revoked members can still decrypt existing data. True revocation requires creating a new map.

4. **Should the `useMapKey` hook be duplicated in both periscope and ssu-dapp, or shared?**
   - **Option A: Duplicate** -- Each app has its own `useMapKey.ts`. Simple, no cross-app dependency. Cons: code duplication.
   - **Option B: Move to chain-shared** -- Create a React hook in chain-shared. Cons: chain-shared is currently framework-agnostic (no React imports). Adding React hooks changes its nature.
   - **Option C: Create a shared hooks package** -- `packages/shared-hooks/`. Pros: clean separation. Cons: new package, more infrastructure.
   - **Recommendation:** Option A for now. The hook is small (~20 lines). Duplication is acceptable. If a third consumer appears, extract to shared hooks.

## Deferred

- **Cross-map location aggregation** -- Merging locations from multiple maps into a single view (Periscope could show all decrypted locations across all maps on the intel dashboard). Defer until basic map CRUD is working.
- **Admin delegation** -- Allowing map members to also invite others (requires an `admins: vector<address>` field). Keep V1 simple with creator-only invites.
- **Map renaming / metadata editing** -- Low priority, add when needed.
- **Bulk operations** -- Adding multiple locations in one TX, inviting multiple members in one TX. PTB composition makes this straightforward but not essential for V1.
- **ssu-market-dapp integration** -- The market dapp could show "Publish to Map" for SSU sellers. Defer until ssu-dapp integration is proven.
- **Map discovery / sharing** -- Public "map directory" where creators can list their maps for others to request invites. Entirely separate feature.
- **Key rotation** -- Re-encrypting all locations with a new key after removing a member. Impractical for V1 (O(n) re-encryption). The documented path is "create new map."
