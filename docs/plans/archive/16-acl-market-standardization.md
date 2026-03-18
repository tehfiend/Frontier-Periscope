# Plan: ACL & Market Standardization

**Status:** Complete -- acl_registry + currency_market published, all UIs done. gate_acl upgrade deferred (world package mismatch).
**Created:** 2026-03-17
**Updated:** 2026-03-18
**Module:** multi (contracts, chain-shared, permissions-dapp, ssu-market-dapp)

## Overview

Today, every player who deploys a gate ACL, toll, or turret priority extension gets their own isolated `ExtensionConfig` shared object at publish time. If Tribe A has 20 gates across 10 members' SSUs, each member must independently publish the `gate_acl` package and configure each gate individually -- even though they all want the same allowlist. There is no way to share a single ACL definition across multiple players' structures.

Similarly, markets are SSU-bound: a `MarketConfig` is created per-SSU and only the SSU admin can list items. If a tribe mints a currency (e.g., TRIB), there is no central marketplace where anyone can post sell/buy orders denominated in TRIB. The `OrgMarket` from plan 06 helps orgs post buy orders, but there is no permissionless sell-side tied to a currency rather than to a specific SSU.

This plan introduces two new shared-object patterns: (1) **Shared ACL Registry** -- a standalone on-chain object that defines an access control list (name, tribes, characters, allowlist/denylist). The creator names it (e.g., "Tribe A Alliance"). Any gate owner can then reference this ACL by object ID when configuring their extension, instead of maintaining their own lists. The design is deliberately forward-compatible with a future turret integration (see Deferred section). (2) **Currency Market** -- a shared order book tied to a specific `Coin<T>` type. Each currency has exactly one `CurrencyMarket<T>` where anyone can post sell listings (advertisements pointing to SSU markets) and buy orders (coin escrow). Markets belong to the currency, not to individual SSUs.

## Current State

### ACL System

- **gate_acl contract:** `contracts/gate_acl/sources/gate_acl.move` and `contracts/gate_acl/sources/config.move` -- per-package `ExtensionConfig` shared object with per-gate `AclConfig` dynamic fields keyed by bare `ID`. Supports allowlist/denylist with tribe IDs (`u32`) and character IDs (`u64`). Multi-admin via address list and tribe-based admin delegation. Published at `0x7e0ad0...9ad44c` with config object `0xa543f9...00f9dd6`. Current `Move.toml` has `gate_acl = "0x0"` (no `published-at` set, no `acl_registry` dependency).
- **gate_tribe contract:** `contracts/gate_tribe/sources/tribe_gate.move` and `contracts/gate_tribe/sources/config.move` -- simpler per-package `ExtensionConfig` with per-gate `GateConfig` (allowed tribes only). Published at `0x7ce73c...fd3298`.
- **gate_toll contract:** `contracts/gate_toll/sources/gate_toll.move` -- per-package `TollConfig` with per-gate `GateToll` (fee + free lists). Published at `0xcef451...e1f6a8`.
- **turret_priority contract:** `contracts/turret_priority/sources/turret_priority.move` -- constants-based friend/foe lists baked in at compile time via named constant slots (8 friendly tribes, 8 friendly chars, 4 KOS tribes, 4 KOS chars). No shared config. Each deployment is a unique package with hardcoded values. Uses devInspect + OnlineReceipt hot potato pattern.
- **Permissions dApp:** `apps/permissions-dapp/src/components/AclEditor.tsx` -- UI for editing a single gate's ACL config. `apps/permissions-dapp/src/App.tsx` has a simple layout: package ID + config object ID inputs, assembly selector, ACL editor, admin panel. No navigation/routing -- single page. Uses `@mysten/dapp-kit-react` with `createDAppKit()` and Eve Vault slushWallet config.
- **chain-shared permissions:** `packages/chain-shared/src/permissions.ts` -- `queryAclConfig()`, `queryAdminConfig()`, `buildConfigureAcl()`, `buildRemoveAclConfig()`, admin management builders (`buildAddAdmin`, `buildRemoveAdmin`, `buildAddAdminTribe`, `buildRemoveAdminTribe`).
- **chain-shared config:** `packages/chain-shared/src/config.ts` -- `CONTRACT_ADDRESSES` record keyed by `TenantId` ("stillness" | "utopia"). Each tenant has `gateAcl: { packageId, configObjectId }`.

**Key insight:** Gate extensions do NOT have a fixed entry point -- unlike turrets, the game server does not call the extension directly. Instead, the player (or a dApp) calls the extension function to issue a `JumpPermit`, and the game server validates the permit via `gate::jump_with_permit()`. This means extension function signatures are fully under our control and can accept any additional objects (like `&SharedAcl`).

**Key limitation:** Each `ExtensionConfig` is created in `init()` at package publish time. It is scoped to the publisher. To share an ACL, every member would need to know the publisher's config object ID and be granted admin access. There is no way to browse or discover ACLs by name.

### Market System

