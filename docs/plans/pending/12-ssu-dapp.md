# Plan: SSU dApp — Default Smart Storage Unit Interface

**Status:** Draft
**Created:** 2026-03-17
**Module:** ssu-market-dapp

## Overview

The goal is to build a standalone SSU (Smart Storage Unit) dApp that faithfully reproduces the functionality of EVE Frontier's default dApp — the interface players see when they press **F** on a Smart Storage Unit in-game. This dApp allows players to view SSU inventories (owner, extension, and ephemeral), view assembly metadata and status, and perform owner operations (deposit/withdraw items, bring online/offline, update metadata). It is the canonical interface for interacting with a storage unit.

Today, the TehFrontier monorepo has `apps/ssu-market-dapp/`, which is a purpose-built **marketplace dApp** for the custom `ssu_market` extension. It shows sell order listings and allows buying/selling — it does NOT serve as a general-purpose SSU dApp. A player visiting a storage unit that has no market extension needs the default SSU interface, not a market UI. The two dApps serve different roles and should coexist.

This plan covers building the default SSU dApp as a new module (`apps/ssu-dapp/`) that can be loaded in-game via the `dappURL` field on any SSU, or opened in an external browser with `?tenant=&itemId=` parameters (matching the DappKit convention). Phase 1 faithfully reproduces the default behavior (read-only views + owner operations). Phase 2 extends it with TehFrontier-specific enhancements like extension status display, multi-inventory tabs, and integration with the ssu-market-dapp for market-enabled SSUs.

## Current State

### Existing SSU Market dApp (`apps/ssu-market-dapp/`)

A focused marketplace interface for SSUs that have the `ssu_market` extension deployed:

- **App shell:** `apps/ssu-market-dapp/src/App.tsx` — Vite + React 19 + Tailwind v4 + `@mysten/dapp-kit-react` + `@tanstack/react-query`. Uses `createDAppKit()` with `slushWalletConfig` for EVE Vault. Port 3200.
- **Main view:** `apps/ssu-market-dapp/src/components/MarketView.tsx` — Reads `configId` from URL params, fetches `MarketConfig` on-chain, shows sell orders. Admin sees `OwnerView`, buyers see `BuyerView`.
- **Hooks:** `useMarketConfig.ts`, `useMarketListings.ts`, `useInventory.ts`, `useSignAndExecute.ts` — All use `SuiGraphQLClient` directly (not DappKit's `useSmartObject`).
- **Chain shared:** Transaction builders and queries live in `packages/chain-shared/src/ssu-market.ts` — `buildCreateSellOrder`, `buildBuySellOrder`, `buildCancelSellOrder`, `buildUpdateSellPrice`, `queryMarketConfig`, `queryAllSellOrders`.
- **Item resolution:** `apps/ssu-market-dapp/src/lib/items.ts` — Resolves type IDs to names via World API (`/v2/types/{typeId}`).
- **Constants:** `apps/ssu-market-dapp/src/lib/constants.ts` — `WORLD_PACKAGE_ID`, `SSU_MARKET_PACKAGE_ID`, URL param helpers.

This dApp is **not** the default SSU dApp. It requires a `?configId=0x...` parameter pointing to a deployed MarketConfig object.

### Permissions dApp Pattern (`apps/permissions-dapp/`)

Another Vite + React dApp using the same stack: `@mysten/dapp-kit-react`, `@tanstack/react-query`, `@tehfrontier/chain-shared`, Tailwind v4, lucide-react. Port unspecified. Shows the established pattern for standalone dApps in this monorepo.

### Chain-Shared Infrastructure (`packages/chain-shared/`)

- `src/graphql-queries.ts` — `getObjectJson()`, `listDynamicFieldsGql()`, `getDynamicFieldJson()`, `listCoinsGql()`, `queryEventsGql()` — all use `SuiGraphQLClient`.
- `src/config.ts` — Tenant-specific contract addresses (`CONTRACT_ADDRESSES`), world package IDs.
- `src/types.ts` — TypeScript interfaces for on-chain data structures.

### World Contracts Reference (`docs/world-contracts-reference.md`)

StorageUnit has three inventories: extension-controlled (`inventory`), owner-controlled (`owner_inventory`), and open/code-only (`open_inventory`). Key functions: `deposit_by_owner`, `withdraw_by_owner`, `authorize_extension`, `remove_extension`, `online`, `offline`, `update_metadata_name/description/url`.

### DappKit SDK (`docs/dappkit-sdk-reference.md`)

Provides data hooks but **no pre-built UI components**:
- `useSmartObject()` — Resolves `?itemId=&tenant=` → Sui object ID via ObjectRegistry, polls assembly data every 10s.
- `useConnection()` — EVE Vault wallet connection.
- `useSponsoredTransaction()` — Gas-sponsored TX via EVE Vault.
- `StorageModule` type: `{ mainInventory: { capacity, usedCapacity, items }, ephemeralInventories: EphemeralInventory[] }`.
- `InventoryItem` type: `{ id, item_id, location, quantity, tenant, type_id, name }`.
- `getDatahubGameInfo(typeId)` — Fetch display name, icon, physical properties.

### Default dApp (CCP's `dapps.evefrontier.com`)

The game client opens `https://dapps.evefrontier.com/?tenant={tenant}&itemId={itemId}` when a player presses F on an assembly. This is CCP's proprietary implementation — source not available. Based on the DappKit SDK types and game behavior, the default SSU dApp displays:

1. **Assembly header** — Name, type (SSU), status (online/offline/anchored), owner character name.
2. **Owner inventory** — List of items with type name, icon, quantity, and volume. Owner can deposit/withdraw.
3. **Ephemeral inventories** — Per-character temporary storage. Each shows owner name and item list.
4. **Assembly actions** — Bring online/offline (sponsored TX), update metadata (name, description, dApp URL).
5. **Extension info** — Whether an extension is configured and its type name.

## Target State

A new `apps/ssu-dapp/` module that renders the default SSU interface when loaded with `?tenant=&itemId=` URL parameters. It should work both in-game (embedded browser) and in an external browser.

### Architecture

```
apps/ssu-dapp/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── App.tsx                    # EveFrontierProvider + QueryClient + routing
│   ├── styles/globals.css
│   ├── lib/
│   │   ├── constants.ts           # URL param helpers, world package IDs
│   │   └── items.ts               # Item name/icon resolution via Datahub API
│   ├── hooks/
│   │   ├── useAssembly.ts         # Assembly data via useSmartObject or direct GQL
│   │   ├── useInventory.ts        # Fetch owner + extension + ephemeral inventories
│   │   └── useSignAndExecute.ts   # TX signing wrapper (same pattern as ssu-market-dapp)
│   ├── components/
│   │   ├── AssemblyHeader.tsx     # Name, type, status, owner, online/offline badge
│   │   ├── InventoryTable.tsx     # Sortable item list (name, icon, quantity, volume)
│   │   ├── InventoryTabs.tsx      # Tab switcher: Owner | Extension | Ephemeral[n]
│   │   ├── DepositWithdrawPanel.tsx  # Owner deposit/withdraw controls
│   │   ├── MetadataEditor.tsx     # Edit name, description, dApp URL
│   │   ├── ExtensionInfo.tsx      # Extension type display, authorize/remove
│   │   └── WalletConnect.tsx      # EVE Vault connect button (no modal)
│   └── views/
│       └── SsuView.tsx            # Main view composing all components
```

### Data Flow

1. URL params (`?tenant=&itemId=`) or env var (`VITE_OBJECT_ID`) → derive Sui object ID.
2. Fetch assembly data via GraphQL (either DappKit's `useSmartObject` or direct `getObjectJson`).
3. Parse `StorageUnit` fields: `inventory`, `owner_inventory`, `open_inventory`, `extension`, `status`, `metadata`.
4. Enumerate inventory items via `listDynamicFieldsGql` on each inventory's table ID.
5. Resolve item names/icons via Datahub API (`getDatahubGameInfo` or World API `/v2/types/{typeId}`).
6. Owner operations build PTBs using `character::borrow_owner_cap` + operation + `return_owner_cap`.

### Key Components

**AssemblyHeader:** Shows SSU name, type badge ("Smart Storage Unit"), status indicator (online=green, offline=amber, anchored=gray), owner character name, and solar system location. Read-only for visitors, owner sees action buttons.

**InventoryTabs + InventoryTable:** Tab-based view of the three inventory types. Each tab shows a sortable table of items with columns: Icon, Name, Quantity, Volume. Owner inventory tab includes deposit/withdraw controls. Extension inventory is read-only (controlled by extension code). Ephemeral inventories each show their owner character name.

**DepositWithdrawPanel:** For the SSU owner only. Select item type from owner's game inventory (on the SSU), specify quantity, execute `withdraw_by_owner` or `deposit_by_owner` via PTB with `borrow_owner_cap` pattern.

**MetadataEditor:** Owner can edit assembly name, description, and dApp URL. Uses `update_metadata_name/description/url` via OwnerCap.

**WalletConnect:** Same pattern as ssu-market-dapp — direct EVE Vault connection, no modal. `autoConnect: false`.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New app vs. extend ssu-market-dapp | New `apps/ssu-dapp/` module | Different purpose: default SSU interface vs. marketplace. Separation of concerns. The market dApp needs `?configId=`, the SSU dApp needs `?itemId=&tenant=`. |
| DappKit SDK vs. direct GraphQL | Direct GraphQL via chain-shared | DappKit (`@evefrontier/dapp-kit`) adds ~200KB bundle, only 4 hooks, and locks us to their provider tree. Our chain-shared already has equivalent GraphQL queries. Use DappKit's object ID derivation logic (`deriveObjectID` from `@mysten/sui/utils`) but not the full provider. |
| Object ID resolution | Implement `deriveObjectID` ourselves using `@mysten/sui/utils` | O(1) local computation. DappKit's `getObjectId()` does the same thing. We avoid the full DappKit dependency. The derivation uses `bcs.struct("TenantItemId", { id: bcs.u64(), tenant: bcs.string() })` + `deriveObjectID(registryAddress, typeTag, key)`. |
| Inventory fetching | Parse SSU object JSON → extract inventory table IDs → enumerate dynamic fields | The `StorageUnit` object has `inventory`, `owner_inventory`, `open_inventory` fields. Each contains an `Inventory` struct with a table ID. We enumerate items via `listDynamicFieldsGql` on each table. |
| Item name/icon resolution | World API `/v2/types/{typeId}` with in-memory cache | Same approach as ssu-market-dapp's `items.ts`. DappKit's `getDatahubGameInfo` is equivalent but requires their provider. |
| Wallet integration | `@mysten/dapp-kit-react` with `createDAppKit` + `slushWalletConfig` | Same proven pattern as ssu-market-dapp and permissions-dapp. EVE Vault is the primary wallet for in-game use. |
| Owner operations | PTBs with borrow_owner_cap pattern | Standard world-contracts pattern. `character::borrow_owner_cap<StorageUnit>` → operation → `character::return_owner_cap`. Requires resolving character object ID and OwnerCap receiving ticket from wallet address. |
| Port | 3201 | 3200 is used by ssu-market-dapp. |
| Styling | Tailwind v4, dark zinc theme | Consistent with all other dApps in the monorepo. Optimized for in-game embedded browser (dark background, compact layout). |

## Implementation Phases

### Phase 1: Read-Only SSU View

Build the core read-only interface that any visitor can see without a wallet.

1. Scaffold `apps/ssu-dapp/` with Vite + React 19 + Tailwind v4 + `@mysten/dapp-kit-react` + `@tanstack/react-query` + `@tehfrontier/chain-shared`. Copy boilerplate from `ssu-market-dapp` (package.json, vite.config.ts, tsconfig.json, index.html, globals.css, main.tsx).
2. Implement `src/lib/constants.ts` — URL param parsing (`itemId`, `tenant`), world package IDs per tenant, ObjectRegistry addresses, `VITE_OBJECT_ID` fallback.
3. Implement `src/lib/deriveObjectId.ts` — `deriveObjectId(itemId, tenant)` using `bcs.struct("TenantItemId")` + `deriveObjectID` from `@mysten/sui/utils`. Returns Sui object ID.
4. Implement `src/hooks/useAssembly.ts` — Given the derived object ID, fetch the `StorageUnit` object via `getObjectJson()`. Parse fields: `key`, `type_id`, `status`, `metadata` (name, description, url), `extension`, `owner_cap_id`, `energy_source_id`. Return typed `AssemblyData` object.
5. Implement `src/hooks/useInventory.ts` — Given the SSU object ID, fetch all three inventories. Parse the `inventory`, `owner_inventory`, `open_inventory` fields from the SSU JSON to get table IDs. Enumerate items in each via `listDynamicFieldsGql` + `getDynamicFieldJson`. Return `{ ownerItems, extensionItems, openItems, ephemeralInventories }`.
6. Implement `src/lib/items.ts` — Same pattern as ssu-market-dapp: `resolveItemName(typeId)` and `resolveItemNames(typeIds)` via World API with in-memory cache. Add `resolveItemIcon(typeId)` for icon URLs.
7. Build `src/components/AssemblyHeader.tsx` — Display SSU name, type ("Smart Storage Unit"), status badge, owner character name (resolved via `owner_cap_id` → character). Compact layout for embedded browser.
8. Build `src/components/InventoryTable.tsx` — Reusable sortable table: Icon, Name, Type ID, Quantity, Volume. Empty state message. Loading skeleton.
9. Build `src/components/InventoryTabs.tsx` — Tab bar: "Owner Inventory", "Extension Inventory", "Open Inventory", plus one tab per ephemeral inventory (labeled with owner name). Each tab renders an `InventoryTable`.
10. Build `src/views/SsuView.tsx` — Compose `AssemblyHeader` + `InventoryTabs`. Handle loading/error/not-found states. This is the main view.
11. Build `src/App.tsx` — Provider tree (`QueryClientProvider` + `DAppKitProvider`) + `SsuView`. Parse URL params, derive object ID, pass down.
12. Add to `pnpm-workspace.yaml` and `turbo.json` (coordinator task).
13. Test with a known SSU object ID on testnet.

### Phase 2: Owner Operations

Add write operations for the SSU owner.

1. Implement `src/hooks/useCharacter.ts` — Resolve wallet address → Character object ID via GraphQL query for `PlayerProfile` owned by wallet → extract `character_id`. Cache the result.
2. Implement `src/hooks/useOwnerCap.ts` — Given character object ID and SSU's `owner_cap_id`, resolve the `Receiving<OwnerCap<StorageUnit>>` ticket needed for borrow_owner_cap.
3. Implement `src/hooks/useSignAndExecute.ts` — Same pattern as ssu-market-dapp: wrap `dAppKit.signAndExecuteTransaction`, invalidate queries on success.
4. Build `src/components/WalletConnect.tsx` — EVE Vault connect button. Show abbreviated address when connected. No modal.
5. Build `src/components/DepositWithdrawPanel.tsx` — For owner only. Shows items in owner inventory with withdraw button (quantity input). `withdraw_by_owner` PTB: `borrow_owner_cap` → `withdraw_by_owner` → `return_owner_cap`. Deposit is typically game-side (bridging items from game to chain) so may be deferred.
6. Build `src/components/MetadataEditor.tsx` — Inline edit for name, description, dApp URL. Uses `update_metadata_name/description/url` via OwnerCap PTB.
7. Build `src/components/AssemblyActions.tsx` — Bring online/offline buttons. Uses `storage_unit::online()` / `storage_unit::offline()`. Requires network node object. May use sponsored TX if available.
8. Build `src/components/ExtensionInfo.tsx` — Display extension type name if configured. Owner can see `authorize_extension` / `remove_extension` buttons (for advanced use).
9. Integrate owner UI: `SsuView` detects if connected wallet matches SSU owner address, shows owner-specific panels conditionally.

### Phase 3: Polish and Extensions

1. Add `deposit_by_owner` support — Owner deposits items from their wallet-held items into the SSU owner inventory. Requires building a PTB that borrows OwnerCap and calls `deposit_by_owner` with an `Item` object.
2. Add ephemeral inventory display — Query and display per-character ephemeral storage. Show character name + items for each.
3. Add item transfer between inventories — Owner can move items between owner and extension inventories (if extension is configured).
4. Add responsive/mobile layout — The in-game browser has limited width. Ensure the UI adapts gracefully.
5. Add error code decoder — Map Move abort codes to human-readable messages using error tables from `world-contracts-reference.md`.
6. Consider integration link to ssu-market-dapp — If SSU has a market extension, show a "View Market" link that opens ssu-market-dapp with the correct `configId`.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/ssu-dapp/package.json` | Create | Package manifest: Vite + React 19 + Tailwind v4 + dapp-kit-react + chain-shared |
| `apps/ssu-dapp/vite.config.ts` | Create | Vite config with React, Tailwind, `@` alias, port 3201 |
| `apps/ssu-dapp/tsconfig.json` | Create | TS config extending `@tehfrontier/tsconfig` |
| `apps/ssu-dapp/index.html` | Create | HTML shell with dark zinc theme |
| `apps/ssu-dapp/src/main.tsx` | Create | React DOM render entry point |
| `apps/ssu-dapp/src/App.tsx` | Create | Provider tree + main view |
| `apps/ssu-dapp/src/styles/globals.css` | Create | Tailwind import + scrollbar styles |
| `apps/ssu-dapp/src/lib/constants.ts` | Create | URL param helpers, tenant configs, registry addresses |
| `apps/ssu-dapp/src/lib/deriveObjectId.ts` | Create | itemId+tenant → Sui object ID derivation |
| `apps/ssu-dapp/src/lib/items.ts` | Create | Item name/icon resolution via World API |
| `apps/ssu-dapp/src/hooks/useAssembly.ts` | Create | Fetch + parse StorageUnit object |
| `apps/ssu-dapp/src/hooks/useInventory.ts` | Create | Fetch all three inventories + ephemeral |
| `apps/ssu-dapp/src/hooks/useCharacter.ts` | Create | Wallet → Character resolution |
| `apps/ssu-dapp/src/hooks/useOwnerCap.ts` | Create | OwnerCap receiving ticket resolution |
| `apps/ssu-dapp/src/hooks/useSignAndExecute.ts` | Create | TX signing wrapper |
| `apps/ssu-dapp/src/components/AssemblyHeader.tsx` | Create | SSU name, type, status, owner display |
| `apps/ssu-dapp/src/components/InventoryTable.tsx` | Create | Sortable item list component |
| `apps/ssu-dapp/src/components/InventoryTabs.tsx` | Create | Tab switcher for inventory types |
| `apps/ssu-dapp/src/components/WalletConnect.tsx` | Create | EVE Vault connect button |
| `apps/ssu-dapp/src/components/DepositWithdrawPanel.tsx` | Create | Owner deposit/withdraw controls |
| `apps/ssu-dapp/src/components/MetadataEditor.tsx` | Create | Assembly metadata inline editor |
| `apps/ssu-dapp/src/components/AssemblyActions.tsx` | Create | Online/offline toggle buttons |
| `apps/ssu-dapp/src/components/ExtensionInfo.tsx` | Create | Extension status display |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Create | Main view composing all components |
| `pnpm-workspace.yaml` | Modify | Add `apps/ssu-dapp` to workspace (coordinator) |
| `turbo.json` | Modify | Add ssu-dapp to pipeline if needed (coordinator) |

## Open Questions

1. **Should we use DappKit's `@evefrontier/dapp-kit` or build on `@mysten/dapp-kit-react` directly?**
   - **Option A: Use `@evefrontier/dapp-kit`** — Pros: Get `useSmartObject()` which handles object ID derivation, assembly parsing, polling, and `StorageModule` data extraction automatically; `useSponsoredTransaction()` for gas-free online/offline. Cons: Adds ~200KB to bundle; locks us into their provider tree (`EveFrontierProvider`); only 4 hooks so limited value; may conflict with our direct GraphQL approach in chain-shared; version churn risk.
   - **Option B: Use `@mysten/dapp-kit-react` + chain-shared** — Pros: Consistent with existing ssu-market-dapp and permissions-dapp patterns; full control over data fetching and caching; smaller bundle; uses our battle-tested `chain-shared` GraphQL queries. Cons: Must implement object ID derivation ourselves (~20 lines using `@mysten/sui/utils`); must parse `StorageUnit` JSON manually; no sponsored TX (use regular TX signing instead).
   - **Recommendation:** Option B. The derivation logic is trivial to implement, our GraphQL queries are already proven, and consistency with the existing dApps matters more than DappKit's convenience. If sponsored TX becomes important later, we can add it incrementally.

2. **How to resolve the SSU owner's character for display?**
   - **Option A: Follow OwnerCap chain** — SSU has `owner_cap_id` → OwnerCap is owned by a Character object → Character has `character_address` and `metadata.name`. Requires 2 GraphQL hops: SSU → OwnerCap owner → Character JSON.
   - **Option B: Use World API** — If the World API provides character lookup by SSU, use that. However, the World API primarily indexes by type ID, not by owner relationship.
   - **Recommendation:** Option A. The on-chain ownership chain is authoritative and the two hops are cheap GraphQL queries that can be batched.

3. **Should the SSU dApp support the `?configId=` parameter to also serve as the market dApp?**
   - **Option A: SSU-only** — This dApp shows inventory and owner operations. Market functionality stays in ssu-market-dapp. If the SSU has a market extension, show a link to open ssu-market-dapp.
   - **Option B: Integrated** — Detect if SSU has market extension, show market UI inline alongside inventory.
   - **Recommendation:** Option A for Phase 1. The market dApp has its own query patterns and UI that are distinct from inventory management. Cross-linking is simpler and maintains separation of concerns. Phase 3 can revisit integration.

4. **Inventory data: use DappKit's `StorageModule` parsing or raw GraphQL?**
   - **Option A: DappKit** — `useSmartObject()` returns `assembly.storage.mainInventory.items` already parsed with names. But this only exposes `mainInventory` (owner) and `ephemeralInventories`, not extension or open inventories.
   - **Option B: Raw GraphQL** — Fetch SSU object, parse all three inventory table IDs, enumerate dynamic fields. Full access to all inventory types.
   - **Recommendation:** Option B. We need access to all three inventories, not just the ones DappKit exposes. Direct GraphQL gives us complete control.

## Deferred

- **In-game item bridging (chain_item_to_game_inventory / game_item_to_chain_inventory)** — These require admin/server signatures and are game-server operations, not dApp operations.
- **Energy source display** — Showing linked network node, fuel status, and energy production. Useful but not core SSU dApp functionality. Can be added later.
- **Fuel management** — Deposit/burn/pause fuel on the SSU's network node. Separate concern.
- **Multi-SSU dashboard** — Viewing all SSUs owned by a character at once. Better suited for Periscope than a single-assembly dApp.
- **Sponsored transactions** — Using DappKit's `useSponsoredTransaction` for gas-free operations. Requires `@evefrontier/dapp-kit` dependency. Can be added incrementally if user demand warrants it.
- **Open inventory management** — The open inventory (`deposit_to_open_inventory` / `withdraw_from_open_inventory`) requires extension authorization. Displaying it is Phase 1, but write operations are extension-specific and deferred.
