# Plan: SSU Market Linking On-Chain Config

**Status:** Draft
**Created:** 2026-03-28
**Module:** periscope, chain-shared

## Overview

Market/sell features on SSUs are currently broken because the on-chain SSU standings config (`ssu_standings::SsuConfig`) has no `market_id` or `coin_type` field. The `useSsuConfig` hook in the SSU dapp (line 70-73 of `apps/ssu-dapp/src/hooks/useSsuConfig.ts`) hardcodes `coinType` and `marketId` to `null` with the comment "Market info is not stored in the standings config."

The existing `ssu_unified` module in `packages/chain-shared/src/ssu-unified.ts` already defines the correct TypeScript interface (`SsuUnifiedConfigInfo` with `marketId: string | null`) and full TX builders for market operations (`set_market`, `remove_market`, `escrow_and_list`, `buy_from_listing`, etc.), but no corresponding Move contract exists in `contracts/`. The `ssu_unified` package IDs in `config.ts` point to deployed contracts that apparently don't store market info -- the `ssu_standings.move` contract only stores `registry_id`, `min_deposit`, `min_withdraw`, and `config_owner` in its `SsuConfig` struct.

Since there are no existing users and all contracts can be fresh, we should write a new `ssu_unified` Move contract that stores all SSU config in a single per-user owned object (not dynamic fields on a shared object), matching the `SsuUnifiedConfigInfo` TypeScript type exactly: owner, ssu_id, delegates, market_id (Option<ID>), is_public, registry_id, min_deposit, min_withdraw.

## Current State

### On-chain contract (`contracts/ssu_standings/sources/ssu_standings.move`)

The deployed `ssu_standings` contract stores per-SSU config as dynamic fields on a shared `SsuStandingsConfig` object. Each entry (`SsuConfig`) contains only:
- `registry_id: ID`
- `min_deposit: u8`
- `min_withdraw: u8`
- `config_owner: address`

There is no `market_id`, `coin_type`, `delegates`, or `is_public` field. No `ssu_unified` Move source exists in the `contracts/` directory at all.

### TypeScript TX builders (`packages/chain-shared/src/ssu-unified.ts`)

The `ssu-unified.ts` file has full TypeScript TX builders for an `SsuUnifiedConfig` object that would store:
- `owner`, `ssu_id`, `delegates[]`, `market_id: Option<ID>`, `is_public: bool`
- `registry_id`, `min_deposit: u8`, `min_withdraw: u8`

It also has builders for market linking (`set_market`, `remove_market`), delegate management, visibility, deposit/withdraw with standings, trade execution (escrow_and_list, buy_from_listing, cancel_listing, fill_buy_order, etc.), and a `querySsuUnifiedConfig` function that reads these fields from chain.

The queries work -- `parseOptionId(fields.market_id)` at line 678 handles the Sui Option serialization correctly. But no matching contract is deployed, so the TX builders have no on-chain target.

### SSU dapp hook (`apps/ssu-dapp/src/hooks/useSsuConfig.ts`)

The dapp hook queries `ssu_standings`'s shared config but returns `marketId: null` and `coinType: null` because the standings-only contract has no market info (lines 70-73).

### Periscope extension config (`apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx`)

The SSU config panel already has a `MarketSelector` component (line 281-288) for picking a Market<T> object. However, `buildConfigureSsuStandings` in `apps/periscope/src/chain/transactions.ts` (line 251-273) only calls `ssu_standings::set_ssu_config` which has no market parameter. The selected `marketId` is saved to IndexedDB only -- never written on-chain.

### Extension template (`apps/periscope/src/chain/config.ts`, lines 254-270)

The `ssu_unified` extension template is registered with:
- `witnessType: "ssu_standings::SsuStandingsAuth"`
- Package IDs for both tenants pointing to `0x8668...568d`
- Config object IDs pointing to `0x87dc...5c5a`

## Target State

1. **New `ssu_unified` Move contract** in `contracts/ssu_unified/` that creates per-user `SsuUnifiedConfig` owned objects with all fields including `market_id: Option<ID>`.

2. **Published to both tenants** (stillness and utopia on Sui testnet), replacing the current `ssuUnified` package IDs in `config.ts`.

3. **SSU dapp reads market from chain** -- `useSsuConfig` queries the new `SsuUnifiedConfig` object and gets real `marketId` and resolves `coinType` from the linked `Market<T>`.

