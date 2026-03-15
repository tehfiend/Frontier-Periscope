# Governance System Implementation Plan (Revised)

**Status:** COMPLETE (2026-03-14) — Phase 1 fully implemented and deployed. Steps 1-12 done (contracts built/tested/published, addresses filled, all 4 views wired to chain TX). Step 13 cleanup items remain (low priority, deferred). Governance package live on testnet at `0x8bef45b3...a578cb`.

## Context

Replace the "extension templates" approach with a unified **Governance Organization** as the root on-chain object. Everything (turrets, markets, finances, claims) flows from the org. Terminology: "Tenants" → "Servers", "Extensions" → gone.

**Design decisions (confirmed):**
- **Tiers are mutually exclusive.** Each character/tribe in exactly one tier per org.
- **Org required for everything.** "Sole Proprietorship" is a UI concept (auto-detected from empty tiers), not a contract field.
- **System names: dual model.** On-chain governance names + local personal nicknames.
- **Skip gates for Phase 1.** Game server only passes an extension's own config — can't pass Organization cross-package. Gate integration deferred to Phase 2 (after clarifying parameter support with CCP).
- **Single Move package.** `contracts/governance/` with `org.move` + `claims.move` modules.

---

## Phase 1: Hackathon Target (March 15-31, 2026)

### Step 1: Move Contract — `governance::org` [DONE]

**Package:** `contracts/governance/`

Single package, two modules. No world-contracts dependency (neither module needs Gate/Character types).

**`sources/org.move`:**
```move
module governance::org;

public struct Organization has key {
    id: UID,
    name: vector<u8>,
    creator: address,
    stakeholders: Tier,
    members: Tier,
    serfs: Tier,
    opposition: Tier,
}

public struct Tier has store, drop, copy {
    tribes: vector<u32>,
    characters: vector<u64>,
    addresses: vector<address>,
}
```

No `org_type` field. Sole proprietorship is a UI concept: Periscope shows simplified view when `stakeholders.addresses.length == 1 && members/serfs are empty`.

**Key functions:**
- `create_org(name, ctx)` — creator added to stakeholders, shared object
- `create_and_share(name, ctx)` — entry function, creates + shares in one call
- `add_stakeholder_tribe/character/address` / `remove_stakeholder_tribe/character/address` — creator only
- `add_member_tribe/character/address`, `add_serf_*`, `add_opposition_*` + matching `remove_*` — any stakeholder
- **Tier exclusivity:** removes entity from all other tiers before adding (scans all 4 tier vectors per entity type)
- `is_stakeholder_tribe/character/address`, `is_member_*`, `is_serf_*`, `is_opposition_*` — read checks
- `is_friendly_tribe/character/address` = stakeholder OR member OR serf
- All mutations emit `TierChangedEvent { org_id, entity_type, entity_id, entity_address, old_tier, new_tier }`

**Note:** Functions are per-entity-type (tribe/character/address), not generic. The TypeScript TX builders in `governance.ts` handle this by iterating entities and calling the correct typed function.

**Move tests written (7):**
- Create org, verify creator in stakeholders
- Add member, verify in members tier, verify friendly
- Add same member to serfs, verify removed from members (exclusivity)
- Remove stakeholder (non-creator), verify removed
- Only creator can add/remove stakeholders (expected failure test)
- Any stakeholder can manage other tiers
- `is_friendly()` returns true for stakeholder/member/serf, false for opposition/unknown

---

### Step 2: Move Contract — `governance::claims` [DONE]

**`sources/claims.move`:**
```move
module governance::claims;

use governance::org::Organization;

public struct ClaimsRegistry has key {
    id: UID,
    total_claims: u64,
}

public struct ClaimKey has store, copy, drop {
    org_id: ID,
    system_id: u64,
}

public struct SystemClaim has store, drop {
    org_id: ID,
    system_id: u64,
    name: vector<u8>,
    claimed_at: u64,
    weight: u64,
}
```

Events: `ClaimCreatedEvent`, `ClaimUpdatedEvent`, `ClaimRemovedEvent` for client-side indexing.

**Key functions:**
- `init(ctx)` — creates shared ClaimsRegistry
- `create_claim(registry, org, system_id, name, weight, clock, ctx)` — stakeholder only
- `update_claim_name(registry, org, system_id, name, ctx)` — stakeholder only
- `update_claim_weight(registry, org, system_id, weight, ctx)` — stakeholder only
- `remove_claim(registry, org, system_id, ctx)` — stakeholder only
- `has_claim(registry, org_id, system_id)` — check via `dynamic_field::exists_`

