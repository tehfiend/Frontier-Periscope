# Plan: Market & Currency System

**Status:** COMPLETE — All phases implemented and contracts deployed
**Created:** 2026-03-14
**Updated:** 2026-03-17 (plan review: all code + contracts deployed, plan archived)
**Module:** multi (contracts, chain-shared, periscope, gas-station)

## Overview

This plan covers the end-to-end implementation of a **closed-loop org economy** for TehFrontier governance organizations. The core design principle is that currency never escapes the org ecosystem: the org mints tokens, distributes them to players through buy orders and bounties, and recaptures them through sell orders and (eventually) dues.

Three on-chain systems power this loop: (1) **OrgTreasury** — a new `governance_ext` Move package that wraps `TreasuryCap<T>` in a shared object, allowing any org stakeholder to mint without personally holding the cap; (2) **Bidirectional SSU Market** — an upgrade to the deployed `ssu_market` contract that adds buy orders (org posts "we buy X for Y tokens") alongside the existing sell orders, plus an atomic `buy_and_withdraw<T>()` function; and (3) **Bounty Board** — the already-deployed `bounty_board` contract (`0xf55f78...b4bf`) which already accepts generic `Coin<T>` for bounty escrow, requiring no contract changes.

The economy loop is: **Faucets** (currency enters player hands) — buy orders let players sell resources to the org for org tokens, and bounties let hunters earn org tokens for kills. **Sinks** (currency returns to org) — sell orders on SSU markets price goods in org tokens, and the org recycles received tokens back into buy orders. There is no separate treasury wallet — the `OrgTreasury` shared object holds the `TreasuryCap`, market escrow on `MarketConfig` IS the working capital, and minted coins flow through `OrgTreasury → buy order escrow → players → sell orders → org admin address → recycled into buy orders`.

## Current State

### Token Factory — Partially Built

- **Move contract:** `contracts/token_template/sources/token.move` — compiled and published at `0x38e749bfd487ca48633df45126820e23eddfbba8e0fc391f0f7a748dcb665ccf`. Contains `init()` (creates TreasuryCap + CoinMetadata), `mint<T>()`, and `burn<T>()`.
- **TX builders:** `packages/chain-shared/src/token-factory.ts` — `buildPublishToken()`, `buildMintTokens()`, `buildBurnTokens()`, plus bytecode patching utilities. **Critical gap:** `TEMPLATE_BYTECODES` is `null` — not functional until bytecodes are embedded.
- **Types:** `packages/chain-shared/src/types.ts` (lines 81-91) — `TokenInfo` interface.
- **Config:** `packages/chain-shared/src/config.ts` (line 21) — `tokenTemplate.packageId` is set.

### GovernanceFinance UI — Local-Only

- **View:** `apps/periscope/src/views/GovernanceFinance.tsx` — Currency creation form that stores records **locally only** in IndexedDB. Phase 1 banner says "Gas station sponsorship for token publish coming in Phase 2."
- **DB schema:** V12 with `currencies` table.
- **Current behavior:** `handleCreateCurrency()` creates a local CurrencyRecord with empty `coinType`, `packageId`, `treasuryCapId`.

### SSU Market — Contract Deployed, No UI

- **Move contract:** `contracts/ssu_market/sources/ssu_market.move` — Published at `0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885`. Functions: `create_market()`, `set_listing()`, `buy_item<T>()`. **Sell-only** — no buy orders. `buy_item<T>()` handles payment but does NOT atomically withdraw items from SSU.
- **TX builders:** `packages/chain-shared/src/ssu-market.ts` — `buildCreateMarket()`, `buildSetListing()`, `buildBuyItem()`, `queryMarketConfig()`, `queryListing()`.
- **No UI exists.** No GovernanceTrade view.

### Governance — Contract Deployed

- **Move contract:** `contracts/governance/sources/org.move` — Published at `0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb`. Key function: `is_stakeholder_address(org: &Organization, addr: address): bool`.
- **Move.toml:** `contracts/governance/Move.toml` — edition 2024, Sui framework dep, `governance = "0x0"`.

### Bounty Board — Contract Deployed

- **Move contract:** `contracts/bounty_board/sources/bounty_board.move` — Published at `0xf55f7830828c66d6402add527e9e4ff9190aaae52bbb7ab723d24f455021b4bf`. Generic over `Coin<T>` — already works with org tokens. `post_bounty<T>()`, `claim_bounty<T>()`, `cancel_bounty<T>()`.
- **Board object:** `0x38725e050f5872d381407dd0d97117b66daae4202e21bf2a0bbd743fca3a3a86`.

### Gas Station — Build Pipeline Ready

- **Server:** `apps/gas-station/src/index.ts` — Express on port 3100.
- **Build pipeline:** `apps/gas-station/src/buildTurret.ts` — Pattern: generate source → write temp dir → `sui move build` → `sui client publish --json` → parse `objectChanges` → cleanup.
- **Sponsor:** `apps/gas-station/src/sponsor.ts` — Validates transaction targets against allowed package ID whitelist.
- **Config:** `apps/gas-station/src/config.ts` — `getAllowedPackageIds()` collects static package IDs from `CONTRACT_ADDRESSES`. No dynamic registration.

> **NOTE:** The "Current State" section above describes the state BEFORE Plan 06 execution. See "Implementation Status (2026-03-17)" below for the final delivered state.

## Implementation Status (2026-03-17)

All code across all 3 phases has been written, committed, and deployed on-chain. The plan is **COMPLETE**.

### Phase 1: Token Lifecycle + OrgTreasury — COMPLETE + DEPLOYED
| Deliverable | File | Status |
|-------------|------|--------|
| Treasury Move contract | `contracts/governance_ext/sources/treasury.move` | Published at `0x670b8491481ab8f88a47f708918c83a6ba17427861d7d8a82e2a513176bec349` (v1) |
| Treasury TX builders | `packages/chain-shared/src/treasury.ts` (268 lines) | Complete |
| Gas station `/build-token` | `apps/gas-station/src/buildToken.ts` (194 lines) | Complete |
| Gas station route | `apps/gas-station/src/index.ts` (line 74) | Registered |
| Dynamic sponsor whitelist | `apps/gas-station/src/config.ts` | Complete (EXTRA_ALLOWED_PACKAGES + published-tokens.json) |
| GovernanceFinance overhaul | `apps/periscope/src/views/GovernanceFinance.tsx` (1310 lines) | Complete (gas station + import mode) |
| DB V13 migration | `apps/periscope/src/db/index.ts` | Complete (description, moduleName, orgTreasuryId) |
| DB types update | `apps/periscope/src/db/types.ts` | Complete |
| Zod schemas | `packages/shared/src/schemas/trading.ts` | Complete (buildTokenRequest/Response) |
| Chain-shared exports | `packages/chain-shared/src/index.ts` | Complete (treasury export added) |
| Types | `packages/chain-shared/src/types.ts` | Complete (OrgMarketInfo, BuyOrderInfo, governanceExt, originalPackageId) |
| Config | `packages/chain-shared/src/config.ts` | governanceExt.packageId populated for both tenants |

### Phase 2: Bidirectional SSU Market — COMPLETE + DEPLOYED (v3)
| Deliverable | File | Status |
|-------------|------|--------|
| SSU Market upgrade (Move) | `contracts/ssu_market/sources/ssu_market.move` (650 lines) | Upgraded to v3 at `0xeca760fe766302433fcc4c538d95f1f8960e863e5b789c63011dae18a20723d4` (original `0xdb9df1...`) |
| SSU Market Move.toml | `contracts/ssu_market/Move.toml` | In upgrade mode (published-at, governance dep) |
| SSU Market TX builders | `packages/chain-shared/src/ssu-market.ts` (637 lines) | Complete (OrgMarket, buy orders, v3 SellOrder functions) |
| GovernanceTrade view | `apps/periscope/src/views/GovernanceTrade.tsx` (2053 lines) | Complete (updated to v3 SellOrder model) |
| Router | `apps/periscope/src/router.tsx` | /governance/trade route added |
| Sidebar | `apps/periscope/src/components/Sidebar.tsx` | Trade nav item added |
| Dashboard | `apps/periscope/src/views/GovernanceDashboard.tsx` | Trade quick action added |

### Phase 3: Integration — COMPLETE
| Deliverable | Status |
|-------------|--------|
| GovernanceFinance gas station integration | Complete |
| GovernanceFinance OrgTreasury deposit/mint/burn UI | Complete |
| GovernanceFinance import mode (manual token import) | Complete |
| Token query helpers (queryTokenSupply, queryOwnedCoins) | Complete in `packages/chain-shared/src/token-factory.ts` |
| OrgTreasury/OrgMarket query helpers | Complete in treasury.ts / ssu-market.ts |
| Config updates (governanceExt packageId) | Populated for both stillness and utopia tenants |

### Deployment Blockers — ALL RESOLVED
1. ~~`governance_ext` NOT published~~ -- Published at `0x670b84...` (commit `8cce47d`). UpgradeCap: `0x3d7d55...`
2. ~~`ssu_market` NOT upgraded on-chain~~ -- Upgraded to v3 at `0xeca760...`. OrgMarket/buy-order functions and v3 escrow-based SellOrder model all live on-chain.
3. ~~Gas station NOT tested E2E~~ -- `/build-token` endpoint functional. In-browser bytecode patching also added as fallback.

### Additional Artifacts (not in original plan)
- `scripts/create-token.sh` (151 lines) — CLI alternative to gas station for token creation
- `scripts/upgrade-contract.sh` (124 lines) — Reusable contract upgrade helper
- Gas station is now **optional** — GovernanceFinance supports "Import Token" mode for tokens created via CLI or other means
- **ssu_market v3 evolution** — The original plan specified `stock_items` + `buy_and_withdraw` for sell-side atomic operations. These have been superseded by an escrow-based `SellOrder` model: `create_sell_order` (atomically escrows items), `cancel_sell_order` (returns items), `buy_sell_order` (buyer pays + receives items). The old functions are kept as deprecated for upgrade compatibility.
- **`apps/ssu-market-dapp/`** — Separate standalone dApp for SSU market interaction (plan 12), built on top of the contract infrastructure from this plan.
- **`governance_ext/Move.toml` still has `governance_ext = "0x0"`** — Should be switched to upgrade mode (`0x670b84...`) with `published-at` field before any future upgrade. Not a blocker since no upgrade is currently planned.
- Multiple post-implementation wallet integration fixes (EVE Vault, auto-connect, bytecode patching fallback)

## Target State

After implementation:

