# Plan: SSU Market Linking On-Chain Config

**Status:** Active
**Created:** 2026-03-28
**Module:** periscope, chain-shared

## Overview

Market/sell features on SSUs are currently broken because there is no on-chain contract that stores `market_id` or `coin_type` for SSU config. The `useSsuConfig` hook in the SSU dapp (line 70-73 of `apps/ssu-dapp/src/hooks/useSsuConfig.ts`) hardcodes `coinType` and `marketId` to `null`.

The `ssu-unified.ts` module in `packages/chain-shared/src/` already defines the correct TypeScript interface (`SsuUnifiedConfigInfo` with `marketId: string | null`) and full TX builders for market operations (`set_market`, `remove_market`, `escrow_and_list`, `buy_from_listing`, etc.), but no corresponding Move contract exists in `contracts/`.

This plan creates a new `ssu_unified` Move contract that stores all SSU config in a single per-user owned object, matching the `SsuUnifiedConfigInfo` TypeScript type exactly: owner, ssu_id, delegates, market_id (Option<ID>), is_public, registry_id, min_deposit, min_withdraw.

## Current State

### TypeScript TX builders (`packages/chain-shared/src/ssu-unified.ts`)

The `ssu-unified.ts` file has full TypeScript TX builders for an `SsuUnifiedConfig` object that would store:
- `owner`, `ssu_id`, `delegates[]`, `market_id: Option<ID>`, `is_public: bool`
- `registry_id`, `min_deposit: u8`, `min_withdraw: u8`

It also has builders for market linking (`set_market`, `remove_market`), delegate management, visibility, deposit/withdraw with standings, trade execution (escrow_and_list, buy_from_listing, cancel_listing, fill_buy_order, etc.), and a `querySsuUnifiedConfig` function that reads these fields from chain.

The queries work -- `parseOptionId(fields.market_id)` at line 678 handles the Sui Option serialization correctly. But no matching contract exists yet, so the TX builders have no on-chain target.

### SSU dapp hook (`apps/ssu-dapp/src/hooks/useSsuConfig.ts`)

The dapp hook returns `marketId: null` and `coinType: null` because no contract stores market info (lines 70-73).

### Periscope extension config (`apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx`)

The SSU config panel already has a `MarketSelector` component (line 281-288) for picking a Market<T> object. However, `buildConfigureSsuStandings` in `apps/periscope/src/chain/transactions.ts` (line 251-273) has no market parameter. The selected `marketId` is saved to IndexedDB only -- never written on-chain.

### Extension template (`apps/periscope/src/chain/config.ts`, lines 254-270)

The `ssu_unified` extension template needs to be created with:
- `witnessType: "ssu_unified::SsuUnifiedAuth"`
- Package IDs for both tenants pointing to the new contract
- No config object IDs (the new contract uses per-user owned objects, no shared config)

## Target State

1. **New `ssu_unified` Move contract** in `contracts/ssu_unified/` that creates per-user `SsuUnifiedConfig` owned objects with all fields including `market_id: Option<ID>`.

2. **Published to Sui testnet** (single publish, package ID shared across tenants), with package IDs set in `config.ts`.

3. **SSU dapp reads market from chain** -- `useSsuConfig` queries `SsuUnifiedConfig` and gets real `marketId`, resolves `coinType` from the linked `Market<T>`.

4. **Market/sell UI fully functional** -- all trade builders in `ssu-unified.ts` work against the new on-chain contract.