**Move tests written (2):**
- Create claim, update name, update weight, remove claim, verify all
- Non-stakeholder can't create claims (expected failure test)

**`Move.toml`:**
```toml
[package]
name = "governance"
edition = "2024"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.66.2" }

[addresses]
governance = "0x0"
```

No world-contracts dependency — only sui-framework.

---

### Step 3: Governance Turret (Generator Extension) [DONE]

No new Move contract. Extended turret_priority generator pipeline.

**`packages/chain-shared/src/turret-priority.ts`** — added:
```ts
export function generateOrgTurretConfig(
  orgData: OrganizationInfo,
  mode: 'public' | 'private',
  overrides?: Partial<TurretPriorityConfig>
): TurretPriorityConfig
```

- **Public mode:** Opposition tribes/chars → KOS. Stakeholder+member+serf → friendly.
- **Private mode:** Same friendly, but opposition → KOS max (weight 150).

**`apps/gas-station/`** — new endpoint `POST /build-governance-turret`:
- Accepts: `{ orgObjectId, mode, turretType, weightOverrides? }`
- Fetches Organization from chain → calls `generateOrgTurretConfig()` → existing build pipeline
- Auto-fills effective classes from turret type if specified
- Returns `{ packageId }`

**Files modified:**
- `packages/chain-shared/src/turret-priority.ts` — added `generateOrgTurretConfig()`
- `apps/gas-station/src/index.ts` — added route + handler
- `apps/gas-station/src/buildTurret.ts` — added `buildGovernanceTurret()` function

---

### Step 4: Terminology Rename — Tenants → Servers [DONE]

User-facing only. Internal types (`TenantId`, `TenantConfig`) unchanged.

**Changes made:**
- Created `apps/periscope/src/components/ServerSwitcher.tsx` (copy of TenantSwitcher with renamed labels)
- `apps/periscope/src/components/Sidebar.tsx` — imports `ServerSwitcher` instead of `TenantSwitcher`
- `apps/periscope/src/views/Extensions.tsx` — "tenant switcher" → "server switcher"
- `apps/periscope/src/components/AddCharacterDialog.tsx` — "Tenant:" → "Server:", "on this tenant" → "on this server"

**TenantSwitcher.tsx kept** (not deleted) — no longer imported anywhere but preserved for backwards compatibility.

---

### Step 5: TypeScript Layer [DONE]

**`packages/chain-shared/src/types.ts`** — added:
```ts
export type OrgTier = 'stakeholder' | 'member' | 'serf' | 'opposition';

export interface OrgTierData {
  tribes: number[];
  characters: number[];
  addresses: string[];
}

export interface OrganizationInfo {
  objectId: string;
  name: string;
  creator: string;
  stakeholders: OrgTierData;
  members: OrgTierData;
  serfs: OrgTierData;
  opposition: OrgTierData;
}

export interface OnChainClaim {
  orgId: string;
  systemId: number;
  name: string;
  claimedAt: number;
  weight: number;
}
```

Added `governance?: { packageId: string; claimsRegistryObjectId: string }` to `ContractAddresses`.

**New: `packages/chain-shared/src/governance.ts`** — TX builders:
- `buildCreateOrg(packageId, name)` → Transaction
- `buildAddToTier(packageId, orgObjectId, tier, entities)` → Transaction
- `buildRemoveFromTier(packageId, orgObjectId, tier, entities)` → Transaction
- `queryOrganization(client, orgObjectId)` → OrganizationInfo
- `buildCreateClaim(packageId, registryId, orgObjectId, systemId, name, weight)` → Transaction
- `buildUpdateClaimName(packageId, registryId, orgObjectId, systemId, name)` → Transaction
- `buildUpdateClaimWeight(packageId, registryId, orgObjectId, systemId, weight)` → Transaction
- `buildRemoveClaim(packageId, registryId, orgObjectId, systemId)` → Transaction
- `queryClaimEvents(client, packageId)` → { created, removed } (event-based indexing)

**`packages/chain-shared/src/index.ts`** — added governance export.

**`packages/shared/src/schemas/governance.ts`** — rewritten:
- `orgTierSchema = z.enum(["stakeholder", "member", "serf", "opposition"])`
- `organizationSchema` with `chainObjectId`, tier data
- `createOrgSchema`, `addToTierSchema`, `removeFromTierSchema`
- Removed Proposal/Vote (Phase 2)