- **ssu_market contract:** `contracts/ssu_market/sources/ssu_market.move` -- `MarketConfig` per SSU (shared object with admin + ssu_id), `SellOrder` with escrow (items moved from owner inventory to extension inventory), `OrgMarket` for org buy orders with coin escrow. Published at `0xeca760...0723d4` (upgrade of `0xdb9df1...dc8885`). Move.toml already in upgrade mode with `published-at` and governance dependency.
- **SSU Market dApp:** `apps/ssu-market-dapp/src/` -- `MarketView` component reads `configId` URL param. `BuyerView` + `OwnerView` for sell orders. Uses `@mysten/dapp-kit-react`. Constants in `apps/ssu-market-dapp/src/lib/constants.ts` provide `getConfigId()`, `getCoinType()`, `getTenant()` URL param helpers.
- **chain-shared ssu-market:** `packages/chain-shared/src/ssu-market.ts` -- TX builders for create_market, sell orders (create/cancel/buy/update price), OrgMarket management, buy orders. Query functions for MarketConfig, SellOrder (single + all), OrgMarket, BuyOrder.
- **exchange contract:** `contracts/exchange/sources/exchange.move` -- `OrderBook<A, B>` for `Coin<T>` pairs. Has `place_bid`/`place_ask`/`cancel_bid`/`cancel_ask` with sorted order vectors and coin escrow. No automatic `match_orders()` -- orders sit in the book until manually matched or cancelled.
- **chain-shared exchange:** `packages/chain-shared/src/exchange.ts` -- TX builders for exchange create_pair, place_bid, place_ask, cancel.

**Key limitation:** Markets are SSU-bound -- a `MarketConfig` is tied to one SSU and one admin. There is no way for arbitrary players to list items for sale in a currency without having their own SSU with the market extension deployed. The exchange contract handles `Coin<A> <-> Coin<B>` but not items-for-coins.

### Token System

- **token_template contract:** `contracts/token_template/sources/token.move` -- template for creating custom `Coin<T>` tokens. Published via gas station.
- **governance_ext contract:** `contracts/governance_ext/sources/treasury.move` -- `OrgTreasury<T>` wrapping `TreasuryCap<T>` for governance-gated minting.
- **Gas station build pipeline:** `apps/gas-station/src/buildToken.ts` -- generates Move source, builds, publishes, returns packageId/coinType/treasuryCapId.

## Target State

### 1. Shared ACL Registry

A new Move module `acl_registry` that creates standalone, named ACL objects anyone can reference. The `SharedAcl` object is designed to be usable by both gate and turret extensions -- the struct itself is extension-agnostic. This plan implements gate integration; turret integration is deferred to a follow-up plan.

**Data model:**

```
SharedAcl (shared object):
  id: UID
  name: vector<u8>        -- human-readable name (e.g., "Tribe A Alliance")
  creator: address
  admins: vector<address>
  is_allowlist: bool
  allowed_tribes: vector<u32>
  allowed_characters: vector<u64>
```

**Workflow:**
1. A tribe leader creates a `SharedAcl` object via `create_acl(name, is_allowlist, tribes, characters)`.
2. The object ID is the handle. Members can look it up by scanning `SharedAcl` objects on-chain or by being told the ID.
3. Gate owners configure their gate to use the shared ACL: the gate_acl `config.move` stores a `SharedAclConfig` dynamic field that holds the `SharedAcl` object ID and permit duration.
4. When `can_jump_shared` is called, it reads the `SharedAclConfig` to find the referenced `SharedAcl` object, then checks the character against it at runtime.
5. Admins on the `SharedAcl` can add/remove tribes and characters. Changes propagate instantly to ALL gates referencing it.

**Discovery:** A "Browse ACLs" UI lets players search through all `SharedAcl` objects by name, creator, or tribe membership.

### 2. Currency Market

A new Move module `currency_market` that creates a shared order book tied to a `Coin<T>` type. Each currency has exactly one `CurrencyMarket<T>`.

**Data model:**

```
CurrencyMarket<T> (shared object):
  id: UID
  creator: address
  fee_bps: u64              -- trading fee in basis points
  fee_recipient: address
  next_sell_id: u64
  next_buy_id: u64

  -- Dynamic fields:
  SellListing (keyed by sell_id):
    listing_id: u64
    seller: address
    ssu_id: ID              -- which SSU holds the items
    market_config_id: ID    -- MarketConfig on the SSU for purchase
    type_id: u64            -- item type
    price_per_unit: u64     -- price in Coin<T>
    quantity: u64
    posted_at_ms: u64       -- timestamp for freshness sorting

  BuyOrder (keyed by buy_id + offset):
    order_id: u64
    buyer: address
    type_id: u64
    price_per_unit: u64
    quantity: u64
    -- Coin<T> escrow stored as dynamic field
```

**Workflow:**
1. When a currency is created, the creator calls `create_currency_market<T>(fee_bps)` to create the single `CurrencyMarket<T>` shared object for that currency.
2. **Sell listings:** A seller who has items on an SSU with a sell order posts an advertisement on the CurrencyMarket. The listing includes the SSU ID, MarketConfig ID, item type, price, and quantity. Items are NOT escrowed on the CurrencyMarket -- they stay in the SSU's extension inventory (escrowed via `ssu_market::create_sell_order`). The CurrencyMarket listing is a directory entry pointing buyers to the SSU. Sellers are responsible for keeping listings in sync with their SSU market orders.
3. **Buy orders:** Any player can post a buy order by escrowing `Coin<T>`. When a seller fills the order, the escrowed coins are released to the seller. Fill is manual (honor-based, same model as OrgMarket `confirm_buy_order_fill`).
4. **Discovery:** Players browse sell listings and buy orders across the entire currency. Sell listings show which SSU to visit and provide the MarketConfig ID for direct purchase. Buy orders show what items are wanted and at what price.

### New Routes / Views

