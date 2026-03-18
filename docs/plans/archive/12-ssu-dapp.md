# Plan: SSU dApp — Default Smart Storage Unit Interface

**Status:** Complete
**Created:** 2026-03-17
**Updated:** 2026-03-18
**Module:** ssu-dapp

## Overview

The goal is to build a standalone SSU (Smart Storage Unit) dApp that faithfully reproduces the functionality of EVE Frontier's default dApp — the interface players see when they press **F** on a Smart Storage Unit in-game. This dApp allows players to view SSU inventories (owner, extension, and ephemeral), view assembly metadata and status, and perform owner operations (deposit/withdraw items, bring online/offline, update metadata). It is the canonical interface for interacting with a storage unit.

Today, the TehFrontier monorepo has `apps/ssu-market-dapp/`, which is a purpose-built **marketplace dApp** for the custom `ssu_market` extension. It shows sell order listings and allows buying/selling — it does NOT serve as a general-purpose SSU dApp. A player visiting a storage unit that has no market extension needs the default SSU interface, not a market UI. The two dApps serve different roles and should coexist.

This plan covers building the default SSU dApp as a new module (`apps/ssu-dapp/`) that can be loaded in-game via the `dappURL` field on any SSU, or opened in an external browser with `?tenant=&itemId=` parameters (matching the DappKit convention). Phase 1 builds the read-only views. Phase 2 adds owner operations (withdraw, metadata, online/offline). Phase 3 adds owner inventory transfer capabilities with partial stack support -- the SSU owner can withdraw partial stacks from the owner inventory and deposit wallet-held items back in. Phase 4 covers polish and extensions.

## Current State

### SSU dApp (`apps/ssu-dapp/`) — ALL PHASES COMPLETE

A fully functional SSU viewer, owner management, and transfer dApp:

- **App shell:** `apps/ssu-dapp/src/App.tsx` — Vite + React 19 + Tailwind v4 + `@mysten/dapp-kit-react` + `@tanstack/react-query` + `@tehfrontier/chain-shared`. Uses `createDAppKit()` with `slushWalletConfig` for EVE Vault. Port 3201. Build succeeds (`dist/` exists). Responsive layout with `sm:` breakpoints.
- **Object ID resolution:** `src/lib/deriveObjectId.ts` — BCS derivation using `deriveObjectID` from `@mysten/sui/utils`. Fallback via `VITE_OBJECT_ID` env var.
- **Constants:** `src/lib/constants.ts` — URL param helpers, world package IDs per tenant (stillness + utopia), ObjectRegistry addresses, World API base URLs.
- **Item resolution:** `src/lib/items.ts` — `resolveItemName`, `resolveItemNames`, `resolveItemIcon` via World API `/v2/types/{typeId}` with in-memory cache.
- **Error decoder:** `src/lib/errors.ts` — `decodeErrorMessage()` maps Move abort codes to human-readable messages for storage_unit, inventory, character, and access modules.
- **Assembly data:** `src/hooks/useAssembly.ts` — Fetches StorageUnit via `getObjectJson()`, parses status (variant-based enum), metadata (Option wrapping), extension type, OwnerCap ID, energy source.
- **Inventory data:** `src/hooks/useInventory.ts` — **NOTE: implementation diverged from plan.** Uses dynamic field enumeration (GraphQL `dynamicFields` query) instead of inline VecMap parsing. Classifies inventory slots as owner (key == `owner_cap_id`), open (key == `blake2b256(bcs(ssu_id) + "open_inventory")`), or player (anything else). Resolves player character names via OwnerCap-to-Character lookup. Returns `SsuInventories` with labeled, color-classified slots.
- **Wallet items:** `src/hooks/useWalletItems.ts` — Queries wallet-held `Item` objects via GraphQL with pagination and name resolution. Used by TransferPanel's deposit tab.
- **Owner hooks:** `useCharacter.ts` (wallet -> PlayerProfile -> character_id), `useOwnerCap.ts` (Receiving ticket via receivingConnection), `useSignAndExecute.ts` (TX wrapper with query invalidation for assembly, itemNames, ownerCap, ssu-inventories, wallet-items), `useSuiClient.ts` (typed GraphQL client wrapper).
- **Components:** `AssemblyHeader.tsx` (name, type, status badge, extension, dApp URL, market dApp link), `InventoryTable.tsx` (sortable table with empty/loading states), `InventoryTabs.tsx` (color-coded tab bar with capacity bar, legend, per-slot colors, responsive flex-wrap), `WalletConnect.tsx` (EVE Vault direct connect), `TransferPanel.tsx` (tabbed withdraw/deposit with partial stack support, capacity validation, success feedback), `MetadataEditor.tsx` (inline edit name/description/URL), `AssemblyActions.tsx` (status display, notes online/offline requires server), `ExtensionInfo.tsx` (display + remove extension).
- **Dead code:** `DepositWithdrawPanel.tsx` still exists on disk but is not imported anywhere -- superseded by `TransferPanel.tsx`. Can be deleted in a cleanup pass.
- **Main view:** `src/views/SsuView.tsx` — Composites all components. Shows read-only view for visitors, full owner controls panel (TransferPanel, MetadataEditor, ExtensionInfo, AssemblyActions) when wallet matches SSU owner.

