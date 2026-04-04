# Plan: Structures Tenant Filtering
**Status:** Draft
**Created:** 2026-04-04
**Module:** periscope

## Overview

The Structures (Deployables) page does not filter by tenant. When a user has structures on both Stillness and Utopia, all structures appear in a single list regardless of which tenant is active. This creates confusion because structures are tenant-specific -- a gate on Stillness cannot interact with Utopia chain operations, and displaying cross-tenant structures alongside valid ones leads to failed transactions when users attempt on-chain actions.

Unlike currencies (which use shared cross-tenant Market<T> contracts), structures are inherently tenant-bound. Each assembly is created on a specific tenant's chain and its Sui object only exists within that tenant's world package scope. The `owner` address on each structure maps to a character on a specific tenant, providing a reliable resolution path via the manifest character cache: `deployable.owner` -> `ManifestCharacter.suiAddress` -> `ManifestCharacter.tenant`.

This plan adds tenant filtering to the `useStructureRows` hook using an owner-address-to-tenant join through the manifest character cache. The approach mirrors the pattern established in plan 15 (Currency Tenant Filtering) -- an in-memory join with no schema migration, where unresolvable owners are shown to avoid hiding data.

## Current State

### Data Model

- **`DeployableIntel`** (`apps/periscope/src/db/types.ts:94-120`): Has `owner?: string` (Sui address) but NO `tenant` field. This is the primary structure table for user-owned structures.
- **`AssemblyIntel`** (`apps/periscope/src/db/types.ts:122-135`): Has `owner: string` (Sui address) but NO `tenant` field. This table stores watched/discovered structures from other players.
- **`ManifestCharacter`** (`apps/periscope/src/db/types.ts:418-443`): Has `suiAddress` and `tenant` fields, both indexed. This is the join target for resolving owner addresses to tenants.
- **`CharacterRecord`** (`apps/periscope/src/db/types.ts:178-192`): Has `tenant?: string` and `suiAddress?: string`. The active character's tenant is used as a fallback via `useActiveTenant()`.

### DB Indexes

- `deployables`: `"id, objectId, assemblyType, owner, status, label, systemId, updatedAt, _hlc, ownerCapId, parentId, *tags"` (V19, `apps/periscope/src/db/index.ts:492-493`)
- `assemblies`: `"id, assemblyType, objectId, owner, status, systemId, updatedAt, _hlc, parentId, *tags"` (V19, line 494-495)
- `manifestCharacters`: `"id, characterItemId, name, suiAddress, tribeId, tenant, cachedAt"` (V10, line 351)

### Structure Sync Path

Structures enter the DB via two paths:

1. **Own structure sync** (`apps/periscope/src/views/Deployables.tsx:358-457`): The `handleSyncOwn` function calls `discoverCharacterAndAssemblies(client, chainAddress, tenant)` which queries the active tenant's chain. Results are written to `db.deployables.put()` with the `owner` field set to `chainAddress`. The tenant is NOT stored on the record.

2. **Legacy chain sync** (`apps/periscope/src/chain/sync.ts:67-115`): `syncOwnedAssemblies(address, tenant)` uses `getOwnedAssemblies(address, tenant)` to query by tenant, but writes to `db.deployables` without storing tenant.

### useStructureRows Hook

`apps/periscope/src/hooks/useStructureRows.ts:20-220`:
- Receives `tenant` as a parameter (line 24) but only uses it for extension lookup (line 75: `tmpl.packageIds[tenant as TenantId]`).
- Queries `db.deployables.filter(notDeleted)` and `db.assemblies.filter(notDeleted)` with NO tenant filtering (lines 30-31).
- The `tenant` parameter is already threaded through from the Deployables view (line 273: `useStructureRows({ activeAddresses, tenant, showAll })`), so the plumbing exists but filtering is not applied.

### Deployables View

`apps/periscope/src/views/Deployables.tsx:252-276`:
- Calls `useActiveTenant()` (line 254) to get the current tenant.
- Passes `tenant` to `useStructureRows` (line 273) but the hook does not filter by it.
- The `handleSyncOwn` function (line 364) correctly uses the active tenant for chain discovery.
- The `filteredData` memo (lines 332-346) only filters by quick-filter (all/mine/friendly/hostile), not by tenant.

### StructureDetailCard

