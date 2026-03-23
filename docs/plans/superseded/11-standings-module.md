# Plan: Standings Module -- Encrypted On-Chain Contact Standings

**Status:** Ready
**Created:** 2026-03-23
**Module:** contracts, chain-shared, periscope

## Overview

Standings are an on-chain "contacts" system that lets players define per-character and per-tribe relationships on a scale from -3 (Opposition) to +3 (Full Trust). Each standings list is a shared Sui object with a name and description, encrypted with the same X25519 key-exchange pattern used by Private Maps. This means standings data is private -- only invited members can read the entries.

The contract stores encrypted standing records as dynamic fields on a shared `StandingsList` object. Members receive a `StandingsInvite` (owned object) containing the list's secret key encrypted with their wallet-derived X25519 public key -- the exact same flow as `MapInvite` in the `private_map` contract. The creator can authorize additional editors who can modify standings (beyond just read access).

This feature will later feed into the ACL system so that gate, turret, and structure extensions can reference standings to determine access. For example, a gate could allow anyone with standing >= 1 ("Friendly") while blocking anyone with standing <= -2 ("Hostile"). That integration is explicitly deferred to a follow-up plan.

## Current State

### Private Maps (the pattern to follow)
- **Move contract:** `contracts/private_map/sources/private_map.move` -- shared `PrivateMap` object, `MapInvite` owned objects, X25519 public key on-chain, encrypted dynamic fields for locations, revoke list.
- **Crypto utilities:** `packages/chain-shared/src/crypto.ts` -- `deriveMapKeyFromSignature()`, `generateEphemeralX25519Keypair()`, `sealForRecipient()`, `unsealWithKey()`, `getPublicKeyForAddress()`, `MAP_KEY_MESSAGE` constant (to be renamed to `ENCRYPTION_KEY_MESSAGE` and updated to `"Frontier Periscope Encryption Key v1"` in Phase 2).
- **TX builders + queries:** `packages/chain-shared/src/private-map.ts` -- `buildCreateMap()`, `buildInviteMember()`, `buildAddLocation()`, `buildRemoveLocation()`, `buildRevokeMember()`, `queryPrivateMap()`, `queryMapInvitesForUser()`, `queryMapLocations()`.
- **Periscope UI:** `apps/periscope/src/views/PrivateMaps.tsx` -- map list, create/invite/add-location dialogs, sync from chain, key derivation via `useStoredMapKey()` hook.
- **Local cache:** `apps/periscope/src/db/types.ts` defines `ManifestPrivateMap` and `ManifestMapLocation`; `apps/periscope/src/db/index.ts` stores them in IndexedDB tables `manifestPrivateMaps` and `manifestMapLocations`.
- **Manifest sync:** `apps/periscope/src/chain/manifest.ts` -- `syncPrivateMapsForUser()`, `decryptMapKeys()`, `syncMapLocations()`.

### ACL Registry (future integration point)
- **Move contract:** `contracts/acl_registry/sources/acl_registry.move` -- `SharedAcl` with `allowed_tribes: vector<u32>` and `allowed_characters: vector<u64>`, admin delegation.
- **Chain-shared:** `packages/chain-shared/src/acl-registry.ts` -- TX builders and query functions.

### Gate Unified (groups model reference)
- **Move contract:** `contracts/gate_unified/sources/config.move` -- `Group` struct with `tribes: vector<u32>` and `characters: vector<u64>`. Shows pattern for named collections of entities.

### Contract conventions
- All contracts use `edition = "2024"` in `Move.toml`.
- Sui framework dependency: `rev = "testnet-v1.66.2"`.
- Contract addresses registered in `packages/chain-shared/src/config.ts` under `CONTRACT_ADDRESSES[tenant]`.
- Extension templates registered in `apps/periscope/src/chain/config.ts` under `EXTENSION_TEMPLATES`.

