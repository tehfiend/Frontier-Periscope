# Plan: Gate Toll Custom Currency and Treasury Wallet
**Status:** Draft
**Created:** 2026-03-27
**Module:** periscope, chain-shared

## Overview

This plan introduces two related features: custom currency gate tolls and a shared treasury wallet. Together they enable gate owners to charge tolls in market-created currencies (Coin<T> types from the token-factory/exchange system) and collect that revenue into a multi-user treasury that authorized members can manage.

The existing gate standings extension (`gate-standings.ts`) stores a `tollFee` as a u64 amount and a `tollRecipient` as an address. The toll is always paid in SUI because the on-chain `set_gate_config` function has no `typeArguments` parameter -- it cannot reference a custom Coin<T> type. However, as confirmed in prior research, the world-contracts gate module has no built-in toll mechanism. Gate tolls are entirely extension-defined -- the extension controls jump permit issuance and can require payment as a condition. This means supporting custom currency tolls requires building a new gate extension contract (or modifying the existing gate-standings extension) that accepts Coin<T> payments, not a world contract change.

The treasury wallet is a new on-chain shared object with an admin/member access control list (modeled after the `StandingsRegistry` admin pattern in `standings-registry.ts`). It holds balances of one or more Coin<T> types, supports deposit/withdraw by authorized members, and can serve as the `tollRecipient` for gate toll revenue. This requires a custom Move contract since Sui has no built-in multi-user wallet primitive.

## Current State

### Gate Standings Extension

The gate standings extension contract is deployed at:
- `gateStandings.packageId`: `0xef2cd2bc3a93cbb7286ed4bf9ebf7c49c6459f50db0a1d0c94d19810f2a62eb4` (both tenants)
- `gateStandings.configObjectId`: `0x312a3ea9282b1b702da100c288c520aa452eced3dd325e718c06196b1b9db627`

The TX builder in `packages/chain-shared/src/gate-standings.ts` (lines 19-56) calls `config::set_gate_config` with these parameters:
- `configObjectId` -- the shared GateStandingsConfig object
- `gateId` -- the target gate assembly ID
- `registryId` -- StandingsRegistry object for access checks
- `minAccess` (u8) -- minimum standing to use the gate
- `freeAccess` (u8) -- standing threshold for free passage (no toll)
- `tollFee` (u64) -- toll amount in **SUI** (no typeArguments, no Coin<T> support)
- `tollRecipient` (address) -- where toll payments are sent
- `permitDurationMs` (u64) -- how long the jump permit is valid

The UI in `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` (lines 103-113) shows the toll fee input with the label "Toll Fee (SUI)" and help text: "Gate tolls are always paid in SUI. Custom currency tolls require a world contract upgrade." This help text is inaccurate -- it should say "require a new gate extension" since tolls are extension-defined, not world-contract-defined.

### Gate Toll and Gate Unified Extensions

Two other gate extension contracts exist in `config.ts` (lines 141-152):
- `gateUnified` -- emits `TollCollectedEvent` and `AccessGrantedEvent` via `gate_unified` module
- `gateToll` -- emits `TollCollectedEvent` via `gate_toll` module

The sonar event handler in `apps/periscope/src/chain/sonarEventHandlers.ts` (lines 432-452) parses toll collection events, reading `amount` and `payer` fields. The access granted handler (lines 455-475) reads `toll_paid`. Both assume SUI denomination.

### Market Currency System

Currencies are created via token-factory (two variants):
- `packages/chain-shared/src/token-factory.ts` -- basic token with `Market<T>` (uses bytecode patching)
- `packages/chain-shared/src/token-factory-standings.ts` -- standings-gated token with `market_standings::Market<T>`

Each published token creates a unique `Coin<T>` type where `T` is `{packageId}::{module}::{STRUCT}` (e.g., `0xabc::GOLD_TOKEN::GOLD_TOKEN`). The `CurrencyRecord` type in `apps/periscope/src/db/types.ts` (lines 788-809) stores:
- `coinType` -- the full Coin<T> type string
- `packageId` -- the token package ID
- `marketId` -- the Market<T> shared object ID
- `symbol`, `name`, `decimals`

