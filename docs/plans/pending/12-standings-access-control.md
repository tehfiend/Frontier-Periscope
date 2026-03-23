# Plan: Standings & Access Control System

**Status:** Draft
**Created:** 2026-03-23
**Module:** contracts, chain-shared, periscope

## Overview

The Standings & Access Control system replaces the encrypted standings approach (plan 11) with a simpler, plaintext on-chain model. Instead of encrypted standing entries that only invited members can read, standings are stored as plaintext u8 values (0-6, representing -3 to +3) in a shared `StandingsRegistry` object. This makes them directly readable by extension contracts (gates, turrets, SSUs) without requiring decryption -- enabling real-time on-chain access control based on diplomatic relationships.

The system has three on-chain components: (1) a `standings_registry` contract that stores named standings registries with per-tribe and per-character standing values, (2) a `gate_standings` extension that checks a character's standing against configurable thresholds to block, toll, or grant free passage, and (3) an `ssu_standings` extension that restricts inventory deposit/withdraw based on standing thresholds. A turret integration is deferred because the game server's `devInspect` call for turret extensions uses a fixed function signature that does not pass additional shared objects -- the existing `turret_priority` code generator can be enhanced to read from a StandingsRegistry instead.

On the client side, Periscope adds a local-only Contacts system (IndexedDB) for private per-character notes and standings that are NOT on-chain, plus a Registry Discovery UI for browsing and subscribing to on-chain StandingsRegistry objects. The existing encrypted standings contract (`contracts/standings/`) and its chain-shared/Periscope integrations are superseded by this plan.

## Current State

### Existing encrypted standings (being superseded)
- **Move contract:** `contracts/standings/sources/standings.move` -- encrypted `StandingsList` shared object with X25519 key exchange, `StandingsInvite` owned objects, encrypted `StandingEntry` dynamic fields. Published to Utopia at `0xb1e222afffd559191bb909784e139d4ec7c044f57f2be2a376548c63c5d35abd`.
- **chain-shared:** `packages/chain-shared/src/standings.ts` -- TX builders (`buildCreateStandingsList`, `buildSetStanding`, etc.) and query functions (`queryStandingsList`, `queryStandingEntries`) for the encrypted model.
- **chain-shared types:** `packages/chain-shared/src/types.ts` -- `StandingsListInfo`, `StandingsInviteInfo`, `StandingEntryInfo`, `StandingData` interfaces. `ContractAddresses.standings` already defined.
- **chain-shared config:** `packages/chain-shared/src/config.ts` -- standings packageId populated for utopia, empty for stillness.
- **Periscope DB:** `apps/periscope/src/db/types.ts` -- `ManifestStandingsList`, `ManifestStandingEntry` types. DB version 25 in `apps/periscope/src/db/index.ts` with `manifestStandingsLists` and `manifestStandingEntries` tables.
- **Periscope UI:** `apps/periscope/src/views/Standings.tsx` exists (current encrypted standings view).

### Shared ACL Registry (reference pattern for shared objects)
- **Move contract:** `contracts/acl_registry/sources/acl_registry.move` -- `SharedAcl` shared object with `creator`, `admins`, `is_allowlist`, `allowed_tribes: vector<u32>`, `allowed_characters: vector<u64>`. Published at `0x3b1cdef2e8ddbd17618357a2ea8101073f881086442507e722cb02aa3ffc3b55`.
- **chain-shared:** `packages/chain-shared/src/acl-registry.ts` -- TX builders and queries including `queryAllSharedAcls()` which discovers objects by type.

### Gate Unified (group + toll pattern)
- **Move contract:** `contracts/gate_unified/sources/gate_unified.move` and `config.move` -- group-based ACL + toll. Per-gate config stored as dynamic fields keyed by gate ID. `ExtensionConfig` shared object with `owner`, `admins`, `groups`. `GateConfig` has `is_allowlist`, `access_group_ids`, `permit_duration_ms`, `toll_fee`, `toll_recipient`, `toll_exempt_group_ids`. Uses `gate::issue_jump_permit<GateUnifiedAuth>()` for permit issuance. Published (stillness+utopia).

### Gate ACL with SharedAcl reference (reference-by-ID pattern)
- **Move contract:** `contracts/gate_acl/sources/gate_acl.move` -- `can_jump_shared()` takes a `&SharedAcl` argument, verifies `object::id(shared_acl) == configured_acl_id`, then checks standings. `SharedAclConfig` dynamic field stores `{ shared_acl_id: ID, permit_duration_ms: u64 }`. This is the closest pattern for how `gate_standings` should reference a `StandingsRegistry`.

