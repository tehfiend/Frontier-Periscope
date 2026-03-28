# Plan: Currencies Overhaul -- Unified Currency/Market/Treasury Page

**Status:** Draft
**Created:** 2026-03-28
**Module:** periscope

## Overview

The current Periscope app treats currencies, markets, and treasuries as three separate concepts with three separate views (`/markets`, `/treasury`, `/wallet`). In practice, a "currency" is a single entity that inherently has a market (Market<T> on-chain) and optionally participates in a treasury wallet. Users must navigate between these views to manage different facets of the same currency -- a fragmented experience.

This plan merges the Market view and the currency-management portion of Treasury into a single unified "Currencies" page at `/currencies`. The page will feature a DataGrid showing ALL currencies (from `db.manifestMarkets`) with Excel-like column filtering, archive/unarchive support, and inline currency creation. The Market order-book detail and currency admin actions (mint, burn, authorize, fees) will appear as an expandable detail panel when a currency row is selected.

The Treasury view's treasury-wallet functionality (creating treasuries, managing admins, viewing balances) remains at `/treasury` as it is a separate organizational concept (a shared wallet that can hold multiple currency balances). The Wallet view (`/wallet`) remains unchanged as it shows the user's personal Sui wallet balances and transactions.

## Current State

### Market.tsx (`apps/periscope/src/views/Market.tsx`)
- Route: `/markets` (line 198-202 in router.tsx)
- Sidebar label: "Markets" with Coins icon (Sidebar.tsx line 70)
- Loads currencies from `db.currencies` filtered by `notDeleted` and `!_archived` (line 53-57)
- Has a dropdown selector for currencies, shows MarketDetail panel with order book (sell listings + buy orders)
- MarketDetail includes: market identity card, stat boxes (total supply, fee, authorized count), metadata (market ID, creator, coin type), "Link to SSU" action, and a DataGrid of orders
- Syncs currencies from `db.manifestMarkets` on mount (lines 72-143) -- duplicates the same sync logic in Treasury.tsx

### Treasury.tsx (`apps/periscope/src/views/Treasury.tsx`)
- Route: `/treasury` (line 246-250 in router.tsx)
- Sidebar label: "Treasury" with Landmark icon (Sidebar.tsx line 71)
- Contains TWO sections: treasury management (create/manage shared wallets) and currency management (create/manage currencies)
- Currency creation form with symbol, name, description, decimals (default 9 at line 76)
- CurrencyManagement component (line 711+) -- admin actions: mint, burn, authorize, fees, discover/create market
- Archive/unarchive toggle for currencies (lines 279-282, 446-472)
- Also has its own syncMarkets callback (lines 93-165) duplicating Market.tsx logic

### Wallet.tsx (`apps/periscope/src/views/Wallet.tsx`)
- Route: `/wallet` (line 222-226 in router.tsx)
- Shows personal Sui wallet balances and transaction history
- Unrelated to currency management -- stays as-is

### Data Layer
- `db.currencies` (CurrencyRecord) -- local currency records with `_archived` flag (db/types.ts line 792-813)
- `db.manifestMarkets` (ManifestMarket) -- chain-cached Market<T> objects (db/types.ts line 487-506)
- `db.treasuries` (TreasuryRecord) -- shared treasury wallets (db/types.ts line 823-829)
- `discoverMarkets()` in manifest.ts (line 1565-1604) -- fetches all Market<T> from chain into manifestMarkets

### Token Factory
- `buildPublishToken()` in `packages/chain-shared/src/token-factory.ts` -- decimals default is 9 (line 62)
- `buildPublishTokenStandings()` in `packages/chain-shared/src/token-factory-standings.ts` -- decimals default is 9 (line 88)

### Archive Infrastructure
- `_archived` flag exists on CurrencyRecord (db/types.ts line 812), ManifestPrivateMap (line 561), ManifestPrivateMapV2 (line 623), SubscribedRegistry (line 721)
- DB index added in V31 (db/index.ts line 569-575)
- `notArchived()` helper exported from db/index.ts (line 603-604)
- Archive UI pattern: toggle button (Archive icon), show/hide archived, Archive/ArchiveRestore buttons per item -- used in PrivateMaps.tsx and Treasury.tsx