1. **OrgTreasury** — `governance_ext::treasury` contract provides a shared `OrgTreasury` object that wraps `TreasuryCap<T>`. Any org stakeholder can mint by calling `treasury::mint<T>()` which checks `governance::org::is_stakeholder_address()`. The TreasuryCap is transferred into OrgTreasury once (irreversible).

2. **Token Publish via Gas Station** — Stakeholders click "Create Currency" in GovernanceFinance, the gas station builds and publishes a custom Coin<T> package, then the stakeholder transfers TreasuryCap into OrgTreasury. Currency lifecycle: create → publish → deposit TreasuryCap → mint/burn.

3. **SSU Market (Sell Orders)** — Upgraded `ssu_market` adds atomic `buy_and_withdraw<T>()` for sell-side purchases. Sell orders remain per-SSU on `MarketConfig` (items are physically in that SSU).

4. **OrgMarket (Buy Orders)** — New `OrgMarket` shared object in the `ssu_market` upgrade, scoped per-org. Buy orders specify what the org wants to purchase and which SSU to deliver to. Due to the SSU item binding constraint (items have `parent_id` locked to their originating SSU — see "SSU Item Binding Constraint" below), players deposit items into the target SSU via game mechanics, then a stakeholder calls `confirm_buy_order_fill` to release payment. Authorized SSUs are tracked on OrgMarket for discovery and governance.

5. **PTB-Composed Economic Actions** — TypeScript PTBs compose treasury minting with market operations. "Fund buy order" mints fresh coins and escrows them on `OrgMarket` in one TX. "Buy from market" pays coins and gets items atomically (withdraw from the same SSU). "Confirm fill" releases escrowed coins to the seller after stakeholder verifies delivery.

6. **Bounty Integration** — "Fund bounty" PTB mints from OrgTreasury and posts a bounty on the bounty board in one TX. No bounty_board contract changes needed.

### New Data Models

Existing `currencies` table (V12) extended in V13 with `description` and `moduleName` fields. Add `orgTreasuryId` field (V13) to track the OrgTreasury shared object ID per currency.

No new DB tables. Market config and OrgTreasury objects are on-chain, queried at runtime.

### New Endpoints

| Endpoint | Location | Description |
|----------|----------|-------------|
| `POST /build-token` | `apps/gas-station/src/index.ts` | Accept `{ symbol, name, description, decimals, senderAddress }`, build + publish token, return `{ packageId, coinType, treasuryCapId }` |

### New/Modified Views

| View | Action | Description |
|------|--------|-------------|
| `GovernanceFinance.tsx` | MODIFY | Wire to `/build-token`, add mint/burn UI, OrgTreasury deposit, treasury overview |
| `GovernanceTrade.tsx` | CREATE | SSU market management + buyer flow + buy orders |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Treasury model | Shared OrgTreasury wrapping TreasuryCap (Approach 2) | No single person holds the minting power. Any stakeholder can mint via the shared object. One-time irreversible deposit ensures no one can extract the TreasuryCap. |
| Treasury contract location | New `governance_ext` package with `treasury.move` | Cannot modify the deployed `governance` package (different concern). `governance_ext` depends on `governance` to call `is_stakeholder_address()`. |
| Sell orders | Per-SSU on `MarketConfig` (existing pattern) | Items are physically in the SSU. Listings are tied to a specific depot. Unchanged from current design. |
| Buy orders | Per-org `OrgMarket` with per-SSU buy orders | `OrgMarket` is org-level (one per org), but buy orders are bound to specific SSUs due to the item binding constraint. `authorized_ssus` tracks which SSUs participate. Players deposit items to the specified SSU via game client, then stakeholder calls `confirm_buy_order_fill` to release payment. |
| Buy order architecture | New `OrgMarket` shared object in `ssu_market` upgrade | `OrgMarket { org_id, admin, authorized_ssus: vector<ID>, next_order_id }`. Stakeholders manage which SSUs have buy orders. Buy orders stored as dynamic fields, each tagged with a target SSU. |
| Atomic item transfer | `buy_and_withdraw<T>()` for sell orders | Only the `ssu_market` package can construct `MarketAuth {}`. Handles payment + SSU withdrawal atomically. |
| SSU extension constraint | One extension per SSU (`MarketAuth`) | All market functions go through `ssu_market` so they can construct `MarketAuth`. Both sell orders and buy order fills use the same `MarketAuth` witness. |
| Buy order fill model | Deposit-then-confirm (stakeholder confirmed) | SSU items have `parent_id` locked to their originating SSU (world-contracts v0.0.18 enforces `parent_id == storage_unit_id` on ALL deposit functions). Items cannot be programmatically moved between SSUs. Players deposit items to the target SSU via game client, stakeholder confirms receipt via `confirm_buy_order_fill` to release payment. See "SSU Item Binding Constraint" section. |
| No separate treasury wallet | TreasuryCap in OrgTreasury shared object | Market escrow IS the working capital. Minted coins flow: `OrgTreasury → buy order escrow on OrgMarket → players → sell orders → admin → recycled`. |
| Token publish flow | Gas station builds + publishes (user gets TreasuryCap) | Publishing costs ~0.5 SUI gas. Gas station removes barrier. TreasuryCap transferred to sender address via hardcoded `@{SENDER}` in `init()`. |
| Token build approach | `sui move build` + `sui client publish` in gas station | Generating Move source with string substitution is simpler and more reliable than bytecode patching. Proven pattern from turret builds. |
| Exchange contract | Deferred entirely | Exchange has no `match_orders()` — pure escrow only. Not useful until upgraded. Focus on direct org economy loop (treasury + market + bounties). |
| Dynamic sponsor whitelist | `EXTRA_ALLOWED_PACKAGES` env var + `published-tokens.json` | Newly published token packages need sponsorship. Env var is sufficient for hackathon; JSON file survives restarts. |
| Economy faucets | Buy orders + bounties | Buy orders: org posts buy orders funded by OrgTreasury mint, players sell resources for org currency. Bounties: org funds kill bounties with org currency. |
| Economy sinks | Sell orders (+ dues in Phase 2) | Org lists goods on SSU market priced in org currency. Dues/taxes deferred. |
| Buy order governance check | `create_buy_order` takes `&OrgMarket` + `&Organization`, checks stakeholder | Prevents non-stakeholders from creating buy orders. Enforced on-chain. |
| Multi-SSU delivery | `OrgMarket.authorized_ssus: vector<ID>` | Stakeholders add/remove SSUs. Buy orders specify target SSU for player discovery. Players choose closest depot. |
| DB schema change | V13 bump for `description`, `moduleName`, `orgTreasuryId` | Minimal schema change. All new fields needed for treasury lifecycle. |

## SSU Item Binding Constraint

> **CRITICAL CONSTRAINT (verified 2026-03-15):** All `deposit_item`, `deposit_to_open_inventory`, `deposit_to_owned`, and `deposit_by_owner` functions in `world::storage_unit` (v0.0.18) assert `inventory::parent_id(&item) == storage_unit_id`. Items are permanently bound to their parent SSU and cannot be programmatically transferred between SSUs.

**Impact on buy orders:** The original design assumed players could withdraw items from their SSU and deposit them to an org SSU in one PTB. This is impossible. The revised design uses a **deposit-then-claim** model:

1. Player flies to the org's market SSU in the game client
2. Player deposits items to the SSU via the game client (normal game mechanics, goes to owner inventory or open inventory)
3. A stakeholder calls `confirm_buy_order_fill` to release payment (hackathon model). Post-hackathon, automated verification could check extension/open inventory and pay the seller.

**Open question for implementation:** Which SSU inventory do items deposited via the game client land in? If they go to the owner inventory (not the extension inventory), an automated fill function cannot access them. This needs verification on the live testnet. The game client may use `deposit_by_owner` (requires OwnerCap) or a server-side deposit path. If items land in the open inventory, `withdraw_from_open_inventory<MarketAuth>()` would work for automated fills. If they land in the owner inventory, the SSU owner (org admin) would need to manually move items for automated fills. For the hackathon, the manual `confirm_buy_order_fill` model sidesteps this entirely.

**Alternative considered:** Per-SSU buy orders where the market extension watches the extension inventory for deposits and auto-pays. This would require the player to call `deposit_item<MarketAuth>()` directly, which requires the Item to already have `parent_id` matching that SSU -- meaning the item was previously in that SSU. This only works for items that originated from that SSU. New items crafted or traded would need a different path.

**Recommendation:** For the hackathon, implement buy orders as **coin escrow + manual confirmation**: the org posts a buy order (escrows coins), players deliver items physically, then a stakeholder confirms receipt and releases payment. This avoids the inventory access complexity entirely. The fully automated fill can be implemented post-hackathon once the item flow is tested on live testnet.

## Implementation Phases

### Phase 1: Token Lifecycle + OrgTreasury

**Goal:** Org stakeholders can create, publish, and deposit TreasuryCap into OrgTreasury. Any stakeholder can mint/burn via the shared treasury. Gas station sponsors the publish.

#### Step 1.1: `governance_ext` Treasury Contract

Create a new Move package that wraps `TreasuryCap<T>` in a shared object with governance-gated minting.

**File:** `contracts/governance_ext/Move.toml` (CREATE)