### Gate Toll (toll payment pattern)
- **Move contract:** `contracts/gate_toll/sources/gate_toll.move` -- `Coin<T>` payment with free-pass list. `coin::split()`, `transfer::public_transfer()` pattern for collecting tolls.

### Turret Priority (turret targeting pattern)
- **Move contract:** `contracts/turret_priority/sources/turret_priority.move` -- compile-time config via constants (friendly/KOS lists, weight constants). Uses `turret::unpack_candidate_list()`, `turret::new_return_target_priority_list()`, `turret::destroy_online_receipt()`. Weight constants: `DEFAULT_WEIGHT=30`, `KOS_WEIGHT=100`, `AGGRESSOR_BONUS=40`, `BETRAYAL_BONUS=50`.

### Turret Shoot All (simpler turret pattern)
- **Move contract:** `contracts/turret_shoot_all/sources/turret_shoot_all.move` -- equal weight (100) for all candidates. Simplest turret extension reference.

### Contract conventions
- All contracts use `edition = "2024"` in `Move.toml`.
- World contracts dependency: `rev = "v0.0.21"` (gate_unified uses this).
- Sui framework dependency: `rev = "testnet-v1.66.2"` (acl_registry uses this).
- Extension contracts with shared config use `init()` to `transfer::share_object()` the config.
- Periscope extension templates in `apps/periscope/src/chain/config.ts` -- `EXTENSION_TEMPLATES` array with `id`, `name`, `description`, `assemblyTypes`, `hasConfig`, `packageIds`, `configObjectIds`, `witnessType`.
- Contract addresses in `packages/chain-shared/src/config.ts` -- `CONTRACT_ADDRESSES[tenant]`.
- chain-shared types in `packages/chain-shared/src/types.ts`.

### Periscope DB patterns
- Dexie (IndexedDB) with versioned schema at `apps/periscope/src/db/index.ts`. Current latest is version 25.
- Type definitions at `apps/periscope/src/db/types.ts`.
- Views typically use `useLiveQuery()` from dexie-react-hooks for reactive reads.

## Target State

### 1. StandingsRegistry Contract (`contracts/standings_registry/`)

A new standalone contract (no world dependency). Creates a shared `StandingsRegistry` object that any extension can reference by ID.

**Shared object: `StandingsRegistry`**
```
StandingsRegistry {
    id: UID,
    owner: address,
    admins: vector<address>,
    name: vector<u8>,
    ticker: vector<u8>,        // 3-6 chars, [A-Z0-9], enforced on-chain
    default_standing: u8,      // for unregistered entities (usually 3 = Neutral)
}
```

**Dynamic fields for per-entity standings:**
- Key: `TribeKey { tribe_id: u32 }` -> Value: `u8` (standing 0-6)
- Key: `CharKey { char_id: u64 }` -> Value: `u8` (standing 0-6)

**Standing scale (u8 on-chain, displayed as -3 to +3):**

| u8 Value | Display | Label |
|----------|---------|-------|
| 0 | -3 | Opposition |
| 1 | -2 | Hostile |
| 2 | -1 | Unfriendly |
| 3 | 0 | Neutral |
| 4 | +1 | Friendly |
| 5 | +2 | Ally |
| 6 | +3 | Full Trust |

**Functions:**
- `create_registry(name, ticker, default_standing, ctx)` -- creates shared StandingsRegistry. Validates ticker format (3-6 chars, `[A-Z0-9]`). Emits `RegistryCreatedEvent`.
- `set_tribe_standing(registry, tribe_id, standing, ctx)` -- admin only. Adds or updates dynamic field. Validates standing 0-6. Emits `StandingUpdatedEvent`.
- `set_character_standing(registry, char_id, standing, ctx)` -- admin only. Same pattern.
- `remove_tribe_standing(registry, tribe_id, ctx)` -- admin only. Removes dynamic field (entity reverts to default_standing). Emits `StandingRemovedEvent`.
- `remove_character_standing(registry, char_id, ctx)` -- admin only.
- `set_default_standing(registry, standing, ctx)` -- owner only. Updates default for unregistered entities.
- `update_info(registry, name, ticker, ctx)` -- owner only. Validates ticker format.
- `add_admin(registry, admin, ctx)` -- owner only.
- `remove_admin(registry, admin, ctx)` -- owner only. Cannot remove owner.
- `get_tribe_standing(registry, tribe_id): u8` -- returns standing or default_standing.
- `get_character_standing(registry, char_id): u8` -- returns standing or default_standing.
- `get_standing(registry, tribe_id, char_id): u8` -- checks character first, then tribe, falls back to default. This is the primary lookup used by extension contracts.
- Read accessors: `owner()`, `admins()`, `name()`, `ticker()`, `default_standing()`, `is_admin()`.