**`packages/shared/src/schemas/claims.ts`** — rewritten:
- `chainClaimSchema` (on-chain, org-level, weight)
- `systemNicknameSchema` (local-only, personal)
- Removed old types (claimType, disputeStatus, etc.)

---

### Step 6: Periscope Database Schema V12 [DONE]

**`apps/periscope/src/db/index.ts`:**
```ts
// V12: Governance — organizations, tier members, claims, nicknames, currencies
this.version(12).stores({
  organizations: "id, name, chainObjectId, creator, updatedAt, _hlc",
  orgTierMembers: "id, orgId, tier, kind, characterId, tribeId, [orgId+tier], _hlc",
  systemClaims: "id, orgId, systemId, status, weight, [systemId], updatedAt, _hlc",
  systemNicknames: "id, systemId",
  currencies: "id, orgId, symbol, packageId, treasuryCapId, updatedAt, _hlc",
});
```

**`apps/periscope/src/db/types.ts`** — new records:
- `OrganizationRecord extends SyncMeta` — id, name, chainObjectId?, creator, createdAt, updatedAt
- `OrgTierMember extends SyncMeta` — id, orgId, tier, kind (character|tribe), characterName?, characterId?, suiAddress?, tribeId?, tribeName?
- `SystemClaimRecord extends SyncMeta` — id, orgId, systemId, name, status (active|contested|removed), weight, createdAt, updatedAt
- `SystemNickname` — id, systemId, name (NO SyncMeta — local only)
- `CurrencyRecord extends SyncMeta` — id, orgId, symbol, name, coinType, packageId, treasuryCapId, decimals

---

### Step 7: Navigation Restructure [DONE]

**Sidebar.tsx** — new Governance group with lucide icons (`Building2`, `Crosshair`, `Coins`, `Flag`):

```ts
{
  title: "Governance",
  items: [
    { to: "/governance", icon: Building2, label: "Organization" },
    { to: "/governance/turrets", icon: Crosshair, label: "Turrets" },
    { to: "/governance/finance", icon: Coins, label: "Finance" },
    { to: "/governance/claims", icon: Flag, label: "Claims" },
  ],
}
```

Removed from sidebar: Extensions (Puzzle), Permissions (ShieldCheck), Turret Config (Crosshair from Tools).

**Router — governance routes added:**
```
/governance            → GovernanceDashboard
/governance/turrets    → GovernanceTurrets
/governance/finance    → GovernanceFinance
/governance/claims     → GovernanceClaims
/turret-config         → redirect /governance/turrets
```

**Extensions + Permissions routes kept** (still functional for existing users) but removed from sidebar nav.

---

### Step 8: GovernanceDashboard View [DONE]

**`apps/periscope/src/views/GovernanceDashboard.tsx`**

**No org yet — Creation flow:**
- Name input → stores locally in `db.organizations` (chain TX wired after publish)
- Creator added to stakeholders in `db.orgTierMembers`

**Auto-detect "sole prop" mode** (UI only, no contract field):
- `stakeholders count <= 1 && members empty && serfs empty` → simplified view
- Otherwise → full org view

**Simplified view:** Opposition panel only + quick actions (Turrets, Finance, Claims)
**Full view:** Four tier panels (Stakeholders, Members, Serfs, Opposition) with add/remove

**Tier panels support:**
- Add by character (ID or address) or tribe (ID)
- Optional name field
- Remove individual members
- Each panel color-coded (amber/cyan/zinc/red)

---

### Step 9: GovernanceTurrets View [DONE]

**`apps/periscope/src/views/GovernanceTurrets.tsx`**

Follows existing TurretConfig view pattern:
- Lists owned turrets from `useOwnedAssemblies()`
- Mode toggle: Public (shoot opposition) / Private (shoot non-org)
- Org membership preview: shows friendly/KOS counts from org tiers
- Weight tuning: reuses `TurretPriorityForm` component
- **"Build & Deploy"** → gas station `/build-governance-turret` (with org) or `/build-turret` (without)
- After build: creates dynamic template, calls `deploy()` from `useExtensionDeploy`
- Stores extension record with orgMode and orgId in configuration

---

### Step 10: GovernanceFinance View [DONE]

**`apps/periscope/src/views/GovernanceFinance.tsx`**

Phase 1 — currency creation only. **User pays gas for token publish** (gas station does NOT handle token publishing in Phase 1).

