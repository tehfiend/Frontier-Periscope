# Plan: Currency Tenant Filtering
**Status:** Draft
**Created:** 2026-04-04
**Module:** periscope

## Overview

The Market contract is shared across tenants (Stillness and Utopia use the same packageId), so `ManifestMarket` records have no `tenant` field. This means the Currencies view, CurrencySelector, and MarketSelector all show currencies from every tenant regardless of which tenant is active. When a user switches tenants, currencies from the other tenant still appear in lists.

We can resolve tenant by joining through the character who created the market: `ManifestMarket.creator` -> `ManifestCharacter.suiAddress` -> `ManifestCharacter.tenant`. Since manifest characters always have a tenant field, this gives us a reliable resolution path. A creator address could theoretically have characters on multiple tenants, but this is a rare edge case that can be handled by matching against any character on the active tenant.

This plan adds tenant filtering to the Currencies view, CurrencySelector, and MarketSelector components using a shared utility that resolves market creator addresses to tenants via the manifest character cache.

## Current State

### Data Model

- **`ManifestMarket`** (`apps/periscope/src/db/types.ts:490-509`): Has `creator` (Sui address) but no `tenant` field. Comment on line 508: "No tenant -- market packageId is shared across tenants."
- **`ManifestCharacter`** (`apps/periscope/src/db/types.ts:418-443`): Has `suiAddress` and `tenant` fields, both indexed.
- **`CurrencyRecord`** (`apps/periscope/src/db/types.ts:810-833`): Has `marketId` but no `tenant` field.
- **`ManifestRegistry`** (`apps/periscope/src/db/types.ts:527-537`): Same pattern -- shared packageId, no tenant. Has `owner` address.

### DB Indexes

- `manifestMarkets`: `"id, coinType, creator, cachedAt"` (V30, `apps/periscope/src/db/index.ts:568`)
- `manifestCharacters`: `"id, characterItemId, name, suiAddress, tribeId, tenant, cachedAt"` (V10, line 351)
- `currencies`: `"id, symbol, coinType, packageId, marketId, _archived"` (V31, line 575)

### Currencies View (`apps/periscope/src/views/Currencies.tsx`)

- Calls `useActiveTenant()` (line 272) but only uses it for `getContractAddresses(tenant)` (line 405) and `discoverExchangePairs(suiClient, tenant)` (line 413).
- The `unifiedRows` memo (lines 309-390) iterates all `manifestMarkets` and `currencies` with NO tenant filtering.
- `filteredRows` (lines 394-402) only filters by decommission status.

### CurrencySelector (`apps/periscope/src/components/extensions/CurrencySelector.tsx`)

- Calls `useActiveTenant()` (line 40) but only uses it for decommission queries.
- Lists ALL non-archived currencies from `db.currencies` with no tenant filter (line 43).

### MarketSelector (`apps/periscope/src/components/extensions/MarketSelector.tsx`)

- Calls `useActiveTenant()` (line 40) but only uses it for contract address lookups.
- Lists ALL manifest markets and currencies with no tenant filter.

### Manifest View (`apps/periscope/src/views/Manifest.tsx:664-665`)

- Explicitly comments: "Markets (global -- no tenant filter)" and shows all markets.

### Currency Sync (`apps/periscope/src/chain/currency-sync.ts`)

- `syncCurrenciesFromManifest()` iterates ALL manifest markets. The creator/authorized filter is about access control (who can mint), not tenant.

### Tenant Filtering Pattern

Other entities use a direct `tenant` field on the record. Examples:
- `ManifestCharacter`, `ManifestTribe`, `ManifestLocation`, `ManifestPrivateMap`, etc. all have `tenant` stored directly.
- Views filter with `.where("tenant").equals(tenant)` (e.g., PrivateMaps.tsx line 83) or in-memory `.filter(c => c.tenant === tenant)` (e.g., Manifest.tsx line 629).

## Target State

### Approach: In-Memory Join (No Schema Migration)

Rather than adding a `tenant` column to `ManifestMarket` or `CurrencyRecord` (which would require a DB version bump and migration), we resolve tenant at query time by joining `market.creator` -> `manifestCharacters.where("suiAddress")` -> `character.tenant`. This keeps the data model clean and avoids denormalizing tenant onto a cross-tenant entity.

### Shared Utility Hook

A new `useMarketTenantMap()` hook will:
1. Read all `ManifestMarket` records (reactive via `useLiveQuery`).
2. Read all `ManifestCharacter` records (reactive via `useLiveQuery`).
3. Build a `Map<string, Set<string>>` mapping `suiAddress -> Set<tenant>` from characters.
4. Return a `Map<string, string | null>` mapping `marketId -> tenant` (null if unresolvable).

### Filtered Components

- **Currencies view**: Filter `unifiedRows` to only include rows whose market creator maps to the active tenant (or whose tenant is unresolvable, to avoid hiding unknown currencies).
- **CurrencySelector**: Filter options to active tenant currencies only.
- **MarketSelector**: Filter options to active tenant markets only.
- **Manifest view**: Optionally add tenant column to the markets DataGrid, or filter markets by tenant. (The Manifest view is a debug/inspection tool, so showing all with a tenant indicator column is more appropriate than filtering.)

### Edge Cases