5. **Extension deployment flow** -- when a user configures an SSU with the Periscope extension, the TX creates an `SsuUnifiedConfig` object (optionally with market link) and stores its ID locally. Market linking can be done at creation time or updated later.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config storage model | Per-user owned objects (not dynamic fields on shared) | The existing `ssu-unified.ts` TX builders and `querySsuUnifiedConfig` already assume owned objects. Avoids shared object contention. Each SSU owner creates/owns their own config. Owned objects are readable by anyone via GraphQL (for market resolution) but only modifiable by the owner via TX. This works because trade/deposit TXs are refactored to not pass the config object -- they read config client-side and call market/world functions directly. |
| Market linking approach | `Option<ID>` field on `SsuUnifiedConfig` + `set_market`/`remove_market` entry points | Matches the existing `SsuUnifiedConfigInfo` type in `types.ts` (line 239-252). Simple and directly queryable. |
| coinType resolution | Not stored on-chain; derived by querying the linked Market<T>'s type repr | `coinType` is embedded in the Market object's Move type string (`PKG::market::Market<COIN_TYPE>`). Storing it redundantly would require type generics on the config struct, adding complexity. The dapp already queries `MarketInfo` from chain to get coinType (see `queryMarketDetails` in `market.ts`). |
| Witness type | `ssu_unified::SsuUnifiedAuth` | The contract defines its own witness type for extension authorization. |
| Contract pattern | No `init` function; `create_config` creates owned objects | Unlike `gate_toll_custom` (which has `init` creating a shared config), this contract has no shared state. Each `create_config` call creates a new owned `SsuUnifiedConfig` transferred to the caller. This matches what `ssu-unified.ts` TX builders expect. |
| Trade entry points | Config-only contract + PTB composition | The contract stores config only. Trade operations compose `market_standings` functions directly via PTBs. Avoids depending on world contracts (CCP-controlled, change between cycles). On-chain trade enforcement deferred. |
| Config discovery | Local DB primary, on-chain discovery fallback | Periscope stores config ID in `StructureExtensionConfig.ssuConfigId` (already has this field). The SSU dapp uses `discoverSsuUnifiedConfig` for on-chain discovery. |

## Implementation Phases

### Phase 1: Write ssu_unified Move Contract

1. Create `contracts/ssu_unified/Move.toml` with `edition = "2024.beta"` and no external dependencies (only `Sui` framework).
2. Create `contracts/ssu_unified/sources/ssu_unified.move` with:
   - `SsuUnifiedConfig has key` struct (no `store` -- prevents unauthorized transfer): `id: UID`, `owner: address`, `ssu_id: ID`, `delegates: vector<address>`, `market_id: Option<ID>`, `is_public: bool`, `registry_id: ID`, `min_deposit: u8`, `min_withdraw: u8`
   - `SsuUnifiedAuth has drop` witness struct for extension authorization
   - `create_config(ssu_id, registry_id, min_deposit, min_withdraw, ctx)` -- creates config, uses `transfer::transfer(config, ctx.sender())` to send to caller
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
   - Set `ssuUnified.packageId` for stillness and utopia with the published package ID.
   - No `configObjectId` needed (the contract uses per-user owned objects, no shared config).
2. In `apps/periscope/src/chain/config.ts`:
   - Create the `ssu_unified` extension template:
     - `witnessType: "ssu_unified::SsuUnifiedAuth"`
     - `packageIds` with the new contract package ID
     - No `configObjectIds` (no shared config object)

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
   - Replace the current stub with `querySsuUnifiedConfig` + `discoverSsuUnifiedConfig` from `ssu-unified.ts`
   - Flow: `discoverSsuUnifiedConfig(client, packageId, ssuId)` -> returns config object ID -> `querySsuUnifiedConfig(client, configId)` -> returns `SsuUnifiedConfigInfo` with `marketId`
   - If `marketId` is set, resolve `coinType` by calling `queryMarketDetails(client, marketId)` or `queryMarketStandingsDetails(client, marketId)` to extract the coin type from the Market object's type repr
   - Return the real `marketId` and `coinType` instead of `null`

### Phase 5: Refactor Trade TX Builders to PTB-Only

The trade TX builders in `ssu-unified.ts` currently target non-existent on-chain entry points like `ssu_unified::escrow_and_list` (line 324), `ssu_unified::buy_from_listing` (line 472), etc. Since the `ssu_unified` contract is config-only (no trade entry points), the trade TX builders must be refactored to call `market_standings` contract functions directly:

**Escrow concern:** The `market_standings::post_sell_listing` function only records listing metadata (ssuId, typeId, quantity, price) without taking an item object. This means listings in market_standings are "virtual" -- items remain in SSU inventory until purchase. The PTBs should NOT withdraw items at listing time; instead, withdrawal happens at purchase/fill time. The borrow_owner_cap + withdraw_by_owner steps belong in the buy/fill flow, not the listing flow.