### Periscope navigation
- Router: `apps/periscope/src/router.tsx` -- TanStack Router, lazy-loaded views.
- Sidebar: `apps/periscope/src/components/Sidebar.tsx` -- icon-based nav items.
- Existing route `/private-maps` shows the pattern for adding a new encrypted shared-data view.

## Target State

### Standing Identifiers

| Value | Label |
|-------|-------|
| 3 | Full Trust |
| 2 | Ally |
| 1 | Friendly |
| 0 | Neutral |
| -1 | Unfriendly |
| -2 | Hostile |
| -3 | Opposition |

### UI Color Scheme

Positive standings use blue shades (lighter for lower values), neutral uses white, and negative standings use red shades (lighter for lower severity):

| Value | Label | Text Class | Background Class |
|-------|-------|------------|-----------------|
| +3 | Full Trust | `text-blue-400` | `bg-blue-400/20` |
| +2 | Ally | `text-blue-300` | `bg-blue-300/20` |
| +1 | Friendly | `text-blue-200` | `bg-blue-200/20` |
| 0 | Neutral | `text-zinc-100` | `bg-zinc-100/20` |
| -1 | Unfriendly | `text-red-200` | `bg-red-200/20` |
| -2 | Hostile | `text-red-300` | `bg-red-300/20` |
| -3 | Opposition | `text-red-400` | `bg-red-400/20` |

### Move Contract: `standings`

A new contract `contracts/standings/` with a single source file `standings.move`. Structure:

**Shared object: `StandingsList`**
```
StandingsList {
    id: UID,
    name: String,
    description: String,
    creator: address,
    public_key: vector<u8>,        // X25519 public key (32 bytes)
    editors: vector<address>,      // addresses authorized to modify standings
    revoked: vector<address>,      // addresses blocked from reading/editing
    next_entry_id: u64,
}
```

**Owned object: `StandingsInvite`**
```
StandingsInvite {
    id: UID,
    list_id: ID,
    sender: address,
    encrypted_list_key: vector<u8>,  // list's X25519 private key, sealed with recipient's public key
}
```

**Dynamic fields (encrypted standing records):**

Dynamic field key: `EntryKey { entry_id: u64 }`
Dynamic field value:
```
StandingEntry {
    entry_id: u64,
    encrypted_data: vector<u8>,   // sealed with list's public key
    added_by: address,
    updated_at_ms: u64,
}
```

The `encrypted_data` for each entry contains a JSON payload (encrypted) with the structure:
```json
{
    "kind": "character" | "tribe",
    "characterId": 12345,          // present when kind=character
    "tribeId": 67,                 // present when kind=tribe
    "standing": 2,                 // -3 to 3
    "label": "Ally",               // human-readable label
    "description": "Trusted trade partner"
}
```

The standing value, kind, and identifiers are all encrypted so observers cannot see who is on anyone's standings list or what their standings are.

**Functions:**
- `create_list(name, description, public_key, self_invite_encrypted_key)` -- creates shared StandingsList + self-invite
- `invite_member(list, recipient, encrypted_list_key)` -- creator only, sends StandingsInvite
- `add_editor(list, editor_address)` -- creator only, authorizes address to modify standings
- `remove_editor(list, editor_address)` -- creator only
- `revoke_member(list, address)` -- creator only, blocks access
- `set_standing(list, invite, entry_id_opt, encrypted_data, clock)` -- add or update a standing entry; invite proves membership (not revoked), must also be creator or in editors list for write access. When `entry_id_opt` is `some(id)`, replaces the existing entry's `encrypted_data` and `updated_at_ms`; when `none`, allocates the next entry_id and creates a new dynamic field.
- `remove_standing(list, entry_id)` -- creator or the address that added the entry (same pattern as `remove_location` in private_map -- no invite required, just creator/added_by check)
- `update_list_info(list, name, description)` -- creator only, updates name/description
- Read accessors for all fields