`apps/periscope/src/components/StructureDetailCard.tsx`:
- Uses `useActiveTenant()` for extension classification and on-chain actions.
- Does not filter structures -- it displays whatever row is selected from the parent.

### Tenant Filtering Pattern (Established in Plan 15)

The currency tenant filtering plan established an in-memory join pattern:
- Resolve entity creator/owner addresses to tenants via `ManifestCharacter.suiAddress` -> `ManifestCharacter.tenant`.
- Build `Map<string, Set<string>>` mapping addresses to their tenant set.
- Show entities whose owner address resolves to the active tenant.
- Show entities with unresolvable owners (no matching character in manifest) to avoid hiding data.

## Target State

### Approach: In-Memory Join (No Schema Migration)

Filter structures at query time by joining `structure.owner` -> `ManifestCharacter.suiAddress` -> `ManifestCharacter.tenant`. This avoids a DB version bump and migration. The join is cheap -- typically <500 structures and <1000 characters. The `useStructureRows` hook already receives `tenant` and already reads `manifestChars` for owner name resolution, so the data is already available.

### Filtering Logic

In the `useStructureRows` hook, build an `addressTenantMap: Map<string, Set<string>>` from manifest characters (same data already loaded for `ownerNames`). Then filter structures where:
- The owner address resolves to the active tenant, OR
- The owner address is unresolvable (not in manifest character cache), OR
- The owner address has characters on multiple tenants (show in both)

