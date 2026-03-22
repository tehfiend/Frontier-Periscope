# Plan: Private Map System
**Status:** Active
**Created:** 2026-03-21
**Module:** contracts, chain-shared, periscope, ssu-dapp

## Overview

The Private Map system enables encrypted location sharing among trusted players in EVE Frontier. A map is a shared on-chain object containing an X25519 public key. Members are invited by receiving a `MapInvite` object -- which contains the map's private key encrypted with the invitee's wallet-derived public key. Locations (structures or custom POIs) are encrypted with the map's public key and stored as dynamic fields on the map object. Only members who can decrypt their invite can read locations.

This system is mostly stateless on the client side -- decrypted map keys are cached in the browser's per-origin IndexedDB for performance (same security model as wallet storage). All key material originates on-chain in encrypted form. Users derive their X25519 key deterministically from their wallet via `signPersonalMessage`, and all map access flows through this single derivation. This makes the system work seamlessly across devices.

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

1. **Key derivation:** `dAppKit.signPersonalMessage({ message: encode("TehFrontier Map Key v1") })` returns `{ signature: string }` (base64-encoded). Decode signature from base64 to bytes, then SHA-256 hash -> 32-byte seed -> `x25519.keygen(seed)` to produce X25519 keypair. Ed25519 signatures are deterministic, so same wallet = same derived key every time across devices.
2. **Map creation:** Generate ephemeral X25519 keypair in memory. Store public key on-chain. Self-invite (seal private key with own wallet-derived X25519 public key). Discard ephemeral private key.
3. **Inviting members:** Decrypt own invite to recover map private key. Look up invitee's Ed25519 public key from any of their on-chain transaction signatures (via `queryTransactionSignature` + `parseSerializedSignature`), convert to X25519 via `ed25519.utils.toMontgomery()`. Re-encrypt map private key with invitee's X25519 public key.
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
| Public key distribution | Extract Ed25519 public key from invitee's transaction signatures, convert to X25519 | Every Sui transaction signature includes the signer's Ed25519 public key. Any active player has at least one transaction (character creation). Query any transaction by the invitee's address, extract the public key via `parseSerializedSignature`, convert Ed25519 -> X25519 via `ed25519.utils.toMontgomery()` from `@noble/curves/ed25519.js`. No registry or out-of-band exchange needed -- the blockchain itself is the registry. |
| Contract independence | No dependency on market, ssu_market, or world contracts | Private Map is a pure utility -- location data is opaque bytes. Structure IDs are stored as `Option<ID>` but not validated on-chain. |
| Single deployment for all tenants | Same package ID in both stillness and utopia config entries | No tenant-specific dependencies. Maps are cross-tenant (a map created on one tenant's data works identically on the other). |
| Wallet key type | Ed25519 only | Sui supports Ed25519/Secp256k1/Secp256r1 but only Ed25519 keys can be converted to X25519 for encryption. EVE Vault uses Ed25519. |
| Manifest key caching | Decrypted map keys cached in IndexedDB | Caching avoids re-fetching and re-decrypting on every page load. Trade-off: keys stored in plaintext per-origin storage (same security model as wallet key storage). Re-deriving on each session is an alternative but adds latency. |
| Location removal | Creator or the address that added the location can remove it | Allows map housekeeping without concentrating all control on the creator. |
| Soft revocation via blacklist | `revoke_member` adds address to `revoked` vector on PrivateMap | Cannot delete another user's owned object in Sui. `revoked` list blocks `add_location` calls. Cannot prevent decryption of existing data -- true revocation requires creating a new map. Documented limitation. |
| Crypto libraries | `tweetnacl` + `tweetnacl-sealedbox-js` + `@noble/hashes` + `@noble/curves` | tweetnacl for NaCl primitives, tweetnacl-sealedbox-js for sealed box extension. Noble for SHA-256 hashing and x25519 key generation. All audited, small footprint. |
| Wallet key derivation | `dAppKit.signPersonalMessage({ message })` via `useDAppKit()` | dapp-kit-react exposes `signPersonalMessage` on the DAppKit instance (not a separate hook). Already used pattern in the codebase. |

## Implementation Phases

### Phase 1: Move Contract (`contracts/private_map/`)

1. Create `contracts/private_map/Move.toml` with Sui framework dependency (same pattern as `contracts/market/Move.toml`), `edition = "2024"`, `private_map = "0x0"` placeholder address.
2. Create `contracts/private_map/sources/private_map.move` with:
   - Error codes: `ENotCreator`, `ELocationNotFound`, `ENotLocationOwner`, `EInviteNotForThisMap`, `EMemberRevoked`, `EAlreadyRevoked`, `EInvalidPublicKeyLength`
   - Structs: `PrivateMap`, `MapInvite`, `LocationKey`, `MapLocation` (as specified in Target State)
   - `create_map(name: String, public_key: vector<u8>, self_invite_encrypted_key: vector<u8>, ctx: &mut TxContext)` -- `#[allow(lint(share_owned))]` attribute (same as market.move). Assert `public_key.length() == 32` with error `EInvalidPublicKeyLength`. Creates shared `PrivateMap` with `revoked: vector[]`, transfers self-`MapInvite` to sender
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
   - `deriveMapKeyFromSignature(signatureBase64: string): { publicKey: Uint8Array; secretKey: Uint8Array }` -- decode signature from base64 to bytes, SHA-256 hash (via `@noble/hashes/sha2.js`), then `x25519.keygen(hash)` to produce X25519 keypair. The `x25519` export from `@noble/curves/ed25519.js` accepts an optional 32-byte seed. The base64 input matches the `signPersonalMessage` return format.
   - `generateEphemeralX25519Keypair(): { publicKey: Uint8Array; secretKey: Uint8Array }` -- `x25519.keygen()` (no seed = random). Used for new map creation.
   - `sealForRecipient(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array` -- uses `tweetnacl-sealedbox-js` `seal(plaintext, recipientPublicKey)`
   - `unsealWithKey(ciphertext: Uint8Array, recipientPublicKey: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array` -- uses `tweetnacl-sealedbox-js` `open(ciphertext, recipientPublicKey, recipientSecretKey)`
   - `getPublicKeyForAddress(client, address: string): Promise<Uint8Array>` -- query a recent transaction by the address using `queryTransactionSignature(client, address)` (see below), extract Ed25519 public key via `parseSerializedSignature` from `@mysten/sui/cryptography`. After parsing the signature, check `signatureScheme === 'ED25519'`. If the wallet uses Secp256k1 or Secp256r1, throw an error: `'Private maps require an Ed25519 wallet (e.g., EVE Vault)'`. Document this limitation in the UI with a clear error message. Convert the Ed25519 public key to X25519 via `ed25519.utils.toMontgomery(ed25519PubKey)` from `@noble/curves/ed25519.js`. Throws if no transactions found.
   - Requires a new GraphQL query helper to fetch transaction signatures for an address. Add `queryTransactionSignature(client, address)` to `packages/chain-shared/src/graphql-queries.ts` that queries a single recent transaction with the `signatures` field included. Use `parseSerializedSignature` from `@mysten/sui/cryptography` to extract the Ed25519 public key.
   - `encodeLocationData(data: { solarSystemId: number; planet: number; lPoint: number; description?: string }): Uint8Array` -- JSON serialize + UTF-8 encode
   - `decodeLocationData(plaintext: Uint8Array): { solarSystemId: number; planet: number; lPoint: number; description?: string }` -- UTF-8 decode + JSON parse
2. Create `packages/chain-shared/src/types/tweetnacl-sealedbox-js.d.ts` with `declare module 'tweetnacl-sealedbox-js'` type declarations for `seal(message: Uint8Array, recipientPk: Uint8Array): Uint8Array` and `open(ciphertext: Uint8Array, recipientPk: Uint8Array, recipientSk: Uint8Array): Uint8Array | null` since the package ships no TypeScript types. Note: the function is `open`, not `sealOpen` -- this matches the npm package's actual export names (`seal`, `open`, `overheadLength`).
3. Add `tweetnacl`, `tweetnacl-sealedbox-js`, and `@noble/curves` as dependencies of `packages/chain-shared`. `@noble/hashes` is already a transitive dependency but should be added explicitly.
4. Export from `packages/chain-shared/src/index.ts`.
5. Write unit tests for crypto round-trip (seal -> unseal), key derivation determinism, and location data encoding.

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

### Phase 5: Manifest Caching (IndexedDB)

Cache decrypted private map data in the Periscope manifest (same pattern as Characters and Tribes). This avoids re-fetching and re-decrypting on every page load.

1. **`apps/periscope/src/db/types.ts`** -- Add new interfaces:
   ```typescript
   export interface ManifestPrivateMap {
       id: string;              // PrivateMap object ID (primary key)
       name: string;            // Map name
       creator: string;         // Creator address
       publicKey: string;       // Hex-encoded X25519 public key
       decryptedMapKey: string; // Hex-encoded decrypted map secret key (from user's MapInvite)
       inviteId: string;        // The user's MapInvite object ID
       tenant: string;          // "stillness" or "utopia"
       cachedAt: string;        // ISO timestamp
   }

   export interface ManifestMapLocation {
       id: string;              // Composite key: "{mapId}:{locationId}"
       mapId: string;           // PrivateMap object ID
       locationId: number;      // Location ID within the map
       structureId: string | null; // Optional structure link
       solarSystemId: number;   // Decrypted
       planet: number;          // Decrypted
       lPoint: number;          // Decrypted
       description: string;     // Decrypted (empty if none)
       addedBy: string;         // Address that added this location
       addedAtMs: number;       // Timestamp
       tenant: string;
       cachedAt: string;
   }
   ```

2. **`apps/periscope/src/db/index.ts`** -- Add V24 (V23 is reserved for Plan 24 manifest public locations) with new tables:
   ```typescript
   // V24: Private Maps -- encrypted location sharing cache
   this.version(24).stores({
       manifestPrivateMaps: "id, name, creator, tenant, cachedAt",
       manifestMapLocations: "id, mapId, solarSystemId, structureId, tenant, cachedAt, [mapId+locationId]",
   });
   ```

3. **`apps/periscope/src/chain/manifest.ts`** -- Add private map sync functions:
   - `syncPrivateMaps(walletKeyPair)` -- query user's `MapInvite` objects, for each: fetch `PrivateMap` details, decrypt the map key using the wallet-derived X25519 key, cache in `manifestPrivateMaps`. Uses `cachedAt` for staleness (re-sync if >1 hour old).
   - `syncMapLocations(mapId, decryptedMapKey)` -- query all `MapLocation` dynamic fields on the map, decrypt each with the map key, cache in `manifestMapLocations`. Incremental: only fetch locations with `location_id >= nextLocationId` from last sync.
   - `getDecryptedMapLocations(mapId)` -- read from cache, return sorted by `addedAtMs`.
   - `invalidateMapCache(mapId)` -- delete all cached locations for a map (used after key rotation / map deletion).

### Phase 6: Periscope Integration (maps management UI)

1. Create `apps/periscope/src/views/Maps.tsx` -- main view for managing private maps:
   - List all maps the user is invited to (reads from `manifestPrivateMaps` cache)
   - "Create Map" dialog with name field
   - Per-map view showing decrypted locations (reads from `manifestMapLocations` cache), members, "Invite Member" action
   - "Add Location" dialog with system selector, planet/L-point fields, optional structure ID, description
   - "Remove Location" action per location row
   - "Sync" button to force re-fetch from chain
   - Key derivation via `dAppKit.signPersonalMessage({ message })` using `useDAppKit()` from dapp-kit-react
2. Add `useMapKey` hook (`apps/periscope/src/hooks/useMapKey.ts`) -- derives X25519 keypair from wallet, caches in React state (not persisted). Uses `signPersonalMessage` + `deriveMapKeyFromSignature`.
3. Add `usePrivateMaps` hook (`apps/periscope/src/hooks/usePrivateMaps.ts`) -- reads from manifest cache, triggers `syncPrivateMaps` on mount if stale.
4. Add route `/private-maps` to `apps/periscope/src/router.tsx`.
5. Add navigation entry in sidebar.

### Phase 7: ssu-dapp Integration (publish SSU to map)

1. Add "Publish to Map" button in `apps/ssu-dapp/src/views/SsuView.tsx` header area (visible when wallet is connected and user has map invites).
2. Create `apps/ssu-dapp/src/components/PublishToMapDialog.tsx` -- dialog that lists user's maps, encrypts the SSU's location data, and calls `buildAddLocation`.
3. Add `useMapKey` hook to ssu-dapp (same pattern as periscope).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/private_map/Move.toml` | Create | Package manifest with Sui framework dependency |
| `contracts/private_map/sources/private_map.move` | Create | Core contract: PrivateMap, MapInvite, MapLocation, CRUD functions |
| `packages/chain-shared/src/crypto.ts` | Create | Wallet key derivation, X25519, seal/unseal helpers |
| `packages/chain-shared/src/graphql-queries.ts` | Create/Modify | Add queryTransactionSignature helper for fetching tx signatures by address |
| `packages/chain-shared/src/types/tweetnacl-sealedbox-js.d.ts` | Create | Type declarations for tweetnacl-sealedbox-js (no types shipped) |
| `packages/chain-shared/src/private-map.ts` | Create | TX builders + GraphQL queries for private maps |
| `packages/chain-shared/src/types.ts` | Modify | Add PrivateMapInfo, MapInviteInfo, MapLocationInfo, ContractAddresses.privateMap |
| `packages/chain-shared/src/index.ts` | Modify | Add exports for crypto.ts and private-map.ts |
| `packages/chain-shared/src/config.ts` | Modify | Add privateMap packageId to both tenant entries (after deploy) |
| `packages/chain-shared/package.json` | Modify | Add tweetnacl, tweetnacl-sealedbox-js, @noble/curves, @noble/hashes dependencies |
| `apps/periscope/src/db/types.ts` | Modify | Add ManifestPrivateMap and ManifestMapLocation interfaces |
| `apps/periscope/src/db/index.ts` | Modify | Add V24 schema with manifestPrivateMaps + manifestMapLocations tables |
| `apps/periscope/src/chain/manifest.ts` | Modify | Add syncPrivateMaps, syncMapLocations, getDecryptedMapLocations, invalidateMapCache |
| `apps/periscope/src/views/Maps.tsx` | Create | Private maps management UI (reads from manifest cache) |
| `apps/periscope/src/hooks/useMapKey.ts` | Create | Wallet-derived X25519 key hook |
| `apps/periscope/src/hooks/usePrivateMaps.ts` | Create | Reads from manifest cache, triggers sync when stale |
| `apps/periscope/src/router.tsx` | Modify | Add /private-maps route |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | Add Maps nav entry |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Modify | Add "Publish to Map" button |
| `apps/ssu-dapp/src/components/PublishToMapDialog.tsx` | Create | Dialog for publishing SSU location to a map |
| `apps/ssu-dapp/src/hooks/useMapKey.ts` | Create | Wallet-derived X25519 key hook (duplicate of periscope) |

## Open Questions

None -- all resolved.

1. **How does the inviter obtain the invitee's X25519 public key?**
   - **RESOLVED: Transaction signature extraction.** Every Sui transaction signature includes the signer's Ed25519 public key. Query any transaction by the invitee's address, extract the public key from the signature, convert Ed25519 -> X25519 using `@noble/curves`. No registry, no out-of-band exchange. The blockchain itself is the registry. Any active player has at least one transaction (character creation). Add `getPublicKeyForAddress(client, address)` helper to `crypto.ts`.

2. **Should location add be permissionless or require MapInvite proof?**
   - **RESOLVED: Option B (require MapInvite).** `add_location` takes `&MapInvite` and asserts `invite.map_id == object::id(map)`. This prevents spam and ensures only invited members can contribute. Owned objects can be passed as immutable references by their owner in Sui PTBs.

3. **How should member removal work given Sui's owned object model?**
   - **RESOLVED: Option B (revoked blacklist) + Option C (new map for full revocation).** `revoke_member` adds address to `revoked: vector<address>` on PrivateMap. `add_location` checks this list. Cannot delete another user's owned object, so the MapInvite persists -- revoked members can still decrypt existing data. True revocation requires creating a new map.

4. **Should the `useMapKey` hook be duplicated in both periscope and ssu-dapp, or shared?**
   - **RESOLVED: Option A (duplicate).** The hook is small (~20 lines). Duplication is acceptable. If a third consumer appears, extract to a shared hooks package.

## Deferred

- **Cross-map location aggregation** -- Merging locations from multiple maps into a single view (Periscope could query `manifestMapLocations` across all maps). The manifest cache makes this straightforward but defer until basic map CRUD is working.
- **Admin delegation** -- Allowing map members to also invite others (requires an `admins: vector<address>` field). Keep V1 simple with creator-only invites.
- **Map renaming / metadata editing** -- Low priority, add when needed.
- **Bulk operations** -- Adding multiple locations in one TX, inviting multiple members in one TX. PTB composition makes this straightforward but not essential for V1.
- **ssu-market-dapp integration** -- The market dapp could show "Publish to Map" for SSU sellers. Defer until ssu-dapp integration is proven.
- **Map discovery / sharing** -- Public "map directory" where creators can list their maps for others to request invites. Entirely separate feature.
- **Key rotation** -- Re-encrypting all locations with a new key after removing a member. Impractical for V1 (O(n) re-encryption). The documented path is "create new map."