**Events:**
- `ListCreatedEvent { list_id, creator, name }`
- `MemberInvitedEvent { list_id, recipient, sender }`
- `MemberRevokedEvent { list_id, revoked_address }`
- `EditorAddedEvent { list_id, editor }`
- `EditorRemovedEvent { list_id, editor }`
- `StandingSetEvent { list_id, entry_id, set_by }`
- `StandingRemovedEvent { list_id, entry_id, removed_by }`

### chain-shared: `standings.ts`

New file `packages/chain-shared/src/standings.ts` with:
- TX builders: `buildCreateStandingsList()`, `buildInviteMember()`, `buildAddEditor()`, `buildRemoveEditor()`, `buildRevokeMember()`, `buildSetStanding()`, `buildRemoveStanding()`, `buildUpdateListInfo()`
- Query functions: `queryStandingsList()`, `queryStandingsInvitesForUser()`, `queryStandingEntries()`
- Data encoding: `encodeStandingData()`, `decodeStandingData()`
- Type interfaces for params

### chain-shared: types and config

- New types in `packages/chain-shared/src/types.ts`:
  - `StandingsListInfo { objectId, name, description, creator, publicKey, editors, nextEntryId }`
  - `StandingsInviteInfo { objectId, listId, sender, encryptedListKey }`
  - `StandingEntryInfo { entryId, encryptedData, addedBy, updatedAtMs }`
  - `StandingData { kind, characterId?, tribeId?, standing, label, description }`
- New entry in `ContractAddresses`: `standings?: { packageId: string }`
- New entry in `CONTRACT_ADDRESSES` for utopia tenant (populated after publish)

### Periscope DB

New types in `apps/periscope/src/db/types.ts`:
```
ManifestStandingsList {
    id: string;              // StandingsList object ID
    name: string;
    description: string;
    creator: string;
    publicKey: string;       // hex
    decryptedListKey?: string; // hex, populated after decryption
    encryptedListKey?: string; // hex, from invite
    inviteId: string;
    editors: string[];       // editor addresses
    isEditor: boolean;       // whether current user is an editor
    tenant: string;
    cachedAt: string;
}

ManifestStandingEntry {
    id: string;              // "{listId}:{entryId}"
    listId: string;
    entryId: number;
    kind: "character" | "tribe";
    characterId?: number;
    tribeId?: number;
    standing: number;        // -3 to 3
    label: string;
    description: string;
    addedBy: string;
    updatedAtMs: number;
    tenant: string;
    cachedAt: string;
}
```

New DB version 25 in `apps/periscope/src/db/index.ts` (current latest is version 24) adding:
- `manifestStandingsLists` table with indexes: `id, name, creator, tenant, cachedAt`
- `manifestStandingEntries` table with indexes: `id, listId, kind, standing, tenant, [listId+kind]`

### Periscope UI: `/standings` route

New view `apps/periscope/src/views/Standings.tsx` (lazy-loaded) with:
- **List panel** (left): shows all standings lists the user has access to, with create button
- **Detail panel** (right): shows entries for the selected list, filterable by kind (character/tribe) and standing value
- **Create dialog**: name, description fields; generates ephemeral X25519 keypair, creates list + self-invite
- **Invite dialog**: recipient address input, fetches their X25519 public key from chain, seals list key
- **Add/Edit standing dialog**: character search or tribe ID input, standing slider (-3 to +3), description field
- **Editor management**: creator can add/remove editors from the detail panel header

The UI will reuse the wallet-derived X25519 keypair from private maps. The `useStoredMapKey()` hook is currently defined inline in `apps/periscope/src/views/PrivateMaps.tsx` -- it should be extracted to a shared hook at `apps/periscope/src/hooks/useStoredEncryptionKey.ts` so both PrivateMaps and Standings can use it. The hook will be renamed to `useStoredEncryptionKey()` to be feature-agnostic, and internally it uses the updated `ENCRYPTION_KEY_MESSAGE` constant (`"Frontier Periscope Encryption Key v1"`).

