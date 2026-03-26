# Plan: Manifest Expansion -- Comprehensive On-Chain Entity Cache

**Status:** Draft
**Created:** 2026-03-26
**Module:** periscope

## Overview

The Manifest system currently caches three entity types: characters, tribes, and public locations (from `LocationRevealedEvent`). Private map data (encrypted structure locations) is stored in separate `manifestPrivateMaps` / `manifestMapLocations` / `manifestPrivateMapsV2` tables but is not integrated into the main manifest resolution flow. Markets, standings registries, and private maps are queried ad-hoc by individual views (Market, Standings, PrivateMaps) on every mount rather than being cached centrally.

This plan expands the Manifest into the single source of truth for all on-chain entity data the app needs. The expansion covers three areas: (1) feeding decoded private map locations into manifest location resolution so Deployables, Star Map, and other views can resolve structure locations from private maps without each view needing to know about the decryption flow; (2) caching all Market<T> instances, all StandingsRegistry objects, and all PrivateMap/PrivateMapV2 metadata in dedicated manifest tables with sync logic in `manifest.ts`; and (3) updating consumers to read from the manifest cache instead of making ad-hoc chain queries.

This work is a prerequisite for Plan 03 (Storage Datagrid Improvements), which requires the manifest to contain structure data and a cached market list for the market picker dropdown. It also benefits Sonar and the Star Map by providing a unified location resolution layer that merges public + private map locations.

## Current State

### Manifest Tables (db/index.ts L86-120)

The Dexie DB (version 29) has these manifest-related tables:

- `manifestCharacters` (V10, L337) -- keyed by Sui object ID, stores character name, suiAddress, tribeId, tenant, ownerCapId, mapKey data, cachedAt
- `manifestTribes` (V10, L338) -- keyed by tribe ID, stores name, nameShort, description, taxRate, tribeUrl, tenant, cachedAt
- `manifestLocations` (V23, L505) -- keyed by assembly object ID, stores public locations from `LocationRevealedEvent` -- solarsystem, x/y/z coords, typeId, lPoint, tenant, revealedAt, cachedAt

### Private Map Tables (db/index.ts L92-93, L120)

- `manifestPrivateMaps` (V24, L509-510) -- V1 encrypted maps, keyed by PrivateMap object ID
- `manifestMapLocations` (V24, L511-512) -- decrypted location entries, keyed by `{mapId}:{locationId}`
- `manifestPrivateMapsV2` (V27, L532) -- V2 dual-mode maps (encrypted + cleartext standings)

### Manifest Sync Logic (chain/manifest.ts)

- `discoverCharactersFromEvents()` (L269-383) -- cursor-based event pagination for CharacterCreatedEvent
- `discoverLocationsFromEvents()` (L670-782) -- cursor-based event pagination for LocationRevealedEvent
- `discoverTribes()` (L542-591) -- World API fetch
- `syncPrivateMapsForUser()` (L904-956) -- V1 map discovery via MapInvite objects
- `syncPrivateMapsV2ForUser()` (L1350-1443) -- V2 map discovery via MapInviteV2 + standings events
- `syncMapLocations()` (L1012-1098) -- V1 map location decryption
- `syncMapLocationsV2()` (L1450-1531) -- V2 map location decryption/parsing
- `crossReferencePrivateMapLocations()` (L857-887) -- populates systemId/lPoint on deployables from private map locations
- `crossReferenceManifestLocations()` (L824-849) -- populates systemId/lPoint on deployables from public manifest locations

### Current Location Resolution

Location data flows from two sources into deployables:

1. **Public locations** -- `manifestLocations` populated from `LocationRevealedEvent`, cross-referenced by `crossReferenceManifestLocations()` (L824-849)
2. **Private map locations** -- `manifestMapLocations` populated from decrypted private map entries, cross-referenced by `crossReferencePrivateMapLocations()` (L857-887)