- **Create Currency** form: Symbol, Name, Decimals
- Stores `CurrencyRecord` in `db.currencies` (packageId/coinType/treasuryCapId empty until on-chain publish)
- **Currency List**: card per currency showing symbol, name, publish status
- Phase 1 banner: explains local-only records, on-chain publish requires wallet gas

---

### Step 11: GovernanceClaims View [DONE]

**`apps/periscope/src/views/GovernanceClaims.tsx`**

Two tabbed systems:

1. **Governance Claims (on-chain) tab:**
   - Requires org — "Create an organization first" prompt if none
   - Add claims by system ID + optional name + weight
   - Claims stored in `db.systemClaims`
   - Contested detection: flags claims with "contested" badge
   - Remove claims via trash button

2. **Personal Nicknames (local) tab:**
   - Any user sets nickname for any system by ID
   - `db.systemNicknames` (no sync, no chain)
   - Add/remove nicknames

---

### Step 12: Publish & Wire Chain Transactions [DONE]

**All sub-steps completed 2026-03-14.**

#### 12a: Build & Test Move Contracts Locally [DONE]

9 tests pass (7 for org, 2 for claims). Zero warnings.

#### 12b: Publish to Testnet [DONE]

Published package ID: `0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb`
ClaimsRegistry object ID: `0xa443242e14ddcdbfa0b6ad63305df464ac110fb6abc59b2ed59db8a37f42082f`

#### 12c: Fill Contract Addresses [DONE]

`packages/chain-shared/src/config.ts` — `governance` field added to both `stillness` and `utopia` entries with the published package ID and ClaimsRegistry object ID.

#### 12d: Wire GovernanceDashboard to Chain [DONE]

`apps/periscope/src/views/GovernanceDashboard.tsx` imports `buildCreateOrg`, `getContractAddresses`, `useSignAndExecuteTransaction`. `handleCreateOrg()` builds and executes the on-chain `create_and_share` TX, extracts the Organization object ID from `objectChanges`, and stores it in `db.organizations` with `chainObjectId`.

#### 12e: Wire Tier Management to Chain [DONE]

`GovernanceDashboard.tsx` `TierPanel` imports `buildAddToTier`/`buildRemoveFromTier`. `handleAdd()`/`handleRemove()` store locally AND execute chain TX if `org.chainObjectId` is set. Warning banner shown when org not yet published.

#### 12f: Wire Claims to Chain [DONE]

`apps/periscope/src/views/GovernanceClaims.tsx` imports `buildCreateClaim`/`buildRemoveClaim` and `getContractAddresses`. `handleAdd()`/`handleRemove()` execute chain TX using `claimsRegistryObjectId` and `org.chainObjectId`.

#### 12g: Wire Governance Turret Build [DONE]

`apps/periscope/src/views/GovernanceTurrets.tsx` has `chainObjectId` guard in `handleDeploy()` — shows "Publish your organization to chain first" if org not published.

---

### Step 13: Cleanup [PARTIAL]

**Done:**
- ~~Remove Extensions + Permissions sidebar entries~~ DONE (removed from nav)
- ~~Turret Config sidebar entry~~ DONE (removed, redirect added)
- ~~User-facing "tenant" → "server"~~ DONE

**Remaining (low priority, post-hackathon OK):**
- Delete `apps/periscope/src/components/TenantSwitcher.tsx` (no longer imported anywhere, file still exists)
- `EXTENSION_TEMPLATES` in `apps/periscope/src/chain/config.ts` — **keep for now**. The Extensions view and existing turret deploy flow still reference them. Removing would break the Extensions route which is still reachable by URL.
- `apps/periscope/src/views/TurretConfig.tsx` — keep file but route redirects to `/governance/turrets`. Delete after confirming no deep links reference it.
- Consider redirecting `/extensions` → `/governance` in router.tsx (add `beforeLoad` like turretConfigRoute)

---

## Parallel Workstreams (completed)

```
Workstream A (chain):                Workstream B (UI, parallel):
  [DONE] Write org.move + claims.move  [DONE] DB schema V12 + types
  [DONE] Write Move tests              [DONE] Nav restructure + routing
  [DONE] sui move build + test         [DONE] ServerSwitcher rename
  [DONE] Publish to testnet            [DONE] View shells (GovernanceDashboard/Turrets/Finance/Claims)
  [DONE] Fill contract addresses       ← MERGE POINT →
  [DONE] Write governance.ts builders  [DONE] Wire views to chain TX builders
  [DONE] Gas station endpoint          [DONE] E2E testing (manual)
```