This ensures:
- Structures synced from Stillness only show when Stillness is active (owner's character is on Stillness).
- Structures synced from Utopia only show when Utopia is active.
- Manually added structures with unresolved owners always appear (conservative -- don't hide data).

### Edge Cases

- **Owner on multiple tenants**: If an owner address has characters on both Stillness and Utopia, the structure shows under both tenants. This is correct -- the user may have structures on both.
- **Unresolvable owner**: If no `ManifestCharacter` matches the owner address (e.g., character not yet synced), the structure is shown regardless of tenant to avoid hiding data.
- **Owner is undefined**: Some `DeployableIntel` records have `owner?: string` (optional). Structures with no owner are always shown.
- **"Show All" mode**: When `showAll` is true, the tenant filter should still apply -- "show all" means show non-owned structures, not show all tenants. Structures from the other tenant are irrelevant regardless of the ownership filter.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| In-memory join vs. DB migration | In-memory join | Avoids schema migration. The join reuses data already loaded in `useStructureRows` (`manifestChars` for owner name lookup). Zero additional DB queries. |
| Filter location | `useStructureRows` hook | The hook already receives `tenant` and `manifestChars`. Filtering here ensures all consumers (Deployables view, any future structure views) get consistent tenant filtering. |
| Unresolvable owners | Show in all tenants | Better to show extra structures than hide ones the user expects. They become filterable once the owner character is synced to the manifest. |
| Shared hook vs. inline | Inline in `useStructureRows` | Unlike currencies (which need filtering in 4 components), structures only use `useStructureRows` as the data source. A separate hook would add indirection without reuse. |
| "Show All" tenant behavior | Still filter by tenant | Cross-tenant structures are never useful. "Show all" relaxes the ownership filter, not the tenant filter. |

## Implementation Phases

### Phase 1: Add Tenant Filtering to useStructureRows

1. In `apps/periscope/src/hooks/useStructureRows.ts`, build an `addressTenantMap` in the existing `ownerNames` memo (lines 52-61). This memo already iterates `manifestChars`, so we add tenant tracking with zero extra DB reads:

   ```ts
   const { ownerNames, addressTenantMap } = useMemo(() => {
       const nameMap = new Map<string, string>();
       const tenantMap = new Map<string, Set<string>>();
       for (const mc of manifestChars) {
           if (mc.name && mc.suiAddress) nameMap.set(mc.suiAddress, mc.name);
           if (mc.suiAddress && mc.tenant) {
               const existing = tenantMap.get(mc.suiAddress);
               if (existing) existing.add(mc.tenant);
               else tenantMap.set(mc.suiAddress, new Set([mc.tenant]));
           }
       }
       for (const p of players ?? []) {
           nameMap.set(p.address, p.name);
       }
       return { ownerNames: nameMap, addressTenantMap: tenantMap };
   }, [players, manifestChars]);
   ```

2. Define an `isOwnerOnTenant` helper inside the `data` memo (lines 130-217), before the row-building loop. Defining it inside the memo avoids an extra `useCallback` and ensures it captures the current `addressTenantMap` and `tenant` values:

   ```ts
   const isOwnerOnTenant = (owner: string | undefined): boolean => {
       if (!owner) return true; // no owner -> show
       const tenants = addressTenantMap.get(owner);
       if (!tenants) return true; // unresolvable -> show
       return tenants.has(tenant);
   };
   ```

   Filtering logic:
   - If `owner` is undefined/null/empty -> true (show structures with no owner).
   - If `owner` is not in `addressTenantMap` -> true (unresolvable, show it).
   - If `addressTenantMap.get(owner)` contains `tenant` -> true.
   - Otherwise -> false (owner belongs to a different tenant).

3. Apply the tenant filter in the "Merge + Filter Rows" memo (lines 130-217). Add the filter to both code paths:
   - In the `showAll` path (line 194): instead of returning all rows, filter by tenant: `return rows.filter(row => isOwnerOnTenant(row.owner));`
   - In the default filter path (lines 197-206): add `isOwnerOnTenant(row.owner)` as an additional condition. The cleanest approach is to add the tenant check as a pre-filter before the ownership/sonar/registry checks:
     ```ts
     return rows.filter((row) => {
         if (!isOwnerOnTenant(row.owner)) return false;
         if (row.status === "removed") return false;
         // ... existing ownership/sonar/registry checks
     });
     ```

4. Add `addressTenantMap` and `tenant` to the `data` memo dependency array (lines 207-217). Note: `tenant` is not currently in this dependency array even though it's passed to the hook -- it's only used in `extensionByAssembly`. After this change, `tenant` must be added alongside `addressTenantMap`.

5. Update the return value to include `ownerNames` from the restructured memo (line 219). Since `ownerNames` was previously a standalone memo and is now part of a combined memo, ensure the return shape stays the same: `return { data, ownerNames }`.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/hooks/useStructureRows.ts` | Modify | Add address-to-tenant map to existing ownerNames memo; filter structures by active tenant using owner address resolution |

## Open Questions

1. **Should the active character's own addresses always bypass the tenant filter?**
   - **Option A: No bypass -- use the manifest join for all addresses.** -- Pros: Simple, consistent logic. The active character's address should already be in the manifest cache with the correct tenant. Cons: If the manifest hasn't synced yet, the user's own structures could appear on both tenants until the first manifest sync.
   - **Option B: Always show structures owned by active addresses, regardless of tenant resolution.** -- Pros: User's own structures always visible even before manifest sync. Cons: Defeats the purpose of tenant filtering for the user's own structures -- they'd see their Stillness structures on Utopia too. This is the current behavior we're trying to fix.
   - **Option C: Show active-address structures only when they match active addresses AND tenant is correct per character record.** -- Pros: Correct filtering from the start since `CharacterRecord.tenant` is set during sync (not dependent on manifest). Cons: Adds complexity -- need to check both `manifestChars` and `characterRecords`.
   - **Recommendation:** Option A. The manifest character cache is populated early (during initial chain sync) and the active character's address is always resolved correctly. The brief window before first sync is a non-issue in practice since structures also need syncing from the chain. If this proves problematic, Option C can be added as a follow-up.

## Deferred

- **Store `tenant` directly on `DeployableIntel` / `AssemblyIntel`** -- A future DB migration (V33+) could add a `tenant` field to both types, set during sync, and indexed for efficient querying. Deferred because the in-memory join is sufficient for current data volumes and avoids a migration. Revisit if structure counts grow significantly or if multiple views need independent tenant filtering.
- **Dashboard structure counts** -- The Dashboard view (`apps/periscope/src/views/Dashboard.tsx`) may show structure counts that include cross-tenant structures. After this plan, `useStructureRows` will filter correctly, but the Dashboard may use its own queries. Verify separately.
- **Sonar assembly cross-referencing** -- The `sonarAssemblyIds` filter in `useStructureRows` (lines 38-45) loads ALL sonar events regardless of tenant. If a structure was seen in a sonar event on one tenant, it will pass the filter even on the other tenant. This is a minor cosmetic issue since the tenant filter (this plan) will independently block cross-tenant structures via the owner address check.