### Existing SSU Market dApp (`apps/ssu-market-dapp/`)

A focused marketplace interface for SSUs that have the `ssu_market` extension deployed:

- **App shell:** `apps/ssu-market-dapp/src/App.tsx` — Vite + React 19 + Tailwind v4 + `@mysten/dapp-kit-react` + `@tanstack/react-query`. Uses `createDAppKit()` with `slushWalletConfig` for EVE Vault. Port 3200.
- **Main view:** `apps/ssu-market-dapp/src/components/MarketView.tsx` — Reads `configId` from URL params, fetches `MarketConfig` on-chain, shows sell orders. Admin sees `OwnerView`, buyers see `BuyerView`.
- **Hooks:** `useMarketConfig.ts`, `useMarketListings.ts`, `useInventory.ts`, `useSignAndExecute.ts` — All use `SuiGraphQLClient` directly (not DappKit's `useSmartObject`).
- **Chain shared:** Transaction builders and queries live in `packages/chain-shared/src/ssu-market.ts` — `buildCreateSellOrder`, `buildBuySellOrder`, `buildCancelSellOrder`, `buildUpdateSellPrice`, `queryMarketConfig`, `queryAllSellOrders`.
- **Item resolution:** `apps/ssu-market-dapp/src/lib/items.ts` — Resolves type IDs to names via World API (`/v2/types/{typeId}`).
- **Constants:** `apps/ssu-market-dapp/src/lib/constants.ts` — `WORLD_PACKAGE_ID`, `SSU_MARKET_PACKAGE_ID`, URL param helpers.

This dApp is **not** the default SSU dApp. It requires a `?configId=0x...` parameter pointing to a deployed MarketConfig object.

### Chain-Shared Infrastructure (`packages/chain-shared/`)

- `src/graphql-queries.ts` — `getObjectJson()`, `listDynamicFieldsGql()`, `getDynamicFieldJson()`, `listCoinsGql()`, `queryEventsGql()` — all use `SuiGraphQLClient`.
- `src/config.ts` — Tenant-specific contract addresses (`CONTRACT_ADDRESSES`), world package IDs.
- `src/types.ts` — TypeScript interfaces for on-chain data structures.

### World Contracts Reference (`docs/world-contracts-reference.md`)

StorageUnit inventories are stored as dynamic fields on the SSU object, keyed by ID. The owner inventory key matches the SSU's `owner_cap_id`, the open inventory key is derived via `blake2b256(bcs(ssu_id) + "open_inventory")`, and player inventories are keyed by each player's OwnerCap ID. Each inventory is an `Inventory` struct containing a `VecMap<u64, ItemEntry>` — items are stored inline within the dynamic field value. Key `storage_unit` functions: `deposit_by_owner`, `withdraw_by_owner`, `authorize_extension`, `remove_extension`, `online`, `offline`. Each assembly type has its own `update_metadata_name/description/url` functions on its own module — for SSUs, these are `storage_unit::update_metadata_name/description/url`.

### DappKit SDK (`docs/dappkit-sdk-reference.md`)

Provides data hooks but **no pre-built UI components**:
- `useSmartObject()` — Resolves `?itemId=&tenant=` -> Sui object ID via ObjectRegistry, polls assembly data every 10s.
- `useConnection()` — EVE Vault wallet connection.
- `useSponsoredTransaction()` — Gas-sponsored TX via EVE Vault.
- `StorageModule` type: `{ mainInventory: { capacity, usedCapacity, items }, ephemeralInventories: EphemeralInventory[] }`.
- `InventoryItem` type: `{ id, item_id, location, quantity, tenant, type_id, name }`.
- `getDatahubGameInfo(typeId)` — Fetch display name, icon, physical properties.

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
│   ├── App.tsx                    # DAppKitProvider + QueryClientProvider + routing
│   ├── styles/globals.css
│   ├── lib/
│   │   ├── constants.ts           # URL param helpers, world package IDs
│   │   ├── deriveObjectId.ts      # itemId+tenant -> Sui object ID derivation
│   │   └── items.ts               # Item name/icon resolution via Datahub API
│   ├── hooks/
│   │   ├── useAssembly.ts         # Assembly data via direct GQL (getObjectJson)
│   │   ├── useCharacter.ts        # Wallet -> Character resolution
│   │   ├── useInventory.ts        # Fetch inventories via dynamic fields, classify slots
│   │   ├── useOwnerCap.ts         # OwnerCap receiving ticket resolution
│   │   ├── useSignAndExecute.ts   # TX signing wrapper
│   │   ├── useSuiClient.ts        # Typed SuiGraphQLClient wrapper
│   │   └── useWalletItems.ts      # (Phase 3) Query wallet-held Item objects
│   ├── components/
│   │   ├── AssemblyHeader.tsx     # Name, type, status, extension, dApp URL
│   │   ├── AssemblyActions.tsx    # Online/offline status display
│   │   ├── DepositWithdrawPanel.tsx  # Owner withdraw controls (Phase 2)
│   │   ├── ExtensionInfo.tsx      # Extension type display, authorize/remove
│   │   ├── InventoryTable.tsx     # Sortable item list (name, quantity, volume)
│   │   ├── InventoryTabs.tsx      # Color-coded tab switcher with capacity bar
│   │   ├── MetadataEditor.tsx     # Edit name, description, dApp URL
│   │   ├── TransferPanel.tsx      # (Phase 3) Unified withdraw/deposit with partial stacks
│   │   └── WalletConnect.tsx      # EVE Vault connect button (no modal)
│   └── views/
│       └── SsuView.tsx            # Main view composing all components
```

### Data Flow

1. URL params (`?tenant=&itemId=`) or env var (`VITE_OBJECT_ID`) -> derive Sui object ID.
2. Fetch assembly data via direct GraphQL (`getObjectJson` from chain-shared).
3. Parse `StorageUnit` fields: `type_id`, `status`, `metadata`, `extension`, `owner_cap_id`, `energy_source_id`.
4. Fetch inventory dynamic fields on the SSU object, classify each as owner/open/player based on its key ID, parse `VecMap<u64, ItemEntry>` items from each `Inventory` struct.
5. Resolve item names/icons via World API `/v2/types/{typeId}` with in-memory cache.
6. Resolve player character names for player inventory slots via OwnerCap -> Character lookup.
7. Owner operations build PTBs using `character::borrow_owner_cap` + operation + `return_owner_cap`.

### Key Components

**AssemblyHeader:** Shows SSU name, type name (resolved via World API), status indicator (online=green, offline=gray), object ID, extension type (truncated module::name), and dApp URL link. Compact layout for embedded browser.

**InventoryTabs + InventoryTable:** Color-coded tab-based view of all inventory slots (owner=cyan, open/escrow=amber, player=rotating palette). Global capacity bar shows combined usage across all slots with per-slot colored segments and legend. Each tab renders a sortable `InventoryTable` with columns: Item, Qty, Volume. Player inventory tabs show resolved character names.

**DepositWithdrawPanel:** For the SSU owner only. Select item type from owner inventory, specify quantity (1 to max), execute `withdraw_by_owner` via PTB with `borrow_owner_cap` pattern. Transfers the resulting `Item` object to the owner's wallet.

**MetadataEditor:** Owner can edit assembly name, description, and dApp URL. Uses `storage_unit::update_metadata_name/description/url` (each assembly type has its own metadata update functions) via OwnerCap.

**TransferPanel (Phase 3):** Tabbed UI for owner inventory transfers. "Withdraw" tab lets the owner pull partial stacks from the SSU owner inventory into their wallet. "Deposit" tab lists wallet-held `Item` objects and lets the owner push them (full or partial) into the SSU. Partial deposits use a deposit-then-withdraw-remainder PTB pattern since the `inventory` module has no public split function for `Item` objects.

**WalletConnect:** Same pattern as ssu-market-dapp -- direct EVE Vault connection, no modal. `autoConnect: false`.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New app vs. extend ssu-market-dapp | New `apps/ssu-dapp/` module | Different purpose: default SSU interface vs. marketplace. Separation of concerns. The market dApp needs `?configId=`, the SSU dApp needs `?itemId=&tenant=`. |
| DappKit SDK vs. direct GraphQL | Direct GraphQL via chain-shared | DappKit (`@evefrontier/dapp-kit`) adds ~200KB bundle, only 4 hooks, and locks us to their provider tree. Our chain-shared already has equivalent GraphQL queries. Use DappKit's object ID derivation logic (`deriveObjectID` from `@mysten/sui/utils`) but not the full provider. |
| Object ID resolution | Implement `deriveObjectID` ourselves using `@mysten/sui/utils` | O(1) local computation. DappKit's `getObjectId()` does the same thing. We avoid the full DappKit dependency. The derivation uses `bcs.struct("TenantItemId", { id: bcs.u64(), tenant: bcs.string() })` + `deriveObjectID(registryAddress, typeTag, key)`. |
| Inventory fetching | Dynamic field enumeration on the SSU object | **Updated from plan.** The original plan assumed inventories were inline fields on the StorageUnit struct. In reality, inventories are stored as dynamic fields keyed by ID. The implementation uses a GraphQL `dynamicFields` query on the SSU, filters for `::inventory::Inventory` typed fields, and classifies each slot by comparing its key against `owner_cap_id` (owner slot), `blake2b256(bcs(ssu_id) + "open_inventory")` (open/escrow slot), or anything else (player slot). |
| Item name/icon resolution | World API `/v2/types/{typeId}` with in-memory cache | Same approach as ssu-market-dapp's `items.ts`. DappKit's `getDatahubGameInfo` is equivalent but requires their provider. |
| Wallet integration | `@mysten/dapp-kit-react` with `createDAppKit` + `slushWalletConfig` | Same proven pattern as ssu-market-dapp and permissions-dapp. EVE Vault is the primary wallet for in-game use. |
| Owner operations | PTBs with borrow_owner_cap pattern | Standard world-contracts pattern. `character::borrow_owner_cap<StorageUnit>` -> operation -> `character::return_owner_cap`. Requires resolving character object ID and OwnerCap receiving ticket from wallet address. |
| Port | 3201 | 3200 is used by ssu-market-dapp. |
| Styling | Tailwind v4, dark zinc theme | Consistent with all other dApps in the monorepo. Optimized for in-game embedded browser (dark background, compact layout). |
| Partial stack transfers | Withdraw with quantity param + deposit the resulting Item | `withdraw_by_owner(su, character, owner_cap, type_id, quantity)` already accepts a `quantity: u32` param, producing a new `Item` object with exactly that quantity. To transfer a partial stack from owner inventory to another SSU (or re-deposit), withdraw the partial amount then deposit the resulting `Item`. This is a single PTB with `borrow_owner_cap` -> `withdraw_by_owner` -> `deposit_by_owner` -> `return_owner_cap`. |
| Cross-inventory transfer scope | Owner inventory only (not extension/open) | The Move contracts enforce strict access: extension inventory requires an `Auth` witness from the extension module, open inventory also requires extension auth. The SSU owner can only directly read/write the **owner inventory** via OwnerCap. Transfers between extension/open inventories and owner inventory are not possible without the extension contract's cooperation. The transfer UI is scoped to owner inventory operations. |
| Transfer UX pattern | Tabbed transfer panel below inventory | A `TransferPanel` component with two tabs: "Withdraw" (SSU -> wallet) and "Deposit" (wallet -> SSU). Each tab has an item selector, quantity input with max button, and execute button. Keeps the UI compact for the in-game embedded browser. Replaces the Phase 2 `DepositWithdrawPanel` when Phase 3 ships. |

## Implementation Phases

### Phase 1: Read-Only SSU View -- COMPLETE

Build the core read-only interface that any visitor can see without a wallet.

1. ~~Scaffold `apps/ssu-dapp/` with Vite + React 19 + Tailwind v4 + `@mysten/dapp-kit-react` + `@tanstack/react-query` + `@tehfrontier/chain-shared`. Copy boilerplate from `ssu-market-dapp` (package.json, vite.config.ts, tsconfig.json, index.html, globals.css, main.tsx).~~
2. ~~Implement `src/lib/constants.ts` — URL param parsing (`itemId`, `tenant`), world package IDs per tenant (stillness + utopia), ObjectRegistry addresses, World API base URLs, `VITE_OBJECT_ID` fallback.~~
3. ~~Implement `src/lib/deriveObjectId.ts` — `deriveObjectId(itemId, tenant)` using `bcs.struct("TenantItemId", { id: bcs.u64(), tenant: bcs.string() })` + `deriveObjectID` from `@mysten/sui/utils`. Type tag: `${worldPackageId}::in_game_id::TenantItemId`. Returns Sui object ID.~~
4. ~~Implement `src/hooks/useAssembly.ts` — Given the derived object ID, fetch the `StorageUnit` object via `getObjectJson()`. Parse fields: `type_id`, `status`, `metadata`, `extension`, `owner_cap_id`, `energy_source_id`. Return typed `AssemblyData` object.~~
5. ~~Implement `src/hooks/useInventory.ts` — Fetch inventory dynamic fields from the SSU object, classify each slot (owner/open/player), parse `VecMap` items, resolve character names for player slots. Returns `SsuInventories` with labeled, color-classified slots.~~
6. ~~Implement `src/lib/items.ts` — `resolveItemName(typeId)`, `resolveItemNames(typeIds)`, `resolveItemIcon(typeId)` via World API with in-memory cache.~~
7. ~~Build `src/components/AssemblyHeader.tsx` — Display SSU name, type name, status badge, extension type, dApp URL, object ID. Compact layout for embedded browser.~~
8. ~~Build `src/components/InventoryTable.tsx` — Reusable sortable table: Item, Qty, Volume. Empty state message. Loading skeleton.~~
9. ~~Build `src/components/InventoryTabs.tsx` — Color-coded tab bar with capacity bar, legend, per-slot colors. Each tab renders an `InventoryTable`.~~
10. ~~Build `src/views/SsuView.tsx` — Compose `AssemblyHeader` + `InventoryTabs`. Handle loading/error/not-found states.~~
11. ~~Build `src/App.tsx` — Provider tree (`QueryClientProvider` + `DAppKitProvider`) + `SsuView`. Parse URL params, derive object ID, pass down.~~
12. ~~Build succeeds. Auto-discovered by `pnpm-workspace.yaml` and `turbo.json`.~~

**Implementation notes:**
- Added `useSuiClient.ts` helper hook (typed wrapper for `useCurrentClient()`) -- not in original plan but used by multiple hooks.
- Inventory approach changed from inline VecMap parsing to dynamic field enumeration -- see updated Design Decisions table.
- Player inventory slots with character name resolution were implemented in Phase 1 (originally planned as Phase 4 ephemeral inventories). The "ephemeral inventories" from DappKit turned out to be the same dynamic-field-based player inventory slots.
- `@noble/hashes` (blake2b) is used by `useInventory.ts` for open inventory key derivation but is not listed as an explicit dependency in `package.json` -- it works via hoisted transitive dependency from `@mysten/sui`.

### Phase 2: Owner Operations -- COMPLETE

Add write operations for the SSU owner.

1. ~~Implement `src/hooks/useCharacter.ts` — Resolve wallet address -> Character object ID via GraphQL query for `PlayerProfile` owned by wallet -> extract `character_id`. Cache the result.~~
2. ~~Implement `src/hooks/useOwnerCap.ts` — Given character object ID and SSU's `owner_cap_id`, resolve the `Receiving<OwnerCap<StorageUnit>>` ticket needed for borrow_owner_cap. Uses `receivingConnection` query on the character object.~~
3. ~~Implement `src/hooks/useSignAndExecute.ts` — Wraps `dAppKit.signAndExecuteTransaction`, invalidates `assembly`, `itemNames`, `ownerCap` queries on success.~~
4. ~~Build `src/components/WalletConnect.tsx` — EVE Vault connect button. Show abbreviated address when connected. No modal.~~
5. ~~Build `src/components/DepositWithdrawPanel.tsx` — For owner only. Shows items in owner inventory with withdraw button (quantity input). `withdraw_by_owner` PTB: `borrow_owner_cap` -> `withdraw_by_owner` -> `return_owner_cap`. Transfers resulting `Item` to owner wallet.~~
6. ~~Build `src/components/MetadataEditor.tsx` — Inline edit for name, description, dApp URL. Uses `storage_unit::update_metadata_name/description/url` via OwnerCap PTB. Only submits changed fields.~~
7. ~~Build `src/components/AssemblyActions.tsx` — Status display with energy source info. Notes that online/offline requires server-managed shared objects (NetworkNode, EnergyConfig, OfflineAssemblies) and is not available from the client.~~
8. ~~Build `src/components/ExtensionInfo.tsx` — Display extension type name if configured. Owner can remove extension via `storage_unit::remove_extension` PTB.~~
9. ~~Integrate owner UI: `SsuView` detects if connected wallet matches SSU owner (via `useCharacter` + `useOwnerCap` resolution), shows owner-specific panels conditionally. Non-owner visitors see read-only extension info.~~

**Implementation notes:**
- `AssemblyActions.tsx` does not implement online/offline toggle buttons as originally planned. It correctly identifies that these operations require server-managed shared objects and displays status as read-only with a note.
- `DepositWithdrawPanel.tsx` transfers the withdrawn `Item` to `characterObjectId` rather than the wallet address -- this may need review for Phase 3 wallet-items integration.
- `useSignAndExecute.ts` does not yet invalidate `ssu-inventories` query key -- will be needed for Phase 3.

### Phase 3: Owner Inventory Transfers (Partial Stack Support) -- COMPLETE

Enable the SSU owner to move items within and out of the owner inventory, including partial stacks. The Move contract `withdraw_by_owner` already accepts a `quantity: u32` parameter, so partial withdrawals produce a new `Item` object with the specified quantity. The key operations are:

- **Withdraw partial stack** -- Take X of Y items out of the owner inventory (produces an `Item` object transferred to the owner's wallet). The owner's wallet then holds an `Item` on-chain object.
- **Deposit from wallet** -- Deposit a wallet-held `Item` object (from a previous withdrawal or received via transfer) back into the SSU's owner inventory.
- **Partial deposit** -- Deposit only some of a wallet-held `Item`'s quantity into the SSU. Since there is no public `split` function on the `inventory` module (the `ESplitQuantityInvalid` error exists but the split function is package-scoped), partial deposit uses a deposit-then-withdraw-remainder pattern in a single PTB.

**Scope constraints:** Only the owner inventory is transferable via OwnerCap. Extension and open inventories require extension Auth witnesses and are NOT accessible to the owner through this UI. The transfer UI communicates this clearly to the owner.

**On-chain functions used:**
- `storage_unit::withdraw_by_owner<StorageUnit>(su, character, owner_cap, type_id, quantity)` -- Returns `Item` with the requested quantity. Aborts with `EInventoryInsufficientQuantity` (error 4) if quantity exceeds available.
- `storage_unit::deposit_by_owner<StorageUnit>(su, character, owner_cap, item)` -- Deposits an `Item` object. Aborts with `EInventoryInsufficientCapacity` (error 2) if insufficient capacity.
- Both require the `borrow_owner_cap` / `return_owner_cap` pattern on `Character`.

**Pre-implementation note:** The existing `DepositWithdrawPanel.tsx` transfers the withdrawn `Item` to `characterObjectId` (the shared Character object). For Phase 3, withdrawn items should go to the **wallet address** instead, so the owner can see them as wallet-held objects for re-deposit. This needs to be corrected when implementing the TransferPanel.

1. ~~**Add `useWalletItems.ts` hook** -- Query wallet-held `Item` objects owned by the connected wallet address. Uses GraphQL to find objects of type `${worldPkg}::inventory::Item` owned by the wallet. Returns `{ items: WalletItem[], isLoading }` where `WalletItem` has `{ objectId, typeId, quantity, volume, tenant, name }`. These are items previously withdrawn from SSUs or received via transfers.~~

2. ~~**Build `src/components/TransferPanel.tsx`** -- Owner-only transfer UI, displayed below the inventory tabs when the owner is connected. Contains two sections:~~
   - ~~**Withdraw from SSU** -- Select an item type from the owner inventory, enter quantity (1 to max), execute withdraw. The resulting `Item` object goes to the owner's wallet. Uses the existing `DepositWithdrawPanel` withdraw logic but with a cleaner partial-stack-focused UX.~~
   - ~~**Deposit to SSU** -- Lists wallet-held `Item` objects (from `useWalletItems`). Owner selects an item, optionally specifies partial quantity (requires a split + deposit PTB pattern if depositing less than the full `Item` quantity), and deposits into the owner inventory.~~

3. ~~**Implement partial deposit (split + deposit) PTB** -- When depositing a partial quantity from a wallet-held `Item`:~~
   - ~~The `Item` struct has `key, store` abilities -- it's a standalone on-chain object.~~
   - ~~There is no public `split` function on the `inventory` module for `Item` objects. The `Item` is consumed whole by `deposit_by_owner`.~~
   - ~~**Workaround:** To deposit a partial amount, the owner must deposit the entire `Item` and then withdraw the remainder back. This is a single PTB: `borrow_owner_cap` -> `deposit_by_owner(full_item)` -> `withdraw_by_owner(type_id, remainder_qty)` -> `return_owner_cap`. The withdraw produces a new `Item` with the leftover quantity that transfers back to the owner's wallet.~~
   - ~~The UI shows a quantity input that defaults to the full item quantity. If the user enters a partial amount, the PTB uses the deposit-then-withdraw-remainder pattern.~~

4. ~~**Integrate TransferPanel into SsuView** -- Replace `DepositWithdrawPanel` with `TransferPanel` in the owner controls section of `SsuView.tsx`. Pass `ssuObjectId`, `characterObjectId`, `ownerCap`, `ownerInventory`, and wallet items data.~~

5. ~~**Update `useSignAndExecute.ts`** -- Add `["ssu-inventories"]` and `["wallet-items"]` to invalidated query keys so both the inventory table and the wallet items list refresh after successful transfers.~~

6. ~~**Add transfer success feedback** -- Show inline success message with the transferred quantity and item name after a successful TX.~~

7. ~~**Add capacity validation** -- Before building the deposit PTB, check that `ownerInventory.usedCapacity + depositVolume <= ownerInventory.maxCapacity`. Show an error if insufficient capacity. Volume is `item.volume * quantity` (in milli-m3).~~

**Implementation notes:**
- `TransferPanel.tsx` fully replaces `DepositWithdrawPanel.tsx` in `SsuView.tsx`. The old file still exists on disk but is dead code (not imported anywhere).
- Withdraw tab correctly sends items to the wallet address (not `characterObjectId`), fixing the Phase 2 bug.
- Partial deposit uses the deposit-then-withdraw-remainder PTB pattern as planned.
- Capacity validation shows remaining capacity in m3 with a clear error message.
- Both success and error feedback are inline with `decodeErrorMessage()` integration for Move abort codes.

### Phase 4: Polish and Extensions -- COMPLETE

1. ~~Add responsive/mobile layout -- The in-game browser has limited width. Ensure the UI adapts gracefully.~~
2. ~~Add error code decoder -- Map Move abort codes to human-readable messages using error tables from `world-contracts-reference.md`.~~
3. ~~Consider integration link to ssu-market-dapp -- If SSU has a market extension, show a "View Market" link that opens ssu-market-dapp with the correct `configId`.~~
4. ~~Add `@noble/hashes` as explicit dependency in `package.json` -- Currently relies on hoisted transitive dependency from `@mysten/sui`.~~

**Implementation notes:**
- Responsive layout: `globals.css` has media queries for 480px and 360px viewports. `App.tsx` uses `sm:` breakpoints for padding. `InventoryTabs.tsx` uses `flex-wrap` for tab overflow.
- Error decoder: `src/lib/errors.ts` maps abort codes for storage_unit (12 codes), inventory (7 codes), character (8 codes), and access (3 codes) modules. Used by `TransferPanel` for both withdraw and deposit error handling.
- Market link: `AssemblyHeader.tsx` detects market extensions via `isMarketExtension()` and shows a "View Market" link to ssu-market-dapp with the correct `configId`.
- `@noble/hashes` added as explicit dependency at `^1.7.2` in `package.json`.

## File Summary

| File | Action | Phase | Status | Description |
|------|--------|-------|--------|-------------|
| `apps/ssu-dapp/package.json` | Create | 1 | Done | Package manifest: Vite + React 19 + Tailwind v4 + dapp-kit-react + chain-shared |
| `apps/ssu-dapp/vite.config.ts` | Create | 1 | Done | Vite config with React, Tailwind, `@` alias, port 3201 |
| `apps/ssu-dapp/tsconfig.json` | Create | 1 | Done | TS config extending `@tehfrontier/tsconfig` |
| `apps/ssu-dapp/index.html` | Create | 1 | Done | HTML shell with dark zinc theme |
| `apps/ssu-dapp/src/main.tsx` | Create | 1 | Done | React DOM render entry point |
| `apps/ssu-dapp/src/App.tsx` | Create | 1 | Done | Provider tree + main view |
| `apps/ssu-dapp/src/styles/globals.css` | Create | 1 | Done | Tailwind import + scrollbar styles |
| `apps/ssu-dapp/src/lib/constants.ts` | Create | 1 | Done | URL param helpers, tenant configs, registry addresses |
| `apps/ssu-dapp/src/lib/deriveObjectId.ts` | Create | 1 | Done | itemId+tenant -> Sui object ID derivation |
| `apps/ssu-dapp/src/lib/items.ts` | Create | 1 | Done | Item name/icon resolution via World API |
| `apps/ssu-dapp/src/hooks/useAssembly.ts` | Create | 1 | Done | Fetch + parse StorageUnit object |
| `apps/ssu-dapp/src/hooks/useInventory.ts` | Create | 1 | Done | Fetch inventories via dynamic fields, classify slots, resolve names |
| `apps/ssu-dapp/src/hooks/useSuiClient.ts` | Create | 1 | Done | Typed SuiGraphQLClient wrapper (not in original plan) |
| `apps/ssu-dapp/src/hooks/useCharacter.ts` | Create | 2 | Done | Wallet -> Character resolution |
| `apps/ssu-dapp/src/hooks/useOwnerCap.ts` | Create | 2 | Done | OwnerCap receiving ticket resolution |
| `apps/ssu-dapp/src/hooks/useSignAndExecute.ts` | Create | 2 | Done | TX signing wrapper |
| `apps/ssu-dapp/src/components/AssemblyHeader.tsx` | Create | 1 | Done | SSU name, type, status, extension, dApp URL |
| `apps/ssu-dapp/src/components/InventoryTable.tsx` | Create | 1 | Done | Sortable item list component |
| `apps/ssu-dapp/src/components/InventoryTabs.tsx` | Create | 1 | Done | Color-coded tab switcher with capacity bar |
| `apps/ssu-dapp/src/components/WalletConnect.tsx` | Create | 2 | Done | EVE Vault connect button |
| `apps/ssu-dapp/src/components/DepositWithdrawPanel.tsx` | Create | 2 | Done | Owner withdraw controls |
| `apps/ssu-dapp/src/components/MetadataEditor.tsx` | Create | 2 | Done | Assembly metadata inline editor |
| `apps/ssu-dapp/src/components/AssemblyActions.tsx` | Create | 2 | Done | Status display (read-only, notes server dependency) |
| `apps/ssu-dapp/src/components/ExtensionInfo.tsx` | Create | 2 | Done | Extension status display + remove |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Create | 1 | Done | Main view composing all components |
| `apps/ssu-dapp/src/hooks/useWalletItems.ts` | Create | 3 | Done | Query wallet-held Item objects for deposit operations |
| `apps/ssu-dapp/src/components/TransferPanel.tsx` | Create | 3 | Done | Unified withdraw/deposit UI with partial stack support |
| `apps/ssu-dapp/src/components/DepositWithdrawPanel.tsx` | Remove | 3 | Partial | Superseded by TransferPanel (not imported), file still on disk |
| `apps/ssu-dapp/src/hooks/useSignAndExecute.ts` | Modify | 3 | Done | Added `ssu-inventories` and `wallet-items` to invalidated query keys |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Modify | 3 | Done | Uses TransferPanel instead of DepositWithdrawPanel |
| `apps/ssu-dapp/src/lib/errors.ts` | Create | 4 | Done | Move abort error code decoder (storage_unit, inventory, character, access) |

## Resolved Questions

1. **DappKit vs dapp-kit-react:** Use `@mysten/dapp-kit-react` + chain-shared (Option B). Consistent with existing ssu-market-dapp and permissions-dapp patterns; full control over data fetching; smaller bundle. Object ID derivation is ~20 lines using `@mysten/sui/utils`. Sponsored TX can be added incrementally later.

2. **Owner character resolution:** Follow OwnerCap chain on-chain (Option A). SSU `owner_cap_id` -> OwnerCap owner -> Character JSON. Two cheap GraphQL hops, authoritative data. **Implementation note:** The actual implementation resolves via PlayerProfile (wallet -> PlayerProfile -> character_id) rather than following the OwnerCap chain, which is the correct approach for the connected user.

3. **Market dApp integration:** SSU-only for Phase 1 (Option A). Cross-link to ssu-market-dapp if SSU has market extension. Phase 4 can revisit inline integration.

4. **Inventory data approach:** **Updated.** The original plan assumed inventories were inline fields on the StorageUnit struct. The actual implementation discovered they are dynamic fields keyed by ID. Uses dynamic field enumeration with slot classification (owner/open/player). This approach also naturally provides player inventory slots that were originally deferred to Phase 4.

5. **Consolidate DepositWithdrawPanel into TransferPanel or keep separate?** Option A (Consolidate). Phase 2 ships with `DepositWithdrawPanel` as minimal withdraw-only scaffolding. Phase 3 replaces it with `TransferPanel`.

6. **Cross-SSU transfers:** Out of scope. Single-SSU operations only. Cross-SSU can be done manually: withdraw to wallet, navigate to SSU B, deposit from wallet.

## Open Questions

None. All design decisions are resolved.

## Deferred

- **In-game item bridging (chain_item_to_game_inventory / game_item_to_chain_inventory)** -- These require admin/server signatures and are game-server operations, not dApp operations.
- **Energy source display** -- Showing linked network node, fuel status, and energy production. Useful but not core SSU dApp functionality. Can be added later.
- **Fuel management** -- Deposit/burn/pause fuel on the SSU's network node. Separate concern.
- **Multi-SSU dashboard** -- Viewing all SSUs owned by a character at once. Better suited for Periscope than a single-assembly dApp.
- **Sponsored transactions** -- Using DappKit's `useSponsoredTransaction` for gas-free operations. Requires `@evefrontier/dapp-kit` dependency. Can be added incrementally if user demand warrants it.
- **Open inventory management** -- The open inventory (`deposit_to_open_inventory` / `withdraw_from_open_inventory`) requires extension authorization. Displaying it is Phase 1, but write operations are extension-specific and deferred.
- **Extension inventory transfers** -- Moving items between extension/open inventories and owner inventory requires the extension's Auth witness. This is extension-specific and cannot be generalized in the default SSU dApp. Each extension would need its own transfer UI.
- **Cross-SSU transfers** -- Withdrawing from one SSU and depositing to another in a single operation. Requires multi-object PTB with two SSU references. Deferred to a future "fleet management" feature.
- **Online/offline toggle** -- The `storage_unit::online()` / `storage_unit::offline()` functions require server-managed shared objects (NetworkNode, EnergyConfig, OfflineAssemblies) that are not available from the client. AssemblyActions currently displays status read-only.