### Manifest sync functions

New functions in `apps/periscope/src/chain/manifest.ts`:
- `syncStandingsListsForUser()` -- discovers StandingsInvite objects owned by the user
- `decryptStandingsKeys()` -- decrypts list keys using wallet keypair
- `syncStandingEntries()` -- fetches and decrypts dynamic field entries

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Encryption model | X25519 sealed boxes (same as private maps) | Proven pattern in the codebase, wallet-derived keys, no new crypto deps |
| Standing range | Integer -3 to +3 (7 levels) | Granular enough for game use cases without being overwhelming |
| On-chain storage | Shared StandingsList + encrypted dynamic fields | Follows private_map pattern exactly; shared object allows multi-writer |
| Editor authorization | Explicit `editors` vector on StandingsList | Simpler than invite-based write access; creator manages who can edit |
| Entry structure | All data encrypted in a single blob per entry | Prevents observers from correlating character/tribe IDs with standings |
| Key reuse | Single wallet-derived X25519 keypair for all encrypted features | One signature prompt derives a key used by both private maps and standings; `ENCRYPTION_KEY_MESSAGE` is the shared derivation message |
| Utopia-only target | Only populate utopia contract addresses | Stillness support deferred per project requirements |
| Contract name | `standings` (not `contacts`) | "Standings" better describes the relationship-rating nature; "contacts" implies an address book |
| Set/update API | Single `set_standing` with optional entry_id | Simpler API surface; caller passes `Option<u64>` -- `some(id)` for update, `none` for create. Matches private_map pattern and simplifies the TX builder layer |
| List metadata privacy | Plaintext name and description | List name is already visible as a shared object on-chain. Description helps members identify which list to use. The critical privacy is in the entries themselves, which are fully encrypted |
| Encryption key message | Generalized `"Frontier Periscope Encryption Key v1"` | One key for all encrypted features, clean semantics. Breaking change for existing private map users (they re-derive their key). Constant renamed from `MAP_KEY_MESSAGE` to `ENCRYPTION_KEY_MESSAGE` |
| Entry count limit | No limit | Sui dynamic fields handle large counts well; standings lists expected to have hundreds of entries at most (~3,000 total players). Gas pagination handled in UI if needed |
| UI color scheme | Blue (positive) / White (neutral) / Red (negative) | Three shades per polarity using Tailwind utility classes; intuitive color language for trust/threat at a glance |

## Implementation Phases

### Phase 1: Move Contract

1. Create `contracts/standings/Move.toml` with `edition = "2024"`, Sui dependency `rev = "testnet-v1.66.2"`, placeholder address `0x0`.
2. Create `contracts/standings/sources/standings.move` with:
   - Error codes (ENotCreator, ENotEditor, EEntryNotFound, ENotEntryOwner, EInviteNotForThisList, EMemberRevoked, EAlreadyRevoked, EInvalidPublicKeyLength, EEditorAlreadyExists, EEditorNotFound, ECannotRemoveCreator)
   - Structs: StandingsList, StandingsInvite, EntryKey, StandingEntry
   - Events: ListCreatedEvent, MemberInvitedEvent, MemberRevokedEvent, EditorAddedEvent, EditorRemovedEvent, StandingSetEvent, StandingRemovedEvent
   - Functions: create_list, invite_member, add_editor, remove_editor, revoke_member, set_standing, remove_standing, update_list_info
   - Read accessors for all fields
   - `is_editor()` helper that returns true for creator or anyone in editors list
3. Write comprehensive tests following private_map test patterns:
   - test_create_list_and_self_invite
   - test_invite_member
   - test_non_creator_cannot_invite
   - test_add_and_remove_editor
   - test_editor_can_set_standing
   - test_non_editor_cannot_set_standing (member with invite but not editor)
   - test_set_standing_new_and_update
   - test_remove_standing_by_creator
   - test_remove_standing_by_adder
   - test_unauthorized_remove_standing
   - test_revoke_member
   - test_revoked_member_cannot_set_standing
   - test_update_list_info
   - test_invalid_public_key_length