---

## What Was Actually Built (Summary)

### New Files (9):
| File | Lines | Description |
|------|-------|-------------|
| `contracts/governance/Move.toml` | 10 | Package manifest, sui-framework only |
| `contracts/governance/sources/org.move` | 589 | Organization: 4 tiers, exclusivity, events, 7 tests |
| `contracts/governance/sources/claims.move` | 335 | Claims: dynamic fields, events, 2 tests |
| `packages/chain-shared/src/governance.ts` | 315 | TX builders + query helpers |
| `apps/periscope/src/components/ServerSwitcher.tsx` | 88 | Renamed tenant switcher |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | 380 | Org creation, tier panels, sole prop detection |
| `apps/periscope/src/views/GovernanceTurrets.tsx` | 344 | Public/private mode, org preview, build & deploy |
| `apps/periscope/src/views/GovernanceFinance.tsx` | 229 | Currency creation (local Phase 1) |
| `apps/periscope/src/views/GovernanceClaims.tsx` | 369 | Claims + nicknames tabs |

### Modified Files (13):
| File | Changes |
|------|---------|
| `packages/chain-shared/src/types.ts` | +OrgTier, OrgTierData, OrganizationInfo, OnChainClaim, governance in ContractAddresses |
| `packages/chain-shared/src/turret-priority.ts` | +generateOrgTurretConfig() |
| `packages/chain-shared/src/index.ts` | +governance export |
| `packages/shared/src/schemas/governance.ts` | Rewritten: four-tier model, no proposals |
| `packages/shared/src/schemas/claims.ts` | Rewritten: chainClaim + systemNickname |
| `apps/gas-station/src/index.ts` | +POST /build-governance-turret endpoint |
| `apps/gas-station/src/buildTurret.ts` | +buildGovernanceTurret() |
| `apps/periscope/src/db/types.ts` | +5 governance record types |
| `apps/periscope/src/db/index.ts` | +V12 schema, +5 table declarations |
| `apps/periscope/src/components/Sidebar.tsx` | Governance nav group, ServerSwitcher, removed old entries |
| `apps/periscope/src/router.tsx` | +4 governance routes, +turret-config redirect |
| `apps/periscope/src/views/Extensions.tsx` | "tenant" → "server" |
| `apps/periscope/src/components/AddCharacterDialog.tsx` | "Tenant:" → "Server:" |

---

## What Remains (TODO)

### Phase 1 Critical Path: COMPLETE
All critical path items (Steps 12a-12e) and nice-to-have items (12f, 12g) are done.

### Deferred Cleanup (see Step 13, low priority):
- Delete `TenantSwitcher.tsx` (no imports, safe to remove)
- Delete `TurretConfig.tsx` (redirect in place, functionally replaced)
- Keep `EXTENSION_TEMPLATES` and Extensions view for now (still reachable by URL)
- Wire finance currency creation to `buildPublishToken()` (user-paid gas)
- Add org membership change detection for turret "stale" warning badge
- Redirect `/extensions` → `/governance` in router.tsx

### Phase 2: See `docs/plans/pending/05-governance-phase2.md`

---

## Phase 2: Post-Hackathon

### Gate Integration (deferred from Phase 1)
- Clarify with CCP: can game server pass shared objects from other packages to gate extensions?
- **If yes:** Write `governance::gate_ext` module, add to package, republish
- **If no:** Use gate_unified reuse approach (map org tiers → groups, Periscope syncs)
- GovernanceGates view: tier-based ACL + per-tier tolls

### Finance Expansion
- `governance::faucet` module: time-gated currency distribution
- `governance::loan` module: org-currency lending
- Gas station `POST /build-token` endpoint for sponsored token publishing
- Dues/taxes automated collection

### Trade
- `governance::market` module: tier-restricted SSU markets

### Claims Improvements
- Secondary on-chain index: `Table<u64, vector<ID>>` for system_id → org_ids lookup
- Weight automation from on-chain assembly data
- P2P sync for claims between Periscope instances

### Other
- Alliance system (multi-org agreements)
- Governance voting (proposals)
- Org discovery for non-creators (event polling)
- Tier exclusivity optimization (reverse index dynamic field)

---

## Key Technical Constraints

