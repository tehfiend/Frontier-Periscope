# Plan: Currencies Overhaul -- Unified Currency/Market/Treasury Page

**Status:** Ready
**Created:** 2026-03-28
**Module:** periscope

## Overview

The current Periscope app treats currencies, markets, and treasuries as three separate concepts with three separate views (`/markets`, `/treasury`, `/wallet`). In practice, a "currency" is a single entity that inherently has a market (Market<T> on-chain), a treasury (1:1 -- every currency has exactly one treasury), and optionally participates in exchange pairs. Users must navigate between these views to manage different facets of the same currency -- a fragmented experience.

This plan merges the Market view and the currency-management portion of Treasury into a single unified "Currencies" page at `/currencies`. The page will feature a DataGrid showing ALL currencies (from `db.manifestMarkets`) with Excel-like column filtering, archive/unarchive support, treasury balance column, and inline currency creation. The detail panel when a currency row is selected will show: admin actions (mint, burn, authorize, fees), Market<T> order book (sell listings + buy orders), exchange order book (bid/ask for coin pairs involving this currency), and treasury balance/admin management.

The Treasury view's treasury-wallet functionality (creating treasuries, managing admins, viewing balances) remains at `/treasury` as a convenience view. The Wallet view (`/wallet`) remains unchanged as it shows the user's personal Sui wallet balances and transactions.

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
- `db.treasuries` (TreasuryRecord) -- treasury wallets (db/types.ts line 823-829). Each currency has exactly one treasury (1:1 relationship). The treasury's admins are the currency's admins who can withdraw; anyone can deposit.
- `discoverMarkets()` in manifest.ts (line 1565-1604) -- fetches all Market<T> from chain into manifestMarkets

### Treasury-Currency Relationship (1:1)
- A treasury is always tied to a currency. A currency can only have a single treasury.
- The currency admins are the treasury admins who can transfer/withdraw from the treasury.
- Anyone can deposit into a treasury (e.g., gate extensions deposit toll revenue).
- **Schema design**: `TreasuryRecord` includes a `coinType` field from the start, making the 1:1 link to a currency explicit. This allows direct lookup: `db.treasuries.where("coinType").equals(currency.coinType)`. The `balances` array holds the treasury's actual balance for that coinType (and potentially other coin types deposited by third parties). No migration needed -- the DB schema is designed fresh.
- `queryTreasuryBalances()` in `chain-shared/src/treasury.ts` (line 199-244) enumerates Balance<T> dynamic fields via BalanceKey<T> on the treasury object.
- `queryTreasuryDetails()` in `chain-shared/src/treasury.ts` (line 174-192) fetches owner, admins, and name.
- `treasury-queries.ts` in `apps/periscope/src/chain/` wraps these with IndexedDB caching (currently stubbed, waiting for chain-shared merge).
- **Note**: CurrencyManagement in Treasury.tsx (line 927) uses `queryTreasuryCap()` from `chain-shared/src/market.ts` to find the TreasuryCap for minting -- this is separate from the Treasury shared object wallet.