### Wallet Connect Pattern
- `ConnectWalletButton` component in WalletConnect.tsx (line 62-87) -- inline cyan button with Wallet icon
- Used in Standings.tsx (lines 705, 833) -- replaces action buttons when wallet is disconnected
- Pattern: `{account ? <ActionButton /> : <ConnectWalletButton />}`

## Target State

### Unified Currencies Page

A single page at `/currencies` replaces both `/markets` and the currency-management section of `/treasury`. The page has:

1. **Top-level DataGrid** showing ALL currencies from `db.manifestMarkets` (all chain-cached markets) merged with `db.currencies` (user's local currency records). Columns:
   - Name (from coin metadata or parsed from coinType)
   - Ticker/Symbol
   - Total Supply (from ManifestMarket.totalSupply, cached during discoverMarkets)
   - Creator (resolved to character name via manifestCharacters)
   - Status (Mine/Authorized/Public based on whether user is creator/authorized/neither)
   - Fee (basis points, from ManifestMarket.feeBps)
   - Archived (hidden column, filterable)

2. **Archive toggle** in the toolbar -- same pattern as PrivateMaps.tsx. Archived currencies hidden by default, toggle to show.

3. **Create button** in the toolbar. When wallet is disconnected, shows `ConnectWalletButton` inline. When connected, opens the create form. Default decimals changed to 2.

4. **Row click -> Detail panel** below the grid showing:
   - Market identity card (from current MarketDetail/CurrencyManagement)
   - Admin actions (mint, burn, authorize, fees) -- from Treasury.tsx CurrencyManagement
   - Order book (sell listings + buy orders) -- from Market.tsx MarketDetail
   - Link to SSU action -- from Market.tsx MarketDetail

### Route Changes

- `/currencies` -- new unified page (Currencies.tsx)
- `/markets` -- redirect to `/currencies`
- `/treasury` -- kept, but only for treasury-wallet management (remove currency section)
- `/wallet` -- unchanged

### Sidebar Changes

- "Markets" entry replaced by "Currencies" with Coins icon, route `/currencies`
- "Treasury" entry stays (Landmark icon, `/treasury`)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source for grid | Join `db.manifestMarkets` with `db.currencies` at query time | manifestMarkets has all chain markets; currencies has user's local metadata and _archived flag. No schema change needed -- join in component via useMemo. |
| Route path | `/currencies` with redirect from `/markets` | Clean break from "markets" terminology. Redirect preserves bookmarks. |
| Default decimals | Change to 2 in Currencies.tsx create form only | The chain-shared token factory keeps 9 as the default parameter -- it is a protocol default. The UI create form will default its own state to 2 since most governance tokens use 2 decimals. |
| Treasury page scope | Keep `/treasury` for treasury-wallet management only | Treasuries (shared wallets) are a distinct concept from currencies. Removing the currency section from Treasury.tsx simplifies it. |
| Wallet connect pattern | Use ConnectWalletButton from WalletConnect.tsx | Matches existing pattern in Standings.tsx. Show ConnectWalletButton in place of "Create" button when wallet disconnected. |
| Market.tsx disposition | Delete after merging into Currencies.tsx | All Market.tsx functionality (order book, SSU link) moves into the Currencies detail panel. File is fully subsumed. |
| Treasury.tsx currency section | Remove lines 416-527 (JSX) + 711-1363 (CurrencyManagement) + 1506-1627 (CreateCurrencyForm + formatTokenAmount) | Currency creation and CurrencyManagement move to Currencies.tsx. Lines 1-414 (Treasury component + treasury state) and 530-709 (TreasuryDetail) stay. StatusBanner (line 1367-1413), StatBox (line 1415-1428), and FormField (line 1491-1504) are also used by the treasury section and must stay or be shared. |
| Order book placement | Expandable section in detail panel | The order book is per-currency context -- it belongs in the selected currency's detail view, not as a separate page. |

## Implementation Phases

### Phase 1: Create Currencies.tsx with DataGrid

1. Create `apps/periscope/src/views/Currencies.tsx` as the new unified view.
2. Build a `UnifiedCurrencyRow` type that merges ManifestMarket + CurrencyRecord data:
   ```
   interface UnifiedCurrencyRow {
     id: string;             // manifestMarket.id or CurrencyRecord.id (for unsynced local currencies)
     coinType: string;
     symbol: string;         // parsed from coinType: last segment, strip _TOKEN suffix
     name: string;           // from CurrencyRecord.name if exists, else "{symbol} Token"
     totalSupply?: number;   // from ManifestMarket.totalSupply (cached)
     creator: string;        // from ManifestMarket.creator
     creatorName?: string;   // resolved from db.manifestCharacters
     feeBps: number;         // from ManifestMarket.feeBps
     status: "mine" | "authorized" | "public";  // based on suiAddress match
     archived: boolean;      // from CurrencyRecord._archived if linked
     currencyRecordId?: string;  // link to db.currencies for local actions
     packageId: string;      // from ManifestMarket.packageId
     decimals: number;       // from CurrencyRecord.decimals if linked, else 9
   }
   ```
3. Use `useLiveQuery` to reactively query `db.manifestMarkets` and `db.currencies`. Build the merged rows in a `useMemo` join -- key on `coinType` since both tables share this field (ManifestMarket.coinType and CurrencyRecord.coinType). The join is a full outer join: a row appears if it exists in either table. Currencies in `db.currencies` without a matching `manifestMarket` entry (e.g., newly created currencies not yet discovered by manifest sync) still appear in the grid with available local data. ManifestMarket entries without a matching CurrencyRecord appear as "public" currencies.
4. The page does NOT require an active character to render the DataGrid. All markets are public chain data from manifestMarkets. The `status` column needs `suiAddress` from `useActiveCharacter` -- when no character is selected, all rows show "public" status. Admin actions in the detail panel require a character.
5. Define DataGrid columns: Symbol, Name, Total Supply, Fee (bps), Creator, Status. Text columns (Symbol, Name, Creator, Status) use `excelFilterFn`. Numeric columns (Total Supply, Fee) use `enableColumnFilter: false`.
6. Add toolbar with: global search, archive toggle button, create button (or ConnectWalletButton when disconnected), refresh button to re-run `discoverMarkets()`.
7. Implement row click handler that sets `selectedCurrencyId` state. Use DataGrid's `selectedRowId` and `onRowClick` props (already supported, see DataGrid.tsx lines 34-36).
8. No detail panel yet in this phase -- just the grid.

### Phase 2: Currency Detail Panel

1. Move `CurrencyManagement` component from Treasury.tsx into Currencies.tsx (or a new `components/CurrencyDetail.tsx` file).
2. Move `MarketDetail` order-book section from Market.tsx into the detail panel.
3. Merge the SSU link action from Market.tsx MarketDetail.
4. Wire the detail panel to appear below the DataGrid when a row is selected.
5. Include admin actions (mint, burn, authorize, fees) from CurrencyManagement.
6. Include order book DataGrid (sell listings + buy orders) from MarketDetail.
7. Move shared utilities into Currencies.tsx as local functions (same pattern as Market.tsx and Treasury.tsx): `formatTokenAmount` (from both files), `formatPrice` (from Market.tsx), `StatBox`, `AdminToggle`, `AdminPanel`, `FormField`. These are small, view-specific helpers -- no need for a separate shared file.

### Phase 3: Create Form + Archive + Wallet Connect

1. Move `CreateCurrencyForm` component (Treasury.tsx lines 1506-1615) and the `handleCreateCurrency` function (Treasury.tsx lines 199-277) into Currencies.tsx. The handler calls `buildPublishToken` and `parsePublishResult` from `@tehfrontier/chain-shared`, uses `signAndExecute` from `useDAppKit()`, and writes to `db.currencies.add()`.
2. Change the default decimals from `useState(9)` to `useState(2)` in the create form.
3. Implement the create button logic: replace the current plain text "EVE Vault not connected" (Treasury.tsx line 1594) with `ConnectWalletButton` from `@/components/WalletConnect`. Pattern: `{account ? <CreateButton /> : <ConnectWalletButton />}` matching Standings.tsx lines 704-705.
4. Move archive/unarchive logic: `handleArchiveCurrency` from Treasury.tsx. Add archive button per-row or in the detail panel toolbar.
5. Add the archive toggle button in the DataGrid toolbar (same pattern as PrivateMaps.tsx).
6. Ensure the grid filters out archived currencies by default and shows them when toggle is active.

### Phase 4: Route + Sidebar + Cleanup

1. In `router.tsx`:
   - Add `LazyCurrencies` lazy import for `views/Currencies.tsx`.
   - Add `CurrenciesPage` wrapper with Suspense.
   - Add `/currencies` route -> CurrenciesPage.
   - Change `marketsRoute` from `/markets` component to redirect -> `/currencies`.
   - Keep `treasuryRoute` as-is.
2. In `Sidebar.tsx`:
   - Replace the "Markets" nav item: change `to` from `/markets` to `/currencies`, change `label` from "Markets" to "Currencies". Keep `Coins` icon.
3. In `Treasury.tsx` (1628 lines total):
   - Remove the "Coin Creation Section" JSX (`<section>` at line 417 through line 527).
   - Remove `CurrencyManagement` component (lines 711-1363) and `CreateCurrencyForm` (lines 1506-1615).
   - Remove `AdminToggle` (lines 1430-1474) -- only used by CurrencyManagement.
   - Remove `AdminPanel` (lines 1476-1489) -- only used by CurrencyManagement.
   - Remove `formatTokenAmount` (lines 1619-1627) -- only used by CurrencyManagement.
   - Remove currency-related state from the `Treasury` component: `currencies`, `filteredCurrencies`, `showArchived`, `creating`, `symbol`, `tokenName`, `description`, `decimals`, `selectedCurrencyId`, the `syncMarkets` callback and its useEffect, `handleCreateCurrency`, `handleArchiveCurrency`.
   - **Keep** `buildStatus` and `buildError` state -- also used by `handleCreateTreasury` (line 287) and StatusBanner (line 322). Simplify the `isProcessing` guard (line 89-90) from `buildStatus === "building" || "minting" || "burning"` to just `buildStatus === "building"` since "minting"/"burning" states only came from currency management. Also simplify the `BuildStatus` type to remove "minting" and "burning" variants.
   - Remove currency-related imports: `discoverMarkets`, `buildPublishToken`, `parsePublishResult`, `getCoinMetadata`, `CurrencyRecord`, `Archive`, `ArchiveRestore`, `Package`, `Plus`.
   - **Keep**: `StatusBanner` (lines 1367-1413) -- used by treasury creation at line 322. `StatBox` (lines 1415-1428) -- used by TreasuryDetail (not currently, but may be needed). `FormField` (lines 1491-1504) -- used by TreasuryDetail admin address input.
   - **Keep**: Treasury component lines 1-414 (Treasury function + treasury state + treasury JSX), TreasuryDetail (lines 530-709), and all treasury-related state/imports.
   - Net effect: Treasury.tsx shrinks from ~1628 lines to ~600 lines.
4. Delete `apps/periscope/src/views/Market.tsx`.
5. Remove the `LazyMarket` import and `MarketPage` wrapper from router.tsx.
6. Verify all imports in other files that reference Market.tsx or Treasury.tsx currency exports are updated.

### Phase 5: Deduplicate syncMarkets

1. The `syncMarkets` callback in both Market.tsx (lines 72-143) and Treasury.tsx (lines 93-165) is identical boilerplate that syncs `db.manifestMarkets` -> `db.currencies`. After Phase 4 removes both files' copies, consolidate into a single reusable function.
2. Create `apps/periscope/src/chain/currency-sync.ts` with `syncCurrenciesFromManifest(suiClient, suiAddress, walletAddress?)` that encapsulates the shared logic.
3. Use this function in Currencies.tsx.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/views/Currencies.tsx` | Create | New unified Currencies page with DataGrid + detail panel |
| `apps/periscope/src/views/Market.tsx` | Delete | Fully subsumed by Currencies.tsx |
| `apps/periscope/src/views/Treasury.tsx` | Modify | Remove currency creation/management section; keep treasury-wallet only |
| `apps/periscope/src/router.tsx` | Modify | Add `/currencies` route, redirect `/markets` -> `/currencies`, add lazy import |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | Rename "Markets" nav item to "Currencies", change route to `/currencies` |
| `apps/periscope/src/chain/currency-sync.ts` | Create | Extracted `syncCurrenciesFromManifest()` helper |

## Open Questions

1. **What happens to the Treasury balance column in the Currencies DataGrid?**
   - **Option A: Include Treasury Balance column** -- Query `db.treasuries` balances for each coin type and show in the grid. Pros: gives a complete financial picture per currency. Cons: treasury balances are per-treasury, not per-currency -- a user may have multiple treasuries. Adds query complexity.
   - **Option B: Omit Treasury Balance column** -- Only show market data (total supply, creator, status). Pros: simpler, no ambiguity about which treasury's balance to show. Cons: users lose visibility into treasury holdings from the currencies view.
   - **Recommendation:** Option B -- omit for now. Treasury balances are a treasury-centric concept (one treasury holds many currencies). The Currencies page focuses on the market/token side. Users can check treasury balances on `/treasury`. Can revisit later if demand arises.

2. **Should the exchange (exchange.ts) order book be included in the Currencies detail panel?**
   - **Option A: Include exchange support** -- The exchange module (`packages/chain-shared/src/exchange.ts`) supports generic coin pair trading (create_pair, place_bid, place_ask). Adding exchange order book to the currencies detail panel gives a complete trading view. Pros: complete trading picture. Cons: exchange is a separate concept (coin-to-coin pairs, not item-to-coin markets), significant additional complexity, exchange UI may not exist yet.
   - **Option B: Exclude exchange** -- Only include the Market<T> order book (SSU sell listings and buy orders). Pros: matches current scope, exchange is a separate feature. Cons: misses exchange data.
   - **Recommendation:** Option B -- the exchange module is a separate trading concept (coin pairs) distinct from the Market<T> item marketplace. It should remain a separate future feature if/when an exchange UI is built.

3. **Should the "Link to SSU" action move to Currencies or stay only in Structures?**
   - **Option A: Include in Currencies detail panel** -- Keep the SSU link action from Market.tsx in the Currencies detail panel. Pros: users managing a currency can link SSUs directly. Cons: SSU linking is a structure-level action that also belongs in the Structures view.
   - **Option B: Move to Structures only** -- Remove SSU linking from the currency view entirely, have it only in the Structures detail card. Pros: cleaner separation of concerns. Cons: currency creators lose a convenient shortcut.
   - **Recommendation:** Option A -- keep it in the Currencies detail panel. It is a market-level action (linking a market to an SSU config) and fits naturally alongside market management. The Structures view can independently offer the same action from its own context.

## Deferred

- **Exchange UI** -- Building a full exchange (coin-pair) trading interface. Separate concern from the Market<T> item marketplace.
- **Treasury balance in Currencies grid** -- Showing per-currency treasury holdings in the DataGrid. Requires resolving multi-treasury ambiguity.
- **manifestMarkets enrichment with totalSupply** -- Currently `totalSupply` is cached in ManifestMarket but may be stale. A background refresh mechanism could keep it current. Low priority for initial overhaul.
- **Bulk currency actions** -- Multi-select in DataGrid for bulk archive/unarchive. DataGrid does not currently support multi-select.