The exchange module (`packages/chain-shared/src/exchange.ts`) handles `Coin<T>` via `typeArguments` on all move calls (e.g., `buildPlaceBid` at line 41). The market module (`packages/chain-shared/src/market.ts`) similarly uses `typeArguments: [params.coinType]` for all operations. The `buildPostBuyOrder` function (lines 309-349) demonstrates the merge+split pattern for Coin<T> payment: merge multiple coin objects into one, split the exact amount needed, pass to the move call.

### Coin Handling Patterns

Coin<T> operations in Sui require:
1. The caller to own `Coin<T>` objects
2. `typeArguments: [coinType]` on move calls to specify which Coin<T> type
3. Merge+split for exact amounts (see `buildPostBuyOrder` in `market.ts` lines 314-334)
4. The move function signature must be generic: `fun pay_toll<T>(coin: Coin<T>, ...)`

### Access Control Patterns

The `StandingsRegistry` in `packages/chain-shared/src/standings-registry.ts` provides the ACL model:
- Shared object with `owner` (single address) and `admins` (vector of addresses)
- Owner can add/remove admins (lines 273-305)
- Admins can modify data (standings entries)
- Created via `create_registry` which sets sender as owner

The `SsuUnifiedConfig` in `packages/chain-shared/src/ssu-unified.ts` is another shared object pattern with an `owner` and `delegates` list.

### Plan 06 Deferral

Plan 06 (`docs/plans/active/06-extension-fixes.md`, line 372) explicitly defers custom toll currency: "Custom toll currency for gates -- Requires an on-chain contract upgrade to accept typeArguments for coin type. Out of scope for the Periscope app layer." This plan supersedes that deferral with the correct approach: a new gate extension contract.

## Target State

### 1. Gate Toll Custom Currency Extension

A new Move contract (`gate_toll_custom`) that extends the gate-standings pattern to accept `Coin<T>` toll payments:

**On-chain design:**
- New shared config object `GateTollCustomConfig` with per-gate dynamic fields storing:
  - `registryId` -- StandingsRegistry for access checks
  - `minAccess`, `freeAccess` -- standing thresholds (same as current)
  - `tollAmount` (u64) -- toll amount in the custom currency's base units
  - `tollCoinType` -- stored implicitly via the generic type parameter `T`
  - `tollRecipient` (address) -- where toll Coin<T> is sent (could be a treasury object)
  - `permitDurationMs` (u64)
- `request_access<T>(config, gate_id, coin: Coin<T>, character, clock)` -- toll-paying path:
  1. Look up gate config from phantom-typed dynamic field `GateKey<T>`
  2. Check character's standing in the registry
  3. If standing >= minAccess but < freeAccess, verify `coin.value() >= tollAmount`, transfer coin to `tollRecipient`, issue permit
  4. If standing < minAccess, abort
- `request_free_access<T>(config, gate_id, character, clock)` -- free-access path (no coin needed):
  1. Look up gate config, verify standing >= freeAccess, issue permit
  2. The client-side TX builder picks which function to call based on the traveler's known standing
- Admin functions: `set_gate_config<T>`, `remove_gate_config`, `add_admin`, `remove_admin`

**Generic type approach:**
Unlike the turret-factory or token-factory patterns (which use bytecode patching), this contract uses Sui Move generics natively. The contract is published once with generic `<T>` type parameters. At call time, the TX builder passes `typeArguments: [coinType]` to specify which Coin<T> type is used -- the same pattern used by `market.ts`, `exchange.ts`, and `ssu-unified.ts` throughout the codebase. No bytecode patching is needed for new currencies.

**Dynamic field design note:** The per-gate dynamic field key must incorporate the coin type to allow different currency configs per gate. Using `GateKey { gate_id: ID }` alone (without T) would mean a gate can only ever have one toll currency. Two approaches: (a) use a phantom-typed key struct `GateKey<phantom T> { gate_id: ID }` so each (gate, coinType) pair is a distinct dynamic field, or (b) include the coin type as a string in the key. Approach (a) is more idiomatic in Sui Move.