4. **Market/sell UI fully functional** -- all trade builders in `ssu-unified.ts` work against the new on-chain contract.

5. **Extension deployment flow** -- when a user configures an SSU with the Periscope extension, the TX creates an `SsuUnifiedConfig` object (optionally with market link) and stores its ID locally. Market linking can be done at creation time or updated later.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config storage model | Per-user owned objects (not dynamic fields on shared) | The existing `ssu-unified.ts` TX builders and `querySsuUnifiedConfig` already assume owned objects. Avoids shared object contention. Each SSU owner creates/owns their own config. |
| Market linking approach | `Option<ID>` field on `SsuUnifiedConfig` + `set_market`/`remove_market` entry points | Matches the existing `SsuUnifiedConfigInfo` type in `types.ts` (line 239-252). Simple and directly queryable. |
| coinType resolution | Not stored on-chain; derived by querying the linked Market<T>'s type repr | `coinType` is embedded in the Market object's Move type string (`PKG::market::Market<COIN_TYPE>`). Storing it redundantly would require type generics on the config struct, adding complexity. The dapp already queries `MarketInfo` from chain to get coinType (see `queryMarketDetails` in `market.ts`). |
| Witness type | `ssu_unified::SsuUnifiedAuth` (new struct in new module) | The existing template uses `ssu_standings::SsuStandingsAuth`. A new contract needs its own witness type. Must update the extension template. |
| Contract pattern | Follows `gate_toll_custom` pattern (shared init + owned objects) | The `init` function does not create a shared config. Instead, `create_config` creates owned objects transferred to the caller. This is the pattern `ssu-unified.ts` already expects. |
| No dependency on ssu_standings | Fresh contract, no migration | Since there are no existing users, the old `ssu_standings` contract can be abandoned. The new contract is self-contained. |

## Implementation Phases

### Phase 1: Write ssu_unified Move Contract

1. Create `contracts/ssu_unified/Move.toml` with `edition = "2024.beta"` and no external dependencies (only `Sui` framework).
2. Create `contracts/ssu_unified/sources/ssu_unified.move` with:
   - `SsuUnifiedConfig has key` struct: `id: UID`, `owner: address`, `ssu_id: ID`, `delegates: vector<address>`, `market_id: Option<ID>`, `is_public: bool`, `registry_id: ID`, `min_deposit: u8`, `min_withdraw: u8`
   - `SsuUnifiedAuth has drop` witness struct for extension authorization
   - `create_config(ssu_id, registry_id, min_deposit, min_withdraw, ctx)` -- creates config, transfers to sender
   - `create_config_with_market(ssu_id, registry_id, min_deposit, min_withdraw, market_id, ctx)` -- same but with market pre-linked
   - `set_standings_config(config, registry_id, min_deposit, min_withdraw, ctx)` -- update thresholds, owner-only
   - `set_market(config, market_id, ctx)` -- link market, owner-only
   - `remove_market(config, ctx)` -- unlink market, owner-only
   - `add_delegate(config, delegate, ctx)` -- owner-only
   - `remove_delegate(config, delegate, ctx)` -- owner-only
   - `set_visibility(config, is_public, ctx)` -- owner-only
   - Events: `ConfigCreatedEvent`, `MarketLinkedEvent`, `MarketUnlinkedEvent`, `StandingsConfigUpdatedEvent`, `DelegateAddedEvent`, `DelegateRemovedEvent`, `VisibilityChangedEvent`
   - Error constants: `ENotOwner`, `EDelegateAlreadyExists`, `EDelegateNotFound`
3. Build the contract with `sui move build` from the `contracts/ssu_unified/` directory.
4. Publish to Sui testnet with `sui client publish --gas-budget 500000000`.
5. Record the package ID and update `config.ts` for both tenants.

### Phase 2: Update chain-shared Config & Types

1. In `packages/chain-shared/src/config.ts`:
   - Update `ssuUnified.packageId` for stillness and utopia with the new published package ID.
   - Remove old `previousOriginalPackageIds` if present.
   - The `configObjectId` entries in the extension template are for the old shared-config model -- remove them (the new contract uses per-user owned objects, no shared config).