### Exchange Module
- `packages/chain-shared/src/exchange.ts` -- TX builders for coin-pair exchange: `buildCreatePair`, `buildPlaceBid`, `buildPlaceAsk`, `buildCancelBid`, `buildCancelAsk`.
- Types in `chain-shared/src/types.ts`: `OrderBookInfo` (objectId, coinTypeA, coinTypeB, bidCount, askCount, feeBps), `OrderInfo` (orderId, owner, price, amount, isBid).
- Exchange package deployed at `0x72928ee80a252eece16925c3e7d0cbf6280a8981ebf72c1a0f614f9d8a48315d` (config.ts line 19).
- No query functions exist yet for fetching order book state from chain -- only TX builders and types.
- Sonar already handles exchange events: `exchange_order_placed`, `exchange_order_cancelled` (sonarEventHandlers.ts lines 821-853).

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
   - Treasury Balance (from the currency's treasury, queried via `db.treasuries` matching on coinType)
   - Creator (resolved to character name via manifestCharacters)
   - Status (Mine/Authorized/Public based on whether user is creator/authorized/neither)
   - Fee (basis points, from ManifestMarket.feeBps)
   - Archived (hidden column, filterable)

2. **Archive toggle** in the toolbar -- same pattern as PrivateMaps.tsx. Archived currencies hidden by default, toggle to show.

3. **Create button** in the toolbar. When wallet is disconnected, shows `ConnectWalletButton` inline. When connected, opens the create form. Default decimals changed to 2.

4. **Row click -> Detail panel** below the grid showing:
   - Market identity card (from current MarketDetail/CurrencyManagement)
   - Admin actions (mint, burn, authorize, fees) -- from Treasury.tsx CurrencyManagement
   - Market<T> order book (sell listings + buy orders) -- from Market.tsx MarketDetail
   - Exchange order book section (bid/ask orders for exchange pairs involving this currency)
   - Treasury section (balance, deposit/withdraw actions)

### Route Changes

- `/currencies` -- new unified page (Currencies.tsx)
- `/markets` -- removed entirely (no existing users, no bookmarks to preserve)
- `/treasury` -- kept, but only for treasury-wallet management (remove currency section)
- `/wallet` -- unchanged

### Sidebar Changes

- "Markets" entry replaced by "Currencies" with Coins icon, route `/currencies`
- "Treasury" entry stays (Landmark icon, `/treasury`)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source for grid | Join `db.manifestMarkets` with `db.currencies` and `db.treasuries` at query time | manifestMarkets has all chain markets; currencies has user's local metadata and _archived flag; treasuries has balance data. Join in component via useMemo, keyed on coinType. |
| Treasury balance column | Include in DataGrid | Each currency has exactly one treasury (1:1). No ambiguity -- look up the treasury via its `coinType` field (matches `CurrencyRecord.coinType`). Shows the treasury's balance for that currency directly in the grid. |
| Route path | `/currencies`, delete `/markets` route | Clean break from "markets" terminology. No existing users -- no redirect needed. |
| Default decimals | Change to 2 in Currencies.tsx create form only | The chain-shared token factory keeps 9 as the default parameter -- it is a protocol default. The UI create form will default its own state to 2 since most governance tokens use 2 decimals. |
| Treasury page scope | Keep `/treasury` for treasury-wallet management only | Treasuries are 1:1 with currencies, but the Treasury view provides a wallet-centric perspective (managing admins, viewing all balances). Removing the currency section from Treasury.tsx simplifies it. |
| Wallet connect pattern | Use ConnectWalletButton from WalletConnect.tsx | Matches existing pattern in Standings.tsx. Show ConnectWalletButton in place of "Create" button when wallet disconnected. |
| Market.tsx disposition | Delete after merging into Currencies.tsx | All Market.tsx functionality (order book) moves into the Currencies detail panel. File is fully subsumed. |
| SSU link action | Structures only -- remove from Currencies detail panel | SSU linking is a structure-level action. Keep it in the Structures/Deployables view only, not in the currency detail panel. Cleaner separation of concerns. |
| Treasury.tsx currency section | Remove lines 416-527 (JSX) + 711-1363 (CurrencyManagement) + 1506-1627 (CreateCurrencyForm + formatTokenAmount) | Currency creation and CurrencyManagement move to Currencies.tsx. Lines 1-414 (Treasury component + treasury state) and 530-709 (TreasuryDetail) stay. StatusBanner (line 1367-1413), StatBox (line 1415-1428), and FormField (line 1491-1504) are also used by the treasury section and must stay or be shared. |
| Order book placement | Expandable section in detail panel | The order book is per-currency context -- it belongs in the selected currency's detail view, not as a separate page. |
| Exchange order book | Include in detail panel | The exchange module supports coin-pair trading. For each selected currency, show any exchange pairs where this currency is coinTypeA or coinTypeB. Query functions need to be built (see Phase 2b). |

## Implementation Phases

### Phase 1: Create Currencies.tsx with DataGrid

1. **Schema update**: Add `coinType: string` field to `TreasuryRecord` in `db/types.ts`. Update the existing V32 `treasuries` schema in `db/index.ts` to include the `coinType` index: `"id, owner, coinType"`. No new DB version needed -- the app has not been released, so we redesign V32 in place. Update `handleCreateTreasury` in Treasury.tsx (and later in Currencies.tsx) to store the coinType when creating a treasury for a currency. Update `syncTreasury` in `treasury-queries.ts` to populate coinType from the treasury's balance entries.
2. Create `apps/periscope/src/views/Currencies.tsx` as the new unified view.
3. Build a `UnifiedCurrencyRow` type that merges ManifestMarket + CurrencyRecord + treasury data:
   ```
   interface UnifiedCurrencyRow {
     id: string;             // manifestMarket.id or CurrencyRecord.id (for unsynced local currencies)
     coinType: string;
     symbol: string;         // parsed from coinType: last segment, strip _TOKEN suffix
     name: string;           // from CurrencyRecord.name if exists, else "{symbol} Token"
     totalSupply?: number;   // from ManifestMarket.totalSupply (cached)
     treasuryBalance?: string; // from TreasuryRecord balance matching this coinType (string for bigint)
     creator: string;        // from ManifestMarket.creator
     creatorName?: string;   // resolved from db.manifestCharacters
     feeBps: number;         // from ManifestMarket.feeBps
     status: "mine" | "authorized" | "public";  // based on suiAddress match
     archived: boolean;      // from CurrencyRecord._archived if linked
     currencyRecordId?: string;  // link to db.currencies for local actions
     treasuryId?: string;    // link to TreasuryRecord.id if found
     packageId: string;      // from ManifestMarket.packageId
     decimals: number;       // from CurrencyRecord.decimals if linked, else 9
   }
   ```
4. Use `useLiveQuery` to reactively query `db.manifestMarkets`, `db.currencies`, and `db.treasuries`. Build the merged rows in a `useMemo` join:
   - Key on `coinType` since ManifestMarket.coinType and CurrencyRecord.coinType share this field.
   - For treasury balance: query `db.treasuries` using the new `coinType` index to find the treasury matching each currency's coinType. Since the relationship is 1:1, at most one treasury matches. Extract the balance amount from the treasury's `balances` array entry matching that coinType.
   - The join is a full outer join: a row appears if it exists in either `manifestMarkets` or `currencies`. Currencies in `db.currencies` without a matching `manifestMarket` entry (e.g., newly created currencies not yet discovered by manifest sync) still appear in the grid with available local data. ManifestMarket entries without a matching CurrencyRecord appear as "public" currencies.
5. The page does NOT require an active character to render the DataGrid. All markets are public chain data from manifestMarkets. The `status` column needs `suiAddress` from `useActiveCharacter` -- when no character is selected, all rows show "public" status. Admin actions in the detail panel require a character.
6. Define DataGrid columns: Symbol, Name, Total Supply, Treasury Balance, Fee (bps), Creator, Status. Text columns (Symbol, Name, Creator, Status) use `excelFilterFn`. Numeric columns (Total Supply, Fee, Treasury Balance) use `enableColumnFilter: false`.
7. Add toolbar with: global search, archive toggle button, create button (or ConnectWalletButton when disconnected), refresh button to re-run `discoverMarkets()`.
8. Implement row click handler that sets `selectedCurrencyId` state. Use DataGrid's `selectedRowId` and `onRowClick` props (already supported, see DataGrid.tsx lines 34-36).
9. No detail panel yet in this phase -- just the grid.

### Phase 2: Currency Detail Panel

1. Move `CurrencyManagement` component from Treasury.tsx into Currencies.tsx (or a new `components/CurrencyDetail.tsx` file).
2. Wire the detail panel to appear below the DataGrid when a row is selected.
3. Include admin actions (mint, burn, authorize, fees) from CurrencyManagement.
4. Include Market<T> order book DataGrid (sell listings + buy orders) from MarketDetail.
5. Include treasury section in the detail panel:
   - Show treasury balance for the selected currency (from `TreasuryRecord` matching on coinType).
   - Show treasury admins (derived from currency admins in the 1:1 model).
   - Deposit action (open to anyone) -- uses `buildTreasuryDeposit` from `chain-shared/src/treasury.ts`.
   - Withdraw action (admin only) -- uses `buildTreasuryWithdraw` from `chain-shared/src/treasury.ts`.
6. Move shared utilities into Currencies.tsx as local functions (same pattern as Market.tsx and Treasury.tsx): `formatTokenAmount` (from both files), `formatPrice` (from Market.tsx), `StatBox`, `AdminToggle`, `AdminPanel`, `FormField`. These are small, view-specific helpers -- no need for a separate shared file.

### Phase 2b: Exchange Order Book Integration

1. Create exchange query functions in `packages/chain-shared/src/exchange.ts`:
   - `queryOrderBook(client: SuiGraphQLClient, bookObjectId: string): Promise<OrderBookInfo | null>` -- fetch order book details (fee, counts).
   - `queryOrders(client: SuiGraphQLClient, bookObjectId: string): Promise<OrderInfo[]>` -- enumerate bid/ask orders from dynamic fields.
   - These follow the same pattern as `queryTreasuryDetails` / `queryTreasuryBalances` in treasury.ts: use `getObjectJson` for the book object and `listDynamicFieldsGql` for order entries.
2. Create app-level exchange query wrapper in `apps/periscope/src/chain/exchange-queries.ts`:
   - `discoverExchangePairs(client: SuiGraphQLClient): Promise<void>` -- discover all exchange `OrderBook<A,B>` shared objects by querying for `{exchangePkg}::exchange::OrderBook` type (same pattern as `queryMarkets` in market.ts). Cache results in a new `db.manifestExchangePairs` table.
   - Add `ManifestExchangePair` type to `db/types.ts`: `{ id: string; coinTypeA: string; coinTypeB: string; feeBps: number; cachedAt: string }`.
   - Add `manifestExchangePairs` table to `db/index.ts` in V32 alongside the treasury schema: `"id, coinTypeA, coinTypeB, cachedAt"`. No new version needed -- redesign V32 in place to include all new tables.
   - `fetchExchangeOrders(client: SuiGraphQLClient, bookObjectId: string): Promise<OrderInfo[]>` -- fetch orders for a specific book on demand (not cached -- order state is volatile).
3. Add exchange order book section to the Currencies detail panel:
   - For the selected currency, find all exchange pairs where `coinTypeA === currency.coinType` or `coinTypeB === currency.coinType`.
   - Show a collapsible section per pair: pair name (e.g., "TOKEN_A / TOKEN_B"), bid/ask order DataGrid.
   - Place bid / place ask / cancel actions using `buildPlaceBid`, `buildPlaceAsk`, `buildCancelBid`, `buildCancelAsk` from `chain-shared/src/exchange.ts`.
4. If no exchange pairs exist for the selected currency, show "No exchange pairs" with an optional "Create Pair" action (calls `buildCreatePair`).

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
   - Delete `marketsRoute` (`/markets`) entirely -- no redirect needed since there are no existing users.
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
   - **Do NOT** include SSU link action in Currencies detail panel -- SSU linking stays in Structures/Deployables only.
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
| `apps/periscope/src/views/Currencies.tsx` | Create | New unified Currencies page with DataGrid + detail panel (market order book, exchange order book, treasury, admin actions) |
| `apps/periscope/src/views/Market.tsx` | Delete | Fully subsumed by Currencies.tsx |
| `apps/periscope/src/views/Treasury.tsx` | Modify | Remove currency creation/management section; keep treasury-wallet only |
| `apps/periscope/src/router.tsx` | Modify | Add `/currencies` route, delete `/markets` route, add lazy import |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | Rename "Markets" nav item to "Currencies", change route to `/currencies` |
| `apps/periscope/src/chain/currency-sync.ts` | Create | Extracted `syncCurrenciesFromManifest()` helper |
| `packages/chain-shared/src/exchange.ts` | Modify | Add `queryOrderBook()` and `queryOrders()` query functions for exchange order books |
| `apps/periscope/src/chain/exchange-queries.ts` | Create | App-level exchange query wrapper with `discoverExchangePairs()` and `fetchExchangeOrders()` |
| `apps/periscope/src/db/types.ts` | Modify | Add `coinType` field to `TreasuryRecord`; add `ManifestExchangePair` type |
| `apps/periscope/src/db/index.ts` | Modify | Redesign V32 in place: add `coinType` index to `treasuries` table, add `manifestExchangePairs` table with coinTypeA/coinTypeB indexes. No new DB version -- fresh schema. |

## Resolved Questions

1. **Treasury balance column in Currencies DataGrid** -- **Included.** The original plan assumed treasuries were separate shared wallets (one treasury holds many currencies). The user clarified: a treasury is always tied to a currency (1:1). Each currency has exactly one treasury. The currency's admins can withdraw; anyone can deposit. This removes all ambiguity -- the Treasury Balance column looks up the single treasury matching the currency's coinType via `TreasuryRecord.coinType`. Treasury deposit/withdraw actions are included in the detail panel.

2. **Exchange order book in Currencies detail panel** -- **Included (Option A).** The exchange module (`chain-shared/src/exchange.ts`) supports coin-pair trading with `buildCreatePair`, `buildPlaceBid`, `buildPlaceAsk`, `buildCancelBid`, `buildCancelAsk`. Types `OrderBookInfo` and `OrderInfo` exist in `chain-shared/src/types.ts`. Query functions for fetching order book state need to be created (Phase 2b). The detail panel will show exchange pairs where the selected currency is either coinTypeA or coinTypeB, with bid/ask order grids and place/cancel actions. Full standalone exchange UI (pair management, cross-currency trading dashboard) remains deferred.

3. **SSU link action placement** -- **Structures only (Option B).** SSU linking is removed from the Currencies detail panel. It is a structure-level action that belongs in the Structures/Deployables view. The Market.tsx SSU link code is NOT migrated to Currencies.tsx.

## Deferred

- **Full exchange trading dashboard** -- A standalone exchange UI for managing all coin pairs, cross-currency arbitrage, and pair creation. This plan only adds per-currency exchange pair viewing in the detail panel.
- **manifestMarkets enrichment with totalSupply** -- Currently `totalSupply` is cached in ManifestMarket but may be stale. A background refresh mechanism could keep it current. Low priority for initial overhaul.
- **Bulk currency actions** -- Multi-select in DataGrid for bulk archive/unarchive. DataGrid does not currently support multi-select.