**Events:**
- `RegistryCreatedEvent { registry_id, name, ticker, creator }`
- `StandingUpdatedEvent { registry_id, kind (0=tribe, 1=character), entity_id: u64, standing }`
- `StandingRemovedEvent { registry_id, kind, entity_id }`

**Error codes:**
- `ENotAdmin` (0), `ENotOwner` (1), `EInvalidStanding` (2), `EInvalidTicker` (3), `EAdminAlreadyExists` (4), `EAdminNotFound` (5), `ECannotRemoveOwner` (6), `EStandingNotFound` (7), `ETickerTooShort` (8), `ETickerTooLong` (9)

### 2. Gate Standings Extension (`contracts/gate_standings/`)

Extension contract that references a `StandingsRegistry` for gate access control. Depends on world contracts (for `Gate`, `Character`, `gate::issue_jump_permit`) and `standings_registry`.

**Shared config: `GateStandingsConfig` (created at init)**
```
GateStandingsConfig {
    id: UID,
    owner: address,
    admins: vector<address>,
}
```

**Per-gate config as dynamic field keyed by gate ID:**
```
GateStandingsRule {
    registry_id: ID,           // which StandingsRegistry to check
    min_access: u8,            // minimum standing to pass (below = blocked)
    free_access: u8,           // minimum standing for free passage
    toll_fee: u64,             // toll for standings between min_access and free_access
    toll_recipient: address,
    permit_duration_ms: u64,
}
```

**Functions:**
- `can_jump<T>(source_gate, dest_gate, character, payment, config, registry, clock, ctx)` -- looks up character's standing in registry, compares against gate's thresholds, blocks/tolls/passes.
- `can_jump_free(source_gate, dest_gate, character, config, registry, clock, ctx)` -- toll-free path (for characters who expect to be above free_access threshold).
- `set_gate_config(config, gate_id, registry_id, min_access, free_access, toll_fee, toll_recipient, permit_duration_ms, ctx)` -- admin only.
- `remove_gate_config(config, gate_id, ctx)` -- admin only.
- Admin management: `add_admin()`, `remove_admin()` (owner only).
- Read accessors: `has_gate_config()`, `get_gate_config()`.

**Witness type:** `GateStandingsAuth`

**Flow:** character tries to jump -> contract reads `get_standing(registry, char_tribe, char_id)` -> compares to `min_access` (block if below) -> compares to `free_access` (free if at/above) -> otherwise requires toll payment.

### 3. Turret Standings -- Deferred (code generator approach)

**Key constraint:** The game server calls turret extensions via `devInspect` with a fixed function signature: `get_target_priority_list(turret, character, target_candidate_list, receipt)`. The server does NOT pass additional shared objects (like a StandingsRegistry). This means a turret extension **cannot dynamically read** from a StandingsRegistry at runtime.

**Implication:** A `turret_standings` contract would need to bake friend/foe lists into compile-time constants (the same pattern as `turret_priority`). The only value-add would be a **code generator** that reads from a StandingsRegistry and generates the Move source with the current standings baked in as friendly/KOS tribe/character constants. This is functionally equivalent to `turret_priority` with a different data source for the constants.

**Decision:** Defer `turret_standings` to a follow-up. The existing `turret_priority` code generator (`packages/chain-shared/src/turret-priority.ts`) already handles custom friend/KOS lists. A future enhancement could add a "Generate from Registry" button in the Periscope UI that reads a StandingsRegistry and auto-populates the turret_priority config. This approach reuses existing infrastructure rather than creating a new contract that adds no on-chain capability.

### 4. SSU Standings Extension (`contracts/ssu_standings/`)

Extension that references a `StandingsRegistry` for SSU inventory access control. Depends on world contracts (for `StorageUnit`, `Character`, inventory types) and `standings_registry`.

