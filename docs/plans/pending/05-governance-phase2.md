# Plan: Governance System Phase 2 — Post-Hackathon

**Status:** Draft
**Created:** 2026-03-14
**Updated:** 2026-03-15 (plan review: Phase 2b/2c partially superseded by Plan 06 execution)
**Module:** multi (contracts, chain-shared, periscope, gas-station)

## Overview

Phase 2 extends the governance system beyond the Phase 1 hackathon MVP with five workstreams: gate integration (tier-based access control and tolls), finance expansion (faucets, loans, sponsored token publishing, dues), trade (tier-restricted SSU markets), claims improvements (secondary indexes, weight automation, P2P sync), and alliance/voting systems.

Phase 1 delivered an on-chain Organization with 4-tier membership, system claims, governance turrets, and local currency records. Phase 2 builds on this foundation to create a full-featured organizational management layer where gates, markets, and finances are all governed by org membership.

Gate integration uses a dedicated `governance_ext::gate_permit` module that checks org tier membership directly when issuing jump permits. This is feasible because gates use a dApp-initiated 2-step permit model (confirmed via Builder Chat Discord, 2026-03-14) — the dApp builds the TX and can pass Organization as a parameter. The gate_unified group-mapping approach is retained as a fallback.

## Current State

**Deployed governance contract:** `0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb`
**ClaimsRegistry:** `0xa443242e14ddcdbfa0b6ad63305df464ac110fb6abc59b2ed59db8a37f42082f`
**Gate Unified:** `0x364f68ad3272d9815f2fce74776a854af1e3cb8de58ad1a1d7a0e67ad436210f` (config: `0x1b5bec...daf01a`)

### Phase 1 Artifacts (complete)

| Artifact | Location | Notes |
|----------|----------|-------|
| Move contracts | `contracts/governance/sources/org.move`, `claims.move` | 9 tests, published |
| TX builders | `packages/chain-shared/src/governance.ts` | buildCreateOrg, buildAddToTier, buildRemoveFromTier, buildCreateClaim, buildRemoveClaim, queryOrganization, queryClaimEvents |
| Types | `packages/chain-shared/src/types.ts` | OrgTier, OrgTierData, OrganizationInfo, OnChainClaim, ContractAddresses.governance |
| Config | `packages/chain-shared/src/config.ts` | governance field in stillness + utopia |
| DB schema | `apps/periscope/src/db/index.ts` | V13: organizations, orgTierMembers, systemClaims, systemNicknames, currencies (V13 added description, moduleName, orgTreasuryId to currencies — Plan 06) |
| DB types | `apps/periscope/src/db/types.ts` | OrganizationRecord, OrgTierMember, SystemClaimRecord, SystemNickname, CurrencyRecord |
| Dashboard | `apps/periscope/src/views/GovernanceDashboard.tsx` | Org creation + tier panels, wired to chain |
| Turrets | `apps/periscope/src/views/GovernanceTurrets.tsx` | Public/private mode, gas station build |
| Finance | `apps/periscope/src/views/GovernanceFinance.tsx` | Currency creation (gas station + import mode), OrgTreasury deposit, mint/burn (Plan 06 implemented) |
| Trade | `apps/periscope/src/views/GovernanceTrade.tsx` | Sell + buy orders, SSU market management (Plan 06 implemented) |
| Claims | `apps/periscope/src/views/GovernanceClaims.tsx` | Claims + nicknames, wired to chain |
| Gas station | `apps/gas-station/src/index.ts` | POST /build-governance-turret, POST /build-token (gas station now optional) |
| Treasury contract | `contracts/governance_ext/sources/treasury.move` | OrgTreasury shared object (Plan 06, not yet published) |
| Treasury TX builders | `packages/chain-shared/src/treasury.ts` | OrgTreasury deposit/mint/burn builders (Plan 06 implemented) |
| SSU Market v2 | `contracts/ssu_market/sources/ssu_market.move` | OrgMarket + buy orders code (Plan 06, not yet upgraded on-chain) |
| Market TX builders | `packages/chain-shared/src/ssu-market.ts` | 10 new functions for OrgMarket, buy orders, stock_items, buy_and_withdraw (Plan 06 implemented) |
| Turret generator | `packages/chain-shared/src/turret-priority.ts` | generateOrgTurretConfig() |
| Shared schemas | `packages/shared/src/schemas/governance.ts`, `claims.ts` | Zod schemas |