| View | Location | Description |
|------|----------|-------------|
| ACL Browser | `permissions-dapp` (new tab or page) | List all `SharedAcl` objects, search by name/tribe, create new, edit existing |
| Currency Market Browser | `ssu-market-dapp` (new mode) | Browse all orders for a currency, post buy/sell listings |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ACL object model | Standalone `SharedAcl` shared objects (no world dependency) | Extension-agnostic design allows both gate and turret extensions to reference the same SharedAcl. No migration needed. Any extension can read `&SharedAcl` as a function argument. |
| ACL-to-gate binding | `SharedAclConfig` dynamic field with `SharedAclKey { gate_id }` wrapper key type | Avoids key collisions with existing `AclConfig` fields (both keyed by gate ID but using different key types). A gate can have either an `AclConfig` (inline lists) or a `SharedAclConfig` (reference to SharedAcl), but not both. |
| ACL admin model | Creator + explicit admin list (same as gate_acl config) | Proven pattern. Creator can delegate management to co-admins. |
| Market scope | Per-currency `CurrencyMarket<T>`, one per currency | Each currency has exactly one canonical market. All trade orders for that currency go through this single shared object. |
| Market creation | Creator-only via `TreasuryCap<T>` or `OrgTreasury<T>` | `create_market<T>(&TreasuryCap<T>)` for currencies not yet deposited to OrgTreasury. `create_market_from_treasury<T>(&OrgTreasury<T>, &Organization)` for org-managed currencies (TreasuryCap is locked inside OrgTreasury and cannot be extracted). Uniqueness enforced pragmatically by single-holder constraint; on-chain dedup deferred. |
| Sell order item escrow | Advertisement model (items stay in SSU) | Items are SSU-bound (parent_id constraint). Players deposit items into their player storage on an SSU, then create sell orders which move items to escrow storage. The CurrencyMarket sell listing is a directory pointing to the SSU where the actual escrowed items live. Buyers purchase at the SSU. |
| Buy order escrow | Coin<T> escrowed on CurrencyMarket | Same proven pattern as OrgMarket/BountyBoard. Coins locked on post, released on fill or returned on cancel. |
| ACL discovery | GraphQL scan of SharedAcl objects by type | Same pattern used for org discovery (`discoverOrgByCreator` in governance.ts). Works today. |
| Contract approach | New `acl_registry` package + upgrade `gate_acl`; new `currency_market` package | `acl_registry` is standalone (no world dependency). `gate_acl` upgrade adds bridge function. `currency_market` is distinct from `ssu_market`. |
| Gate extension feasibility | Fully feasible -- player calls extension, not game server | Gate extensions issue JumpPermits. The player/dApp calls `can_jump_shared(...)` passing `&SharedAcl`. Game server only validates the permit via `jump_with_permit()`. No CCP changes required. |
| Turret integration | Deferred to follow-up plan | Turret priority uses compile-time constants and devInspect + OnlineReceipt. A new `turret_shared` extension can reference `&SharedAcl` for friend/foe lists, but it requires a fundamentally different contract. `acl_registry` is designed to support this -- the SharedAcl struct is extension-agnostic. |
| Fee model | Optional fee on CurrencyMarket (fee_bps) | Market creator sets the fee. Incentivizes market creation. Can be set to 0 for community markets. |

## Implementation Phases

### Phase 1: Shared ACL Registry (Contract + Chain-Shared) -- COMPLETE

**Goal:** Players can create named ACL objects on-chain and reference them from gate configurations.

**Deployment order:** Steps 1-2 (acl_registry) must be published FIRST. Steps 3-5 (gate_acl upgrade) depend on the acl_registry package ID. Steps 6-10 (chain-shared) can proceed after both contracts are deployed.

**Implementation note:** All 10 steps completed in commits `4c5cd2c` and `284cdb5`. Contracts not yet published to testnet (package IDs in config.ts are placeholder zeros).

1. Create `contracts/acl_registry/Move.toml`:
   - `name = "acl_registry"`, `edition = "2024"`
   - Dependencies: `Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.66.2" }` (no world dependency -- SharedAcl is extension-agnostic)
   - `[addresses]`: `acl_registry = "0x0"`

2. Create `contracts/acl_registry/sources/acl_registry.move`:
   - `SharedAcl` struct (shared object): `id: UID`, `name: vector<u8>`, `creator: address`, `admins: vector<address>`, `is_allowlist: bool`, `allowed_tribes: vector<u32>`, `allowed_characters: vector<u64>`
   - `create_acl(name: vector<u8>, is_allowlist: bool, tribes: vector<u32>, characters: vector<u64>, ctx: &mut TxContext)` -- creates and shares a `SharedAcl`, sets creator to `ctx.sender()`
   - `update_acl(acl: &mut SharedAcl, is_allowlist: bool, tribes: vector<u32>, characters: vector<u64>, ctx: &TxContext)` -- admin-only bulk update
   - `add_admin(acl: &mut SharedAcl, admin: address, ctx: &TxContext)` / `remove_admin(acl: &mut SharedAcl, admin: address, ctx: &TxContext)` -- creator-only
   - `add_tribe(acl: &mut SharedAcl, tribe_id: u32, ctx: &TxContext)` / `remove_tribe(acl: &mut SharedAcl, tribe_id: u32, ctx: &TxContext)` -- admin-only
   - `add_character(acl: &mut SharedAcl, char_id: u64, ctx: &TxContext)` / `remove_character(acl: &mut SharedAcl, char_id: u64, ctx: &TxContext)` -- admin-only
   - Read accessors: `name(&SharedAcl): &vector<u8>`, `creator(&SharedAcl): address`, `admins(&SharedAcl): &vector<address>`, `is_allowlist(&SharedAcl): bool`, `allowed_tribes(&SharedAcl): &vector<u32>`, `allowed_characters(&SharedAcl): &vector<u64>`, `contains_tribe(&SharedAcl, u32): bool`, `contains_character(&SharedAcl, u64): bool`
   - Admin check: `is_admin(acl: &SharedAcl, ctx: &TxContext): bool` -- returns true if sender is creator or in admins list
   - Events: `AclCreatedEvent { acl_id: ID, name: vector<u8>, creator: address }`, `AclUpdatedEvent { acl_id: ID }`