1. **`buildEscrowAndListWithStandings`** (lines 293-346): Remove the withdraw_by_owner step. Rewrite to call `market_standings::post_sell_listing`. The listing becomes virtual -- items stay in SSU inventory. Remove `ssuConfigId` parameter.
2. **`buildPlayerEscrowAndListWithStandings`** (lines 371-428): Same pattern -- rewrite to call `market_standings::post_sell_listing` directly.
3. **`buildBuyFromListingWithStandings`** (lines 449-490): Rewrite to call `market_standings::buy_from_listing`.
4. **`buildCancelListingWithStandings`** (lines 507-526): Rewrite to call `market_standings::cancel_sell_listing`.
5. **`buildPlayerCancelListingWithStandings`** (lines 531-550): Rewrite to call `market_standings::cancel_sell_listing`.
6. **`buildPlayerFillBuyOrderWithStandings`** (lines 571-624): Rewrite to call `market_standings::fill_buy_order`.
7. **`buildFillBuyOrderWithStandings`** (lines 642-662): Rewrite to call `market_standings::fill_buy_order`.
8. **`buildUnifiedDepositWithStandings`** (lines 214-232): Rewrite to call world contract deposit functions directly. Standings check moves to client-side.
9. **`buildUnifiedWithdrawWithStandings`** (lines 249-268): Same pattern -- call world contract withdraw functions directly.

Note: The `market-standings.ts` file (in `packages/chain-shared/src/`) already exports direct TX builders for all market operations: `buildPostSellListingStandings` (line 143), `buildCancelSellListingStandings` (line 208), `buildPostBuyOrderStandings` (line 244), `buildCancelBuyOrderStandings` (line 298), etc. These accept `packageId`, `marketId`, `coinType`, `registryId` directly. The trade builders in `ssu-unified.ts` should delegate to these existing functions instead of reimplementing the market calls.

The market_standings package IDs are in `config.ts` under `marketStandings.packageId`. The trade TX builders will need to accept `marketStandingsPackageId` (or look it up from config) instead of only `ssuUnifiedPackageId`. Config management calls still use the ssu_unified packageId.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/ssu_unified/Move.toml` | Create | Package manifest for new contract |
| `contracts/ssu_unified/sources/ssu_unified.move` | Create | Move contract with SsuUnifiedConfig + market linking + delegate/visibility management |
| `packages/chain-shared/src/config.ts` | Edit | Set `ssuUnified` package IDs for both tenants |
| `packages/chain-shared/src/ssu-unified.ts` | Edit | Rewrite trade TX builders to PTB-only (delegate to `market-standings.ts` functions). Config management functions already match the contract. |
| `packages/chain-shared/src/market-standings.ts` | None | Already exports direct market TX builders (`buildPostSellListingStandings`, etc.) -- used as delegation targets by refactored trade builders |
| `packages/chain-shared/src/types.ts` | None | `SsuUnifiedConfigInfo` already correct (lines 239-252) |
| `apps/periscope/src/chain/config.ts` | Edit | Create `ssu_unified` extension template with witnessType and packageIds |
| `apps/periscope/src/chain/transactions.ts` | Edit | Update `buildConfigureSsuStandings` to use `buildCreateSsuUnifiedConfig` / `buildSetSsuUnifiedConfig` |
| `apps/periscope/src/components/extensions/StandingsExtensionPanel.tsx` | Edit | Wire market linking into SSU config deploy flow, parse created object ID from TX result |
| `apps/ssu-dapp/src/hooks/useSsuConfig.ts` | Edit | Wire up unified config query + market resolution |
| `apps/periscope/src/db/types.ts` | None | `StructureExtensionConfig` already has `marketId`, `ssuConfigId` fields |

## Deferred

- **On-chain standings enforcement for trades** -- Trade entry points (`escrow_and_list`, `buy_from_listing`, etc.) are deferred because they require dependencies on world contracts and market packages. PTB composition handles these operations for now.
- **Market<T> standings enforcement** -- The `market_standings` contract already handles standings for market operations. The ssu_unified contract only needs to store which market is linked; trade enforcement stays in market_standings.
- **Automatic coinType storage** -- Storing coinType on the SsuUnifiedConfig would require generic type parameters (`SsuUnifiedConfig<T>`), making discovery much harder. Resolved by querying Market<T>'s type repr at runtime.