### Existing Infrastructure Phase 2 Builds On

| Component | Location | What It Provides |
|-----------|----------|-----------------|
| Gate Unified | `contracts/gate_unified/` | Group-based ACL + toll, ExtensionConfig with dynamic field per-gate configs |
| Gate Toll | `packages/chain-shared/src/gate-toll.ts` | queryTollConfig(), buildSetToll() |
| SSU Market | `packages/chain-shared/src/ssu-market.ts` | queryMarketConfig(), buildCreateMarket(), buildSetListing(), buildBuyItem() + 10 new functions (OrgMarket, buy orders, stock_items, buy_and_withdraw — Plan 06) |
| Exchange | `packages/chain-shared/src/exchange.ts` | buildCreatePair(), buildPlaceBid/Ask(), buildCancelBid/Ask() |
| Token Factory | `packages/chain-shared/src/token-factory.ts` | buildPublishToken() (bytecode patching), buildMintTokens(), buildBurnTokens() |
| Lease | `packages/chain-shared/src/lease.ts` | Existing lease contract for SSU rental |
| Bounty Board | `packages/chain-shared/src/bounty.ts` | Existing bounty contract |
| Permission Groups | `apps/periscope/src/db/types.ts` | PermissionGroup, GroupMember, AssemblyPolicy — local permission model |
| P2P Sync | `apps/periscope/src/views/PeerSync.tsx` | WebRTC CRDT sync layer (SyncPeer, SyncLogEntry, SharingGroup) |

## Target State

After Phase 2, the governance system provides:

1. **Gate Integration** — Org tiers control gate access. Stakeholders/members jump free; serfs pay tolls; opposition blocked. Managed from a new GovernanceGates view.
2. **Finance** — Full token lifecycle: sponsored publish via gas station, faucet (time-gated distribution), org treasury management, dues/tax collection.
3. **Trade** — SSU markets restricted by tier. Members trade at org rates; public pays premium or is blocked.
4. **Claims** — Secondary chain index for cross-org lookup, automatic weight from on-chain assembly data, P2P sync of claims between Periscope instances.
5. **Alliances & Voting** — Multi-org alliance agreements, stakeholder voting on proposals.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Gate integration approach | Map org tiers to gate_unified groups (sync via Periscope) | Game server limitation: can only pass extension's own config to the extension. Cannot pass Organization cross-package. Fallback is simpler and works with existing contract. |
| Finance token publish | Gas station `POST /build-token` (sponsored) | Token publish is expensive (new package). Sponsoring reduces barrier for org leaders. |
| Faucet module | New Move module in `governance_ext` package | Time-gated distribution needs on-chain enforcement. Separate package imports original governance types. |
| New modules packaging | `governance_ext` package depends on `governance` | Preserves existing Organization/ClaimsRegistry objects. No republish of original package needed. |
| Market tier restriction | Use existing `ssu_market` contract + Periscope-side tier check | No new Move contract needed. Periscope validates tier before building TX. |
| Claims secondary index | On-chain `Table<u64, vector<ID>>` via upgrade or separate module | Enables cross-org claim lookup without event polling. Approach depends on UpgradeCap availability. |
| Alliance system | New Move module in `governance_ext` | Multi-org agreements need on-chain state to be trustless. |
| Voting system | New Move module in `governance_ext` | Proposal/vote lifecycle needs chain enforcement for integrity. |
| queryOrganization client | Migrate from SuiClient to SuiGrpcClient | SuiClient (JSON-RPC) deprecated Jul 2026. Phase 2 should use the recommended gRPC client. |

## Implementation Phases

### Phase 2a: Gate Integration

**Goal:** Org tiers control gate access via a dedicated governance gate extension.

**Key insight (Discord, Ocky, 2026-03-14):** Cycle 5 gates use a **2-step jump permit model** — the old `canJump()` is gone. Gate extensions issue jump permits via `gate::issue_jump_permit<Auth>()`, and players consume permits with `gate::jump_with_permit`. Crucially, the **dApp builds the TX** (not the game server), so it CAN pass any shared objects — including Organization — as parameters. This means a dedicated `governance::gate_ext` module that checks org tiers directly is feasible and preferred over the gate_unified sync workaround.