**TX builders** in a new `packages/chain-shared/src/gate-toll-custom.ts`:
- `buildSetGateTollCustomConfig()` -- configure a gate with custom currency toll (takes `coinType` param, passes as `typeArguments`)
- `buildRequestGateTollCustomAccess()` -- traveler pays toll in Coin<T> (takes `coinType` + `coinObjectIds`)
- `buildRequestGateTollCustomFreeAccess()` -- free-access path (takes `coinType` for dynamic field lookup)
- `queryGateTollCustomConfig()` -- read per-gate config

**UI changes** in `StandingsExtensionPanel.tsx`:
- Add a "Toll Currency" dropdown next to the toll fee input
- Options: "SUI (default)" + all known market currencies (from `db.currencies`)
- When a custom currency is selected, show the toll amount in that currency's units
- The toll recipient field remains (can be an address or a treasury object ID)

### 2. Treasury Wallet

A new Move contract (`treasury`) implementing a shared multi-user wallet:

**On-chain design:**
- `Treasury` shared object:
  - `owner` (address) -- creator, can manage members and withdraw
  - `admins` (vector<address>) -- can deposit and withdraw
  - `name` (vector<u8>) -- display name
  - Dynamic fields for coin balances: keyed by phantom-typed struct `BalanceKey<phantom T> {}`, storing `Balance<T>` (see Open Question 3; `Balance<T>` is the recommended approach)
- Functions:
  - `create_treasury(name)` -- creates shared Treasury, sender becomes owner
  - `add_admin(treasury, admin_address)` -- owner only
  - `remove_admin(treasury, admin_address)` -- owner only
  - `deposit<T>(treasury, coin: Coin<T>)` -- anyone can deposit (or admin-only, see Open Questions)
  - `withdraw<T>(treasury, amount)` -- admin/owner only, splits coin and transfers to sender
  - `transfer_ownership(treasury, new_owner)` -- owner only
- Events: `DepositEvent`, `WithdrawEvent`, `AdminAddedEvent`, `AdminRemovedEvent`

**TX builders** in a new `packages/chain-shared/src/treasury.ts`:
- `buildCreateTreasury()`, `buildAddTreasuryAdmin()`, `buildRemoveTreasuryAdmin()`
- `buildTreasuryDeposit()` (takes `coinType` param), `buildTreasuryWithdraw()` (takes `coinType` param)
- `queryTreasuryDetails()`, `queryTreasuryBalances()`

**Integration with gate tolls:**
- The toll payment happens within the **traveler's** PTB (programmable transaction block). The traveler calls the gate extension, which validates standing and collects the toll.
- For treasury integration, the gate extension's `request_access<T>` should return the toll `Coin<T>` as a transaction result rather than transferring it internally. The client-side PTB then composes: (1) split traveler's coins -> (2) call `request_access<T>` which takes the toll coin and issues a permit -> (3) call `treasury::deposit<T>` with the toll coin.
- Alternatively, the gate extension can transfer directly to the `tollRecipient` address. If the recipient is a treasury shared object, Sui does not support direct `transfer::public_transfer` to a shared object -- funds must go through `treasury::deposit<T>`. This means the PTB composition approach is required for auto-deposit.
- For simpler setups, the `tollRecipient` can be a regular address (e.g., the gate owner), and the owner manually deposits into a treasury later.

**UI:** New "Treasury" view (or section within the Wallet view):
- Create treasury, name it, add/remove admins
- View balances per currency
- Deposit/withdraw actions
- Link to gate toll config ("Use as toll recipient")

### 3. Sonar Event Updates