3. Upgrade `contracts/gate_acl/Move.toml`:
   - Add `published-at = "0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c"` to `[package]`
   - Add `acl_registry = { local = "../acl_registry" }` to `[dependencies]`
   - Add `acl_registry = "0x..."` to `[addresses]` (populated after acl_registry publish)
   - Change `gate_acl = "0x0"` to `gate_acl = "0x7e0ad0eff0aef4ea2b068209948c7036f2dbfcf51600029a0d27cd5bbf9ad44c"` in `[addresses]`

4. Upgrade `contracts/gate_acl/sources/config.move`:
   - Add `SharedAclKey` wrapper struct: `struct SharedAclKey has copy, drop, store { gate_id: ID }` -- used as dynamic field key to avoid collisions with existing `AclConfig` entries (which use bare `ID` keys)
   - Add `SharedAclConfig` struct: `struct SharedAclConfig has store, drop { shared_acl_id: ID, permit_duration_ms: u64 }`
   - Add `set_shared_config(config: &mut ExtensionConfig, gate_id: ID, shared_acl_id: ID, permit_duration_ms: u64, ctx: &TxContext)` -- stores a `SharedAclConfig` dynamic field keyed by `SharedAclKey { gate_id }`. Requires `is_authorized(config, ctx)`.
   - Add `has_shared_config(config: &ExtensionConfig, gate_id: ID): bool` and `get_shared_config(config: &ExtensionConfig, gate_id: ID): &SharedAclConfig` read accessors
   - Add `remove_shared_config(config: &mut ExtensionConfig, gate_id: ID, ctx: &TxContext)` to remove shared ACL binding
   - Add `shared_acl_id(config: &SharedAclConfig): ID` and `shared_permit_duration_ms(config: &SharedAclConfig): u64` accessors
   - Existing `AclConfig` and all its functions remain unchanged

5. Upgrade `contracts/gate_acl/sources/gate_acl.move`:
   - Add `use acl_registry::acl_registry::SharedAcl;`
   - Add `can_jump_shared(source_gate: &Gate, destination_gate: &Gate, character: &Character, config: &ExtensionConfig, shared_acl: &SharedAcl, clock: &Clock, ctx: &mut TxContext)`:
     - Read `SharedAclConfig` from config dynamic field using `SharedAclKey { gate_id }`
     - Assert `object::id(shared_acl) == shared_acl_config.shared_acl_id` to verify correct ACL passed
     - Check character tribe/ID against SharedAcl's lists (same allowlist/denylist logic as existing `can_jump`)
     - Issue permit using `GateAclAuth {}` witness with the shared config's permit duration
   - Existing `can_jump` remains unchanged

6. Add TX builders to `packages/chain-shared/src/acl-registry.ts`:
   - `buildCreateSharedAcl(params: { packageId, name, isAllowlist, tribeIds, characterIds, senderAddress })` -- returns `Transaction`
   - `buildUpdateSharedAcl(params: { packageId, aclObjectId, isAllowlist, tribeIds, characterIds, senderAddress })`
   - `buildAddAclAdmin(params: { packageId, aclObjectId, adminAddress, senderAddress })` / `buildRemoveAclAdmin(params)`
   - `buildAddAclTribe(params: { packageId, aclObjectId, tribeId, senderAddress })` / `buildRemoveAclTribe(params)`
   - `buildAddAclCharacter(params: { packageId, aclObjectId, characterId, senderAddress })` / `buildRemoveAclCharacter(params)`
   - `querySharedAcl(client: SuiGraphQLClient, aclId: string): Promise<SharedAclInfo | null>` -- read a SharedAcl by ID
   - `discoverSharedAcls(client: SuiGraphQLClient, packageId: string, opts?: { creator?, tribeId? }): Promise<SharedAclInfo[]>` -- search all SharedAcl objects

7. Add `buildConfigureGateWithSharedAcl(params: { packageId, configObjectId, gateId, sharedAclId, permitDurationMs, senderAddress })` to `packages/chain-shared/src/permissions.ts` -- wraps the new `set_shared_config` call. Also add `buildRemoveGateSharedAcl(params)`.

8. Add types to `packages/chain-shared/src/types.ts`:
   - `SharedAclInfo`: `{ objectId: string, name: string, creator: string, admins: string[], isAllowlist: boolean, tribeIds: number[], characterIds: number[] }`

9. Add `aclRegistry` to `ContractAddresses` in `packages/chain-shared/src/types.ts`:
   - `aclRegistry?: { packageId: string }` -- no config object (SharedAcl objects are discovered by type)
   - Populate in `packages/chain-shared/src/config.ts` after deployment for both stillness and utopia tenants.

10. Export `acl-registry` module from `packages/chain-shared/src/index.ts`.

### Phase 2: Shared ACL UI (Permissions dApp) -- MOSTLY COMPLETE

**Goal:** Players can browse, create, and manage shared ACLs through the permissions dApp.

**Implementation note:** Steps 1-3 and 5 completed in commit `284cdb5`. Step 4 (AclEditor "Use Shared ACL" toggle) is NOT yet implemented -- the inline AclEditor does not offer a way to bind a gate to a SharedAcl. Hooks were implemented inline in components rather than as a separate `useSharedAcls.ts` file. Additional components created: `CreateAclForm.tsx`, `SharedAclCard.tsx` (component decomposition beyond the plan).