**Shared config: `SsuStandingsConfig` (created at init)**
```
SsuStandingsConfig {
    id: UID,
    owner: address,
    admins: vector<address>,
}
```

**Per-SSU config as dynamic field keyed by SSU ID:**
```
SsuStandingsRule {
    registry_id: ID,
    min_deposit: u8,     // minimum standing to deposit
    min_withdraw: u8,    // minimum standing to withdraw
}
```

**Functions:**
- `can_deposit(storage_unit, character, config, registry, ctx)` -- checks standing >= min_deposit.
- `can_withdraw(storage_unit, character, config, registry, ctx)` -- checks standing >= min_withdraw.
- Config management: `set_ssu_config()`, `remove_ssu_config()`, admin management.

**Witness type:** `SsuStandingsAuth`

### 5. chain-shared Updates

**New file: `packages/chain-shared/src/standings-registry.ts`**
- TX builders: `buildCreateRegistry()`, `buildSetTribeStanding()`, `buildSetCharacterStanding()`, `buildRemoveTribeStanding()`, `buildRemoveCharacterStanding()`, `buildSetDefaultStanding()`, `buildUpdateRegistryInfo()`, `buildAddRegistryAdmin()`, `buildRemoveRegistryAdmin()`
- Query functions: `queryRegistryDetails()`, `queryAllRegistries()` (by type), `queryRegistryStandings()` (enumerate dynamic fields for tribe/char standings)
- Constants: `STANDING_LABELS`, `standingToDisplay()`, `displayToStanding()`

**Modify: `packages/chain-shared/src/types.ts`**
- Replace `StandingsListInfo` etc. with new types: `StandingsRegistryInfo { objectId, owner, admins, name, ticker, defaultStanding }`, `RegistryStandingEntry { kind, tribeId?, characterId?, standing }`
- Add `standingsRegistry?: { packageId: string }` to `ContractAddresses`
- Add `gateStandings?: { packageId: string; configObjectId: string }` to `ContractAddresses`
- Add `ssuStandings?: { packageId: string; configObjectId: string }` to `ContractAddresses`
- Keep `standings` field for backwards compat (the encrypted contract still exists on-chain)

**Modify: `packages/chain-shared/src/config.ts`**
- Add `standingsRegistry`, `gateStandings`, `ssuStandings` entries (empty initially, populated after publish)

**Modify: `packages/chain-shared/src/index.ts`**
- Export new `standings-registry` module

### 6. Periscope: Client-Side Contacts (Local Only)

New IndexedDB table for local-only contacts (NOT on-chain).

**New types in `apps/periscope/src/db/types.ts`:**
```typescript
interface Contact {
    id: string;              // UUID
    kind: "character" | "tribe";
    characterId?: number;    // when kind=character
    characterName?: string;
    tribeId?: number;        // when kind=tribe
    tribeName?: string;
    standing: number;        // -3 to +3
    label: string;           // standing label
    notes: string;           // free-text private notes
    createdAt: string;
    updatedAt: string;
}
```

**New DB version 26** (or next available) adding `contacts` table.

### 7. Periscope: Registry Discovery & Subscribe

**New types in `apps/periscope/src/db/types.ts`:**
```typescript
interface SubscribedRegistry {
    id: string;              // StandingsRegistry object ID
    name: string;
    ticker: string;
    creator: string;         // address
    creatorName?: string;    // resolved character name
    defaultStanding: number;
    subscribedAt: string;
    lastSyncedAt?: string;
    tenant: string;
}

interface RegistryStanding {
    id: string;              // "{registryId}:{kind}:{entityId}"
    registryId: string;
    kind: "character" | "tribe";
    characterId?: number;
    tribeId?: number;
    standing: number;        // 0-6 (raw u8)
    cachedAt: string;
}
```

**New DB version** adding `subscribedRegistries` and `registryStandings` tables.

### 8. Periscope UI Updates

**Replace `apps/periscope/src/views/Standings.tsx`** with new view containing:
- **Contacts tab:** Local contacts management (add/edit/remove, search, standing badges with colors)
- **Registries tab:** Browse/subscribe to on-chain registries, view standings in subscribed registries
- **Registry admin tab:** Create/manage own registries (add tribes/characters, set standings, manage admins)

**Extension template additions** in `apps/periscope/src/chain/config.ts`:
- `gate_standings` template
- `ssu_standings` template

### UI Colors