- **Creator on multiple tenants**: If a creator address has characters on both Stillness and Utopia, the market shows under both tenants. This is correct behavior.
- **Unresolvable creator**: If no `ManifestCharacter` matches the creator address (e.g., character not yet synced), the currency is shown regardless of tenant to avoid hiding data.
- **Currencies without marketId**: `CurrencyRecord` entries without a `marketId` have no creator to join on. These are shown unconditionally (they are legacy/orphaned records).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| In-memory join vs. DB migration | In-memory join | Avoids schema migration for a cross-tenant entity. The join is cheap (typically <100 markets and <1000 characters). |
| Hook vs. utility function | Shared hook (`useMarketTenantMap`) | Leverages `useLiveQuery` reactivity so filtering updates automatically when manifest data changes. |
| Unresolvable creators | Show in all tenants | Better to show extra currencies than hide ones the user expects to see. They become filterable once the creator character is synced. |
| Manifest view markets | Add tenant column, don't filter | Manifest is a debug tool -- users want to see all data with tenant as metadata. |
| Currency sync tenant awareness | No change to sync | Sync should continue to cache all markets globally. Filtering is purely a view concern. |

## Implementation Phases

### Phase 1: Shared Hook + Currencies View

1. Create `apps/periscope/src/hooks/useMarketTenantMap.ts`:
   - Export `useMarketTenantMap()` hook.
   - Uses `useLiveQuery` to read `db.manifestMarkets.toArray()` and `db.manifestCharacters.toArray()`.
   - Builds `addressToTenants: Map<string, Set<string>>` from characters grouped by `suiAddress`.
   - Returns `marketTenantMap: Map<string, string | null>` mapping each `market.id` to the resolved tenant (or null).
   - For markets whose creator has characters on exactly one tenant, maps to that tenant.
   - For markets whose creator has characters on multiple tenants, maps to ALL those tenants (return a `Set<string>` or include the market in all matching tenants).
   - Export a helper: `isMarketOnTenant(marketTenantMap, marketId, tenant): boolean` -- returns true if market belongs to tenant or is unresolvable (null).

2. Update `apps/periscope/src/views/Currencies.tsx`:
   - Import `useMarketTenantMap` and `isMarketOnTenant`.
   - Call `useMarketTenantMap()` at the top of the `Currencies` component.
   - In the `unifiedRows` memo, filter out rows whose market resolves to a different tenant. Specifically: after building each row, check `isMarketOnTenant(marketTenantMap, row.marketId, tenant)`. Exclude rows that fail this check.
   - Add `marketTenantMap` and `tenant` to the `unifiedRows` memo dependency array.

### Phase 2: CurrencySelector + MarketSelector

1. Update `apps/periscope/src/components/extensions/CurrencySelector.tsx`:
   - Import and call `useMarketTenantMap()`.
   - Load manifest markets (needed to map currency.marketId -> market.creator).
   - In the `options` memo, filter out currencies whose market resolves to a different tenant.

2. Update `apps/periscope/src/components/extensions/MarketSelector.tsx`:
   - Import and call `useMarketTenantMap()`.
   - In the merged `options` memo, filter out markets that resolve to a different tenant.
   - The `manifestOptions` and `standingsOptions` arrays should also respect the tenant filter.

### Phase 3: Manifest View Enhancement

1. Update `apps/periscope/src/views/Manifest.tsx`:
   - Import `useMarketTenantMap()`.
   - In the markets DataGrid, add a "Tenant" column that displays the resolved tenant for each market (or "unknown" if unresolvable).
   - Optionally add a toggle to filter markets by active tenant (default: show all with tenant column visible).

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/hooks/useMarketTenantMap.ts` | Create | Shared hook resolving market IDs to tenants via character join |
| `apps/periscope/src/views/Currencies.tsx` | Modify | Filter `unifiedRows` by active tenant using the hook |
| `apps/periscope/src/components/extensions/CurrencySelector.tsx` | Modify | Filter currency options by active tenant |
| `apps/periscope/src/components/extensions/MarketSelector.tsx` | Modify | Filter market options by active tenant |
| `apps/periscope/src/views/Manifest.tsx` | Modify | Add tenant column to markets DataGrid |

## Open Questions

1. **Should currency-sync also filter by tenant when creating CurrencyRecord entries?**
   - **Option A: Keep sync global, filter in views only** -- Pros: simpler, no sync logic changes, all data available for inspection. Cons: DB contains currencies from all tenants.
   - **Option B: Filter during sync** -- Pros: DB only contains relevant currencies. Cons: requires passing tenant to sync, loses data when switching tenants, more complex.
   - **Recommendation:** Option A. Sync is global, filtering is a view concern. This matches the existing pattern where `discoverMarkets` is documented as "global" and caches everything.

2. **Should the Manifest markets tab filter by tenant or just show a column?**
   - **Option A: Filter by tenant (like characters, tribes, locations)** -- Pros: consistent with other Manifest tabs. Cons: hides cross-tenant data in a debug tool.
   - **Option B: Show all with a tenant column** -- Pros: full visibility, useful for debugging. Cons: inconsistent with other tabs.
   - **Option C: Default to filtered, with "show all" toggle** -- Pros: best of both worlds. Cons: slightly more UI work.
   - **Recommendation:** Option C. Default to tenant-filtered for consistency, with a small toggle to show all markets.

## Deferred

- **Registries tenant filtering**: `ManifestRegistry` has the same shared-packageId problem (no tenant, has `owner` address). The same join pattern could apply: `registry.owner` -> `manifestCharacters.suiAddress` -> `tenant`. Deferred because registries are less user-facing than currencies and the pattern established here can be reused directly.
- **CurrencyRecord.tenant column**: If performance becomes an issue with the in-memory join (unlikely given data sizes), a future migration could denormalize tenant onto `CurrencyRecord` and `ManifestMarket`. Deferred unless needed.