Update `sonarEventHandlers.ts` to handle custom currency toll events:
- Parse the coin type from toll collection events
- Display the currency symbol instead of "EVE" or "SUI"
- Look up currency name from `db.currencies`

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Gate toll custom currency approach | New extension contract (not world contract change) | World contracts have no built-in toll mechanism. Gate tolls are entirely extension-defined. A new extension contract with generic Coin<T> support is the correct approach. |
| Generic contract vs. per-currency publish | Fully generic contract with `<T>` type parameters | The existing `market.ts`, `exchange.ts`, and `ssu-unified.ts` demonstrate that Sui Move generics with `Coin<T>` work well. TX builders pass `typeArguments: [coinType]`. One deployment serves all currencies. |
| Treasury ACL model | Owner + admins (same as StandingsRegistry) | Consistent with existing patterns. Simple and proven. Multi-sig adds unnecessary complexity for the current use case. |
| Treasury coin storage | Dynamic fields keyed by coin type | Supports multiple currencies in a single treasury. Same pattern as Market<T> using typed dynamic fields. |
| Toll-to-treasury integration | PTB composition (toll payment + treasury deposit in one TX) | Single atomic transaction. No intermediate sweep step. Requires the gate extension to return the toll coin as a TX result that can be fed into treasury deposit. |
| New plan vs. amending Plan 06 | New plan (08) that supersedes Plan 06's deferral | Plan 06 is in `active/` and focused on turret fixes. Custom currency tolls are a separate feature with their own contract and UI work. |

## Implementation Phases

### Phase 1: Treasury Contract Design and Implementation

**Goal:** Design and implement the treasury Move contract, compile it, and create TX builders in chain-shared.

1. Design the `treasury` Move module:
   - Struct: `Treasury { id: UID, owner: address, admins: vector<address>, name: vector<u8> }`
   - Coin balances stored as dynamic fields: `CoinKey<T> { }` -> `Coin<T>` or `Balance<T>`
   - Using `Balance<T>` (from `0x2::balance`) instead of `Coin<T>` for storage is more idiomatic -- `Balance` is the unwrapped representation without an object ID
   - Functions: `create_treasury`, `add_admin`, `remove_admin`, `deposit<T>`, `withdraw<T>`, `transfer_ownership`
   - Events: `DepositEvent { treasury_id, depositor, coin_type, amount }`, `WithdrawEvent { treasury_id, withdrawer, coin_type, amount }`
   - Access control: `deposit` is open to anyone (gate extensions can deposit toll revenue); `withdraw` requires owner or admin

2. Compile and publish the contract via `sui move build --build-env testnet` and `sui client publish`. This is a manual step outside the Periscope codebase (same as all other contract deployments in this project). The resulting package ID is added to `config.ts`.

3. Create `packages/chain-shared/src/treasury.ts`:
   - `buildCreateTreasury(params: { packageId, name, senderAddress })` -> Transaction
   - `buildAddTreasuryAdmin(params: { packageId, treasuryId, adminAddress, senderAddress })` -> Transaction
   - `buildRemoveTreasuryAdmin(params: { packageId, treasuryId, adminAddress, senderAddress })` -> Transaction
   - `buildTreasuryDeposit(params: { packageId, treasuryId, coinType, coinObjectIds, amount, senderAddress })` -> Transaction (uses `typeArguments: [coinType]` on the move call, same pattern as `buildMint` in `market.ts`)
   - `buildTreasuryWithdraw(params: { packageId, treasuryId, coinType, amount, senderAddress })` -> Transaction
   - `queryTreasuryDetails(client, treasuryId)` -> `TreasuryInfo | null`
   - `queryTreasuryBalances(client, treasuryId)` -> `TreasuryBalance[]`

4. Add types to `packages/chain-shared/src/types.ts`:
   - `TreasuryInfo { objectId, owner, admins, name }`
   - `TreasuryBalance { coinType, amount: bigint }`

5. Add contract addresses:
   - Add `treasury?: { packageId: string }` to `ContractAddresses` interface in `packages/chain-shared/src/types.ts` (line 289)
   - Add `treasury: { packageId: "" }` placeholder entries in `packages/chain-shared/src/config.ts` for both tenants (populated after contract publish)

6. Export from `packages/chain-shared/src/index.ts`

**Files:**
| File | Action |
|------|--------|
| `packages/chain-shared/src/treasury.ts` | Create |
| `packages/chain-shared/src/types.ts` | Modify (add TreasuryInfo, TreasuryBalance) |
| `packages/chain-shared/src/config.ts` | Modify (add treasury to ContractAddresses) |
| `packages/chain-shared/src/index.ts` | Modify (add treasury export) |

### Phase 2: Gate Toll Custom Currency Contract

**Goal:** Design and implement the custom currency gate toll extension contract, and create TX builders.