| Value | Label | Text Class | Background Class |
|-------|-------|------------|-----------------|
| +3 | Full Trust | `text-blue-400` | `bg-blue-400/20` |
| +2 | Ally | `text-blue-300` | `bg-blue-300/20` |
| +1 | Friendly | `text-blue-200` | `bg-blue-200/20` |
| 0 | Neutral | `text-zinc-100` | `bg-zinc-100/20` |
| -1 | Unfriendly | `text-red-200` | `bg-red-200/20` |
| -2 | Hostile | `text-red-300` | `bg-red-300/20` |
| -3 | Opposition | `text-red-400` | `bg-red-400/20` |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Plaintext vs encrypted standings | Plaintext u8 values | Extension contracts need to read standings at runtime; encrypted values require off-chain decryption which is incompatible with on-chain access control checks |
| Standing storage | Dynamic fields per entity (TribeKey/CharKey -> u8) | Efficient per-entity lookup; no need to enumerate all standings to check one character. Dynamic fields scale to thousands of entries without gas issues |
| Ticker format | 3-6 chars, `[A-Z0-9]`, enforced on-chain | Short display identifier for registries (e.g., "-3 (BURQE)"). Not globally unique -- object ID is the real identifier |
| Standing scale | u8 0-6 on-chain, displayed as -3 to +3 | u8 avoids signed integer complexity in Move; simple arithmetic conversion (display = raw - 3) |
| Lookup priority | Character standing > Tribe standing > Default | Character-level overrides allow exceptions to tribe-wide settings (e.g., a friendly individual in a hostile tribe) |
| Turret integration | Deferred -- enhance turret_priority generator | Game server calls turret extensions via `devInspect` with fixed signature `(turret, character, candidates, receipt)`. Cannot pass additional shared objects, so turret_standings would be functionally identical to turret_priority. Better to add a "Generate from Registry" feature to the existing turret_priority code generator |
| Gate config model | Shared ExtensionConfig + dynamic fields | Gates are called in real transactions (not devInspect), so shared config objects are fine. Follows `gate_unified` pattern |
| SSU config model | Shared ExtensionConfig + dynamic fields | Same reasoning as gates -- real transactions with shared objects |
| Client-side contacts | IndexedDB only, NOT on-chain | Private notes and personal standings should never be publicly visible. On-chain registries are for shared/organizational use |
| Registry discovery | Query by type via GraphQL | Same pattern as `queryAllSharedAcls()` in `acl-registry.ts`. Discovers all `StandingsRegistry` objects on-chain |
| Existing encrypted standings | Keep contract on-chain, supersede in code | Contract is already published and immutable. Remove references from active code paths but keep `ContractAddresses.standings` for any existing users |
| UI colors | Blue positive / White neutral / Red negative | Intuitive trust/threat color language, 3 shades per polarity using Tailwind utilities |
| Gate toll currency | Generic `Coin<T>` | Same pattern as `gate_toll` and `gate_unified` -- supports any Sui coin type |
| No world dependency for registry | Standalone Sui-only contract | StandingsRegistry is extension-agnostic (like SharedAcl). Only extension contracts depend on world |

## Implementation Phases

### Phase 1: StandingsRegistry Contract

1. Create `contracts/standings_registry/Move.toml` with `edition = "2024"`, Sui dependency `rev = "testnet-v1.66.2"`, address `standings_registry = "0x0"`. Pattern matches `contracts/acl_registry/Move.toml` (Sui-only, no world dep).
2. Create `contracts/standings_registry/sources/standings_registry.move` with:
   - Error codes: `ENotAdmin` (0), `ENotOwner` (1), `EInvalidStanding` (2), `EInvalidTicker` (3), `EAdminAlreadyExists` (4), `EAdminNotFound` (5), `ECannotRemoveOwner` (6), `EStandingNotFound` (7), `ETickerTooShort` (8), `ETickerTooLong` (9)
   - Structs: `StandingsRegistry` (shared, key), `TribeKey` (copy, drop, store), `CharKey` (copy, drop, store)
   - Events: `RegistryCreatedEvent`, `StandingUpdatedEvent`, `StandingRemovedEvent`
   - Ticker validation helper: check each byte is `A-Z` (65-90) or `0-9` (48-57), length 3-6
   - `create_registry()`: validate ticker, create shared object, emit event. Use `#[allow(lint(share_owned))]`.
   - Standing CRUD: `set_tribe_standing()`, `set_character_standing()`, `remove_tribe_standing()`, `remove_character_standing()` -- all admin-only, validate standing 0-6, use `dynamic_field::add/borrow_mut/remove`.
   - `get_standing(registry, tribe_id, char_id): u8` -- check `CharKey` dynamic field first, then `TribeKey`, fall back to `default_standing`. This is the primary lookup function used by extensions.
   - `get_tribe_standing()`, `get_character_standing()` -- individual lookups (return default if not found).
   - Owner-only: `set_default_standing()`, `update_info()`, `add_admin()`, `remove_admin()`.
   - Read accessors: `owner()`, `admins()`, `name()`, `ticker()`, `default_standing()`, `is_admin()`.