2. In `apps/periscope/src/chain/config.ts`:
   - Update the `ssu_unified` extension template (line 254-270):
     - Change `witnessType` from `"ssu_standings::SsuStandingsAuth"` to `"ssu_unified::SsuUnifiedAuth"`
     - Update `packageIds` with the new contract package ID
     - Clear or remove `configObjectIds` (no shared config object in the new model)

### Phase 3: Update SSU Config Deployment Flow (Periscope App)

1. In `apps/periscope/src/chain/transactions.ts`:
   - Update `buildConfigureSsuStandings` to use the new `ssu_unified` contract:
     - Import `buildCreateSsuUnifiedConfig` and `buildSetSsuUnifiedConfig` from `@tehfrontier/chain-shared`
     - For new configs: call `buildCreateSsuUnifiedConfig` with registry, thresholds, and optional marketId
     - For existing configs (have `ssuConfigId`): call `buildSetSsuUnifiedConfig` to update thresholds
   - Add a new function `buildConfigureSsuMarketLink` that calls `buildSetSsuMarketLink` to link/unlink a market after initial config creation.
2. In `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx`:
   - Update `handleApply` (line 418-484):
     - For SSU with registry: build `createSsuUnifiedConfig` TX (or `setSsuUnifiedConfig` if reconfiguring)
     - Include `marketId` from `ssuConfig.marketId` when creating config
     - After TX succeeds, save the created `SsuUnifiedConfig` object ID to `StructureExtensionConfig.ssuConfigId`
   - Parse the TX result to extract the created `SsuUnifiedConfig` object ID from `objectChanges`
3. In `apps/periscope/src/db/types.ts`:
   - `StructureExtensionConfig` already has `marketId?: string` (line 261) and `ssuConfigId?: string` (line 263) -- no changes needed.

### Phase 4: Update SSU Dapp to Read Market from Chain

1. In `apps/ssu-dapp/src/hooks/useSsuConfig.ts`:
   - Replace the `querySsuStandingsEntry` call with `querySsuUnifiedConfig` + `discoverSsuUnifiedConfig` from `ssu-unified.ts`
   - Flow: `discoverSsuUnifiedConfig(client, packageId, ssuId)` -> returns config object ID -> `querySsuUnifiedConfig(client, configId)` -> returns `SsuUnifiedConfigInfo` with `marketId`
   - If `marketId` is set, resolve `coinType` by calling `queryMarketDetails(client, marketId)` or `queryMarketStandingsDetails(client, marketId)` to extract the coin type from the Market object's type repr
   - Return the real `marketId` and `coinType` instead of `null`
2. Verify that all existing trade TX builders in `ssu-unified.ts` (escrow_and_list, buy_from_listing, etc.) correctly reference the new package's entry points. The function names (`ssu_unified::escrow_and_list`, etc.) already match what the new Move contract should export.

### Phase 5: Add Trade Entry Points to Move Contract

The trade entry points (`escrow_and_list`, `buy_from_listing`, `cancel_listing`, `fill_buy_order`, `player_escrow_and_list`, `player_cancel_listing`, `player_fill_buy_order`, `deposit_item`, `withdraw_item`) are referenced by TX builders in `ssu-unified.ts` but would require dependencies on the EVE world contracts (character, storage_unit, inventory modules) and the market/market_standings contracts.

1. Evaluate whether these functions should live in the `ssu_unified` contract or remain as client-side PTB orchestration:
   - **PTB-only approach**: The TX builders already construct multi-step PTBs that call world contract functions directly (borrow_owner_cap, withdraw_by_owner, etc.) and market contract functions (post_sell_listing, etc.). These don't need on-chain wrapper functions.
   - **On-chain wrapper approach**: The current `ssu-unified.ts` TX builders call entry points like `ssu_unified::escrow_and_list`. If the new contract doesn't export these, the TX builders must be refactored to PTB-only.