1. Design the `gate_toll_custom` Move module:
   - Shared config: `GateTollCustomConfig { id: UID, owner: address, admins: vector<address> }`
   - Per-gate dynamic fields: `GateKey<phantom T> { gate_id: ID }` -> `GateConfig { registry_id: ID, min_access: u8, free_access: u8, toll_amount: u64, toll_recipient: address, permit_duration_ms: u64 }`
   - Note: The phantom type parameter on `GateKey` ties each gate config to a specific Coin<T> type. This means a single gate could have configs for multiple currencies (each as a separate dynamic field). The config value struct itself does not need `<T>` -- the coin type is encoded in the key.
   - `set_gate_config<T>(config, gate_id, registry_id, min_access, free_access, toll_amount, toll_recipient, permit_duration_ms)` -- admin only
   - `request_access<T>(config, gate_id, character, coin: Coin<T>, clock)` -- toll-paying path: checks standings, collects toll, issues permit
   - `request_free_access<T>(config, gate_id, character, clock)` -- free-access path: verifies standing >= freeAccess, issues permit without toll. Needs `<T>` to look up the correct phantom-typed dynamic field for this gate's config.

2. Handle the world contract interaction:
   - The extension must call `world::gate::issue_jump_permit()` or use the existing gate world hooks
   - Research the exact interface: how does the gate-standings extension currently issue permits? Check the on-chain contract bytecodes or the gate-unified contract for the pattern
   - The extension needs the `GateHook` witness type and must be authorized on the gate assembly

3. Compile the contract -- this needs the world contracts package as a dependency

4. Create `packages/chain-shared/src/gate-toll-custom.ts`:
   - `buildSetGateTollCustomConfig(params: { packageId, configObjectId, gateId, registryId, coinType, minAccess, freeAccess, tollAmount, tollRecipient, permitDurationMs, senderAddress })` -> Transaction
   - `buildRequestGateTollCustomAccess(params: { packageId, configObjectId, gateId, coinType, coinObjectIds, tollAmount, characterId, senderAddress })` -> Transaction (toll-paying path)
   - `buildRequestGateTollCustomFreeAccess(params: { packageId, configObjectId, gateId, coinType, characterId, senderAddress })` -> Transaction (free-access path)
   - `queryGateTollCustomConfig(client, configObjectId, gateId, coinType?)` -> GateTollCustomConfigInfo | null

5. Add types: `GateTollCustomConfigInfo` to `types.ts`

6. Add contract addresses:
   - Add `gateTollCustom?: { packageId: string; configObjectId: string }` to `ContractAddresses` in `types.ts`
   - Add placeholder entries in `config.ts` for both tenants

**Files:**
| File | Action |
|------|--------|
| `packages/chain-shared/src/gate-toll-custom.ts` | Create |
| `packages/chain-shared/src/types.ts` | Modify (add GateTollCustomConfigInfo) |
| `packages/chain-shared/src/config.ts` | Modify (add gateTollCustom to ContractAddresses, both tenants) |
| `packages/chain-shared/src/index.ts` | Modify (add gate-toll-custom export) |

### Phase 3: Treasury UI

**Goal:** Add a Treasury management view in the Periscope app.

1. Create `apps/periscope/src/views/Treasury.tsx`:
   - List user's treasuries (query by owner address)
   - Create new treasury (name input + create button)
   - Treasury detail view:
     - Name, owner, admins list
     - Add/remove admin buttons (owner only)
     - Balances table: currency symbol, amount, coin type
     - Deposit action: select currency, enter amount, execute
     - Withdraw action: select currency, enter amount, execute
   - Use the same DataGrid component for balance display

2. Add DB types for treasury caching in `apps/periscope/src/db/types.ts`:
   - `TreasuryRecord extends SyncMeta { id, name, owner, admins: string[], balances: TreasuryBalanceEntry[] }`
   - `TreasuryBalanceEntry { coinType, symbol, amount: string }` (amount as string for IndexedDB bigint compat)
   - Add `treasuries` table to Dexie schema in `db/index.ts` as version 32: `treasuries: "id, owner"`

3. Add route in `apps/periscope/src/router.tsx`: `/treasury`