3. Write tests:
   - `test_create_registry` -- validates creation, ticker, events
   - `test_invalid_ticker` -- too short, too long, invalid chars (lowercase, special)
   - `test_set_and_get_standings` -- tribe and character standings
   - `test_standing_priority` -- character standing overrides tribe standing
   - `test_default_standing` -- unregistered entities get default
   - `test_remove_standing` -- entity reverts to default
   - `test_admin_management` -- add/remove admins, non-admin rejection
   - `test_owner_only_operations` -- non-owner cannot manage admins or defaults
   - `test_invalid_standing_value` -- standing > 6 rejected

### Phase 2: Gate Standings Extension Contract

1. Create `contracts/gate_standings/Move.toml` with `edition = "2024"`, dependencies: `world = { local = "../world_utopia" }`, `standings_registry = { local = "../standings_registry" }`. The `[addresses]` section must pin `standings_registry` to its published address (populated after Phase 1 publish). Pattern matches `contracts/gate_acl/Move.toml`.
2. Create `contracts/gate_standings/sources/gate_standings.move` with:
   - `GateStandingsAuth` witness struct
   - Error codes: `ENotAuthorized` (0), `EGateNotConfigured` (1), `EAccessDenied` (2), `EInsufficientPayment` (3), `ERegistryMismatch` (4)
   - Events: `AccessGrantedEvent`, `TollCollectedEvent`
   - `can_jump_free()` -- for characters at/above free_access threshold. Calls `standings_registry::get_standing()`, compares to thresholds, issues permit via `gate::issue_jump_permit<GateStandingsAuth>()`.
   - `can_jump<T>()` -- with `Coin<T>` payment. Same flow but handles toll collection for standings between min_access and free_access.
3. Create `contracts/gate_standings/sources/config.move` with:
   - `GateStandingsConfig` shared object (created in `init()`)
   - `GateStandingsRule` struct for per-gate dynamic fields
   - `set_gate_config()`, `remove_gate_config()` -- admin only
   - Admin management: `add_admin()`, `remove_admin()`
   - Read accessors: `has_gate_config()`, `get_gate_config()`, field accessors
4. Write tests (similar to gate_unified test patterns).

### Phase 3: SSU Standings Extension Contract

1. Create `contracts/ssu_standings/Move.toml` with `edition = "2024"`, dependencies: `world = { local = "../world_utopia" }`, `standings_registry = { local = "../standings_registry" }`. Pin `standings_registry` address. Same pattern as gate_standings.
2. Create `contracts/ssu_standings/sources/ssu_standings.move` with:
   - `SsuStandingsAuth` witness struct
   - `SsuStandingsConfig` shared object (created in `init()`)
   - `SsuStandingsRule` per-SSU dynamic field
   - `can_deposit()` and `can_withdraw()` -- check standing against thresholds
   - Config management and admin functions
3. Create `contracts/ssu_standings/sources/config.move` (or inline in main file, depending on complexity).
4. Write tests.

### Phase 4: chain-shared Integration

1. Create `packages/chain-shared/src/standings-registry.ts` with:
   - TX builders for all registry operations
   - `queryRegistryDetails()` -- fetch single registry by ID
   - `queryAllRegistries()` -- discover all `StandingsRegistry` objects by type (same pattern as `queryAllSharedAcls()`)
   - `queryRegistryStandings()` -- enumerate dynamic fields for tribe/char standings
   - Constants: `STANDING_LABELS` map, `standingToDisplay(u8): number` (raw - 3), `displayToStanding(display: number): u8` (display + 3)
2. Update `packages/chain-shared/src/types.ts`:
   - Add `StandingsRegistryInfo`, `RegistryStandingEntry` types
   - Add `standingsRegistry`, `gateStandings`, `ssuStandings` to `ContractAddresses`
   - Keep existing `standings` and encrypted types for backwards compat