4. Run `sui move test` to verify all tests pass.

### Phase 2: chain-shared Integration

1. In `packages/chain-shared/src/crypto.ts`, rename `MAP_KEY_MESSAGE` to `ENCRYPTION_KEY_MESSAGE` and update its value to `"Frontier Periscope Encryption Key v1"`. This is a breaking change -- existing private map users will need to re-derive their key on next use.
2. Update all imports/references to `MAP_KEY_MESSAGE` across the codebase (primarily `packages/chain-shared/src/index.ts` re-export and any consumers in `apps/periscope/`) to use `ENCRYPTION_KEY_MESSAGE`.
3. Add `StandingsListInfo`, `StandingsInviteInfo`, `StandingEntryInfo`, and `StandingData` interfaces to `packages/chain-shared/src/types.ts`.
4. Add `standings?: { packageId: string }` to `ContractAddresses` in `packages/chain-shared/src/types.ts`.
5. Create `packages/chain-shared/src/standings.ts` with:
   - TX builders: `buildCreateStandingsList()`, `buildInviteStandingsMember()`, `buildAddEditor()`, `buildRemoveEditor()`, `buildRevokeStandingsMember()`, `buildSetStanding()`, `buildRemoveStanding()`, `buildUpdateListInfo()`
   - Query functions: `queryStandingsList()`, `queryStandingsInvitesForUser()`, `queryStandingEntries()`
   - Data helpers: `encodeStandingData()`, `decodeStandingData()`, `STANDING_LABELS` constant map
6. Export from `packages/chain-shared/src/index.ts`.
7. Run `pnpm build` in chain-shared to verify types compile.

### Phase 3: Publish Contract & Register Addresses

1. Publish `contracts/standings/` to Sui testnet (Utopia).
2. Update `contracts/standings/Move.toml` with the published address.
3. Add package ID to `packages/chain-shared/src/config.ts` under `CONTRACT_ADDRESSES.utopia.standings`.
4. Run `pnpm build` to verify no regressions.

### Phase 4: Periscope DB & Manifest Sync

1. Add `ManifestStandingsList` and `ManifestStandingEntry` types to `apps/periscope/src/db/types.ts`.
2. Add DB version 25 in `apps/periscope/src/db/index.ts` (current latest is v24) with `manifestStandingsLists` and `manifestStandingEntries` tables.
3. Add sync functions to `apps/periscope/src/chain/manifest.ts`:
   - `syncStandingsListsForUser()` -- pattern from `syncPrivateMapsForUser()`
   - `decryptStandingsKeys()` -- pattern from `decryptMapKeys()`
   - `syncStandingEntries()` -- pattern from `syncMapLocations()`
4. Run `pnpm build` in periscope to verify.

### Phase 5: Periscope UI

1. Extract `useStoredMapKey()` from `apps/periscope/src/views/PrivateMaps.tsx` into `apps/periscope/src/hooks/useStoredEncryptionKey.ts` (rename to `useStoredEncryptionKey()`). Update PrivateMaps.tsx to import from the shared hook.
2. Create `apps/periscope/src/views/Standings.tsx` with:
   - List panel showing all accessible standings lists (from manifestStandingsLists)
   - Detail panel showing entries for selected list
   - Standing value display with color-coded badges per the UI Color Scheme (blue shades for positive, white for neutral, red shades for negative)
   - Filter/search by kind (character/tribe), standing range, text search
3. Add "Create Standings List" dialog:
   - Name and description inputs
   - Generates ephemeral X25519 keypair
   - Builds and signs create_list transaction
   - Auto-syncs after creation
4. Add "Invite Member" dialog:
   - Recipient address input (with character search)
   - Fetches recipient's X25519 public key via `getPublicKeyForAddress()`
   - Encrypts list key for recipient
   - Builds and signs invite_member transaction