2. Decision: Start with config management only (Phase 1) -- `create_config`, `set_market`, delegates, visibility. Trade entry points are deferred until the config contract is deployed and proven. The TX builders in `ssu-unified.ts` can be refactored to PTB-only composition in a follow-up.
3. Update the trade TX builders in `ssu-unified.ts` to use PTB composition instead of calling `ssu_unified::escrow_and_list`:
   - Instead of calling a single `ssu_unified::escrow_and_list<T>`, compose the PTB to: read config -> check standings -> borrow_owner_cap -> withdraw_by_owner -> post_sell_listing on Market -> return_owner_cap
   - This avoids the ssu_unified contract needing to depend on the world contracts.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/ssu_unified/Move.toml` | Create | Package manifest for new contract |
| `contracts/ssu_unified/sources/ssu_unified.move` | Create | Move contract with SsuUnifiedConfig + market linking + delegate/visibility management |
| `packages/chain-shared/src/config.ts` | Edit | Update `ssuUnified` package IDs for both tenants |
| `packages/chain-shared/src/ssu-unified.ts` | Edit | Refactor trade TX builders to PTB-only (remove `ssu_unified::escrow_and_list` etc. calls). Config management functions already match the new contract. |
| `packages/chain-shared/src/types.ts` | None | `SsuUnifiedConfigInfo` already correct (lines 239-252) |
| `apps/periscope/src/chain/config.ts` | Edit | Update `ssu_unified` extension template: new witnessType, packageIds, remove configObjectIds |
| `apps/periscope/src/chain/transactions.ts` | Edit | Update `buildConfigureSsuStandings` to use `buildCreateSsuUnifiedConfig` / `buildSetSsuUnifiedConfig` |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Edit | Wire market linking into SSU config deploy flow, parse created object ID from TX result |
| `apps/ssu-dapp/src/hooks/useSsuConfig.ts` | Edit | Replace standings query with unified config query + market resolution |
| `apps/periscope/src/db/types.ts` | None | `StructureExtensionConfig` already has `marketId`, `ssuConfigId` fields |

## Open Questions

1. **Should the ssu_unified contract include trade entry points or use PTB-only composition?**
   - **Option A: Config-only contract + PTB composition** -- Pros: Simpler Move contract, no dependency on world/market packages, faster to deploy, less on-chain code to audit. Cons: Standings checks for trades happen client-side (not enforced on-chain), PTBs are more complex and fragile.
   - **Option B: Full contract with trade wrappers** -- Pros: On-chain standings enforcement for every trade, single source of truth. Cons: Requires adding the world contracts and market/market_standings packages as dependencies, significantly larger contract, world contract API changes would break the extension.
   - **Recommendation:** Option A. The world contracts are external (CCP-controlled) and change between cycles. Depending on them makes the extension fragile. Standings checks are already client-enforced for gates. Start with config-only and add on-chain trade enforcement in a later cycle if needed.

2. **How should the dapp discover existing SsuUnifiedConfig objects after contract republish?**
   - **Option A: Search by type with `discoverSsuUnifiedConfig`** -- Pros: Already implemented, works by paginating all SsuUnifiedConfig objects and filtering by `ssu_id`. Cons: Slow for many configs, O(n) scan.
   - **Option B: Store config object ID in Periscope's local DB** -- Pros: Instant lookup. Cons: New users or cleared DBs need discovery fallback. SSU dapp (separate app) doesn't have Periscope's DB.
   - **Option C: Both -- local DB primary, on-chain discovery fallback** -- Pros: Fast primary path, resilient fallback. Cons: Slightly more code.
   - **Recommendation:** Option C. Periscope stores the config ID in `StructureExtensionConfig.ssuConfigId` (already has this field). The SSU dapp uses on-chain discovery. This matches the current implementation pattern.

3. **Should the old `ssu_standings` extension references be removed or kept as fallback?**
   - **Option A: Remove completely** -- Pros: Clean codebase, no confusion. Cons: Any SSU that already authorized the old witness type would need to remove and re-authorize the new extension.
   - **Option B: Keep detection for old type, prompt migration** -- Pros: Smooth transition for any SSUs deployed during development. Cons: Extra code to maintain.
   - **Recommendation:** Option A. No production users exist, and the old contract doesn't have market linking. Clean removal is simplest. Any test SSUs can be re-authorized.

## Deferred

- **On-chain standings enforcement for trades** -- Trade entry points (`escrow_and_list`, `buy_from_listing`, etc.) are deferred because they require dependencies on world contracts and market packages. PTB composition handles these operations for now.
- **Market<T> standings enforcement** -- The `market_standings` contract already handles standings for market operations. The ssu_unified contract only needs to store which market is linked; trade enforcement stays in market_standings.
- **Automatic coinType storage** -- Storing coinType on the SsuUnifiedConfig would require generic type parameters (`SsuUnifiedConfig<T>`), making discovery much harder. Resolved by querying Market<T>'s type repr at runtime.