> Note: `edition = "2024"` is correct — all existing contracts use this edition (not `"2024.beta"` despite CLAUDE.md). The Sui framework rev must match what was used for the governance package publish (`testnet-v1.66.2` resolves to the same commit as in governance's Move.lock).

```toml
[package]
name = "governance_ext"
edition = "2024"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.66.2" }
governance = { local = "../governance" }

[addresses]
governance_ext = "0x0"
governance = "0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb"
```

> **Dependency note:** `governance = { local = "../governance" }` in `[dependencies]` gives the Move compiler access to the governance source code for type checking (`Organization`, `is_stakeholder_address`). The `governance = "0x8bef..."` in `[addresses]` overrides the `governance = "0x0"` from governance's own Move.toml, linking to the published on-chain package. Both entries are required.

**Post-deploy:** After publishing, a `Published.toml` will be auto-generated (similar to `contracts/governance/Published.toml`). Record the UpgradeCap ID for future upgrades. Add `governanceExt.packageId` to `CONTRACT_ADDRESSES` in `packages/chain-shared/src/config.ts`.

**File:** `contracts/governance_ext/sources/treasury.move` (CREATE)

```move
/// OrgTreasury: shared-object wrapper around TreasuryCap<T>.
///
/// Once deposited, the TreasuryCap cannot be extracted. Any org stakeholder
/// can mint by calling treasury functions, which check governance::org::is_stakeholder_address().
module governance_ext::treasury;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::event;
use governance::org::Organization;

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const ENotStakeholder: vector<u8> = b"Only org stakeholders can use the treasury";

#[error(code = 1)]
const EOrgMismatch: vector<u8> = b"Organization does not match this treasury";

// ── Structs ────────────────────────────────────────────────────────────────

/// Shared treasury object. One per org per token type.
public struct OrgTreasury<phantom T> has key {
    id: UID,
    org_id: ID,
    treasury_cap: TreasuryCap<T>,
}

// ── Events ─────────────────────────────────────────────────────────────────

public struct TreasuryCreatedEvent has copy, drop {
    treasury_id: ID,
    org_id: ID,
}

public struct MintEvent has copy, drop {
    treasury_id: ID,
    amount: u64,
    recipient: address,
    minter: address,
}

public struct BurnEvent has copy, drop {
    treasury_id: ID,
    amount: u64,
    burner: address,
}

// ── Deposit TreasuryCap (one-time, irreversible) ──────────────────────────

/// Deposit a TreasuryCap into a new OrgTreasury shared object.
/// The caller must be a stakeholder of the organization.
/// After this call, the TreasuryCap is locked and cannot be extracted.
public fun deposit_treasury_cap<T>(
    org: &Organization,
    treasury_cap: TreasuryCap<T>,
    ctx: &mut TxContext,
) {
    assert!(governance::org::is_stakeholder_address(org, ctx.sender()), ENotStakeholder);

    let org_id = object::id(org);
    let treasury = OrgTreasury<T> {
        id: object::new(ctx),
        org_id,
        treasury_cap,
    };

    let treasury_id = object::id(&treasury);

    event::emit(TreasuryCreatedEvent { treasury_id, org_id });

    transfer::share_object(treasury);
}

// ── Mint (stakeholder only) ───────────────────────────────────────────────

/// Mint tokens from the OrgTreasury. Caller must be an org stakeholder.
/// Returns the minted Coin<T> (caller decides where to send it).
public fun mint<T>(
    treasury: &mut OrgTreasury<T>,
    org: &Organization,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(object::id(org) == treasury.org_id, EOrgMismatch);
    assert!(governance::org::is_stakeholder_address(org, ctx.sender()), ENotStakeholder);

    let minted = coin::mint(&mut treasury.treasury_cap, amount, ctx);

    event::emit(MintEvent {
        treasury_id: object::id(treasury),
        amount,
        recipient,
        minter: ctx.sender(),
    });

    minted
}

/// Mint and transfer in one call (convenience entry function).
entry fun mint_and_transfer<T>(
    treasury: &mut OrgTreasury<T>,
    org: &Organization,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let coin = mint(treasury, org, amount, recipient, ctx);
    transfer::public_transfer(coin, recipient);
}

// ── Burn (any holder) ─────────────────────────────────────────────────────

/// Burn tokens. Any coin holder can burn their own tokens.
public fun burn<T>(
    treasury: &mut OrgTreasury<T>,
    coin: Coin<T>,
    ctx: &TxContext,
) {
    let amount = coin::value(&coin);
    coin::burn(&mut treasury.treasury_cap, coin);

    event::emit(BurnEvent {
        treasury_id: object::id(treasury),
        amount,
        burner: ctx.sender(),
    });
}

// ── Read accessors ────────────────────────────────────────────────────────

public fun total_supply<T>(treasury: &OrgTreasury<T>): u64 {
    coin::total_supply(&treasury.treasury_cap)
}

public fun org_id<T>(treasury: &OrgTreasury<T>): ID {
    treasury.org_id
}
```

**Key design details:**
- `OrgTreasury<T>` is a shared object with `key` ability only (no `store`) — it cannot be wrapped or transferred after creation.
- `TreasuryCap<T>` is consumed on deposit (moved into the struct). No extraction function exists — irreversible.
- `mint<T>()` returns `Coin<T>` (not `entry`) so it can be composed in PTBs. The returned coin can be passed to `ssu_market::create_buy_order<T>()` or `bounty_board::post_bounty<T>()` in the same transaction.
- `mint_and_transfer<T>()` is an `entry` convenience for direct mint-to-recipient.
- `burn<T>()` takes `&TxContext` (not `&mut`) — any holder can burn, not just stakeholders.

#### Step 1.2: Gas Station `/build-token` Endpoint

Create a new build-and-publish pipeline in the gas station.

**File:** `apps/gas-station/src/buildToken.ts` (CREATE)

**Approach:** Generate Move source with substituted values (same pattern as `buildTurret.ts`):
1. Accept params: `{ symbol, name, description, decimals, senderAddress }`
2. Generate Move source by string-replacing placeholders in a template:
   - Module name: `{symbol_lower}_token` (e.g., `GOLD` -> `gold_token`)
   - OTW struct: `{SYMBOL}_TOKEN` (e.g., `GOLD_TOKEN`)
   - Metadata: symbol, name, description, decimals
   - `transfer::public_transfer(treasury, @{SENDER})` — hardcoded stakeholder address
3. Write `Move.toml` + source to temp dir
4. `sui move build` → `sui client publish --skip-dependency-verification --json`
5. Parse `objectChanges` for `packageId`, `treasuryCapId` (TreasuryCap object), `coinType`
6. Append packageId to `published-tokens.json` for dynamic whitelist persistence
7. Return `{ packageId, coinType, treasuryCapId, moduleName }`

**Move template string** (embedded in `buildToken.ts`):

```move
module {MODULE_NAME}::{OTW_NAME};
use sui::coin;

public struct {OTW_NAME} has drop {}

fun init(witness: {OTW_NAME}, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        {DECIMALS},
        b"{SYMBOL}",
        b"{NAME}",
        b"{DESCRIPTION}",
        option::none(),
        ctx,
    );
    transfer::public_transfer(treasury, @{SENDER});
    transfer::public_freeze_object(metadata);
}

/// Bootstrap mint — usable only while TreasuryCap is held by the creator.
/// After depositing TreasuryCap into OrgTreasury, this becomes uncallable.
public entry fun mint(
    treasury: &mut coin::TreasuryCap<{OTW_NAME}>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let minted = coin::mint(treasury, amount, ctx);
    transfer::public_transfer(minted, recipient);
}

/// Bootstrap burn — usable only while TreasuryCap is held by the creator.
public entry fun burn(
    treasury: &mut coin::TreasuryCap<{OTW_NAME}>,
    coin: coin::Coin<{OTW_NAME}>,
) {
    coin::burn(treasury, coin);
}
```

**Key differences from turret build:**
1. TreasuryCap is transferred to `senderAddress` (the org stakeholder), NOT the gas station wallet. This is achieved via hardcoded `@{SENDER}` in `init()`.
2. The existing `contracts/token_template/sources/token.move` uses `ctx.sender()` (gives to gas station wallet). The gas station template uses `@{SENDER}` (gives to the requesting user). These are different approaches; the gas station template is correct.
3. The template includes minimal `mint`/`burn` entry functions for the bootstrap window (see Resolved Question #4). After TreasuryCap is deposited into OrgTreasury, the template's `mint`/`burn` become unusable (TreasuryCap is locked).
4. The gas station must parse `objectChanges` to extract BOTH the `packageId` AND the `TreasuryCap` object ID (look for `objectType` containing `::coin::TreasuryCap<`). Also extract `coinType` from the TreasuryCap's type parameter.

**File:** `apps/gas-station/src/index.ts` (MODIFY — add endpoint)

Add `POST /build-token` handler with validation: symbol 1-10 chars uppercase alphanum, name 1-100 chars, decimals 0-18, senderAddress is valid Sui address.

**File:** `apps/gas-station/src/config.ts` (MODIFY — add dynamic whitelist)

```typescript
// Read persisted token packages on startup
const publishedTokensPath = join(__dirname, "../published-tokens.json");
const dynamicAllowedPackages = new Set<string>();

try {
    const data = readFileSync(publishedTokensPath, "utf-8");
    for (const pkg of JSON.parse(data)) dynamicAllowedPackages.add(pkg);
} catch { /* file may not exist yet */ }

// Support EXTRA_ALLOWED_PACKAGES env var
const extra = process.env.EXTRA_ALLOWED_PACKAGES?.split(",") ?? [];
for (const pkg of extra) if (pkg.trim()) dynamicAllowedPackages.add(pkg.trim());

export function addDynamicAllowedPackage(packageId: string): void {
    dynamicAllowedPackages.add(packageId);
    // Persist to file
    writeFileSync(publishedTokensPath, JSON.stringify([...dynamicAllowedPackages]), "utf-8");
}

export function getAllowedPackageIds(): Set<string> {
    const allowed = new Set<string>();
    // ... existing static collection ...
    for (const pkg of dynamicAllowedPackages) allowed.add(pkg);
    return allowed;
}
```

#### Step 1.3: Wire GovernanceFinance to Gas Station

Modify the existing view to call the gas station and support OrgTreasury deposit.

**File:** `apps/periscope/src/views/GovernanceFinance.tsx` (MODIFY)

**Changes:**
1. Add `description` field to the creation form
2. Replace local-only `handleCreateCurrency()` with gas station call:
   a. `POST ${gasStationUrl}/build-token` with `{ symbol, name, description, decimals, senderAddress }`
   b. On success, create CurrencyRecord with populated `packageId`, `coinType`, `treasuryCapId`
   c. On failure, show error toast (no local fallback — token must be published)
3. Remove Phase 1 amber banner
4. Add loading/progress indicator during build (~30-60s)
5. Add "Deposit to OrgTreasury" button on published currencies (before first mint):
   - Builds PTB: `treasury::deposit_treasury_cap<T>(org, treasuryCap)`
   - After success, updates CurrencyRecord with `orgTreasuryId` (parsed from objectChanges)
6. For currencies with `orgTreasuryId`:
   - Show total supply (query `treasury::total_supply()`)
   - "Mint" button → modal: amount + recipient → `treasury::mint_and_transfer<T>(orgTreasury, org, amount, recipient)`
   - "Burn" button → modal: coin selection → `treasury::burn<T>(orgTreasury, coin)`

**Coordinator note:** The coordinator must add `published-tokens.json` to the root `.gitignore` and add `governanceExt` to `CONTRACT_ADDRESSES` in `packages/chain-shared/src/config.ts` after deployment. Also add `export * from "./treasury";` to `packages/chain-shared/src/index.ts`.

#### Step 1.4: Chain-Shared Treasury Helpers

**File:** `packages/chain-shared/src/treasury.ts` (CREATE)

New TX builder functions:
```typescript
export function buildDepositTreasuryCap<T>(params: {
    governanceExtPackageId: string;
    orgObjectId: string;
    treasuryCapId: string;
    coinType: string;
    senderAddress: string;
}): Transaction;

export function buildMintAndTransfer<T>(params: {
    governanceExtPackageId: string;
    orgTreasuryId: string;
    orgObjectId: string;
    coinType: string;
    amount: bigint;
    recipient: string;
    senderAddress: string;
}): Transaction;

export function buildBurn<T>(params: {
    governanceExtPackageId: string;
    orgTreasuryId: string;
    coinType: string;
    coinObjectId: string;
    senderAddress: string;
}): Transaction;

// Mint that returns Coin<T> for PTB composition (not entry, returns value)
export function buildMint<T>(params: {
    governanceExtPackageId: string;
    orgTreasuryId: string;
    orgObjectId: string;
    coinType: string;
    amount: bigint;
    recipient: string;
    senderAddress: string;
}, tx: Transaction): TransactionResult;

export async function queryOrgTreasury(client: SuiClient, treasuryId: string): Promise<{
    orgId: string;
    totalSupply: bigint;
}>;
```

#### Step 1.5: DB Schema V13

**File:** `apps/periscope/src/db/types.ts` (MODIFY)

Add to `CurrencyRecord`:
- `description?: string`
- `moduleName?: string` (e.g., `gold_token`)
- `orgTreasuryId?: string` (Sui object ID of OrgTreasury, populated after deposit)

**File:** `apps/periscope/src/db/index.ts` (MODIFY)

Add V13 with backfill for `description`, `moduleName` (derived from `coinType` if present), `orgTreasuryId`.

#### Step 1.6: Shared Schemas

**File:** `packages/shared/src/schemas/trading.ts` (MODIFY)

```typescript
export const buildTokenRequestSchema = z.object({
    symbol: z.string().min(1).max(10).regex(/^[A-Z0-9]+$/),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().default(""),
    decimals: z.number().int().min(0).max(18).default(9),
    senderAddress: suiAddressSchema,
});

export const buildTokenResponseSchema = z.object({
    packageId: z.string(),
    coinType: z.string(),
    treasuryCapId: z.string(),
    moduleName: z.string(),
});
```

### Phase 2: Bidirectional SSU Market

**Goal:** Upgrade `ssu_market` with buy orders and atomic buy-and-withdraw. Create GovernanceTrade view. Wire PTB composition for "fund buy order" and "confirm buy order fill" flows.

#### Step 2.1: Upgrade `ssu_market` Contract

Upgrade the deployed `ssu_market` package to add buy orders, `buy_and_withdraw<T>()`, and governance dependency.

**File:** `contracts/ssu_market/Move.toml` (MODIFY — add governance dependency, set upgrade address)

> **UPGRADE NOTE:** The current Move.toml has `ssu_market = "0x0"` (fresh publish). For upgrade, it MUST be changed to the published address. The `world` dependency already exists in the current Move.toml. The `governance` dependency is new. The UpgradeCap is `0xa8039526a9dc0f8cd5ad799daa235ccfc51958a40d527eb164b9d56800203eaf` (from `contracts/ssu_market/Published.toml`). Upgrade command: `sui client upgrade --upgrade-capability <cap_id>`.

```toml
[package]
name = "ssu_market"
edition = "2024"
published-at = "0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.66.2" }
world = { git = "https://github.com/evefrontier/world-contracts.git", subdir = "contracts/world", rev = "v0.0.18" }
governance = { local = "../governance" }

[addresses]
ssu_market = "0xdb9df166063dc60ab0a450a768d4010f3e5939e554910d6aa1dc1b72e5dc8885"
governance = "0x8bef45b3006c3112cbc4aa930a6aa521fc586cc8609c89514c4e14f514a578cb"
```

> **Same dependency pattern as governance_ext:** `governance = { local = "../governance" }` provides source for type resolution. `[addresses]` overrides to the published address.

**File:** `contracts/ssu_market/sources/ssu_market.move` (MODIFY — add OrgMarket, buy orders, buy_and_withdraw)

New structs:

```move
/// Per-org market: manages buy orders across multiple SSUs.
/// Created once per org. Stakeholders manage authorized SSUs and buy orders.
public struct OrgMarket has key {
    id: UID,
    org_id: ID,
    admin: address,
    authorized_ssus: vector<ID>,
    next_order_id: u64,
}

/// Buy order: org wants to purchase items, paying Coin<T>.
/// Stored as dynamic field on OrgMarket keyed by order_id.
/// `ssu_id` tracks which SSU items should be delivered to (for UI display).
public struct BuyOrder has store, drop {
    order_id: u64,
    ssu_id: ID,           // Target delivery SSU (informational — for player discovery)
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    poster: address,
    // Coin<T> escrowed as separate dynamic field: order_id + 1_000_000_000
}

public struct OrgMarketCreatedEvent has copy, drop {
    org_market_id: ID,
    org_id: ID,
    admin: address,
}

public struct BuyOrderCreatedEvent has copy, drop {
    org_market_id: ID,
    order_id: u64,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    poster: address,
}

public struct BuyOrderFilledEvent has copy, drop {
    org_market_id: ID,
    order_id: u64,
    ssu_id: ID,
    type_id: u64,
    quantity: u64,
    total_paid: u64,
    seller: address,
}
```

New functions:

```move
use governance::org::{Self, Organization};
use world::storage_unit::{Self, StorageUnit};
use world::character::Character;
use world::inventory::Item;

/// Create an OrgMarket for an organization. One per org.
public fun create_org_market(
    org: &Organization,
    ctx: &mut TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    transfer::share_object(OrgMarket {
        id: object::new(ctx),
        org_id: object::id(org),
        admin: ctx.sender(),
        authorized_ssus: vector::empty(),
        next_order_id: 0,
    });
}

/// Add an SSU as an authorized delivery point. Stakeholders only.
/// The SSU must already have authorize_extension<MarketAuth>() called by its owner.
public fun add_authorized_ssu(
    market: &mut OrgMarket,
    org: &Organization,
    ssu_id: ID,
    ctx: &TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    market.authorized_ssus.push_back(ssu_id);
}

/// Remove an SSU from authorized delivery points.
public fun remove_authorized_ssu(
    market: &mut OrgMarket,
    org: &Organization,
    ssu_id: ID,
    ctx: &TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    let (found, idx) = market.authorized_ssus.index_of(&ssu_id);
    if (found) { market.authorized_ssus.remove(idx); };
}

/// Create a buy order on the org market. Stakeholders only.
/// `ssu_id` indicates which SSU players should deliver items to.
/// Escrowed Coin<T> stored as dynamic field on OrgMarket.
public fun create_buy_order<T>(
    market: &mut OrgMarket,
    org: &Organization,
    payment: Coin<T>,
    ssu_id: ID,
    type_id: u64,
    price_per_unit: u64,
    quantity: u64,
    ctx: &mut TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    let total_cost = price_per_unit * quantity;
    assert!(coin::value(&payment) >= total_cost, EInsufficientPayment);

    let order_id = market.next_order_id;
    market.next_order_id = order_id + 1;

    let record = BuyOrder {
        order_id, ssu_id, type_id, price_per_unit, quantity,
        poster: ctx.sender(),
    };

    dynamic_field::add(&mut market.id, order_id, record);
    // Escrow coins with offset key (same pattern as bounty_board)
    let coin_key = order_id + 1_000_000_000;
    dynamic_field::add(&mut market.id, coin_key, payment);

    event::emit(BuyOrderCreatedEvent {
        org_market_id: object::id(market), order_id, type_id,
        price_per_unit, quantity, poster: ctx.sender(),
    });
}

/// Fill a buy order (hackathon: manual confirmation model).
///
/// Flow: Player deposits items to the SSU via game client first. Then a stakeholder
/// calls confirm_buy_order_fill to release payment. This avoids the SSU item binding
/// constraint (items can't be programmatically transferred between SSUs).
///
/// For the hackathon, this is a stakeholder-confirmed fill. The stakeholder verifies
/// items were delivered (off-chain check) and releases payment to the seller.
/// Automated fill (checking extension inventory on-chain) deferred to post-hackathon.
public fun confirm_buy_order_fill<T>(
    market: &mut OrgMarket,
    org: &Organization,
    order_id: u64,
    seller: address,
    quantity_filled: u64,
    ctx: &mut TxContext,
) {
    assert!(object::id(org) == market.org_id, EOrgMismatch);
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);

    // Validate buy order exists
    let record = dynamic_field::borrow<u64, BuyOrder>(&market.id, order_id);
    assert!(quantity_filled <= record.quantity, EExceedsOrderQuantity);

    let payment_amount = record.price_per_unit * quantity_filled;

    let type_id = record.type_id;

    // Pay seller from escrowed coins
    let coin_key = order_id + 1_000_000_000;
    let escrowed = dynamic_field::borrow_mut<u64, Coin<T>>(&mut market.id, coin_key);
    let payment = coin::split(escrowed, payment_amount, ctx);
    transfer::public_transfer(payment, seller);

    // Update or remove order based on remaining quantity
    // NOTE: Must read remaining_qty into a local before the conditional remove,
    // otherwise the mutable borrow of `record` conflicts with `dynamic_field::remove`.
    let remaining_qty = {
        let record = dynamic_field::borrow_mut<u64, BuyOrder>(&mut market.id, order_id);
        record.quantity = record.quantity - quantity_filled;
        record.quantity
    }; // record reference dropped here

    if (remaining_qty == 0) {
        dynamic_field::remove<u64, BuyOrder>(&mut market.id, order_id);
        // Return any remaining dust coins to admin
        let remaining = dynamic_field::remove<u64, Coin<T>>(&mut market.id, coin_key);
        if (coin::value(&remaining) > 0) {
            transfer::public_transfer(remaining, ctx.sender());
        } else {
            coin::destroy_zero(remaining);
        };
    };

    event::emit(BuyOrderFilledEvent {
        org_market_id: object::id(market), order_id,
        ssu_id: object::id_from_address(@0x0), // SSU tracked off-chain for hackathon
        type_id, quantity: quantity_filled,
        total_paid: payment_amount, seller,
    });
}

/// Cancel a buy order. Returns escrowed coins to poster.
public fun cancel_buy_order<T>(
    market: &mut OrgMarket,
    org: &Organization,
    order_id: u64,
    ctx: &mut TxContext,
) {
    assert!(org::is_stakeholder_address(org, ctx.sender()), ENotAdmin);
    dynamic_field::remove<u64, BuyOrder>(&mut market.id, order_id);
    let coin_key = order_id + 1_000_000_000;
    let coins = dynamic_field::remove<u64, Coin<T>>(&mut market.id, coin_key);
    transfer::public_transfer(coins, ctx.sender());
}

/// Stock items into the SSU extension inventory for sell orders.
/// The market admin moves items from owner inventory to extension inventory.
/// Called in a PTB after borrow_owner_cap → withdraw_by_owner → stock_items → return_owner_cap.
/// Item must have parent_id matching the SSU (same-SSU items only — see item binding constraint).
public fun stock_items(
    config: &MarketConfig,
    ssu: &mut StorageUnit,
    character: &Character,
    item: Item,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAdmin);
    storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
}

/// Atomically buy items from a sell listing: pay Coin<T>, receive items.
/// Constructs MarketAuth {} to withdraw items from the SSU extension inventory.
/// Items must be stocked first via stock_items().
public fun buy_and_withdraw<T>(
    config: &MarketConfig,
    ssu: &mut StorageUnit,
    character: &Character,
    payment: Coin<T>,
    type_id: u64,
    quantity: u32,
    ctx: &mut TxContext,
): (Item, Coin<T>) {
    // Same payment logic as buy_item<T> (validate listing, split payment, send to admin)
    let change = buy_item<T>(config, payment, type_id, quantity as u64, ctx);
    // Withdraw items from SSU extension inventory
    let item = storage_unit::withdraw_item<MarketAuth>(
        ssu, character, MarketAuth {}, type_id, quantity, ctx,
    );
    (item, change)
}
```

**Sell order stocking flow (PTB):**
```
1. character::borrow_owner_cap<StorageUnit>(character, receiving_owner_cap, ctx) → (owner_cap, receipt)
2. storage_unit::withdraw_by_owner(ssu, owner_cap, type_id, quantity) → item
3. ssu_market::stock_items(config, ssu, character, item)
4. character::return_owner_cap(character, owner_cap, receipt)
```
This moves items from the SSU's owner inventory to the extension inventory, making them available for `buy_and_withdraw`.

**Key design points:**
- **`OrgMarket` is per-org, not per-SSU.** Created once via `create_org_market()`. Buy orders are org-level procurement, each tagged with a target `ssu_id` for discovery.
- **`authorized_ssus: vector<ID>`** — stakeholders manage which SSUs participate in org procurement.
- **`confirm_buy_order_fill` is stakeholder-confirmed** (hackathon model). Player deposits items to the target SSU via game client. Stakeholder verifies receipt off-chain, then calls `confirm_buy_order_fill` to release payment. This avoids the SSU item binding constraint (see "SSU Item Binding Constraint" section above).
- **Partial fills supported** — `confirm_buy_order_fill` takes `quantity_filled` and updates the remaining quantity. Simpler than exact-fill for the manual confirmation model.
- **Sell orders remain on per-SSU `MarketConfig`** — unchanged. `buy_and_withdraw` is the atomic sell-side purchase (items are already in the SSU's extension inventory).
- **Coin escrow uses bounty_board pattern** — `order_id` for record, `order_id + 1_000_000_000` for coins.
- **Missing error codes to add:** `EOrgMismatch`, `EExceedsOrderQuantity`, `ENotAuthorizedSSU`, `ETypeMismatch` (add as `#[error(code = N)]` constants following the existing pattern in ssu_market.move, starting at code 4).

#### Step 2.2: Chain-Shared Market Helpers

**File:** `packages/chain-shared/src/ssu-market.ts` (MODIFY)

Add new TX builder functions:

```typescript
// ── OrgMarket management ──

export function buildCreateOrgMarket(params: {
    packageId: string; orgObjectId: string; senderAddress: string;
}): Transaction;

export function buildAddAuthorizedSsu(params: {
    packageId: string; orgMarketId: string; orgObjectId: string;
    ssuId: string; senderAddress: string;
}): Transaction;

export function buildRemoveAuthorizedSsu(params: {
    packageId: string; orgMarketId: string; orgObjectId: string;
    ssuId: string; senderAddress: string;
}): Transaction;

// ── Buy orders (on OrgMarket) ──

export function buildCreateBuyOrder(params: {
    packageId: string; orgMarketId: string; orgObjectId: string;
    coinType: string; paymentObjectId: string;
    ssuId: string; // Target delivery SSU
    typeId: number; pricePerUnit: number; quantity: number;
    senderAddress: string;
}): Transaction;

export function buildConfirmBuyOrderFill(params: {
    packageId: string; orgMarketId: string; orgObjectId: string;
    coinType: string; orderId: number;
    sellerAddress: string; quantityFilled: number;
    senderAddress: string; // Must be a stakeholder
}): Transaction;

export function buildCancelBuyOrder(params: {
    packageId: string; orgMarketId: string; orgObjectId: string;
    coinType: string; orderId: number; senderAddress: string;
}): Transaction;

// ── Sell orders (on MarketConfig — stock + atomic purchase) ──

export function buildStockItems(params: {
    packageId: string; configObjectId: string;
    ssuObjectId: string; characterObjectId: string;
    ownerCapReceivingId: string; // Receiving<OwnerCap<StorageUnit>>
    typeId: number; quantity: number;
    senderAddress: string;
}): Transaction;
// PTB: borrow_owner_cap → withdraw_by_owner → stock_items → return_owner_cap

export function buildBuyAndWithdraw(params: {
    packageId: string; configObjectId: string;
    ssuObjectId: string; characterObjectId: string;
    coinType: string; paymentObjectId: string;
    typeId: number; quantity: number;
    senderAddress: string;
}): Transaction;

// ── Query helpers ──

export async function queryOrgMarket(client: SuiClient, orgMarketId: string):
    Promise<{ orgId: string; admin: string; authorizedSsus: string[]; nextOrderId: number }>;

export async function queryBuyOrders(client: SuiClient, orgMarketId: string):
    Promise<Array<{ orderId: number; ssuId: string; typeId: number; pricePerUnit: number; quantity: number; poster: string }>>;
```

**PTB composition helpers** (for combined treasury + market operations):

```typescript
/// "Fund buy order" PTB: mint from OrgTreasury → create buy order (one TX)
export function buildFundBuyOrder(params: {
    governanceExtPackageId: string;
    ssuMarketPackageId: string;
    orgTreasuryId: string;
    orgObjectId: string;
    orgMarketId: string;
    coinType: string;
    mintAmount: bigint;
    ssuId: string;         // Target delivery SSU
    typeId: number;
    pricePerUnit: number;
    quantity: number;
    senderAddress: string;
}): Transaction {
    const tx = new Transaction();
    tx.setSender(params.senderAddress);

    // Step 1: Mint from OrgTreasury (returns Coin<T>)
    const [mintedCoin] = tx.moveCall({
        target: `${params.governanceExtPackageId}::treasury::mint`,
        typeArguments: [params.coinType],
        arguments: [
            tx.object(params.orgTreasuryId),
            tx.object(params.orgObjectId),
            tx.pure.u64(params.mintAmount),
            tx.pure.address(params.senderAddress),  // recipient (unused, coin returned)
        ],
    });

    // Step 2: Create buy order on OrgMarket with minted coins
    tx.moveCall({
        target: `${params.ssuMarketPackageId}::ssu_market::create_buy_order`,
        typeArguments: [params.coinType],
        arguments: [
            tx.object(params.orgMarketId),
            tx.object(params.orgObjectId),
            mintedCoin,
            tx.pure.id(params.ssuId),
            tx.pure.u64(params.typeId),
            tx.pure.u64(params.pricePerUnit),
            tx.pure.u64(params.quantity),
        ],
    });

    return tx;
}

/// "Fund bounty" PTB: mint from OrgTreasury → post bounty (one TX)
export function buildFundBounty(params: {
    governanceExtPackageId: string;
    bountyBoardPackageId: string;
    orgTreasuryId: string;
    orgObjectId: string;
    boardObjectId: string;
    coinType: string;
    rewardAmount: bigint;
    targetCharacterId: number;
    expiresAt: number;
    senderAddress: string;
}): Transaction {
    const tx = new Transaction();
    tx.setSender(params.senderAddress);

    // Step 1: Mint from OrgTreasury
    const [mintedCoin] = tx.moveCall({
        target: `${params.governanceExtPackageId}::treasury::mint`,
        typeArguments: [params.coinType],
        arguments: [
            tx.object(params.orgTreasuryId),
            tx.object(params.orgObjectId),
            tx.pure.u64(params.rewardAmount),
            tx.pure.address(params.senderAddress),
        ],
    });

    // Step 2: Post bounty with minted coins
    tx.moveCall({
        target: `${params.bountyBoardPackageId}::bounty_board::post_bounty`,
        typeArguments: [params.coinType],
        arguments: [
            tx.object(params.boardObjectId),
            tx.pure.u64(params.targetCharacterId),
            mintedCoin,
            tx.pure.u64(params.expiresAt),
        ],
    });

    return tx;
}
```

#### Step 2.3: GovernanceTrade View

**File:** `apps/periscope/src/views/GovernanceTrade.tsx` (CREATE)

**Layout:**
```
+-- Header: Trade (ShoppingBag icon) + WalletConnect -------------------------+
|                                                                              |
| +-- Tab Bar: Sell Orders | Buy Orders --------------------------------------+
|                                                                              |
| [Sell Orders Tab - Market Management]                                        |
| +-- Create Market -----------------------------------------------------------+
| |  SSU dropdown (from owned assemblies) + Currency dropdown                  |
| |  [Create Market] button                                                    |
| +----------------------------------------------------------------------------+
|                                                                              |
| +-- Market: SSU "Alpha Depot" (MarketConfig 0x1234...) ---------------------+
| |  Currency: GOLD (0x5678::gold_token::GOLD_TOKEN)                          |
| |                                                                            |
| |  Listings:                                                                 |
| |  +-- Fuel EU-90 (78437) --- 10 GOLD/unit -- [Enabled] [Edit] ----------+  |
| |  +-- SOF-80 (78515) ------- 8 GOLD/unit --- [Disabled] [Edit] ---------+  |
| |  [+ Add Listing]                                                          |
| +----------------------------------------------------------------------------+
|                                                                              |
| [Buy Orders Tab - Org Procurement]                                           |
| +-- Authorized Delivery Points (OrgMarket) ---------------------------------+
| |  ● Alpha Depot (Jita 30003692)  ● Beta Refinery (Amarr 30002187)         |
| |  ● Gamma Outpost (Rens 30002510)                                          |
| |  [+ Add SSU] [Manage...]                                                  |
| +----------------------------------------------------------------------------+
|                                                                              |
| +-- Fund Buy Order ----------------------------------------------------------+
| |  Item type picker + Price per unit + Quantity + [Fund from Treasury]       |
| |  Shows: will mint X tokens, deliverable to 3 SSUs                         |
| +----------------------------------------------------------------------------+
|                                                                              |
| +-- Active Buy Orders -------------------------------------------------------+
| |  Fuel EU-90 (78437) --- paying 5 GOLD/unit --- 500 wanted --- [Cancel]    |
| |    Deliver to: Alpha Depot | Beta Refinery | Gamma Outpost                |
| |  Iron Ore (78201) ----- paying 3 GOLD/unit --- 1000 wanted --- [Cancel]   |
| |    Deliver to: Alpha Depot | Beta Refinery | Gamma Outpost                |
| +----------------------------------------------------------------------------+
+------------------------------------------------------------------------------+
```

**Implementation details:**
1. Wallet guard + Org guard (same pattern as GovernanceFinance)
2. Currency guard — if org has no published currencies with OrgTreasury, show "Set up treasury first" link
3. **Sell Orders tab:**
   - Market creation per SSU: `buildCreateMarket()` → store MarketConfig ID
   - Listing management: `buildSetListing()` per item type
   - Buyer flow: `buildBuyAndWithdraw()` for atomic purchase
4. **Buy Orders tab:**
   - OrgMarket creation (one-time): `buildCreateOrgMarket()` → store OrgMarket ID
   - Authorized SSU management: `buildAddAuthorizedSsu()` / `buildRemoveAuthorizedSsu()`
   - Fund buy orders: `buildFundBuyOrder()` PTB (mint from treasury + escrow on OrgMarket in one TX)
   - Buy order display: `queryBuyOrders()` — shows all active orders with target delivery SSUs
   - Cancel: `buildCancelBuyOrder()` returns escrowed coins to poster
   - **Confirm fill:** Stakeholder selects a buy order, enters seller address and quantity delivered, calls `buildConfirmBuyOrderFill()` to release payment
5. **Player fill flow (hackathon: manual):**
   - Player sees buy order listing (what items the org wants, which SSU to deliver to, price)
   - Player flies to the target SSU in-game, deposits items via game client
   - Player notifies org stakeholder (chat/discord) that delivery was made
   - Stakeholder confirms via "Confirm Fill" button → payment released to seller
   - **Post-hackathon:** Automate with on-chain inventory checks or event listeners

#### Step 2.4: Router & Sidebar

**File:** `apps/periscope/src/router.tsx` (MODIFY) — Add `/governance/trade` route
**File:** `apps/periscope/src/components/Sidebar.tsx` (MODIFY) — Add Trade nav item (ShoppingBag icon)
**File:** `apps/periscope/src/views/GovernanceDashboard.tsx` (MODIFY) — Add Trade quick action, grid-cols-3 -> grid-cols-4

### Phase 3: Integration

**Goal:** Bounty board integration with treasury, treasury dashboard, economic analytics.

#### Step 3.1: Bounty Board Integration

Wire "Fund Bounty" PTB to GovernanceFinance or a new Bounties section.

**File:** `apps/periscope/src/views/GovernanceFinance.tsx` (MODIFY)

Add "Bounties" section to the treasury view:
1. "Post Bounty" button → modal: target character ID, reward amount, expiration
2. Executes `buildFundBounty()` PTB: mint from OrgTreasury → post on bounty board
3. Display active bounties funded by this org (query BountyBoard events)

No contract changes needed — `bounty_board::post_bounty<T>()` already accepts any `Coin<T>`.

#### Step 3.2: Treasury Dashboard

**File:** `apps/periscope/src/views/GovernanceFinance.tsx` (MODIFY)

Treasury overview section:
1. Total supply (from `OrgTreasury` on-chain)
2. Circulating supply estimate (total supply minus coins held by known org addresses)
3. Buy order escrow total (sum of active buy order balances)
4. Bounty escrow total (sum of active org-funded bounties)
5. Mint/burn history (from `MintEvent`/`BurnEvent` on-chain events)

#### Step 3.3: Chain-Shared Query Helpers

**File:** `packages/chain-shared/src/token-factory.ts` (MODIFY)

```typescript
export async function queryTokenSupply(
    client: SuiClient,
    coinType: string,
): Promise<{ totalSupply: bigint }>;

export async function queryOwnedCoins(
    client: SuiClient,
    owner: string,
    coinType: string,
): Promise<Array<{ objectId: string; balance: bigint }>>;
```

**File:** `packages/chain-shared/src/ssu-market.ts` — `queryBuyOrders()` already defined in Step 2.2 (no duplicate needed). The `quantity` field on the on-chain `BuyOrder` struct represents the remaining quantity (decremented by `confirm_buy_order_fill`).

#### Step 3.4: Config Updates

> **NOTE:** These config changes should be done in Phase 1 (after `governance_ext` is deployed), not deferred to Phase 3. They're listed here because Phase 3 is the integration phase, but the coordinator should apply them right after Step 1.1 deployment.

**File:** `packages/chain-shared/src/types.ts` (MODIFY)

Add to `ContractAddresses` (after `governance`):
```typescript
governanceExt?: { packageId: string };
```

**File:** `packages/chain-shared/src/config.ts` (MODIFY)

Add `governanceExt` entry to both `stillness` and `utopia` tenant configs after deployment:
```typescript
governanceExt: { packageId: "<deployed-governance-ext-package-id>" },
```

**File:** `packages/chain-shared/src/index.ts` (MODIFY)

Add export for the new treasury module:
```typescript
export * from "./treasury";
```

## File Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `contracts/governance_ext/Move.toml` | CREATE | 1 | Move manifest with governance dependency |
| `contracts/governance_ext/sources/treasury.move` | CREATE | 1 | OrgTreasury shared object, stakeholder-gated minting |
| `apps/gas-station/src/buildToken.ts` | CREATE | 1 | Token build + publish pipeline |
| `apps/gas-station/src/index.ts` | MODIFY | 1 | Add `POST /build-token` endpoint |
| `apps/gas-station/src/config.ts` | MODIFY | 1 | Dynamic whitelist + `EXTRA_ALLOWED_PACKAGES` env var |
| `apps/periscope/src/views/GovernanceFinance.tsx` | MODIFY | 1,3 | Wire gas station, OrgTreasury deposit, mint/burn, bounties, dashboard |
| `apps/periscope/src/db/index.ts` | MODIFY | 1 | V13 schema bump |
| `apps/periscope/src/db/types.ts` | MODIFY | 1 | Add `description`, `moduleName`, `orgTreasuryId` to CurrencyRecord |
| `packages/chain-shared/src/treasury.ts` | CREATE | 1 | OrgTreasury TX builders + PTB composition helpers |
| `packages/chain-shared/src/token-factory.ts` | MODIFY | 3 | Add queryTokenSupply, queryOwnedCoins |
| `packages/shared/src/schemas/trading.ts` | MODIFY | 1 | buildTokenRequest/Response Zod schemas |
| `contracts/ssu_market/sources/ssu_market.move` | MODIFY | 2 | Add OrgMarket, BuyOrder, create_buy_order, confirm_buy_order_fill, stock_items, buy_and_withdraw |
| `contracts/ssu_market/Move.toml` | MODIFY | 2 | Add governance dependency for upgrade |
| `packages/chain-shared/src/ssu-market.ts` | MODIFY | 2 | Add buy order TX builders (create, confirm fill, cancel), stock_items, buy_and_withdraw, PTB composition helpers |
| `apps/periscope/src/views/GovernanceTrade.tsx` | CREATE | 2 | SSU market management, buy orders, buyer flow |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | MODIFY | 2 | Add Trade quick action |
| `apps/periscope/src/router.tsx` | MODIFY | 2 | Add `/governance/trade` route |
| `apps/periscope/src/components/Sidebar.tsx` | MODIFY | 2 | Add Trade nav item |
| `packages/chain-shared/src/types.ts` | MODIFY | 1* | Add `governanceExt` to ContractAddresses (*deploy-time, listed in Phase 3 but needed after Step 1.1 deploy) |
| `packages/chain-shared/src/config.ts` | MODIFY | 1* | Add governanceExt deployed address (*deploy-time) |
| `packages/chain-shared/src/index.ts` | MODIFY | 1 | Add `export * from "./treasury"` |
| `scripts/upgrade-contract.sh` | CREATE | — | Reusable contract upgrade script (see Upgrade & Migration Strategy) |

## Resolved Design Questions

### 1. TreasuryCap ownership model — RESOLVED

**Decision:** Shared OrgTreasury (Approach 2). TreasuryCap is deposited into a shared `OrgTreasury<T>` object. Any org stakeholder can mint. No single person holds minting power. Irreversible deposit prevents extraction.

### 2. SSU item withdrawal with MarketAuth — RESOLVED

**Decision:** `buy_and_withdraw<T>()` in upgraded `ssu_market`. Only the `ssu_market` package can construct `MarketAuth {}`. The function handles payment + SSU withdrawal atomically in one Move call.

### 3. TreasuryCap recipient after publish — RESOLVED

**Decision:** Gas station generates Move source with `transfer::public_transfer(treasury, @{SENDER})` hardcoded. TreasuryCap goes directly to the org stakeholder's address at publish time. They then deposit it into OrgTreasury.

### 4. Dynamic sponsor whitelist persistence — RESOLVED

**Decision:** `EXTRA_ALLOWED_PACKAGES` env var + `published-tokens.json` file. Gas station `/build-token` appends new package IDs to the JSON file. On startup, reads the file. Env var is the manual override.

### 5. Market buy orders — RESOLVED (revised 2026-03-15)

**Decision:** Upgrade existing `ssu_market` (UpgradeCap: `0xa8039526a9dc0f8cd5ad799daa235ccfc51958a40d527eb164b9d56800203eaf`) to add `BuyOrder` struct, `create_buy_order<T>()`, `confirm_buy_order_fill<T>()`. Buy order creation requires `&Organization` parameter for stakeholder check. Fill is stakeholder-confirmed (manual) due to SSU item binding constraint — see "SSU Item Binding Constraint" section. This is the primary currency faucet.

### 6. Currency faucet/sink balance — RESOLVED

**Decision:** Faucets: buy orders (mint → escrow → players sell resources) + bounties (mint → escrow → hunters claim kills). Sinks: sell orders (players buy goods with org tokens → admin receives tokens → recycled into buy orders). Dues/taxes deferred to Phase 2.

### 7. Order matching in exchange contract — RESOLVED (deferred)

**Decision:** Exchange has no `match_orders()` — it is pure escrow. Skip exchange integration entirely. The closed-loop org economy (treasury + market + bounties) doesn't need an exchange. Exchange upgrade is post-hackathon.

## Open Questions

### Game client deposit target inventory — UNRESOLVED (non-blocking)

When a player deposits items to an SSU via the game client UI, which inventory do the items land in?
- **Option A: Owner inventory** — accessed via `deposit_by_owner<T>()`. If so, the market extension cannot see or access these items. The SSU owner would need to manually move items from owner to extension inventory for buy order fills to work.
- **Option B: Open inventory** — accessed via `deposit_to_open_inventory<Auth>()`. If so, the market extension can use `withdraw_from_open_inventory<MarketAuth>()` to verify delivery and automate fills.
- **Option C: Extension inventory** — accessed via `deposit_item<Auth>()`. Unlikely for game client deposits since it requires the Auth witness.

**Impact:** If Option A, the buy order fill model stays manual (stakeholder confirms). If Option B, automated fills are possible post-hackathon. Needs testing on live testnet.

**Status:** Not resolved. The hackathon shipped with the manual `confirm_buy_order_fill` model, which works regardless of which inventory items land in. This question is deferred to post-hackathon automated fills work.

## Previously Resolved Questions

### 1. SSU storage_unit API — RESOLVED
**Signatures confirmed from world-contracts v0.0.18:**
- `withdraw_item<Auth: drop>(storage_unit: &mut StorageUnit, character: &Character, _: Auth, type_id: u64, quantity: u32, ctx: &mut TxContext): Item`
- `deposit_item<Auth: drop>(storage_unit: &mut StorageUnit, character: &Character, item: Item, _: Auth, _: &mut TxContext)`

Both take `Auth: drop` witness (`MarketAuth`), `&Character`, and operate on `Item` objects.

### 2. Partial fills — RESOLVED: Yes (changed 2026-03-15)
**Decision:** Partial fills supported. The manual confirmation model (`confirm_buy_order_fill`) takes a `quantity_filled` parameter and updates the remaining quantity on the order. This is simpler with manual confirmation since the stakeholder can confirm exactly what was delivered. `coin::split()` handles partial payment from the escrow.

### 3. governance_ext publish wallet — RESOLVED: Deployer wallet
**Decision:** Deploy from `0xa4dee9...883d` (same as all other contracts). UpgradeCap stays at that address. Add `governanceExt.packageId` to `CONTRACT_ADDRESSES` after deployment.

### 4. Token template — RESOLVED: Keep mint/burn
**Decision:** Keep `mint()` and `burn()` in the gas station template. They're needed during the bootstrap window: creator publishes token → mints initial supply → deposits TreasuryCap into OrgTreasury. After treasury deposit, the template's mint/burn are unusable (TreasuryCap is locked in the shared object), but they serve the critical bootstrap step.

## Upgrade & Migration Strategy

This section covers how contract upgrades, bug fixes, and new releases propagate to Periscope users seamlessly.

### Sui Package Upgrade Constraints

Sui's "compatible" upgrade policy (the default) allows:
- **Adding** new functions, structs, error codes, dependencies
- **Cannot** change existing public function signatures, remove functions, or alter struct layouts

After an upgrade, the **original package ID** still works for v1 functions and types. New/modified functions are only available at the **new package ID** returned by the upgrade. Shared objects (`OrgTreasury`, `OrgMarket`, `MarketConfig`) survive upgrades — they live on-chain, only the code changes.

**Key implication for bug fixes:** You cannot modify `confirm_buy_order_fill`. You'd publish `confirm_buy_order_fill_v2` and deprecate the original. Callers switch to v2. Existing shared objects continue working.

### Move Contract Upgrade Workflow

#### Step U.1: Upgrade Script

**File:** `scripts/upgrade-contract.sh` (CREATE)

Extend the existing `deploy-contracts.sh` pattern for upgrades:

```bash
#!/usr/bin/env bash
# Upgrade a deployed TehFrontier contract.
#
# Usage: ./scripts/upgrade-contract.sh <contract_name>
# Example: ./scripts/upgrade-contract.sh ssu_market

set -euo pipefail
cd "$(dirname "$0")/.."

NAME="$1"
DIR="contracts/$NAME"
PUBLISHED="$DIR/Published.toml"

# Extract UpgradeCap ID from Published.toml
UPGRADE_CAP=$(grep 'upgrade-capability' "$PUBLISHED" | cut -d'"' -f2)
PUBLISHED_AT=$(grep 'published-at' "$PUBLISHED" | cut -d'"' -f2)

echo "=== Upgrading: $NAME ==="
echo "  UpgradeCap: $UPGRADE_CAP"
echo "  Current version: $(grep 'version' "$PUBLISHED" | head -1)"

# 1. Set Move.toml to upgrade mode (address = published-at, not 0x0)
# The Move.toml should already be configured for upgrade before running this script.
# Verify:
ADDR=$(grep "^$NAME = " "$DIR/Move.toml" | cut -d'"' -f2)
if [ "$ADDR" = "0x0" ]; then
    echo "ERROR: Move.toml still has $NAME = \"0x0\". Set it to \"$PUBLISHED_AT\" first."
    exit 1
fi

# 2. Build
echo "  Building..."
sui move build --path "$DIR"

# 3. Upgrade
echo "  Upgrading..."
OUTPUT=$(sui client upgrade \
    --upgrade-capability "$UPGRADE_CAP" \
    --path "$DIR" \
    --gas-budget 500000000 \
    --json 2>&1)

# 4. Extract new package ID
NEW_PKG=$(echo "$OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('objectChanges', []):
    if c.get('type') == 'published':
        print(c['packageId'])
        break
")

echo "  New package ID: $NEW_PKG"
echo "  Upgrade complete! Update CONTRACT_ADDRESSES with the new package ID."
```

#### Step U.2: Move.toml Mode Switching

Each contract's Move.toml needs two modes:

| Mode | `[addresses]` value | `published-at` | When |
|------|---|---|---|
| Fresh publish | `"0x0"` | absent | Initial deployment |
| Upgrade | `"0xdeployed..."` | `"0xdeployed..."` | All subsequent upgrades |

After initial deployment, the Move.toml should be permanently switched to upgrade mode. The `Published.toml` (auto-generated by `sui client publish/upgrade`) tracks the current state.

#### Step U.3: Version Tracking

After each upgrade:
1. `Published.toml` is auto-updated by Sui CLI (new version number, new package ID)
2. Update `packages/chain-shared/src/config.ts` — change `packageId` to the new package ID
3. Update `apps/periscope/src/chain/config.ts` — update `EXTENSION_TEMPLATES` entries if applicable
4. Update `apps/gas-station/src/config.ts` — new packages are auto-included via `CONTRACT_ADDRESSES`
5. Commit all changes together: `"upgrade: ssu_market v2 — add buy orders"`

### Periscope Seamless User Migration

Periscope users get seamless upgrades through three mechanisms working together:

#### 1. PWA Update Prompt (already configured)

`vite.config.ts` has `VitePWA({ registerType: "prompt" })` — when a new build is deployed:
1. Service worker detects new assets in the background
2. User sees "Update available" prompt (non-disruptive)
3. User clicks to update → page reloads with new version
4. All new code, config, and contract addresses load immediately

No user action beyond clicking "Update" is needed. The prompt appears within minutes of a deploy.

#### 2. IndexedDB Schema Migration (Dexie version bumps)

Dexie auto-migrates the database when the schema version changes. Current: V12. This plan bumps to V13.

**Migration pattern (existing, proven across 12 versions):**
```typescript
this.version(13)
    .stores({
        currencies: "id, orgId, symbol, coinType, packageId",
    })
    .upgrade(async (tx) => {
        // Backfill new fields on existing records
        await tx.table("currencies").toCollection().modify((c) => {
            c.description = c.description ?? "";
            c.moduleName = c.moduleName ?? "";
            c.orgTreasuryId = c.orgTreasuryId ?? "";
        });
    });
```

**Key guarantees:**
- Migrations run automatically on first page load after update
- Existing data is preserved — only new fields are added
- Failed migrations roll back (Dexie transaction safety)
- Skipped versions are applied sequentially (V12 → V13 → V14 if needed)

#### 3. Contract Address Propagation

When a Move contract is upgraded, the package ID changes. Periscope handles this through **build-time config** — contract addresses are baked into the JS bundle via `chain-shared/src/config.ts` and `periscope/src/chain/config.ts`.

**What stays stable across upgrades:**
- `coinType` (e.g., `0x38e749::gold_token::GOLD_TOKEN`) — types are bound to the ORIGINAL package ID forever
- Shared object IDs (`OrgTreasury`, `OrgMarket`, `MarketConfig`) — these are on-chain objects, not tied to package version
- `BountyBoard` object ID — same board across versions

**What changes:**
- `CONTRACT_ADDRESSES.ssuMarket.packageId` → new package ID (for calling new/updated functions)
- `CONTRACT_ADDRESSES.governanceExt.packageId` → new package ID (if governance_ext is upgraded)

**What does NOT need migration in IndexedDB:**
- `CurrencyRecord.packageId` — this is the TOKEN package ID (published by gas station), not the contract being upgraded. These tokens are never upgraded.
- `CurrencyRecord.coinType` — type references are immutable in Sui
- `CurrencyRecord.orgTreasuryId` — shared object ID, stable across upgrades

#### 4. Future Schema Migrations (V14+)

For future upgrades that change the local data model:

```typescript
// Example: V14 adds orgMarketId to a new table
this.version(14)
    .stores({
        orgMarkets: "id, orgId",
    })
    .upgrade(async (tx) => {
        // Populate from on-chain query on next app load
        // (lazy migration — query chain if local record is missing)
    });
```

**Lazy migration pattern:** For data that comes from the chain, don't try to backfill during DB migration. Instead, treat a missing local record as a cache miss and query the chain on first access. This avoids needing network calls during migration.

### Gas Station Upgrades

The gas station is stateless (no database). Upgrades are standard server redeploys:
1. Update code → rebuild → restart service
2. `published-tokens.json` persists across restarts (dynamic whitelist)
3. New `CONTRACT_ADDRESSES` are picked up automatically (imported from `chain-shared`)

### Token Package Upgrades (Not Possible)

Each token published via the gas station is a **separate immutable package**. There is no upgrade path — the token contract is frozen at publish time. This is acceptable because:
- Token logic is minimal (`init` + bootstrap `mint`/`burn`)
- After TreasuryCap deposit into OrgTreasury, the template functions are unusable
- All minting goes through `governance_ext::treasury`, which IS upgradeable

If a token bug is discovered, the org would:
1. Mint remaining supply from the old token
2. Publish a new token package (new symbol/name)
3. Deposit new TreasuryCap into a new OrgTreasury
4. Distribute new tokens to holders (manual or via a migration contract)
5. Retire old buy orders and create new ones with the new token

### Upgrade Checklist Template

For each contract upgrade:
```
- [ ] Create branch: `upgrade/ssu-market-v2`
- [ ] Update Move.toml: address = published address, add `published-at`
- [ ] Make code changes (additive only — no breaking changes)
- [ ] `sui move build` — verify compiles
- [ ] Run upgrade script: `./scripts/upgrade-contract.sh ssu_market`
- [ ] Record new package ID from output
- [ ] Update `packages/chain-shared/src/config.ts` with new package ID
- [ ] Update `apps/periscope/src/chain/config.ts` if extension templates changed
- [ ] Bump Dexie version if schema changes needed
- [ ] Write migration handler if backfill needed
- [ ] Build and deploy Periscope
- [ ] Verify PWA update prompt appears
- [ ] Test migration on fresh install + existing install
- [ ] Commit Published.toml changes
```

### File Summary (Upgrade Infrastructure)

| File | Action | Description |
|------|--------|-------------|
| `scripts/upgrade-contract.sh` | CREATE | Upgrade script (extends deploy pattern) |
| `contracts/*/Move.toml` | MODIFY (per upgrade) | Switch from `"0x0"` to published address |
| `packages/chain-shared/src/config.ts` | MODIFY (per upgrade) | Update `CONTRACT_ADDRESSES` with new package ID |
| `apps/periscope/src/chain/config.ts` | MODIFY (per upgrade) | Update `EXTENSION_TEMPLATES` if needed |
| `apps/periscope/src/db/index.ts` | MODIFY (per schema change) | Add Dexie version bump + migration handler |

## Deferred

- **Exchange integration** — Exchange contract needs `match_orders()` upgrade before it's useful. The closed-loop org economy works without it. Post-hackathon.
- **Tier-based differential pricing** — Different prices for members vs. public. Would require two listings per item or contract upgrade for tier-aware pricing. Deferred until basic market flow is validated.
- **Dues/tax collection** — Periodic membership fees. Sui lacks scheduled transactions. Would need a "pay dues" function that members call manually or a keeper bot. Deferred.
- **Market aggregator** — Cross-org price comparison. Requires indexing multiple MarketConfig objects. Future feature.
- **Token metadata upgrades** — CoinMetadata is frozen at init. Immutable after publish. No solution without a new module.
- **Multi-currency markets** — SSU markets accepting multiple payment tokens. Requires contract changes or multiple MarketConfig objects per SSU.
- **Faucet module** — Time-gated token distribution to members. Could be built as another `governance_ext` module. Deferred because buy orders serve as the primary faucet.
- **Template bytecodes fallback** — Keep `patchBytecodes()` in `token-factory.ts` as client-side publish fallback. Not needed for primary flow but could be wired later.
- **Automated buy order fills** — Once we determine which inventory game client deposits land in (see Open Questions), automated `fill_buy_order` using `withdraw_from_open_inventory<MarketAuth>()` could replace the manual confirmation model. Deferred to post-hackathon.

## Review Notes (2026-03-15)

### Critical Issue Found: SSU Item Binding Constraint

The original plan assumed items could be programmatically transferred between SSUs (`withdraw_item` from player SSU, `deposit_item` to org SSU). **This is impossible** — all deposit functions in `world::storage_unit` (v0.0.18) enforce `parent_id == storage_unit_id`, permanently binding items to their originating SSU.

**Resolution:** Replaced `fill_buy_order` with `confirm_buy_order_fill` (stakeholder-confirmed manual model). Buy orders now specify a target SSU for delivery; players deposit via game client; stakeholders confirm receipt and release payment. See "SSU Item Binding Constraint" section.

### Changes Made During Review

1. **Added "SSU Item Binding Constraint" section** — Documents the parent_id binding and its impact on buy orders
2. **Replaced `fill_buy_order` with `confirm_buy_order_fill`** — Manual stakeholder-confirmed fill model
3. **Changed partial fills to YES** — Manual confirmation naturally supports partial quantities
4. **Added `ssu_id` to `BuyOrder` struct** — Each buy order specifies a target delivery SSU
5. **Added `world` dependency to ssu_market upgrade Move.toml** — Was already in the original Move.toml but missing from the plan's upgrade spec
6. **Added `published-at` field to ssu_market upgrade Move.toml** — Required for Sui package upgrades
7. **Documented UpgradeCap IDs** — `ssu_market`: `0xa803...3eaf`, `governance`: `0x9186...04cb`
8. **Added missing `use world::inventory::Item` import** — The plan's Move code referenced `Item` without importing it
9. **Fixed duplicate step numbering** — Two items were numbered "5." in Target State
10. **Fixed stale duplicate markdown fence** — Extra ` ``` ` between queryBuyOrders and PTB helpers
11. **Fixed `queryBuyOrders` parameter** — Changed `marketConfigId` to `orgMarketId`
12. **Added coordinator notes** — `published-tokens.json` to .gitignore, `treasury.ts` export in chain-shared index
13. **Added new Open Question** — Game client deposit target inventory (owner vs open vs extension)
14. **Moved config updates to Phase 1** — `governanceExt` in ContractAddresses needed after Step 1.1 deploy, not Phase 3
15. **Added detailed gas station template differences** — Documented how it differs from existing `token_template/sources/token.move`

### Review Pass 2 Changes (2026-03-15)

16. **Fixed mutable borrow conflict in `confirm_buy_order_fill`** — The original code mutably borrowed `record` from `market.id`, updated `record.quantity`, then tried to call `dynamic_field::remove(&mut market.id, ...)` in the `if (record.quantity == 0)` block while the `record` reference was still live. This would fail to compile due to a mutable borrow conflict. Fixed by reading `remaining_qty` into a local variable via a block expression, dropping the reference before the conditional remove.

### Review Pass 2 Verified Items (No New Issues Found)

- `governance_ext/Move.toml` dependency `governance = { local = "../governance" }` is the correct pattern for linking to a deployed package while accessing source for type checking. The `[addresses]` override `governance = "0x8bef..."` links to the published on-chain package.
- `ssu_market/Move.toml` upgrade correctly adds both `world` (already present in original) and `governance` (new). The `published-at` field and address override are required for Sui package upgrades. The explicit `Sui` dependency is redundant (transitive via `world`) but harmless.
- `stock_items()` calls `storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx)` — matches actual `deposit_item` signature: `(storage_unit, character, item, _auth, _ctx)`.
- `confirm_buy_order_fill()` — `coin::split(escrowed, payment_amount, ctx)` usage is correct: `escrowed` is `&mut Coin<T>` (via `borrow_mut`), `payment_amount` is `u64`, returns new `Coin<T>`. `dynamic_field::borrow_mut` for coin key is a different dynamic field key than the record key, so no borrow conflict there.
- Gas station template mint/burn use concrete `{OTW_NAME}` type instead of generic `<T>` — this is correct and intentional. The concrete type restricts these functions to only work with this specific token's TreasuryCap, which is the desired behavior for a published module. Both approaches (generic and concrete) are type-safe since `TreasuryCap<T>` enforces the type constraint.
- `treasury.move` calls `governance::org::is_stakeholder_address(org, ctx.sender())` — matches actual signature at `org.move` line 271: `(org: &Organization, addr: address): bool`. The import `use governance::org::Organization` + qualified call `governance::org::is_stakeholder_address` is the correct Move pattern.
- `withdraw_item<Auth>` actual signature takes `quantity: u32`; `buy_and_withdraw` correctly declares `quantity: u32` and casts to `u64` only for `buy_item` call (`quantity as u64`).
- `BuyOrderFilledEvent.ssu_id` uses placeholder `object::id_from_address(@0x0)` — intentional for hackathon (SSU tracked off-chain). Could capture `record.ssu_id` during immutable borrow phase but plan explicitly defers this.

### Review Pass 1 Verified Items

- All file paths referenced in the plan exist in the codebase
- Package IDs match between the plan and `packages/chain-shared/src/config.ts`
- `governance::org::is_stakeholder_address(org: &Organization, addr: address): bool` signature confirmed at line 271 of `contracts/governance/sources/org.move`
- `bounty_board::post_bounty<T>()` signature confirmed — accepts generic `Coin<T>`, no changes needed
- Gas station `buildAndPublishTurret` pattern confirmed in `apps/gas-station/src/buildTurret.ts` — token build can follow same pattern
- `getAllowedPackageIds()` in `apps/gas-station/src/config.ts` confirmed — only static, dynamic whitelist addition is correct approach
- `suiAddressSchema` exists in `packages/shared/src/schemas/auth.ts` and is already imported by `trading.ts`
- DB schema is at V12 (currencies table exists) — V13 bump for new fields is correct
- `CurrencyRecord` type confirmed in `apps/periscope/src/db/types.ts` (lines 480-491) — missing `description`, `moduleName`, `orgTreasuryId` fields
- Sidebar already has Governance section with Finance link — no Trade link yet (Phase 2 addition correct)
- Router already has `/governance/finance` route — `/governance/trade` route needed (Phase 2 addition correct)
- GovernanceDashboard grid is `grid-cols-3` — adding Trade quick action requires `grid-cols-4` (Phase 2)
- All existing contracts use `edition = "2024"` (not `"2024.beta"` despite CLAUDE.md) — plan is consistent
- `token_template/Move.toml` uses `token_template = "0x0"` — gas station approach of generating fresh source is correct (avoids bytecode patching complexity)
- ~~No implementation has been started — all CREATE files are absent, all MODIFY files are in their original state~~ (stale: all code implemented and deployed as of 2026-03-17)

### Review Pass 3 (2026-03-17) — Archive Review

All phases verified as complete with contracts deployed on-chain:

1. **governance_ext** published at `0x670b84...` (v1). Config populated. UpgradeCap recorded in `Published.toml`.
2. **ssu_market** upgraded to v3 at `0xeca760...`. Has evolved beyond original plan: escrow-based `SellOrder` model replaces `stock_items`/`buy_and_withdraw` (deprecated but kept). `originalPackageId` field added to types for coinType references.
3. **GovernanceTrade.tsx** updated to use v3 `SellOrder` functions (buildCreateSellOrder, buildCancelSellOrder, buildBuySellOrder). Now 2053 lines (was 1467 at first commit).
4. **governance_ext/Move.toml** still has `governance_ext = "0x0"` (fresh-publish mode). Should be switched to `"0x670b84..."` with `published-at` before any future upgrade.
5. **DB schema** now at v16 (plan added v13; subsequent plans 13/15 added v14-v16).
6. **ssu-market-dapp** (`apps/ssu-market-dapp/`) built as a separate standalone dApp leveraging plan 06 contract infrastructure.
7. All deployment blockers resolved. Open question about game client deposit inventory remains non-blocking.

**Decision: Move to archive.**