**Approach:** Write a `governance_ext::gate_permit` module that:
- Takes `&Organization` as a parameter in `issue_org_jump_permit()`
- Checks if the caller's address/character/tribe is in a friendly tier (stakeholder/member/serf)
- Issues a jump permit for friendly entities, denies for opposition/unknown
- Optionally charges a toll for serfs (stakeholders/members exempt)

**Fallback:** The gate_unified group-mapping approach (sync tiers → groups) remains viable if the `governance_ext` approach hits unforeseen issues.

**Steps:**

1. **Move contract: `governance_ext::gate_permit`** — New module in `contracts/governance_ext/`
   - `issue_org_jump_permit<GatePermitAuth>(gate, org, character, clock, ctx)` — checks `org::is_friendly_address()`, issues permit via `gate::issue_jump_permit<GatePermitAuth>()`
   - `authorize_org_gate<GatePermitAuth>(gate, owner_cap, ctx)` — registers this extension on a gate via `gate::authorize_extension<GatePermitAuth>()`
   - Toll support: optional SUI payment argument, checked for serfs only
   - Imports: `governance::org` (from published package `0x8bef45...578cb`) + world-contracts `gate` module
   - Move.toml dependencies: governance (published address), Sui, world-contracts (gate module only)

2. **Chain-shared TX builders** — Create:
   - `packages/chain-shared/src/gate-permit.ts` (new file):
     - `buildAuthorizeOrgGate(govExtPkgId, gateObjectId, ownerCapId)` — registers governance gate extension
     - `buildIssueOrgJumpPermit(govExtPkgId, gateObjectId, orgObjectId, characterObjectId)` — issues permit after org tier check
     - `queryGateExtensionStatus(client, gateObjectId)` — check if gate has governance extension authorized
   - `packages/chain-shared/src/index.ts` — add gate-permit export

3. **GovernanceGates view** — New view at `/governance/gates`
   - List owned gates from `useOwnedAssemblies()`
   - Per-gate: "Authorize Governance Extension" button → calls `buildAuthorizeOrgGate()`
   - Status indicator: authorized / not authorized
   - Mode config: toll amount for serfs (0 = free for all friendlies)
   - Periscope also needs a "Request Jump Permit" UI that travelers use at gates (calls `buildIssueOrgJumpPermit()`)

4. **Sidebar + Router** — Add "Gates" nav item under Governance group (icon: `DoorOpen`)

5. **Gate_unified TX builders** — Still useful for non-governance gate management:
   - `packages/chain-shared/src/gate-unified.ts` (new file):
     - `buildCreateGroup(packageId, configObjectId, name, tribes, characters)`
     - `buildUpdateGroup(packageId, configObjectId, groupId, name, tribes, characters)`
     - `buildSetGateConfig(packageId, configObjectId, gateId, isAllowlist, accessGroupIds, permitDurationMs, tollFee, tollRecipient, tollExemptGroupIds)`
     - `queryGateConfig(client, configObjectId, gateId)`
   - `packages/chain-shared/src/index.ts` — add gate-unified export