Both cross-reference functions write `systemId` and `lPoint` onto `deployables`/`assemblies` table records. The Market view (Market.tsx L465-466) reads both `manifestLocations` and `manifestMapLocations` directly via `useLiveQuery` to build an SSU location lookup. The Deployables view (Deployables.tsx L453-455) calls both cross-reference functions after syncing.

### Markets -- Current Ad-Hoc Pattern

- Market view (Market.tsx L111-114) calls `queryMarkets()` on mount to discover all `Market<T>` objects
- `queryMarkets()` is in `packages/chain-shared/src/market.ts` L381-459 -- GraphQL type-filtered query
- `CurrencyRecord` in `db/types.ts` L717-736 stores `marketId` but markets themselves are not cached
- Plan 03 needs a cached market list for the SSU extension market picker dropdown

### Standings Registries -- Current Ad-Hoc Pattern

- Standings view (Standings.tsx L378, L582) calls `queryAllRegistries()` on mount
- `queryAllRegistries()` is in `packages/chain-shared/src/standings-registry.ts` L338-397 -- GraphQL type-filtered query
- `subscribedRegistries` table (db/index.ts L103) caches user-subscribed registries but the global registry list is not persisted
- Structure extension configs (db/index.ts L123) reference `registryId` but the registry metadata must be fetched live

### Private Maps -- Partially Cached

- V1 maps: `manifestPrivateMaps` + `manifestMapLocations` -- cached after user sync
- V2 maps: `manifestPrivateMapsV2` -- cached after user sync
- Map metadata is user-scoped (only maps the user has invites to or subscribed registries for)
- No global enumeration of all private maps on chain (by design -- they are access-controlled)

### Contract Addresses (packages/chain-shared/src/config.ts)

All package IDs needed for queries exist in `CONTRACT_ADDRESSES`:

- `market.packageId` (L44, L110) -- Market<T> package
- `standingsRegistry.packageId` (L52, L119) -- StandingsRegistry package
- `privateMap.packageId` (L48, L113) -- PrivateMap (V1) package
- `privateMapStandings.packageId` (L72, L139) -- PrivateMapV2 package

### Auto-Sync (hooks/useManifestAutoSync.ts)

- Runs once on mount via `DataInitializer`
- Syncs characters (both tenants) and tribes
- Does NOT sync locations, markets, registries, or private maps

## Target State

### New Manifest Tables

Add three new Dexie tables (V30):

1. **`manifestMarkets`** -- cache of all `Market<T>` objects discovered on chain
   - Primary key: `id` (Market object ID)
   - Indexes: `coinType, creator, cachedAt`
   - Fields: `id, packageId, creator, authorized, feeBps, feeRecipient, nextSellId, nextBuyId, coinType, totalSupply, cachedAt`
   - Note: no `tenant` field -- market packageId is shared across tenants (see Open Question 2)

2. **`manifestRegistries`** -- cache of all `StandingsRegistry` objects
   - Primary key: `id` (StandingsRegistry object ID)
   - Indexes: `owner, name, ticker, cachedAt`
   - Fields: `id, owner, admins, name, ticker, defaultStanding, cachedAt`
   - Note: no `tenant` field -- standingsRegistry packageId is shared across tenants

3. **`manifestPrivateMapIndex`** -- lightweight global index of known private maps (both V1 and V2), separate from user-specific `manifestPrivateMaps`/`manifestPrivateMapsV2` which contain decryption keys
   - Primary key: `id` (map object ID)
   - Indexes: `creator, tenant, cachedAt`
   - Fields: `id, version (1|2), name, creator, mode (0|1), registryId, tenant, cachedAt`

### New DB Types (db/types.ts)