4. Add sidebar entry in `apps/periscope/src/components/Sidebar.tsx`

5. Create `apps/periscope/src/chain/treasury-queries.ts`:
   - Wrap chain-shared query functions with app-level caching
   - Sync treasury data to IndexedDB

**Files:**
| File | Action |
|------|--------|
| `apps/periscope/src/views/Treasury.tsx` | Create |
| `apps/periscope/src/db/types.ts` | Modify (add TreasuryRecord) |
| `apps/periscope/src/db/index.ts` | Modify (add treasuries table) |
| `apps/periscope/src/router.tsx` | Modify (add /treasury route) |
| `apps/periscope/src/components/Sidebar.tsx` | Modify (add Treasury nav item) |
| `apps/periscope/src/chain/treasury-queries.ts` | Create |

### Phase 4: Gate Toll Currency UI

**Goal:** Update the gate config UI to support custom currency selection and integrate with the new gate toll custom extension.

1. Update `StandingsExtensionPanel.tsx`:
   - Replace the "Toll Fee (SUI)" section with a currency selector
   - Add `tollCoinType` to `GateConfigValues` interface (lines 190-196)
   - When "SUI" is selected, use the existing `gate-standings` extension (current behavior)
   - When a custom currency is selected, use the new `gate-toll-custom` extension
   - Update the help text (line 112) to remove the inaccurate "requires a world contract upgrade" message
   - Add a "Use Treasury" button next to toll recipient that opens a treasury picker

2. Create `apps/periscope/src/components/extensions/CurrencySelector.tsx`:
   - Dropdown listing "SUI (native)" + all currencies from `db.currencies`
   - Shows symbol, name, and coin type
   - Returns the selected coin type string

3. Update `GateConfigValues` in `StandingsExtensionPanel.tsx`:
   - Add `tollCoinType?: string` -- undefined means SUI (default)
   - Add `tollTreasuryId?: string` -- optional treasury as recipient

4. Update `StructureExtensionConfig` in `db/types.ts`:
   - Add `tollCoinType?: string`
   - Add `tollTreasuryId?: string`

5. Update `buildConfigureGateStandings()` in `apps/periscope/src/chain/transactions.ts`:
   - Branch on `tollCoinType`: if undefined/SUI, use existing `buildSetGateStandingsConfig`
   - If custom currency, use new `buildSetGateTollCustomConfig`

6. Update sonar event handlers to display custom currency tolls:
   - `tollCollectedHandler` in `sonarEventHandlers.ts` (line 432): read coin type from event, look up currency name from db
   - `accessGrantedHandler` (line 455): similar update for `toll_paid` display

**Files:**
| File | Action |
|------|--------|
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify (add currency selector, update help text) |
| `apps/periscope/src/components/extensions/CurrencySelector.tsx` | Create |
| `apps/periscope/src/db/types.ts` | Modify (add tollCoinType, tollTreasuryId to StructureExtensionConfig) |
| `apps/periscope/src/chain/transactions.ts` | Modify (branch on toll currency type) |
| `apps/periscope/src/chain/sonarEventHandlers.ts` | Modify (parse custom currency from toll events) |

### Phase 5: Toll-Treasury Integration

**Goal:** Enable gate toll revenue to auto-deposit into a treasury.

1. Design the integration flow:
   - Option A: Gate extension transfers toll Coin<T> directly to treasury via PTB composition
   - Option B: Gate extension transfers to treasury owner's address, manual sweep into treasury
   - Prefer Option A: compose `request_access<T>` + `treasury::deposit<T>` in a single PTB

2. Update `buildRequestGateTollCustomAccess` to optionally compose with treasury deposit:
   - Add optional `treasuryId` parameter
   - If provided, instead of transferring toll to recipient, call `treasury::deposit<T>` with the toll coin
   - This requires the gate toll contract to return the toll coin as a TX result (not transfer internally)

3. Update the gate toll custom contract design:
   - Split `request_access` into: collect toll (returns Coin<T>) + issue permit
   - The PTB composition then does: split coin -> collect toll -> deposit to treasury -> issue permit