**Dependencies:** Requires `governance_ext` package (see Open Question #3 re: republish strategy). Also requires world-contracts gate module as a dependency.

### Phase 2b: Finance Expansion

**Goal:** Full token lifecycle, faucet distribution, and org treasury management.

> **NOTE (2026-03-15):** Steps 1-4 below have been **implemented by Plan 06**. Gas station `/build-token` endpoint is coded, GovernanceFinance is wired to chain with gas station + import mode, OrgTreasury shared object pattern is in `governance_ext/treasury.move`. Gas station is now optional (CLI token creation via `scripts/create-token.sh`). Remaining items in this phase: faucet module and dues/taxes.

**Steps:**

1. ~~**Gas station `POST /build-token`**~~ — **DONE (Plan 06)**. `apps/gas-station/src/buildToken.ts` (194 lines), route registered in index.ts.

2. ~~**Wire GovernanceFinance to chain**~~ — **DONE (Plan 06)**. GovernanceFinance (1330 lines) has gas station integration + import mode + OrgTreasury deposit + mint/burn UI.

3. **Faucet module** — New Move contract in a `governance_ext` package
   - Depends on original `governance` package (imports `governance::org::Organization`)
   - `FaucetPool` shared object: `{ org_id: ID, coin_type, amount_per_claim, cooldown_ms, balance, last_claim: Table<address, u64> }`
   - `create_faucet(org, amount_per_claim, cooldown_ms, coins, ctx)` — stakeholder creates faucet
   - `claim_faucet(faucet, org, clock, ctx)` — tier check (stakeholder/member/serf only via `org::is_friendly_*`), cooldown check, transfer coins
   - `fund_faucet(faucet, org, coins, ctx)` — stakeholder deposits coins into faucet balance
   - Separate package avoids republish of original governance contract
   - Files: `contracts/governance_ext/sources/faucet.move` (new), `contracts/governance_ext/Move.toml` (new)

4. **Treasury view** — Balance display for each currency
   - Query TreasuryCap balance, show total minted / total burned
   - Mint-to and burn-from controls (stakeholder only)
   - File: Expand `GovernanceFinance.tsx` or split into `GovernanceTreasury.tsx`

5. **Dues/taxes** (stretch) — Automated collection
   - Org sets a periodic due amount per serf
   - Serfs manually pay (no auto-deduct — Sui doesn't support scheduled TXs)
   - Track payment status in `db.currencies` or new `db.orgDues` table
   - Move module: `governance_ext::dues` with `set_dues()`, `pay_dues()`, `check_overdue()`
   - File: `contracts/governance_ext/sources/dues.move` (new)

**Dependencies:**
- Template bytecodes for token-factory (currently placeholder in `token-factory.ts`) must be extracted from compiled `contracts/token_template/`
- Faucet and dues modules go in the `governance_ext` package (depends on original `governance` package)

### Phase 2c: Trade

**Goal:** Tier-restricted SSU markets where org members trade at preferential rates.

> **NOTE (2026-03-15):** Steps 1-2 below have been **implemented by Plan 06**. GovernanceTrade view (1467 lines) is at `/governance/trade` with sell orders + buy orders tabs. ssu-market.ts has 10 new functions (OrgMarket, buy orders, stock_items, buy_and_withdraw). SSU Market Move contract v2 is written but NOT upgraded on-chain. Remaining: tier-restricted pricing (Periscope-side tier check), exchange integration.

**Steps:**

1. ~~**GovernanceTrade view**~~ — **DONE (Plan 06)**. `apps/periscope/src/views/GovernanceTrade.tsx` (1467 lines), route + sidebar added.

2. ~~**Tier-restricted market basics**~~ — **PARTIALLY DONE (Plan 06)**. `ssu-market.ts` extended with OrgMarket/buy order builders. OrgMarket contract code written. Remaining: Periscope-side tier check for preferential pricing not yet implemented.

3. **Exchange integration** — Org currency pairs
   - Create trading pairs between org currencies and SUI
   - Use existing `exchange` contract (`buildCreatePair`, `buildPlaceBid`, `buildPlaceAsk`)
   - GovernanceTrade view includes exchange order book section
   - File: Extend GovernanceTrade view

4. ~~**Sidebar + Router**~~ — **DONE (Plan 06)**. Trade nav item added to sidebar (ShoppingBag icon), `/governance/trade` route added to router.

**Dependencies:** None. Uses existing ssu_market and exchange contracts.

### Phase 2d: Claims Improvements

**Goal:** Better claim querying, automatic weight calculation, and P2P sync.

**Steps:**

1. **Secondary on-chain index** — Add `system_index: Table<u64, vector<ID>>` to ClaimsRegistry
   - Maps `system_id` to list of org IDs that claim it
   - Enables `get_claimants(registry, system_id)` query without event polling
   - **If UpgradeCap exists:** Use `sui client upgrade` to modify `claims.move` in-place, preserving existing ClaimsRegistry object
   - **If no UpgradeCap:** Create `governance_ext::claims_index` module with a separate `ClaimsIndex` shared object that mirrors the registry. Periscope maintains it via events.
   - File: `contracts/governance/sources/claims.move` (modify via upgrade) OR `contracts/governance_ext/sources/claims_index.move` (new)

2. **Weight automation** — Calculate claim weight from on-chain assembly data
   - Query assemblies in the claimed system (turrets, gates, SSUs)
   - Weight formula: base + (turret_count * turret_weight) + (gate_count * gate_weight) + ...
   - Auto-update weight when assemblies change (detected via Radar events)
   - File: `packages/chain-shared/src/governance.ts` (new `calculateClaimWeight()`)
   - File: `apps/periscope/src/views/GovernanceClaims.tsx` (auto-weight toggle)

3. **P2P sync for claims** — Sync claim data between Periscope instances
   - Claims table already has `_hlc`, `_deleted`, `_origin` fields (SyncMeta)
   - Add claims to P2P sync sharing groups
   - Cross-org claim visibility: when receiving claims from peers, mark as "external"
   - File: Extend P2P sync config in `apps/periscope/src/views/PeerSync.tsx`

4. **Org discovery** — Non-creators can find orgs they belong to
   - Poll `OrgCreatedEvent` and `TierChangedEvent` from chain
   - If current wallet address appears in any tier, auto-import that org
   - File: `packages/chain-shared/src/governance.ts` (new `queryOrgEvents()`)
   - File: `apps/periscope/src/views/GovernanceDashboard.tsx` (discovery UI)

**Dependencies:** Step 1 requires either UpgradeCap (for in-place upgrade) or a separate claims_index module in governance_ext. Step 3 depends on P2P sync layer maturity.

### Phase 2e: Alliance & Voting

**Goal:** Multi-org agreements and stakeholder governance.

**Steps:**

1. **Alliance module** — New Move contract `governance_ext::alliance`
   ```
   AllianceRegistry (shared)
   Alliance { id, name, member_orgs: vector<ID>, created_at, status }
   AllianceInvite { alliance_id, org_id, invited_by, status }
   ```
   - `create_alliance(registry, org, name, clock, ctx)` — stakeholder of founding org
   - `invite_org(registry, alliance, inviting_org, target_org_id, ctx)` — any alliance member stakeholder
   - `accept_invite(registry, invite, org, ctx)` — target org stakeholder
   - `leave_alliance(registry, alliance, org, ctx)` — any member org stakeholder
   - Events: `AllianceCreatedEvent`, `OrgJoinedAllianceEvent`, `OrgLeftAllianceEvent`
   - File: `contracts/governance_ext/sources/alliance.move` (new)

2. **Voting module** — New Move contract `governance_ext::voting`
   ```
   Proposal { id, org_id, title, description, created_by, created_at, expires_at, status }
   Vote { proposal_id, voter: address, choice: u8, voted_at }
   ```
   - `create_proposal(org, title, description, duration_ms, clock, ctx)` — stakeholder only
   - `cast_vote(org, proposal_id, choice, clock, ctx)` — any stakeholder
   - `finalize_proposal(org, proposal_id, clock, ctx)` — after expiry, tallies votes
   - Quorum: configurable per org (e.g., >50% of stakeholder addresses must vote)
   - File: `contracts/governance_ext/sources/voting.move` (new)

3. **Alliance view** — New view at `/governance/alliances`
   - Create alliance, invite orgs, accept/reject invites
   - Alliance member list with org names
   - File: `apps/periscope/src/views/GovernanceAlliances.tsx` (new)

4. **Voting view** — New view at `/governance/voting`
   - Create proposals, cast votes, view results
   - Active/expired/passed/failed tabs
   - File: `apps/periscope/src/views/GovernanceVoting.tsx` (new)

5. **DB schema V14** — New tables for alliance + voting local cache (V13 already taken by Plan 06)
   - `alliances`, `allianceMembers`, `proposals`, `votes`
   - File: `apps/periscope/src/db/index.ts` (version bump)

6. **Sidebar + Router** — Add "Alliances" and "Voting" nav items. Reorganize Governance section.

**Dependencies:** All new Move modules go in `governance_ext` package (separate from original governance). Voting quorum design needs stakeholder discussion.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/governance_ext/Move.toml` | CREATE | Package manifest, depends on governance + sui-framework |
| `contracts/governance_ext/sources/faucet.move` | CREATE | Time-gated currency faucet module |
| `contracts/governance_ext/sources/alliance.move` | CREATE | Multi-org alliance registry |
| `contracts/governance_ext/sources/voting.move` | CREATE | Stakeholder proposal/voting |
| `contracts/governance_ext/sources/dues.move` | CREATE | Periodic dues/tax collection (stretch) |
| `contracts/governance/sources/claims.move` | MODIFY | Add secondary index (if UpgradeCap available) |
| `contracts/governance_ext/sources/claims_index.move` | CREATE | Alternative claims index (if no UpgradeCap) |
| `packages/chain-shared/src/gate-unified.ts` | CREATE | TX builders + queries for gate_unified config/groups |
| `packages/chain-shared/src/governance.ts` | MODIFY | Add gate sync helpers, org discovery, claim weight calc |
| `packages/chain-shared/src/index.ts` | MODIFY | Add gate-unified export |
| `packages/chain-shared/src/token-factory.ts` | MODIFY | Extract and embed actual template bytecodes |
| `packages/chain-shared/src/types.ts` | MODIFY | Add Alliance, Proposal, Vote, FaucetConfig types |
| `packages/chain-shared/src/config.ts` | MODIFY | Update governance packageId after republish |
| `apps/gas-station/src/index.ts` | ~~MODIFY~~ DONE | POST /build-token endpoint added (Plan 06) |
| `apps/gas-station/src/buildToken.ts` | ~~CREATE~~ DONE | Token build+publish handler created (Plan 06) |
| `apps/periscope/src/views/GovernanceGates.tsx` | CREATE | Gate access control tied to org tiers |
| `apps/periscope/src/views/GovernanceTrade.tsx` | ~~CREATE~~ DONE | Sell + buy orders tabs created (Plan 06). Remaining: tier pricing, exchange integration |
| `apps/periscope/src/views/GovernanceAlliances.tsx` | CREATE | Alliance management |
| `apps/periscope/src/views/GovernanceVoting.tsx` | CREATE | Proposal creation and voting |
| `apps/periscope/src/views/GovernanceFinance.tsx` | ~~MODIFY~~ DONE | Wired to gas station + import mode, mint/burn, OrgTreasury (Plan 06) |
| `apps/periscope/src/views/GovernanceClaims.tsx` | MODIFY | Auto-weight, org discovery, P2P sync toggle |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | MODIFY | Org discovery for non-creators |
| `apps/periscope/src/db/index.ts` | MODIFY | V14 schema: alliances, proposals, votes, orgDues (V13 taken by Plan 06) |
| `apps/periscope/src/db/types.ts` | MODIFY | Add AllianceRecord, ProposalRecord, VoteRecord, OrgDuesRecord |
| `apps/periscope/src/router.tsx` | MODIFY | Add /governance/gates, /governance/alliances, /governance/voting routes (/governance/trade already added — Plan 06) |
| `apps/periscope/src/components/Sidebar.tsx` | MODIFY | Add Gates, Alliances, Voting nav items (Trade already added — Plan 06) |
| `packages/shared/src/schemas/governance.ts` | MODIFY | Add alliance, proposal, vote Zod schemas |

## Open Questions

1. **~~Gate parameter passing~~** — RESOLVED (2026-03-14, Builder Chat Discord). Gates use a 2-step jump permit model where the **dApp builds the TX**, not the game server. This means the dApp CAN pass Organization as a parameter to a custom gate extension. Phase 2a has been updated to use a dedicated `governance_ext::gate_permit` module as the primary approach. The gate_unified sync approach is retained as a fallback.

2. **Token template bytecodes** — The `token-factory.ts` currently has a placeholder for compiled bytecodes. These must be extracted from a compiled `contracts/token_template/` build. **Status:** Blocked until template is compiled and bytecodes embedded. **Recommendation:** Compile token_template, extract base64 bytecodes, embed in `token-factory.ts` as a prerequisite to Phase 2b.

3. **Governance package republish strategy** — Phases 2b (faucet module), 2d (claims index), and 2e (alliance + voting) all require new modules. Move packages are immutable on Sui — adding modules means publishing a completely new package. **Critical constraint:** New modules in a new package cannot access existing Organization/ClaimsRegistry objects created by the old package, because they are typed to the old package ID. New modules must either: (A) take Organization as a generic `&UID` parameter and verify type manually, (B) be published as a separate package that imports the original governance package as a dependency (using `governance = "0x8bef45b3..."` in Move.toml), or (C) accept the original package's types as read-only references. **Recommendation:** Option B — publish new modules (faucet, alliance, voting) as a `governance_ext` package that depends on the original `governance` package. This lets new modules reference `governance::org::Organization` directly. The original package's address goes into the new package's Move.toml. Claims secondary index (Phase 2d) is the exception: it modifies `claims.move`, so it requires the Sui upgrade mechanism (`sui client upgrade`) if the original package was published with an UpgradeCap, OR a new `governance_claims_v2` package. **Open:** Verify if the original publish retained the UpgradeCap or transferred/destroyed it.

4. **Voting quorum design** — What quorum rules should proposals use? Options: (A) Simple majority of stakeholder addresses who voted, (B) Majority of all stakeholder addresses (abstention = no), (C) Configurable per-org threshold. **Note:** The original `org.move` does not expose `&mut UID` access, so governance_ext cannot add dynamic fields to Organization objects. Quorum config must be stored in a separate `VotingConfig` shared object owned by the voting module. **Recommendation:** Option C — `governance_ext::voting` creates a `VotingConfig { org_id, quorum_threshold, ... }` shared object per org. Default to 50% of stakeholders who voted (Option A semantics).

5. **Dues enforcement** — Sui has no scheduled transactions. Dues must be manually paid or triggered by another action. Options: (A) Manual pay button in Finance view, (B) Auto-deduct when serf interacts with org gate/market (adds overhead to every TX), (C) Grace period + stakeholder-triggered "check overdue" that moves delinquent serfs to opposition. **Recommendation:** Option C — gives serfs time to pay, stakeholders can enforce.

6. **SuiGrpcClient migration** — `queryOrganization()` in governance.ts currently uses `SuiClient` (JSON-RPC), deprecated Jul 2026. Should Phase 2 migrate all governance queries to SuiGrpcClient? **Recommendation:** Yes. The `packages/sui-client` wrapper already provides `createSuiClient()` which returns a gRPC-capable client. Migrate `queryOrganization()` and `queryClaimEvents()` to use `SuiGrpcClient`.

7. **UpgradeCap for governance package** — Did the original `sui client publish` of the governance package retain the UpgradeCap, or was it transferred/destroyed? If retained by the deployer (`0xa4dee9...883d`), the package can be upgraded in-place using `sui client upgrade`, preserving the same package ID and allowing claims.move modifications. If the UpgradeCap was destroyed or lost, the package is permanently immutable and new modules must be in a separate package. **Status:** Check deploy wallet for UpgradeCap ownership. **Recommendation:** If UpgradeCap exists, use `sui client upgrade` for claims.move changes (Phase 2d). Either way, new modules (faucet, alliance, voting) should be in a separate `governance_ext` package for cleaner separation.

## Deferred (Beyond Phase 2)

- **Phase 3: On-chain governance discovery** — Public org registry, org profile pages, searchable org directory. Requires CCP support for indexer access or a custom indexer.
- **Tier exclusivity optimization** — Replace O(n) vector scan with reverse-index dynamic fields for O(1) lookups. Only matters at scale (hundreds of entities per tier).
- **Cross-org diplomacy** — Standing (friendly/neutral/hostile) between non-allied orgs. Reputation system.
- **Automated org turret refresh** — When tier membership changes, automatically rebuild and republish turret packages. Requires gas station batch processing.
- **Mobile notifications** — Push notifications for org events (new members, claims contested, proposals pending).
- **Org analytics dashboard** — Treasury inflows/outflows, member activity, claim map overlay.

---

## Priority Order

For post-hackathon work, the recommended execution order is:

1. **Phase 2a (Gates)** — Highest user value, no new contracts needed, builds on existing gate_unified
2. **Phase 2b (Finance)** — Token publish is the most requested feature after gates
3. **Phase 2d (Claims)** — Improvements to existing feature, some require republish
4. **Phase 2c (Trade)** — Builds on finance (need tokens first)
5. **Phase 2e (Alliance/Voting)** — Lowest priority, most complex, requires the batched republish