1. ~~Add `apps/permissions-dapp/src/hooks/useSharedAcls.ts`:~~ **DONE** (queries embedded directly in components instead of separate hook file)
   - `useSharedAcls(filters?: { creator?, tribeId? })` -- calls `discoverSharedAcls()`, returns `useQuery` result
   - `useSharedAcl(aclId: string)` -- calls `querySharedAcl()`, returns `useQuery` result
   - Both hooks use `useSuiClient()` from existing `apps/permissions-dapp/src/hooks/useSuiClient.ts`

2. ~~Add `apps/permissions-dapp/src/components/AclBrowser.tsx`:~~ **DONE** (named `SharedAclBrowser.tsx` + `SharedAclCard.tsx`)
   - Search input for name/tribe filtering
   - List of `SharedAcl` cards showing name, creator, mode (allowlist/denylist), tribe/character counts
   - "Use this ACL" button that copies the object ID to clipboard
   - "Edit" button (shown when user is creator/admin) to navigate to SharedAclEditor

3. ~~Add `apps/permissions-dapp/src/components/SharedAclEditor.tsx`:~~ **DONE** (+ separate `CreateAclForm.tsx`)
   - Create new SharedAcl form: name, mode toggle (allowlist/denylist), tribes list, characters list
   - Edit existing SharedAcl (if admin): same fields, pre-populated
   - Admin management section (creator only): add/remove co-admin addresses
   - Uses `useSignAndExecuteTransaction` from dapp-kit-react

4. ~~Update `apps/permissions-dapp/src/components/AclEditor.tsx`:~~ **DONE**
   - Inline/Shared ACL mode toggle added
   - Shared ACL search/browse dropdown with `queryAllSharedAcls`
   - Permit duration input, bind/update/remove buttons
   - Auto-detects existing shared ACL binding via GraphQL dynamic field scan
   - Uses `buildSetSharedAclConfig` and `buildRemoveSharedAclConfig` from chain-shared

5. ~~Update `apps/permissions-dapp/src/App.tsx`:~~ **DONE**
   - Add tab navigation between "Gate ACL" (current view) and "Shared ACLs" (new SharedAclBrowser + SharedAclEditor)
   - Shared ACL tab does not require assembly selection -- it is a standalone browser/editor

### Phase 3: Currency Market Contract -- COMPLETE

**Goal:** A per-currency order book where anyone can post sell listings and buy orders.

**Implementation note:** All 6 steps completed in commits `4c5cd2c` and `284cdb5`. `currency_market/Move.toml` uses `0x0` placeholder addresses for `governance_ext` and `governance` (differs from plan which specified concrete addresses -- these will be resolved at build time via local dependency resolution). Contract not yet published to testnet.

1. Create `contracts/currency_market/Move.toml`:
   - `name = "currency_market"`, `edition = "2024"`
   - Dependencies: `Sui` (git, testnet-v1.66.2) + `governance_ext = { local = "../governance_ext" }` (brings `governance` transitively)
   - `[addresses]`:
     - `currency_market = "0x0"`
     - `governance_ext = "0x670b8491481ab8f88a47f708918c83a6ba17427861d7d8a82e2a513176bec349"`
     - `governance = "0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb"`

2. Create `contracts/currency_market/sources/currency_market.move`:
   - `CurrencyMarket<T>` struct (shared object): `id: UID`, `creator: address`, `fee_bps: u64`, `fee_recipient: address`, `next_sell_id: u64`, `next_buy_id: u64`
   - **Two creation paths:**
     - `create_market<T>(treasury_cap: &TreasuryCap<T>, fee_bps: u64, ctx: &mut TxContext)` -- for currencies where the caller still holds the TreasuryCap (before depositing to OrgTreasury). Requires `&TreasuryCap<T>` to prove currency ownership.
     - `create_market_from_treasury<T>(treasury: &OrgTreasury<T>, org: &Organization, fee_bps: u64, ctx: &mut TxContext)` -- for org-managed currencies where TreasuryCap is locked in OrgTreasury. Requires org stakeholder authorization.
   - **Uniqueness enforcement:** Use a `MarkerKey<T>` type stored as a dynamic field on the CurrencyMarket to track whether a market exists. Alternatively, since Sui's type system ensures only one `TreasuryCap<T>` / `OrgTreasury<T>` exists per `T`, we can store a `MarketExists` marker as a dynamic field on the `TreasuryCap<T>` UID or use a module-level `Table` to track. Simplest approach: accept `&mut TreasuryCap<T>` (mutable borrow) and add a dynamic field `MarketCreated {}` marker to it. If the marker exists, abort. For `OrgTreasury` path, the marker goes on the OrgTreasury UID instead (requires `governance_ext` to expose a `borrow_treasury_uid()` or similar). **Pragmatic fallback:** Since both TreasuryCap and OrgTreasury are typically held by a single entity who would not create duplicate markets, rely on the single-holder constraint and let the UI discover the first market per type. On-chain dedup can be added later if needed.
   - Sets `creator` and `fee_recipient` to `ctx.sender()`.
   - `post_sell_listing<T>(market: &mut CurrencyMarket<T>, ssu_id: ID, market_config_id: ID, type_id: u64, price_per_unit: u64, quantity: u64, clock: &Clock, ctx: &mut TxContext)` -- posts a sell listing (advertisement pointing to an SSU market). Includes `posted_at_ms` from clock for freshness. Anyone can post.
   - `update_sell_listing<T>(market: &mut CurrencyMarket<T>, listing_id: u64, price_per_unit: u64, quantity: u64, ctx: &TxContext)` -- update price/quantity (seller only, asserts sender == listing.seller)
   - `cancel_sell_listing<T>(market: &mut CurrencyMarket<T>, listing_id: u64, ctx: &TxContext)` -- remove a sell listing (seller only)
   - `post_buy_order<T>(market: &mut CurrencyMarket<T>, payment: Coin<T>, type_id: u64, price_per_unit: u64, quantity: u64, ctx: &mut TxContext)` -- escrows coins, posts a buy order. Escrowed coin stored as dynamic field keyed by `buy_id + 1_000_000_000` (same offset pattern as OrgMarket/BountyBoard).
   - `fill_buy_order<T>(market: &mut CurrencyMarket<T>, order_id: u64, seller: address, quantity: u64, ctx: &mut TxContext)` -- buyer confirms fill, releases payment to seller (honor-based, same model as OrgMarket `confirm_buy_order_fill`). Asserts sender == order.buyer.
   - `cancel_buy_order<T>(market: &mut CurrencyMarket<T>, order_id: u64, ctx: &mut TxContext)` -- buyer cancels, gets escrowed coins back. Asserts sender == order.buyer.
   - Events: `MarketCreatedEvent { market_id, creator }`, `SellListingPostedEvent { market_id, listing_id, seller, ssu_id, type_id, price_per_unit, quantity }`, `SellListingCancelledEvent { market_id, listing_id }`, `SellListingUpdatedEvent { market_id, listing_id, price_per_unit, quantity }`, `BuyOrderPostedEvent { market_id, order_id, buyer, type_id, price_per_unit, quantity }`, `BuyOrderFilledEvent { market_id, order_id, seller, quantity, total_paid }`, `BuyOrderCancelledEvent { market_id, order_id }`
   - Read accessors: `market_creator()`, `market_fee_bps()`, `market_fee_recipient()`