3. Update `packages/chain-shared/src/config.ts`:
   - Add `standingsRegistry`, `gateStandings`, `ssuStandings` entries (empty packageId initially)
4. Update `packages/chain-shared/src/index.ts` to export `standings-registry` module.
5. Update `packages/chain-shared/src/standings.ts` -- add deprecation comment at top of file noting superseded by `standings-registry.ts`.
6. Run `pnpm build` to verify chain-shared compiles.

### Phase 5: Publish Contracts & Register Addresses

1. Publish `contracts/standings_registry/` to Sui testnet. Note: this must be published first since gate_standings and ssu_standings depend on it.
2. Update `contracts/standings_registry/Move.toml` with published address.
3. Publish `contracts/gate_standings/` to Sui testnet (depends on standings_registry published address).
4. Update `contracts/gate_standings/Move.toml` with published address.
5. Publish `contracts/ssu_standings/` to Sui testnet (depends on standings_registry published address).
6. Update `contracts/ssu_standings/Move.toml` with published address.
7. Add all package IDs and config object IDs to `packages/chain-shared/src/config.ts`.
8. Run `pnpm build` to verify.

### Phase 6: Periscope DB & Contacts

1. Add `Contact`, `SubscribedRegistry`, `RegistryStanding` types to `apps/periscope/src/db/types.ts`.
2. Add new DB version(s) in `apps/periscope/src/db/index.ts`:
   - `contacts` table: `"id, kind, characterId, tribeId, standing, updatedAt"`
   - `subscribedRegistries` table: `"id, name, ticker, creator, tenant, subscribedAt"`
   - `registryStandings` table: `"id, registryId, kind, characterId, tribeId, [registryId+kind]"`
3. The existing `manifestStandingsLists` and `manifestStandingEntries` tables (from DB v25, for encrypted standings) can be dropped in this version since they are no longer used. Add `manifestStandingsLists: null, manifestStandingEntries: null` to clear them.
4. Create `apps/periscope/src/hooks/useContacts.ts` -- CRUD hooks for local contacts.
5. Create `apps/periscope/src/hooks/useRegistrySubscriptions.ts` -- subscribe/unsubscribe, sync standings from chain.

### Phase 7: Periscope UI -- Contacts & Registry

1. Rewrite `apps/periscope/src/views/Standings.tsx` with tabbed layout:
   - **Contacts tab:** Local contacts list with add/edit/remove dialogs, standing badge display (colored per scale), notes field, character/tribe search via existing `ContactPicker` pattern.
   - **Registries tab:** Browse all on-chain registries (via `queryAllRegistries()`), subscribe button, view subscribed registry standings. Show name, ticker, creator (resolved to character name from manifest), admin count.
   - **My Registries tab:** Create/manage own registries (visible when wallet connected). Set tribe/character standings, manage admins.
2. Create standing badge component at `apps/periscope/src/components/StandingBadge.tsx` -- reusable badge showing standing value + label with appropriate color classes.
3. Add extension templates to `apps/periscope/src/chain/config.ts`:
   - `gate_standings` entry in `EXTENSION_TEMPLATES`
   - `ssu_standings` entry in `EXTENSION_TEMPLATES`