5. Add "Set Standing" dialog:
   - Kind selector (character / tribe)
   - For characters: reuse existing `ContactPicker` component (`apps/periscope/src/components/ContactPicker.tsx`)
   - For tribes: simple search/select from `manifestTribes` table in local DB (no existing tribe picker component exists)
   - Standing slider/select (-3 to +3) with label display
   - Description text input
   - Encrypts entry data, builds set_standing transaction
6. Add "Editor Management" section in list header:
   - Show current editors
   - Add/remove editor buttons (creator only)
7. Add route `/standings` in `apps/periscope/src/router.tsx` (lazy-loaded).
8. Add sidebar entry in `apps/periscope/src/components/Sidebar.tsx` in the "Intelligence" section (after "Private Maps") with `BookUser` icon from lucide-react and "Standings" label. Note: `Users` icon is already used for "Players".
9. Run `pnpm build` to verify full build passes.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/standings/Move.toml` | Create | Package manifest with Sui dependency |
| `contracts/standings/sources/standings.move` | Create | Move contract: StandingsList, StandingsInvite, StandingEntry, all functions + tests |
| `packages/chain-shared/src/crypto.ts` | Modify | Rename `MAP_KEY_MESSAGE` to `ENCRYPTION_KEY_MESSAGE`, update value to `"Frontier Periscope Encryption Key v1"` |
| `packages/chain-shared/src/types.ts` | Modify | Add StandingsListInfo, StandingsInviteInfo, StandingEntryInfo, StandingData types; add standings to ContractAddresses |
| `packages/chain-shared/src/standings.ts` | Create | TX builders, query functions, data encoding for standings |
| `packages/chain-shared/src/config.ts` | Modify | Add standings package ID to CONTRACT_ADDRESSES.utopia |
| `packages/chain-shared/src/index.ts` | Modify | Re-export standings module |
| `apps/periscope/src/db/types.ts` | Modify | Add ManifestStandingsList, ManifestStandingEntry types |
| `apps/periscope/src/db/index.ts` | Modify | Add new DB version with standings tables |
| `apps/periscope/src/chain/manifest.ts` | Modify | Add syncStandingsListsForUser, decryptStandingsKeys, syncStandingEntries |
| `apps/periscope/src/hooks/useStoredEncryptionKey.ts` | Create | Extracted from PrivateMaps.tsx -- shared wallet-derived X25519 keypair hook |
| `apps/periscope/src/views/PrivateMaps.tsx` | Modify | Replace inline `useStoredMapKey()` with import from shared hook |
| `apps/periscope/src/views/Standings.tsx` | Create | Main standings UI view with list/detail panels and dialogs |
| `apps/periscope/src/router.tsx` | Modify | Add /standings route (lazy-loaded) |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | Add Standings nav item with BookUser icon in Intelligence section |

## Open Questions

None -- all resolved. See Design Decisions table for outcomes.

## Deferred

- **ACL integration** -- Tying standings into gate/turret/structure access control. Will require a new extension contract that reads standings via `borrow_standing()` or similar. Deferred to a separate plan once the base standings module is live and tested.
- **Stillness support** -- Only targeting Utopia for now. Stillness deployment can be done by simply publishing the same contract to the Stillness network and adding the package ID.
- **Standings aggregation across lists** -- A user may be in multiple standings lists with different ratings. How to resolve conflicts (e.g., "Ally" in one list, "Hostile" in another) is deferred to the ACL integration plan.
- **Standings import/export** -- Bulk import from CSV or sharing standings data outside the encryption system. Deferred to post-launch iteration.
- **Standing change history** -- Tracking when standings change over time. Could be done via events (already emitted) but UI display is deferred.
- **Contact picker integration** -- The character search component already exists; deeper integration with standings (e.g., showing standing badge next to character names across the app) is deferred.