3. Add TX builders to `packages/chain-shared/src/currency-market.ts`:
   - `buildCreateCurrencyMarket(params: { packageId, treasuryCapId, coinType, feeBps, senderAddress })` -- for direct TreasuryCap holder
   - `buildCreateCurrencyMarketFromTreasury(params: { packageId, orgTreasuryId, orgObjectId, coinType, feeBps, senderAddress })` -- for OrgTreasury-managed currencies
   - `buildPostSellListing(params: { packageId, marketId, coinType, ssuId, marketConfigId, typeId, pricePerUnit, quantity, clockId, senderAddress })`
   - `buildUpdateSellListing(params: { packageId, marketId, coinType, listingId, pricePerUnit, quantity, senderAddress })`
   - `buildCancelSellListing(params: { packageId, marketId, coinType, listingId, senderAddress })`
   - `buildPostBuyOrder(params: { packageId, marketId, coinType, paymentObjectId, typeId, pricePerUnit, quantity, senderAddress })`
   - `buildFillBuyOrder(params: { packageId, marketId, coinType, orderId, sellerAddress, quantity, senderAddress })`
   - `buildCancelBuyOrder(params: { packageId, marketId, coinType, orderId, senderAddress })`
   - `queryCurrencyMarket(client, marketId): Promise<CurrencyMarketInfo | null>` -- read market info
   - `querySellListings(client, marketId): Promise<CurrencyMarketSellListing[]>` -- list all sell listings via dynamic field scan (similar to `queryAllSellOrders` pattern)
   - `queryBuyOrders(client, marketId): Promise<CurrencyMarketBuyOrder[]>` -- list all buy orders (keys < 1_000_000_000)
   - `discoverCurrencyMarkets(client, packageId): Promise<CurrencyMarketInfo[]>` -- find all CurrencyMarket objects via type scan

4. Add types to `packages/chain-shared/src/types.ts`:
   - `CurrencyMarketInfo`: `{ objectId: string, creator: string, feeBps: number, feeRecipient: string, coinType: string, nextSellId: number, nextBuyId: number }`
   - `CurrencyMarketSellListing`: `{ listingId: number, seller: string, ssuId: string, marketConfigId: string, typeId: number, pricePerUnit: number, quantity: number, postedAtMs: number }`
   - `CurrencyMarketBuyOrder`: `{ orderId: number, buyer: string, typeId: number, pricePerUnit: number, quantity: number }`

5. Add `currencyMarket` to `ContractAddresses` in `packages/chain-shared/src/types.ts`:
   - `currencyMarket?: { packageId: string }` -- no config object (markets discovered by type)
   - Populate in `packages/chain-shared/src/config.ts` after deployment.

6. Export `currency-market` module from `packages/chain-shared/src/index.ts`.

### Phase 4: Currency Market UI -- MOSTLY COMPLETE

**Goal:** Players can browse and interact with currency markets through the ssu-market-dapp.

**Implementation note:** Steps 1-5 completed in commit `284cdb5`. Step 6 partially done -- `getUrlParam` helper exists but no dedicated `CURRENCY_MARKET_PACKAGE_ID` constant or `getMarketId()` helper added to constants.ts. Users enter the package ID manually via input field. Component naming differs slightly from plan: `CurrencyMarketView` is named `CurrencyMarketDetail`, and market discovery is in `CurrencyMarketBrowser`. Hooks are inline in components rather than in a separate `useCurrencyMarket.ts` file.

1. ~~Add `apps/ssu-market-dapp/src/hooks/useCurrencyMarket.ts`:~~ **DONE** (queries embedded directly in components instead of separate hook file)
   - `useCurrencyMarket(marketId: string)` -- calls `queryCurrencyMarket()`, returns `useQuery` result
   - `useSellListings(marketId: string)` -- calls `querySellListings()`, returns `useQuery` result
   - `useBuyOrders(marketId: string)` -- calls `queryBuyOrders()`, returns `useQuery` result