4. Update Sidebar if needed (the existing "Standings" entry should already point to the rewritten view).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/standings_registry/Move.toml` | Create | Package manifest -- Sui-only dependency, no world dep |
| `contracts/standings_registry/sources/standings_registry.move` | Create | StandingsRegistry shared object, tribe/char standings as dynamic fields, admin management |
| `contracts/gate_standings/Move.toml` | Create | Package manifest -- world + standings_registry deps |
| `contracts/gate_standings/sources/gate_standings.move` | Create | Gate extension: standings-based access + toll |
| `contracts/gate_standings/sources/config.move` | Create | Per-gate config as dynamic fields on shared GateStandingsConfig |
| `contracts/ssu_standings/Move.toml` | Create | Package manifest -- world + standings_registry deps |
| `contracts/ssu_standings/sources/ssu_standings.move` | Create | SSU extension: standings-based deposit/withdraw access |
| `contracts/ssu_standings/sources/config.move` | Create | Per-SSU config as dynamic fields on shared SsuStandingsConfig |
| `packages/chain-shared/src/standings-registry.ts` | Create | TX builders, queries, constants for standings_registry contract |
| `packages/chain-shared/src/types.ts` | Modify | Add StandingsRegistryInfo, RegistryStandingEntry, new ContractAddresses entries |
| `packages/chain-shared/src/config.ts` | Modify | Add standingsRegistry, gateStandings, ssuStandings address entries |
| `packages/chain-shared/src/index.ts` | Modify | Export standings-registry module |
| `packages/chain-shared/src/standings.ts` | Modify | Add deprecation comment (superseded by standings-registry.ts) |
| `apps/periscope/src/db/types.ts` | Modify | Add Contact, SubscribedRegistry, RegistryStanding types |
| `apps/periscope/src/db/index.ts` | Modify | Add new DB version with contacts, subscribedRegistries, registryStandings tables |
| `apps/periscope/src/hooks/useContacts.ts` | Create | Local contacts CRUD hooks |
| `apps/periscope/src/hooks/useRegistrySubscriptions.ts` | Create | Registry subscribe/unsubscribe + sync hooks |
| `apps/periscope/src/views/Standings.tsx` | Rewrite | Tabbed view: Contacts, Registries, My Registries |
| `apps/periscope/src/components/StandingBadge.tsx` | Create | Reusable standing display badge with color coding |
| `apps/periscope/src/chain/config.ts` | Modify | Add gate_standings and ssu_standings extension templates |

## Open Questions

1. **How does the SSU extension hook into the world contracts' inventory system?**
   - **Option A: Extension inventory methods (deposit_item/withdraw_item)** -- Pros: standard extension pattern. Cons: the world contracts require the extension's typed witness (`Auth`) for deposit/withdraw, meaning the extension contract itself must be the one calling these methods. The game server would need to route through our extension.
   - **Option B: Access control check only** -- The SSU extension provides `can_deposit()` / `can_withdraw()` check functions, but the actual inventory operations go through the standard world contract paths. The game server calls our extension as an access check before proceeding.
   - **Recommendation:** Research needed. The world contracts' storage_unit extension model needs deeper investigation to determine exactly how custom extensions participate in the deposit/withdraw flow. If the game server calls the extension's deposit/withdraw functions directly (passing the Auth witness), then Option A. If it's a pre-check, Option B. This should be resolved before Phase 4 implementation.

2. **Should we batch-set standings in a single transaction, or one-at-a-time?**
   - **Option A: One-at-a-time (`set_tribe_standing` / `set_character_standing`)** -- Pros: simpler contract, each call is atomic. Cons: many transactions for bulk setup.
   - **Option B: Batch functions (`set_tribe_standings(registry, tribe_ids, standings)` / `set_character_standings(registry, char_ids, standings)`)** -- Pros: efficient bulk setup. Cons: more complex contract, vector length validation.
   - **Option C: Both** -- Individual functions for single updates, batch functions for bulk. Pros: best of both worlds. Cons: more code to maintain.
   - **Recommendation:** Option C. Add batch variants (`set_tribe_standings_batch`, `set_character_standings_batch`) alongside individual setters. Bulk setup is a common use case (importing a whole tribe's standings). The batch functions just loop over the vectors internally and call the same validation/storage logic.

## Deferred

- **Standings aggregation across registries** -- A character may appear in multiple registries with different standings. Determining how to resolve conflicts (highest wins? specific priority?) is deferred. For now, each extension references exactly one registry.
- **Standings change notifications** -- Events are emitted on-chain, but building a real-time notification system in Periscope (e.g., "BURQE changed your tribe's standing from +1 to -2") is deferred.
- **Contact sync to registry** -- Pushing local contacts to an on-chain StandingsRegistry (user-initiated). This is mentioned in the design but the UI flow is deferred.
- **Stillness support** -- Only targeting Utopia for initial deployment. Stillness can be done by publishing the same contracts.
- **Registry transfer of ownership** -- Moving a registry to a new owner. Deferred; can be added as a contract upgrade later.
- **Standing history / audit log** -- Tracking changes over time (events exist on-chain but UI display is deferred).
- **Turret standings integration** -- A `turret_standings` contract is not feasible because the game server's `devInspect` call uses a fixed 4-argument function signature that cannot accept a StandingsRegistry shared object. Instead, the `turret_priority` code generator can be enhanced with a "Generate from Registry" feature that reads standings from a registry and bakes them into compile-time constants. This reuses the existing infrastructure.