1. **Move contracts are immutable.** Single `governance` package = simpler republish if bugs found.
2. **Turret 4-param signature fixed.** Membership baked as constants → republish on change.
3. **Tiers mutually exclusive.** Contract enforces via scan-and-remove. Phase 2: reverse index optimization.
4. **Sole prop is UI-only.** No contract field. Auto-detected from tier state.
5. **Gate extensions deferred.** Game server parameter limitation. Phase 2 after CCP clarification.
6. **Claims querying via events.** Can't query dynamic fields by partial key. Periscope builds local index.
7. **Token publish = user pays gas.** Gas station doesn't handle token publishing in Phase 1.
8. **Org discovery: creator only in Phase 1.** Non-creators can't auto-discover orgs they belong to.

---

## Verification Checklist

1. [x] `sui move build` + `sui move test` for governance package (org + claims)
2. [x] Publish to testnet, verify shared objects (Organization, ClaimsRegistry) created
3. [x] Fill contract addresses in config.ts
4. [x] Test TX builders: `buildCreateOrg()`, `buildAddToTier()`, `buildCreateClaim()`
5. [x] Gas station: `POST /build-governance-turret` end-to-end
6. [x] Periscope E2E: create org → add opposition → deploy turret → create currency → claim system → add members/serfs (triggers "full org" UI)
7. [x] Terminology: grep Periscope for "tenant" → all user-facing changed to "server"
8. [x] Old routes: `/turret-config` redirects correctly
9. [x] TypeScript syntax verified for all new/modified files

---

## Review Notes (2026-03-14, execution review pass 1)

### Verified Correct:
- **All 9 new files exist** at the paths listed in the File Summary
- **All 13 modified files exist** and contain the described changes
- **Move contracts match plan description:** org.move (590 lines, 7 tests), claims.move (336 lines, 2 tests)
- **governance.ts TX builders** correctly map to per-entity-type Move functions (e.g., `add_stakeholder_tribe`, `add_member_character`, etc.)
- **DB schema V12** matches plan exactly — 5 new tables with correct indexes
- **Router** has all 4 governance routes + turret-config redirect
- **Sidebar** has Governance nav group with correct icons and routes
- **Gas station** has both endpoints (`/build-turret` and `/build-governance-turret`)
- **`generateOrgTurretConfig()`** correctly derives friendly/KOS from org tiers
- **`CONTRACT_ADDRESSES` type** includes `governance?: { packageId: string; claimsRegistryObjectId: string }`
- **`EXTENSION_TEMPLATES`** still exists in `apps/periscope/src/chain/config.ts` (Extensions view still uses it)
- **`TenantSwitcher.tsx`** still exists (not deleted, not imported anywhere — safe to delete)
- **`AddCharacterDialog.tsx`** uses "Server:" and "on this server" (user-facing rename confirmed)

### Issues Found and Fixed in This Review:
1. **Step 1 function signatures were simplified inaccurately.** Updated to show actual per-entity-type functions (e.g., `add_stakeholder_tribe/character/address`) instead of generic `add_stakeholder`.
2. **Step 12 was too vague for execution.** Expanded into 7 sub-steps (12a-12g) with exact commands, file paths, import patterns, and extraction instructions.
3. **"What Remains" section** reorganized to reference Step 12 sub-steps by ID for traceability.

### Known Gaps (acceptable for Phase 1):
- **`queryOrganization()` uses `SuiClient` (JSON-RPC)** — deprecated Jul 2026 but fine for hackathon. Phase 2 should migrate to `SuiGrpcClient`.
- **GovernanceClaims references `db.solarSystems`** — if user hasn't imported static data, system names won't resolve. Degrades gracefully to "System {id}".
- **GovernanceDashboard `handleCreateOrg()` has dead `gasStationUrl` check** — the gas station is never actually called. Step 12d instructions clarify that org creation is user-paid gas, not sponsored.
- **No org re-fetch from chain** — if someone creates an org, closes browser, and reopens, the org is only in IndexedDB. Phase 2 should add org discovery via `OrgCreatedEvent` polling.
- **Tier exclusivity not enforced locally** — the Move contract enforces exclusivity, but the IndexedDB layer doesn't. If a user adds the same entity to two tiers via the UI before chain TX executes, the local DB will be inconsistent. Mitigation: always use chain as source of truth once wired.

### Assessment:
**Phase 1 COMPLETE.** All 12 steps done. Governance package published to testnet (`0x8bef45b3...a578cb`), all 4 Periscope views wired to chain transactions, contract addresses filled. Step 13 cleanup remains (low priority). Phase 2 work tracked in `docs/plans/pending/05-governance-phase2.md`.