2. ~~Add `apps/ssu-market-dapp/src/components/CurrencyMarketView.tsx`:~~ **DONE** (named `CurrencyMarketDetail.tsx`)
   - Takes `marketId` URL parameter (from `getUrlParam("marketId")`)
   - Tabs or sections for "Sell Listings" and "Buy Orders"
   - Sell listings show: item type name (from `items.ts` lookup), price, quantity, SSU ID (truncated), "Buy at SSU" link that constructs the SSU market URL (`?configId={marketConfigId}&coinType={coinType}`)
   - Buy orders show: item type name, price per unit, quantity, buyer address
   - Sort sell listings by freshness (posted_at_ms descending)

3. ~~Add order posting components:~~ **DONE** (named `PostSellListingForm.tsx` and `PostBuyOrderForm.tsx`)
   - `apps/ssu-market-dapp/src/components/PostSellListingForm.tsx` -- form: SSU ID, MarketConfig ID, item type (dropdown from `items.ts`), price per unit, quantity. Calls `buildPostSellListing`.
   - `apps/ssu-market-dapp/src/components/PostBuyOrderForm.tsx` -- form: item type, price per unit, quantity, coin selector. Calls `buildPostBuyOrder`.

4. ~~Update `apps/ssu-market-dapp/src/App.tsx`:~~ **DONE**
   - Route between views based on tabs: "SSU Market" tab -> MarketView (existing), "Currency Market" tab -> CurrencyMarketBrowser (new)
   - Uses `currencyMarketPackageId` URL param for auto-detection

5. ~~Add market discovery view `apps/ssu-market-dapp/src/components/MarketBrowser.tsx`:~~ **DONE** (named `CurrencyMarketBrowser.tsx`)
   - Lists all `CurrencyMarket` objects with currency name (from coin metadata), creator, fee
   - Click navigates to CurrencyMarketDetail

6. **TODO** -- Update `apps/ssu-market-dapp/src/lib/constants.ts`:
   - Add `CURRENCY_MARKET_PACKAGE_ID` constant
   - Add `getMarketId()` URL param helper
   - **Note:** Currently the package ID is entered manually via input field in App.tsx. This step is blocked on contract deployment (need real package ID).

## File Summary

| File | Action | Status | Description |
|------|--------|--------|-------------|
| `contracts/acl_registry/Move.toml` | CREATE | DONE | Package manifest for ACL registry |
| `contracts/acl_registry/sources/acl_registry.move` | CREATE | DONE | SharedAcl shared object, CRUD functions, events |
| `contracts/gate_acl/sources/config.move` | MODIFY | DONE | Add SharedAclKey, SharedAclConfig, set/get/remove_shared_config |
| `contracts/gate_acl/sources/gate_acl.move` | MODIFY | DONE | Add can_jump_shared function that reads SharedAcl |
| `contracts/gate_acl/Move.toml` | MODIFY | DONE | Add published-at, acl_registry dependency, update addresses |
| `contracts/currency_market/Move.toml` | CREATE | DONE | Package manifest for currency market |
| `contracts/currency_market/sources/currency_market.move` | CREATE | DONE | CurrencyMarket<T>, sell listings, buy orders with coin escrow |
| `packages/chain-shared/src/acl-registry.ts` | CREATE | DONE | TX builders and queries for SharedAcl |
| `packages/chain-shared/src/currency-market.ts` | CREATE | DONE | TX builders and queries for CurrencyMarket |
| `packages/chain-shared/src/permissions.ts` | MODIFY | DONE | Add buildSetSharedAclConfig, buildRemoveSharedAclConfig |
| `packages/chain-shared/src/types.ts` | MODIFY | DONE | Add SharedAclInfo, CurrencyMarketInfo, listing/order types, aclRegistry/currencyMarket to ContractAddresses |
| `packages/chain-shared/src/config.ts` | MODIFY | DONE | Add aclRegistry and currencyMarket to CONTRACT_ADDRESSES (placeholder zeros -- needs deploy) |
| `packages/chain-shared/src/index.ts` | MODIFY | DONE | Export acl-registry and currency-market modules |
| `apps/permissions-dapp/src/components/SharedAclBrowser.tsx` | CREATE | DONE | Browse/search SharedAcl objects (was AclBrowser.tsx in plan) |
| `apps/permissions-dapp/src/components/SharedAclCard.tsx` | CREATE | DONE | Card component for SharedAcl display (extra decomposition) |
| `apps/permissions-dapp/src/components/SharedAclEditor.tsx` | CREATE | DONE | Edit existing SharedAcl objects |
| `apps/permissions-dapp/src/components/CreateAclForm.tsx` | CREATE | DONE | Create new SharedAcl form (split from SharedAclEditor) |
| `apps/permissions-dapp/src/hooks/useSharedAcls.ts` | CREATE | SKIPPED | Queries embedded in components instead |
| `apps/permissions-dapp/src/components/AclEditor.tsx` | MODIFY | DONE | Added Inline/Shared ACL mode toggle, browse, bind/unbind |
| `apps/permissions-dapp/src/App.tsx` | MODIFY | DONE | Add tab navigation to ACL browser |
| `apps/ssu-market-dapp/src/components/CurrencyMarketDetail.tsx` | CREATE | DONE | Browse currency market orders (was CurrencyMarketView.tsx in plan) |
| `apps/ssu-market-dapp/src/components/PostSellListingForm.tsx` | CREATE | DONE | Form for posting sell listings |
| `apps/ssu-market-dapp/src/components/PostBuyOrderForm.tsx` | CREATE | DONE | Form for posting buy orders |
| `apps/ssu-market-dapp/src/components/CurrencyMarketBrowser.tsx` | CREATE | DONE | Discover all CurrencyMarket objects (was MarketBrowser.tsx in plan) |
| `apps/ssu-market-dapp/src/hooks/useCurrencyMarket.ts` | CREATE | SKIPPED | Queries embedded in components instead |
| `apps/ssu-market-dapp/src/App.tsx` | MODIFY | DONE | Route between SSU market and currency market modes |
| `apps/ssu-market-dapp/src/lib/constants.ts` | MODIFY | **TODO** | Add currency market package ID and URL param helpers |