```typescript
export interface ManifestMarket {
    id: string;                 // Market<T> object ID
    packageId: string;          // Package that defined this Market<T>
    creator: string;            // Creator Sui address
    authorized: string[];       // Authorized minter addresses
    feeBps: number;
    feeRecipient: string;
    nextSellId: number;
    nextBuyId: number;
    coinType: string;           // Full coin type string
    totalSupply?: number;
    cachedAt: string;
    // No tenant -- market packageId is shared across tenants
}

export interface ManifestRegistry {
    id: string;                 // StandingsRegistry object ID
    owner: string;              // Owner Sui address
    admins: string[];
    name: string;
    ticker: string;
    defaultStanding: number;    // Raw u8 (0-6)
    cachedAt: string;
    // No tenant -- standingsRegistry packageId is shared across tenants
}

export interface ManifestPrivateMapIndex {
    id: string;                 // Map object ID
    version: 1 | 2;            // V1 or V2
    name: string;
    creator: string;
    mode: number;               // 0=encrypted, 1=cleartext standings (V2 only; V1 always 0)
    registryId?: string;        // StandingsRegistry ID (V2 mode=1 only)
    tenant: string;
    cachedAt: string;
}
```

### Manifest Sync Expansion (chain/manifest.ts)

Add three new sync functions following the existing cursor/pagination patterns:

1. **`discoverMarkets()`** -- query all `Market<T>` objects via `queryMarkets()` from chain-shared, cache in `manifestMarkets`. Paginated by GraphQL type filter. Stale entries refreshed if `cachedAt` > 1 hour.

2. **`discoverRegistries()`** -- query all `StandingsRegistry` objects via `queryAllRegistries()` from chain-shared, cache in `manifestRegistries`. Same pagination pattern.

3. **`discoverPrivateMapIndex()`** -- lightweight enumeration of known maps. For user-scoped maps: merge from existing `manifestPrivateMaps` and `manifestPrivateMapsV2` tables. For global standings maps (mode=1): use `queryStandingsMaps()` then `queryPrivateMapV2()` to fetch metadata. Cache in `manifestPrivateMapIndex`.

### Private Map -> Manifest Location Integration

Add a new function `mergePrivateMapLocationsIntoManifest()` that:

1. Reads all `manifestMapLocations` entries that have a non-null `structureId`
2. For each, checks if a `manifestLocations` entry exists for that `structureId`
3. If not, creates a synthetic `ManifestLocation` entry with `solarsystem` from the map location, `lPoint` from `P{planet}-L{lPoint}`, and a special marker field (e.g. `source: "private-map"`) indicating the data came from a private map rather than a public `LocationRevealedEvent`
4. This makes private map locations visible in the same unified `manifestLocations` table that Deployables, Star Map, and Market views already query

This requires adding an optional `source` field to `ManifestLocation` (`"public" | "private-map"`) and updating the `manifestLocations` index accordingly.

### Auto-Sync Expansion (hooks/useManifestAutoSync.ts)

Extend the initial sync to also run:

- `discoverMarkets(client)` once (not per-tenant -- market packageId is shared)
- `discoverRegistries(client)` once (not per-tenant -- standingsRegistry packageId is shared)
- `syncPrivateMapIndex(tenantId)` per tenant (privateMapStandings packageId differs per tenant for some tenants)
- `mergePrivateMapLocationsIntoManifest(tenantId)` per tenant (after private map data is synced)

These run after the existing character + tribe sync, as low-priority background tasks.

### Consumer Migration

Update views to read from manifest cache instead of ad-hoc queries:

- **Market.tsx** -- replace `queryMarkets()` call with `useLiveQuery(() => db.manifestMarkets.toArray())` (no tenant filter -- markets are global)
- **Standings.tsx** -- replace `queryAllRegistries()` calls with `useLiveQuery(() => db.manifestRegistries.toArray())` (no tenant filter -- registries are global)
- **StandingsExtensionPanel.tsx (Market Picker)** -- read from `db.manifestMarkets` (enables Plan 03's market picker dropdown)
- **Manifest.tsx** -- add new tabs for Markets, Registries, Private Maps

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Separate table for manifest markets vs. reuse currencies | New `manifestMarkets` table | `currencies` is a user-curated list; manifest markets is a chain-wide cache. Different lifecycle and schema. |
| Separate table for manifest registries vs. reuse subscribedRegistries | New `manifestRegistries` table | `subscribedRegistries` is user-scoped (only subscribed ones); manifest registries is the global cache of all registries on chain. |
| Private map location -> manifestLocation merge strategy | Synthetic ManifestLocation entries with `source` field | Avoids duplicating resolution logic in every consumer. One table, one query. Private map entries are distinguishable by `source` field. |
| Global private map index vs. user-scoped only | Lightweight global index (`manifestPrivateMapIndex`) | The global index enables views to show "all known maps" without decryption keys. User-specific tables remain for invite/key storage. |
| Market/registry tenant scoping | Global (no tenant field) | market.packageId and standingsRegistry.packageId are identical across stillness/utopia (config.ts L44=L110, L52=L119). Querying once covers both tenants. Avoids duplicates. |
| Sync timing -- eager vs. lazy | Eager on startup (background) | Markets and registries are small (~50-200 objects each). Cost of one GQL query on startup is minimal compared to UX benefit of instant data. |
| DB migration approach | Single V30 migration with new tables only | No data migration needed -- new tables are empty until first sync. Existing tables untouched. |
| ManifestLocation.source field | Optional field, no index | Only used for display differentiation. Not queried by index. |

## Implementation Phases

### Phase 1: DB Schema + Types (V30 Migration)

1. Add `ManifestMarket`, `ManifestRegistry`, `ManifestPrivateMapIndex` types to `db/types.ts` (after the existing ManifestLocation interface, ~L468)
2. Add optional `source?: "public" | "private-map"` field to the existing `ManifestLocation` interface in `db/types.ts` L443
3. Add the three new EntityTable declarations to the `PeriscopeDB` class in `db/index.ts` (after L120, near the other manifest tables)
4. Add V30 migration to `db/index.ts` (after V29, ~L550):
   ```
   this.version(30).stores({
       manifestMarkets: "id, coinType, creator, cachedAt",
       manifestRegistries: "id, owner, name, ticker, cachedAt",
       manifestPrivateMapIndex: "id, creator, tenant, cachedAt",
   });
   ```
   Note: `manifestMarkets` and `manifestRegistries` omit tenant index (shared across tenants). `manifestPrivateMapIndex` retains tenant because private maps are discovered via user-scoped invites and subscribed registries, which are per-tenant in the existing data model.
5. Update the imports in `db/index.ts` to include the new types

### Phase 2: Market Sync

1. Add `discoverMarkets()` function to `chain/manifest.ts`:
   - Accept `client: SuiGraphQLClient`, `ctx?: TaskContext`
   - Get `market.packageId` from `getContractAddresses("stillness")` (identical across tenants -- `0xf9c4...`)
   - Call `queryMarkets(client, packageId)` from chain-shared (already exported via index.ts L8)
   - Map each `MarketInfo` to `ManifestMarket` with `cachedAt` (no tenant field)
   - Bulk put into `db.manifestMarkets`
   - Return count of markets synced
2. Import `queryMarkets` from `@tehfrontier/chain-shared` in `manifest.ts`

### Phase 3: Registry Sync

1. Add `discoverRegistries()` function to `chain/manifest.ts`:
   - Accept `client: SuiGraphQLClient`, `ctx?: TaskContext`
   - Get `standingsRegistry.packageId` from `getContractAddresses("stillness")` (identical across tenants -- `0x7d38...`)
   - Call `queryAllRegistries(client, packageId)` from chain-shared (already exported via index.ts L13)
   - Map each `StandingsRegistryInfo` to `ManifestRegistry` with `cachedAt` (no tenant field)
   - Bulk put into `db.manifestRegistries`
   - Return count of registries synced
2. Import `queryAllRegistries` from `@tehfrontier/chain-shared` in `manifest.ts`

### Phase 4: Private Map Index Sync

1. Add `syncPrivateMapIndex()` function to `chain/manifest.ts`:
   - Read all `manifestPrivateMaps` (V1) and `manifestPrivateMapsV2` (V2) entries for the tenant
   - Merge into `manifestPrivateMapIndex` entries with version, name, creator, mode
   - For V2 mode=1 maps: also discover via `queryStandingsMaps()` (already used in `syncPrivateMapsV2ForUser`)
   - Bulk put into `db.manifestPrivateMapIndex`
   - Return count of maps indexed

### Phase 5: Private Map -> Manifest Location Merge

1. Add `mergePrivateMapLocationsIntoManifest()` function to `chain/manifest.ts`:
   - Read all `manifestMapLocations` entries with non-null `structureId`
   - For each, check if `db.manifestLocations.get(structureId)` already exists
   - If not, create a `ManifestLocation` entry:
     - `id`: structureId
     - `assemblyItemId`: "" (unknown from map data)
     - `typeId`: 0 (unknown from map data)
     - `ownerCapId`: "" (unknown)
     - `solarsystem`: loc.solarSystemId
     - `x`, `y`, `z`: "0" (private maps don't store exact coords)
     - `lPoint`: `P${loc.planet}-L${loc.lPoint}`
     - `tenant`: loc.tenant
     - `source`: "private-map"
     - `revealedAt`: new Date(loc.addedAtMs).toISOString()
     - `cachedAt`: now
   - Put into `db.manifestLocations`
   - Call `crossReferenceManifestLocations()` for newly created IDs
2. Wire this function to run after private map location syncs (in `syncMapLocations` and `syncMapLocationsV2`)

### Phase 6: Auto-Sync Expansion

1. Update `useManifestAutoSync.ts` to include:
   - After the per-tenant character + tribe loop: call `discoverMarkets(client)` once (shared packageId)
   - After markets: call `discoverRegistries(client)` once (shared packageId)
   - Then per-tenant: call `syncPrivateMapIndex(tenantId)` (lightweight, no decryption)
   - Then per-tenant: call `mergePrivateMapLocationsIntoManifest(tenantId)`
2. Add `discoverMarkets`, `discoverRegistries`, `syncPrivateMapIndex`, `mergePrivateMapLocationsIntoManifest` to the imports from `@/chain/manifest`

### Phase 7: Consumer Migration + Manifest UI

1. **Market.tsx**: Replace `queryMarkets()` direct call with `useLiveQuery(() => db.manifestMarkets.toArray())` (no tenant filter). Add a "Refresh Markets" button that triggers `discoverMarkets()` via task worker.
2. **Standings.tsx**: Replace `queryAllRegistries()` calls at L378 and L582 with `useLiveQuery(() => db.manifestRegistries.toArray())` (no tenant filter). Add refresh button.
3. **Manifest.tsx**: Add new tabs to the tab bar (L510-541):
   - "Markets ({count})" tab -- DataGrid showing `manifestMarkets` with columns: coinType, creator, feeBps, totalSupply, cachedAt
   - "Registries ({count})" tab -- DataGrid showing `manifestRegistries` with columns: name, ticker, owner, defaultStanding, cachedAt
   - "Private Maps ({count})" tab -- DataGrid showing `manifestPrivateMapIndex` with columns: name, creator, version, mode, cachedAt
   - Update the discover button to call the appropriate sync function per tab
   - Update the stats line (L469-471) to include market/registry/map counts

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Modify | Add `ManifestMarket`, `ManifestRegistry`, `ManifestPrivateMapIndex` interfaces; add `source?` field to `ManifestLocation` |
| `apps/periscope/src/db/index.ts` | Modify | Add V30 migration with 3 new tables; add EntityTable declarations; update type imports |
| `apps/periscope/src/chain/manifest.ts` | Modify | Add `discoverMarkets()`, `discoverRegistries()`, `syncPrivateMapIndex()`, `mergePrivateMapLocationsIntoManifest()`; wire merge into existing sync functions |
| `apps/periscope/src/hooks/useManifestAutoSync.ts` | Modify | Extend initial sync to include markets, registries, private map index, and location merge |
| `apps/periscope/src/views/Manifest.tsx` | Modify | Add Markets, Registries, Private Maps tabs with DataGrid columns and sync buttons |
| `apps/periscope/src/views/Market.tsx` | Modify | Replace ad-hoc `queryMarkets()` with `useLiveQuery` on `db.manifestMarkets` |
| `apps/periscope/src/views/Standings.tsx` | Modify | Replace ad-hoc `queryAllRegistries()` with `useLiveQuery` on `db.manifestRegistries` |

## Open Questions

1. **Should the private-map-sourced ManifestLocation entries be distinguishable in the UI?**
   - **Option A: Visual indicator** -- Show a lock icon or "Private" badge next to locations sourced from private maps in the Manifest locations tab and Deployables grid. Pros: transparency about data provenance. Cons: minor UI complexity.
   - **Option B: No distinction** -- Treat all locations identically in the UI. Pros: simpler. Cons: user can't tell if a location is public knowledge or private intel.
   - **Recommendation:** Option A -- users care about provenance. A small badge or icon is low effort and high value.

2. **Should manifest market/registry sync be tenant-scoped or global?**
   - **Option A: Tenant-scoped** -- Store `tenant` on each manifest entry, filter by active tenant in queries. Sync runs per-tenant in the auto-sync loop. Pros: consistent with existing manifest pattern (characters/tribes/locations all have tenant). Cons: market and registry package IDs are identical across both tenants (config.ts L44 = L110 = `0xf9c4...`, L52 = L119 = `0x7d38...`), so `queryMarkets()` / `queryAllRegistries()` return the same objects regardless of tenant. This would create duplicate entries.
   - **Option B: Global (no tenant)** -- Markets and registries are published to the shared Sui testnet, not tenant-specific. Store without tenant, sync once (not per-tenant). Pros: avoids duplicates; single query covers both tenants. Cons: breaks the existing manifest pattern where everything has a tenant field; consumers need to query without tenant filter.
   - **Recommendation:** Option B -- since the package IDs are identical across tenants, running `queryMarkets()` twice yields the exact same results. Store globally without tenant. The sync runs once in auto-sync (not per-tenant). Consumer queries use `db.manifestMarkets.toArray()` instead of filtering by tenant. This is a pragmatic deviation from the tenant-scoped pattern used by characters/tribes/locations, which genuinely differ per tenant (different world packages).

3. **How aggressively should stale manifest market/registry entries be refreshed?**
   - **Option A: Startup only** -- Sync on app startup, no periodic refresh. Manual "Refresh" button in Manifest UI. Pros: simplest. Cons: data goes stale during long sessions.
   - **Option B: Periodic background refresh** -- Re-sync every 30 minutes via a timer in useManifestAutoSync. Pros: fresh data. Cons: adds background network traffic; complexity.
   - **Option C: Startup + event-driven** -- Sync on startup. Chain Sonar already monitors market events (market_sell_posted, etc.) -- when Sonar detects new market activity, trigger a manifest market refresh. Pros: efficient, only refreshes when needed. Cons: requires wiring Sonar events to manifest refresh.
   - **Recommendation:** Option A for initial implementation. Markets and registries change infrequently. A manual refresh button is sufficient. Periodic/event-driven refresh can be added later.

## Cross-Plan Dependencies

- **Plan 03 (Storage Datagrid)** depends on this plan for:
  - Cached market list (`manifestMarkets`) for the market picker dropdown in SSU extension config
  - Manifest-backed structure data for the filtered datagrid mode
  - Unified location resolution that includes private map locations
- This plan should be implemented **before** Plan 03's Phase 4 (Market Picker) and Phase 5 (Manifest-backed Datagrid).

## Deferred

- **Periodic background refresh of markets/registries** -- not needed for initial implementation; can be added when session-length staleness becomes a problem.
- **Chain Sonar -> manifest refresh wiring** -- event-driven manifest updates based on Sonar detecting new market/registry activity. Good optimization but not blocking.
- **Global enumeration of all private maps** -- V1 maps have no creation event to enumerate globally. V2 mode=0 maps are invite-only. Only V2 mode=1 (standings) maps are globally discoverable. The index only covers what's accessible.
- **Market order caching** -- caching individual sell listings and buy orders in the manifest. These change too frequently for a cache to be useful; leave them as live queries.