4. Add a "Revenue destination" selector in the gate config UI:
   - "Direct to address" (current behavior)
   - "Deposit to treasury" (select from user's treasuries)

**Files:**
| File | Action |
|------|--------|
| `packages/chain-shared/src/gate-toll-custom.ts` | Modify (PTB composition with treasury) |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify (revenue destination selector) |

## File Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `packages/chain-shared/src/treasury.ts` | Create | 1 | Treasury TX builders and query helpers |
| `packages/chain-shared/src/types.ts` | Modify | 1, 2 | Add TreasuryInfo, TreasuryBalance, GateTollCustomConfigInfo |
| `packages/chain-shared/src/config.ts` | Modify | 1, 2 | Add treasury and gateTollCustom to ContractAddresses |
| `packages/chain-shared/src/index.ts` | Modify | 1, 2 | Add treasury and gate-toll-custom exports |
| `packages/chain-shared/src/gate-toll-custom.ts` | Create | 2, 5 | Gate toll custom currency TX builders |
| `apps/periscope/src/views/Treasury.tsx` | Create | 3 | Treasury management view |
| `apps/periscope/src/db/types.ts` | Modify | 3, 4 | Add TreasuryRecord, tollCoinType, tollTreasuryId |
| `apps/periscope/src/db/index.ts` | Modify | 3 | Add treasuries table |
| `apps/periscope/src/router.tsx` | Modify | 3 | Add /treasury route |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | 3 | Add Treasury nav item |
| `apps/periscope/src/chain/treasury-queries.ts` | Create | 3 | Treasury chain query wrappers with IndexedDB caching |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Modify | 4, 5 | Currency selector, treasury recipient, updated help text |
| `apps/periscope/src/components/extensions/CurrencySelector.tsx` | Create | 4 | Reusable currency dropdown component |
| `apps/periscope/src/chain/transactions.ts` | Modify | 4 | Branch on toll currency type |
| `apps/periscope/src/chain/sonarEventHandlers.ts` | Modify | 4 | Parse custom currency from toll events |

## Open Questions

1. **How should the gate toll custom extension handle the generic Coin<T> type?**
   - **Option A: Fully generic contract** -- The Move contract uses `<T>` generics on all functions. One contract deployment handles all Coin types. Config is stored as `GateConfig<phantom T>` dynamic fields, so each gate is locked to one Coin type at config time. Pros: Single deployment, no bytecode patching needed for new currencies. Cons: Sui Move generics require the type to be known at call time, which is fine for TX building but means the config object stores different-typed dynamic fields per gate.
   - **Option B: Per-currency published contract** -- Like the token-factory pattern, compile and publish a separate contract per currency. Bytecode patching swaps the dependency. Pros: Simpler Move code (no generics). Cons: Requires a publish transaction per currency, higher gas cost, more complex management.
   - **Recommendation:** Option A (fully generic). The existing `market.ts` and `exchange.ts` contracts demonstrate that Sui Move generics with `Coin<T>` work well. The TX builder passes `typeArguments: [coinType]` and the Sui runtime resolves the type. This avoids the complexity of bytecode patching for coin types.

2. **Should treasury deposits be open to anyone or restricted to admins?**
   - **Option A: Open deposits** -- Anyone can deposit Coin<T> into a treasury. Pros: Gate extensions can deposit toll revenue without being admins. External parties can send funds. Cons: Potential for spam deposits of worthless tokens.
   - **Option B: Admin-only deposits** -- Only owner/admins can deposit. Pros: No spam. Full control over what enters the treasury. Cons: Gate extensions would need to be added as admins, or toll revenue would need an intermediate step.
   - **Option C: Configurable** -- Treasury has an `allow_public_deposits: bool` flag. Pros: Flexible. Cons: Slightly more complex contract.
   - **Recommendation:** Option A (open deposits). The gate toll integration requires the extension to deposit without being an admin. Spam is low-risk since depositing costs gas and the owner can always see balances. If this becomes a problem, Option C can be added later without breaking changes.

3. **Should the treasury store `Balance<T>` or `Coin<T>` in dynamic fields?**
   - **Option A: Balance\<T>** -- Unwrapped balance representation. Pros: More idiomatic for shared objects, no object ID overhead, supports join/split natively. Cons: Requires `balance::join` and `balance::split` instead of `coin::split` and `transfer::public_transfer`.
   - **Option B: Coin\<T>** -- Wrapped coin objects. Pros: Simpler to transfer out (just `transfer::public_transfer`). Cons: Each Coin has its own object ID, more storage overhead, less idiomatic for balances held within shared objects.
   - **Recommendation:** Option A (Balance\<T>). The `0x2::balance::Balance<T>` type is the standard way to store fungible token balances inside shared objects in Sui Move. Deposits convert `Coin<T>` to `Balance<T>` via `coin::into_balance()`, withdrawals convert back via `coin::from_balance()`.

4. **How should the gate toll extension interact with the world contract's gate system?**
   - **Option A: Direct world contract call** -- The extension calls `world::gate::issue_jump_permit()` directly, similar to the existing gate-standings extension. Pros: Clean, direct. Cons: Requires understanding the exact gate world contract API and hook registration.
   - **Option B: Compose via PTB** -- The extension validates the toll payment and returns a receipt, then a separate PTB step calls the world contract to issue the permit. Pros: Decouples toll logic from world contract integration. Cons: More complex client-side PTB construction.
   - **Recommendation:** Option A. The existing gate-standings extension already demonstrates direct integration with the world contract gate system. The new extension should follow the same pattern. This requires research into the exact API (the `gate_standings` contract's on-chain source is the reference).

5. **Where should the Treasury view live in the app navigation?**
   - **Option A: Standalone view at /treasury** -- Top-level nav item alongside Market, Structures, etc. Pros: Clear, discoverable. Cons: Adds another nav item to an already populated sidebar.
   - **Option B: Sub-section of Wallet view** -- Treasury management as a tab within the existing Wallet view (`apps/periscope/src/views/Wallet.tsx`, lazy-loaded in `router.tsx` line 17, nav entry at `Sidebar.tsx` line 68). Pros: Groups financial features together, Wallet already exists. Cons: Wallet view would need restructuring to support tabs.
   - **Option C: Sub-section of Market view** -- Since treasuries hold market currencies. Pros: Contextually related. Cons: Market view (`views/Market.tsx`) is already complex with token creation, order books, and listings.
   - **Recommendation:** Option A (standalone view). Treasury management has its own admin/access control concerns distinct from personal wallet or market trading. A dedicated route keeps navigation clear.

## Deferred

- **Multi-sig treasury withdrawals** -- Requiring multiple admin signatures for withdrawals. Adds significant complexity (threshold signatures, pending approval state). Deferred until there's a clear need from users managing large shared funds.
- **Treasury spending limits** -- Per-member withdrawal limits or time-based caps. Useful for organizations but adds contract complexity. Can be added as a v2 feature.
- **Automatic toll splitting** -- Splitting gate toll revenue between multiple recipients (e.g., 70% treasury, 30% gate owner). Requires contract-level split logic. Deferred -- users can set up a separate sweeper or use PTB composition.
- **Treasury transaction history UI** -- Displaying deposit/withdraw history from on-chain events. Requires indexing treasury events in sonar. Deferred to after the base treasury feature is stable.
- **Cross-tenant treasury support** -- Treasury objects are per-network (testnet). Cross-chain treasury management is out of scope.
- **Existing SUI toll migration** -- Migrating gates currently using SUI tolls to the new custom currency system. Not required -- the existing gate-standings extension continues to work for SUI-only tolls. Users can switch when ready.

## Cross-Plan Dependencies

- **Plan 04 (manifest expansion):** The CurrencySelector component (Phase 4) reads from `db.currencies`, which already exists (Dexie v12+). Plan 04 adds market discovery caching that would improve currency data freshness, but is not a hard blocker -- the Market view already populates `db.currencies` via `discoverMarkets()`.
- **Plan 06 (extension fixes):** Plan 06 defers custom toll currency (line 372). This plan supersedes that deferral. No code conflicts -- Plan 06 only touches the existing SUI toll help text (which this plan also modifies in Phase 4, but the change is compatible).
- **Plan 07 (dashboard landing):** No dependency. Treasury could appear as a dashboard card in a future iteration.