## Resolved Questions

1. **Should the SharedAcl be usable by turret extensions too?**
   - **Resolution: Gates only in this plan; turret integration deferred.**
   - The `SharedAcl` struct is designed to be extension-agnostic (no world dependency, just tribe/character lists). This plan implements gate integration only. A follow-up plan will create a new `turret_shared` extension that reads `&SharedAcl` at runtime for friend/foe lists. The key constraint is that turrets use devInspect + OnlineReceipt (fundamentally different execution model), so turret support requires a separate contract. The SharedAcl design deliberately supports this future use case.

2. **Sell listing model: advertisement vs. escrow?**
   - **Resolution: Advertisement model (Option A).**
   - Items are SSU-bound with parent_id locked to the originating SSU. Players deposit items into their player storage on an SSU, then create sell orders via `ssu_market::create_sell_order` which moves items to escrow storage on that SSU. The CurrencyMarket sell listing is a directory entry pointing buyers to the SSU where the actual escrowed items live. Buyers complete the purchase at the SSU. To mitigate staleness, sell listings include `posted_at_ms` timestamps and the UI sorts by freshness.

3. **Should CurrencyMarket creation be permissionless or require currency creator?**
   - **Resolution: Creator-only via TreasuryCap or OrgTreasury (modified Option B).**
   - Each currency has exactly one CurrencyMarket. Two creation paths:
     1. `create_market<T>(&TreasuryCap<T>)` -- for currencies where the creator still holds the TreasuryCap directly (before depositing to OrgTreasury).
     2. `create_market_from_treasury<T>(&OrgTreasury<T>, &Organization)` -- for org-managed currencies where the TreasuryCap is permanently locked inside OrgTreasury. Checks `is_stakeholder_address`.
   - On-chain uniqueness enforcement is deferred (pragmatic approach: single TreasuryCap/OrgTreasury holder is unlikely to create duplicates; UI discovers first market per type). Can add a dynamic field marker later if needed.

4. **Should gate_acl be upgraded or should we create a new gate extension that reads SharedAcl?**
   - **Resolution: Upgrade gate_acl (Option A).**
   - Upgrading gate_acl keeps all ACL logic in one place. The package has an UpgradeCap from initial publish. Adding new functions (`can_jump_shared`, `set_shared_config`) is backward compatible -- existing gates continue working with inline `AclConfig`. Gates that want shared ACL simply add a `SharedAclConfig` dynamic field and call `can_jump_shared` instead of `can_jump`. No backward compatibility concerns for the upgrade itself, as we are only adding new structs and functions.

## Outstanding Items

Two minor UI items remain before this plan can be archived:

1. ~~**AclEditor shared ACL binding (Phase 2, Step 4):**~~ **DONE** -- Inline/Shared ACL mode toggle, browse, bind/unbind all implemented.

2. ~~**Constants.ts updates (Phase 4, Step 6):**~~ **DONE** -- `CURRENCY_MARKET_PACKAGE_ID`, `getMarketId()`, `getCurrencyMarketPackageId()` added to `ssu-market-dapp/src/lib/constants.ts`.

3. ~~**Contract deployment:**~~ **DONE** -- `acl_registry` published at `0x3b1cdef2...fc3b55`, `currency_market` published at `0x07d9632d...f035a6`. Config.ts updated with real package IDs for both tenants. `gate_acl` upgrade deferred -- original was published against Stillness world package (`0x28b497...`), can't upgrade to Utopia world (`0xd12a70...`) due to Move compatibility rules. Requires fresh publish against correct world package.

## Deferred

- **Turret shared ACL** -- Turret priority uses compile-time constants and a completely different execution model (devInspect + OnlineReceipt). The `SharedAcl` struct from this plan is designed to support turret integration -- a new `turret_shared` extension would accept `&SharedAcl` and use its tribe/character lists for friend/foe targeting. This requires a new contract that handles the OnlineReceipt hot potato and BCS return value format. Separate follow-up plan.
- **On-chain market uniqueness enforcement** -- The current design relies on the single-holder constraint (one TreasuryCap/OrgTreasury per currency) to prevent duplicate markets. A robust on-chain enforcement (e.g., dynamic field marker on TreasuryCap UID) can be added later if duplicate markets become an issue in practice.
- **Automated buy order fulfillment** -- CurrencyMarket buy orders use manual fill (same as OrgMarket). Automated verification of item delivery requires solving the SSU item binding constraint. Deferred until world-contracts provides a path for cross-SSU item transfer or on-chain inventory proofs.
- **Order matching engine** -- The exchange contract has sorted order books but no automatic matching. A proper matching engine for currency markets would enable limit order fills. Out of scope -- use manual fill for now.
- **Gas station sponsorship for ACL/market creation** -- These transactions are low-frequency and players can pay their own gas. Add sponsorship if adoption shows demand.
- **Periscope integration** -- Periscope could show a governance view for managing shared ACLs and viewing currency market activity. Defer until the core contracts and dApps are stable.
