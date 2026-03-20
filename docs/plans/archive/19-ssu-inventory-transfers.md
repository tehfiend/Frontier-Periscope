# Plan 19: SSU Inventory Transfers

## Overview

Add transfer functions to the `ssu_market` Move contract so the SSU owner and players can move items between inventory slots (owner inventory, escrow, player inventories) without leaving the SSU. The ssu-dapp TransferDialog currently can only move items between the two OwnerCap-gated slots. Extension-authorized functions unlock escrow and cross-player deposits.

The market's existing sell order flow already uses these primitives -- `create_sell_order` escrows items via `deposit_item<MarketAuth>`, and `cancel_sell_order` returns them via `withdraw_item` + `deposit_to_owned`. The new transfer functions generalize this pattern.

## Current State

### Contract (`ssu_market::ssu_market`)

- `MarketAuth` witness registered as extension on SSUs
- `deposit_item<MarketAuth>` -- deposits to owner/main inventory (keyed by `storage_unit.owner_cap_id`)
- `withdraw_item<MarketAuth>` -- withdraws from owner/main inventory
- `deposit_to_open_inventory<MarketAuth>` -- deposits to escrow (open inventory) -- **not used yet**
- `withdraw_from_open_inventory<MarketAuth>` -- withdraws from escrow -- **not used yet**
- `deposit_to_owned<MarketAuth>` -- deposits to any player's inventory (creates slot if needed)
- No functions exist for admin-initiated transfers between arbitrary slots

### Chain-Shared Helpers (`packages/chain-shared/src/ssu-market.ts`)

- `discoverMarketConfig(client, ssuMarketPackageId, ssuId)` -- finds MarketConfig by SSU ID
- `queryMarketConfig(client, configObjectId)` -- reads MarketConfig fields (admin, ssu_id)
- PTB builders for sell orders already exist (`buildCreateSellOrder`, etc.)

### dApp (`ssu-dapp`)

- TransferDialog builds PTBs using `withdraw_by_owner<T>` + `deposit_by_owner<T>` (OwnerCap-gated)
- Only works between Owner Inventory <-> connected player's own Player Inventory
- Escrow and other player inventories show as "(no access)" in destination dropdown
- No ssu_market package ID in ssu-dapp constants -- only world package IDs are configured
- `useOwnerCharacter` hook already resolves OwnerCap ID -> Character object -> metadata.name

### Inventory Slot Terminology

| Slot | Dynamic Field Key | Contract Access |
|------|-------------------|-----------------|
| Owner Inventory | `storage_unit.owner_cap_id` | `deposit_item` / `withdraw_item` (extension) or `deposit_by_owner<StorageUnit>` / `withdraw_by_owner<StorageUnit>` (OwnerCap) |
| Escrow | `blake2b(bcs(ssu_id) + "open_inventory")` | `deposit_to_open_inventory` / `withdraw_from_open_inventory` (extension only) |
| Player: X | `object::id(X's OwnerCap<Character>)` | `deposit_to_owned` (extension, creates on first use) or `deposit_by_owner<Character>` / `withdraw_by_owner<Character>` (player's OwnerCap only) |

### Key storage_unit.move Signatures (verified)

```move
// quantity is u32 in all withdraw functions
public fun withdraw_item<Auth: drop>(su, character, _: Auth, type_id: u64, quantity: u32, ctx): Item
public fun withdraw_from_open_inventory<Auth: drop>(su, character, _: Auth, type_id: u64, quantity: u32, ctx): Item
public fun deposit_item<Auth: drop>(su, character, item: Item, _: Auth, ctx)
public fun deposit_to_open_inventory<Auth: drop>(su, character, item: Item, _: Auth, ctx)
public fun deposit_to_owned<Auth: drop>(su, character, item: Item, _: Auth, ctx)
// deposit_by_owner has non-obvious arg order: (su, item, character, owner_cap, ctx)
public fun deposit_by_owner<T: key>(su, item: Item, character, owner_cap, ctx)
public fun withdraw_by_owner<T: key>(su, character, owner_cap, type_id: u64, quantity: u32, ctx): Item
```

## Target State

### New Contract Functions

**7 transfer functions** covering all valid directions:

```move
// ── Admin functions (require config.admin == ctx.sender()) ──────────────

// Owner Inventory -> Escrow
public fun admin_to_escrow(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
)   // = withdraw_item + deposit_to_open_inventory

// Escrow -> Owner Inventory
public fun admin_from_escrow(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
)   // = withdraw_from_open_inventory + deposit_item

// Owner Inventory -> Player X (direct, no escrow hop)
public fun admin_to_player(
    config: &MarketConfig, ssu: &mut StorageUnit, admin_character: &Character,
    recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
)   // = withdraw_item + deposit_to_owned(recipient)

// Escrow -> Player X (direct)
public fun admin_escrow_to_player(
    config: &MarketConfig, ssu: &mut StorageUnit, admin_character: &Character,
    recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
)   // = withdraw_from_open_inventory + deposit_to_owned(recipient)

// ── Player functions (any player, no admin check) ──────────────────────

// Player deposits Item to Escrow (Item provided from PTB via OwnerCap withdraw)
public fun player_to_escrow(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    item: Item, ctx: &mut TxContext,
)   // = deposit_to_open_inventory

// Player deposits Item to Owner Inventory (Item provided from PTB via OwnerCap withdraw)
public fun player_to_owner(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    item: Item, ctx: &mut TxContext,
)   // = deposit_item

// ── Admin-only escrow withdrawal ───────────────────────────────────────

// Escrow -> Player (self) -- admin only
// (player_from_escrow requires admin to prevent unauthorized escrow withdrawal)
public fun admin_escrow_to_self(
    config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
    type_id: u64, quantity: u32, ctx: &mut TxContext,
)   // = withdraw_from_open_inventory + deposit_to_owned(self)
```

**Note:** `quantity` is `u32` to match the underlying `storage_unit::withdraw_item` / `withdraw_from_open_inventory` signatures. The `character` arg in admin functions is the admin's own character (needed for inventory event emission). Both `deposit_item` and `deposit_to_open_inventory` check `parent_id(&item) == storage_unit_id` -- this is satisfied because all items are withdrawn from the same SSU within the same PTB.

### Transfer Matrix

| From \ To | Owner Inv | Escrow | Player X | Player (self) |
|-----------|-----------|--------|----------|---------------|
| **Owner Inv** | -- | `admin_to_escrow` | `admin_to_player` | OwnerCap direct |
| **Escrow** | `admin_from_escrow` | -- | `admin_escrow_to_player` | `admin_escrow_to_self` |
| **Player (self)** | `player_to_owner` (PTB) | `player_to_escrow` (PTB) | -- | -- |
| **Player X** | Cannot (no withdraw_from_owned) | Cannot | Cannot | Cannot |

### Updated dApp

- TransferDialog detects the SSU's extension via MarketConfig
- For `MarketAuth` SSUs: builds PTBs using the new `ssu_market` transfer functions
- All visible slots become valid destinations (escrow, other players for admin; escrow + owner for players)
- Destination dropdown shows all slots with correct access per role

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where to add functions | `ssu_market` contract (upgrade) | Same `MarketAuth` witness, no extension swap needed |
| Admin auth check | `config.admin == ctx.sender()` | Consistent with existing sell order functions |
| `player_to_escrow` access | Any player | Enables player-initiated sell orders later; `parent_id` check prevents cross-SSU abuse |
| `player_to_owner` access | Any player | Players can return/contribute items to the SSU owner |
| Escrow withdrawal | Admin-only | Prevents unauthorized withdrawal of escrowed items (sell orders, etc.) |
| Escrow -> Player X | Single atomic function (`admin_escrow_to_player`) | Simpler PTB, less gas, no intermediate staging |
| Owner <-> Player (self) | Keep existing OwnerCap direct path | No extension needed, already works |
| Player -> other player | Not supported | Contract has no `withdraw_from_owned<Auth>` |

## Implementation Phases

### Phase 1: Contract -- Add transfer functions to ssu_market -- COMPLETE

**Files:** `contracts/ssu_market/sources/ssu_market.move`, `contracts/ssu_market_utopia/sources/ssu_market.move`

**Important:** `quantity` is `u32` in all functions below to match `storage_unit::withdraw_item` / `withdraw_from_open_inventory` signatures. No new error codes needed -- reuses existing `ENotAdmin` (code 0) and `ESSUMismatch` (code 10).

1. Add event struct and helper near the existing events/structs:
   ```move
   public struct TransferEvent has copy, drop {
       market_id: ID,
       ssu_id: ID,
       from_slot: vector<u8>,  // b"owner", b"escrow", b"player"
       to_slot: vector<u8>,
       type_id: u64,
       quantity: u64,
       sender: address,
   }
   ```

2. Add helper for common admin + SSU assertions:
   ```move
   fun assert_admin(config: &MarketConfig, ssu: &StorageUnit, ctx: &TxContext) {
       assert!(ctx.sender() == config.admin, ENotAdmin);
       assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
   }
   ```

3. Add `admin_to_escrow`:
   ```move
   public fun admin_to_escrow(
       config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
       type_id: u64, quantity: u32, ctx: &mut TxContext,
   ) {
       assert_admin(config, ssu, ctx);
       let item = storage_unit::withdraw_item<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
       storage_unit::deposit_to_open_inventory<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
       event::emit(TransferEvent {
           market_id: object::id(config), ssu_id: config.ssu_id,
           from_slot: b"owner", to_slot: b"escrow",
           type_id, quantity: (quantity as u64), sender: ctx.sender(),
       });
   }
   ```

4. Add `admin_from_escrow`:
   ```move
   public fun admin_from_escrow(
       config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
       type_id: u64, quantity: u32, ctx: &mut TxContext,
   ) {
       assert_admin(config, ssu, ctx);
       let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
       storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
       event::emit(TransferEvent {
           market_id: object::id(config), ssu_id: config.ssu_id,
           from_slot: b"escrow", to_slot: b"owner",
           type_id, quantity: (quantity as u64), sender: ctx.sender(),
       });
   }
   ```

5. Add `admin_to_player`:
   ```move
   public fun admin_to_player(
       config: &MarketConfig, ssu: &mut StorageUnit, admin_character: &Character,
       recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
   ) {
       assert_admin(config, ssu, ctx);
       let item = storage_unit::withdraw_item<MarketAuth>(ssu, admin_character, MarketAuth {}, type_id, quantity, ctx);
       storage_unit::deposit_to_owned<MarketAuth>(ssu, recipient_character, item, MarketAuth {}, ctx);
       event::emit(TransferEvent {
           market_id: object::id(config), ssu_id: config.ssu_id,
           from_slot: b"owner", to_slot: b"player",
           type_id, quantity: (quantity as u64), sender: ctx.sender(),
       });
   }
   ```

6. Add `admin_escrow_to_player`:
   ```move
   public fun admin_escrow_to_player(
       config: &MarketConfig, ssu: &mut StorageUnit, admin_character: &Character,
       recipient_character: &Character, type_id: u64, quantity: u32, ctx: &mut TxContext,
   ) {
       assert_admin(config, ssu, ctx);
       let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, admin_character, MarketAuth {}, type_id, quantity, ctx);
       storage_unit::deposit_to_owned<MarketAuth>(ssu, recipient_character, item, MarketAuth {}, ctx);
       event::emit(TransferEvent {
           market_id: object::id(config), ssu_id: config.ssu_id,
           from_slot: b"escrow", to_slot: b"player",
           type_id, quantity: (quantity as u64), sender: ctx.sender(),
       });
   }
   ```

7. Add `admin_escrow_to_self`:
   ```move
   public fun admin_escrow_to_self(
       config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
       type_id: u64, quantity: u32, ctx: &mut TxContext,
   ) {
       assert_admin(config, ssu, ctx);
       let item = storage_unit::withdraw_from_open_inventory<MarketAuth>(ssu, character, MarketAuth {}, type_id, quantity, ctx);
       storage_unit::deposit_to_owned<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
       event::emit(TransferEvent {
           market_id: object::id(config), ssu_id: config.ssu_id,
           from_slot: b"escrow", to_slot: b"player",
           type_id, quantity: (quantity as u64), sender: ctx.sender(),
       });
   }
   ```

8. Add `player_to_escrow`:
   ```move
   public fun player_to_escrow(
       config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
       item: Item, ctx: &mut TxContext,
   ) {
       assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
       let qty = (item.quantity() as u64);
       let type_id = item.type_id();
       storage_unit::deposit_to_open_inventory<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
       event::emit(TransferEvent {
           market_id: object::id(config), ssu_id: config.ssu_id,
           from_slot: b"player", to_slot: b"escrow",
           type_id, quantity: qty, sender: ctx.sender(),
       });
   }
   ```

9. Add `player_to_owner`:
   ```move
   public fun player_to_owner(
       config: &MarketConfig, ssu: &mut StorageUnit, character: &Character,
       item: Item, ctx: &mut TxContext,
   ) {
       assert!(object::id(ssu) == config.ssu_id, ESSUMismatch);
       let qty = (item.quantity() as u64);
       let type_id = item.type_id();
       storage_unit::deposit_item<MarketAuth>(ssu, character, item, MarketAuth {}, ctx);
       event::emit(TransferEvent {
           market_id: object::id(config), ssu_id: config.ssu_id,
           from_slot: b"player", to_slot: b"owner",
           type_id, quantity: qty, sender: ctx.sender(),
       });
   }
   ```

### Phase 2: Build and deploy contract upgrade -- COMPLETE

1. ~~Build both `ssu_market` and `ssu_market_utopia`~~ DONE
2. ~~Publish upgrade to testnet (utopia first, then stillness)~~ DONE
   - Utopia: `0xde7c7dacdfb98fa507f1ee70ea13c056b8b00a6b2a9060ae387306e84147df1d` (v2, tx `CbJEYpmESHXCUdoAUo8ZCvs8VD1PNiWMv813upq8BiBq`)
   - Stillness: `0x35c690bb9d049b78856e990bfe439709d098922de369d0f959a1b9737b6b824e` (v4, tx `AynqR7yzmXSHBZ2vSkh6Pqpc6pUdZ7SsYiHPPQDhzhn7`)
   - Note: Stillness required creating `contracts/world_stillness/` (local World dependency with correct address `0x28b49755...`) because the git dependency resolved to `0x0`.
3. ~~Update `packages/chain-shared/src/config.ts`~~ DONE -- both tenant `ssuMarket.packageId` entries updated
4. ~~Verify new functions are callable via dApp testing~~ DONE -- dApp wired up in Phases 3-5

### Phase 3: Update ssu-dapp -- MarketConfig detection and TransferContext -- COMPLETE

**Files:** `apps/ssu-dapp/src/hooks/useMarketConfig.ts` (new), `apps/ssu-dapp/src/lib/constants.ts`, `apps/ssu-dapp/src/views/SsuView.tsx`

1. Add ssu_market package ID accessor to `apps/ssu-dapp/src/lib/constants.ts`:
   ```ts
   import { getContractAddresses, type TenantId } from "@tehfrontier/chain-shared";

   /** Get the ssu_market package ID for the current tenant (latest version, for moveCall targets) */
   export function getSsuMarketPackageId(tenant?: string): string | null {
       const t = (tenant ?? getTenant()) as TenantId;
       return getContractAddresses(t).ssuMarket?.packageId ?? null;
   }

   /** Get the ssu_market original package ID for the current tenant (for type filtering in GraphQL) */
   export function getSsuMarketOriginalPackageId(tenant?: string): string | null {
       const t = (tenant ?? getTenant()) as TenantId;
       const m = getContractAddresses(t).ssuMarket;
       return m?.originalPackageId ?? m?.packageId ?? null;
   }
   ```
   **Note:** IDs already exist in `packages/chain-shared/src/config.ts` (`CONTRACT_ADDRESSES[tenant].ssuMarket`) -- do NOT duplicate them. After Phase 2 upgrades the contract, update the `packageId` values in `chain-shared/config.ts`, not here.

2. Create `useMarketConfig` hook (`apps/ssu-dapp/src/hooks/useMarketConfig.ts`):
   - Uses `discoverMarketConfig` from `@tehfrontier/chain-shared` (already exists)
   - Pass `originalPackageId` (not `packageId`) to `discoverMarketConfig` for GraphQL type filtering
   - Then `queryMarketConfig` to get admin address
   - Returns `{ configObjectId: string, admin: string, packageId: string } | null`
   - `packageId` = latest version from `getSsuMarketPackageId()` (used for PTB moveCall targets)
   - `configObjectId` = MarketConfig object ID discovered on-chain
   - `admin` = MarketConfig.admin address
   - Enabled only when SSU has a MarketAuth extension (check `assembly.extensionType` contains "ssu_market")

3. Extend `TransferContext` in `TransferDialog.tsx`:
   - Add `marketConfigId?: string`, `marketPackageId?: string`, `isAdmin: boolean`
   - `isAdmin` = `marketConfig.admin === walletAddress`

4. In `SsuView.tsx`, integrate `useMarketConfig`:
   - Call `useMarketConfig(objectId)` when `assembly.extensionType` includes "ssu_market"
   - Pass market info into `TransferContext` alongside existing slotCaps
   - When market extension active AND `isAdmin`: the transferContext should work for ALL visible slots (not just OwnerCap-gated ones)

### Phase 3b: Update ssu-dapp -- destination computation and PTB construction -- COMPLETE

**Files:** `apps/ssu-dapp/src/components/TransferDialog.tsx`, `apps/ssu-dapp/src/components/InventoryTabs.tsx`

1. Update destination computation in `InventoryTabs.tsx`:
   - If `transferContext.marketConfigId` exists: all visible slots become valid destinations
   - Admin: can transfer from Owner Inv or Escrow to any other slot
   - Player: can transfer from own Player Inv to Escrow or Owner Inv
   - Keep `inaccessibleSlots` only for non-market SSUs and non-admin non-self player slots
   - Admin transferring from Owner Inv or Escrow also sees a "Send to player..." option (Phase 5)

2. Refactor PTB construction in `TransferDialog.tsx` -- route by source/dest slot types:
   - **Owner -> Escrow** (admin): simple `admin_to_escrow(config, ssu, char, type_id, qty)` -- no cap borrow needed
   - **Escrow -> Owner** (admin): simple `admin_from_escrow(config, ssu, char, type_id, qty)`
   - **Owner -> Player X** (admin): `admin_to_player(config, ssu, admin_char, recipient_char, type_id, qty)` -- needs recipient Character object
   - **Escrow -> Player X** (admin): `admin_escrow_to_player(config, ssu, admin_char, recipient_char, type_id, qty)`
   - **Escrow -> Player (self, admin)**: `admin_escrow_to_self(config, ssu, char, type_id, qty)`
   - **Player (self) -> Escrow**: PTB: borrow cap + `withdraw_by_owner` + return cap, then `player_to_escrow(config, ssu, char, item)` -- note `item` comes from withdraw result
   - **Player (self) -> Owner**: PTB: borrow cap + `withdraw_by_owner` + return cap, then `player_to_owner(config, ssu, char, item)`
   - **Owner <-> Player (self)**: existing OwnerCap-based PTB (no market extension needed, keep as-is)

3. Important implementation detail for admin PTBs: admin functions take `character: &Character` as a shared object reference -- use `tx.object(characterObjectId)`, no cap borrow needed. For `admin_to_player`/`admin_escrow_to_player`, the `recipient_character` is also passed as `tx.object(recipientCharacterObjectId)`.

4. Important detail for player PTBs: the player functions take `item: Item` which comes from the `withdraw_by_owner` result in the same PTB. The borrow/return cap sequence wraps the withdraw, and the `player_to_escrow`/`player_to_owner` call comes after `return_owner_cap`.

### Phase 4: Resolve recipient Character for admin -> player transfers -- COMPLETE

**Files:** `apps/ssu-dapp/src/hooks/useInventory.ts`, `apps/ssu-dapp/src/hooks/useOwnerCharacter.ts`

Player inventory slots are keyed by `OwnerCap<Character>` ID. The admin transfer functions need the `Character` object ID (not the OwnerCap ID) as the `recipient_character` argument.

1. Extend `LabeledInventory` interface with optional `characterObjectId?: string` field
2. The resolution logic already exists in `useOwnerCharacter.ts` (lines 47-54):
   - Step 1: GraphQL query on the OwnerCap object -> its `owner` is the Character (ObjectOwner variant)
   - Step 2: The owner address IS the Character object ID
   - For Phase 4 we only need the Character object ID (from step 1), not the name (step 2 of useOwnerCharacter)
3. In `useInventory.ts`, add a parallel query (alongside `characterNamesQuery`) that resolves `characterObjectId` for each player slot:
   - For each player key, query the OwnerCap<Character> object's owner -> that's the Character object ID
   - Merge into `LabeledInventory` alongside `characterName`
   - Cache results (5 min stale time, same as names)
4. This resolution is only needed when the user is the SSU admin (admin needs recipient char IDs). Two options:
   - **Option A (recommended):** Add an `isAdmin?: boolean` parameter to `useInventory` and pass it from `SsuView.tsx`. Only run the characterObjectId query when `isAdmin` is true.
   - **Option B (implemented):** Always resolve characterObjectIds for all player slots (small overhead, simpler API). Character objects are shared and cheap to query.
   - The extra query runs alongside the existing `characterNamesQuery` and reuses the same OwnerCap owner lookup pattern from `useOwnerCharacter.ts`.

### Phase 5: Character search for admin -> new player transfers -- COMPLETE

**Files:** `apps/ssu-dapp/src/hooks/useCharacterSearch.ts` (new), `apps/ssu-dapp/src/components/TransferDialog.tsx`

When the admin transfers from Owner Inventory or Escrow, the recipient player may not have
an existing inventory slot on the SSU (they've never deposited items). The contract's
`deposit_to_owned<Auth>` creates the slot on first use, so the transfer still works -- but the
dApp needs a way to find the recipient by name.

1. Add a "Send to player..." option in the destination dropdown (admin only, when source is Owner Inv or Escrow)
2. When selected, show a character name search input (debounced text field)
3. New hook `useCharacterSearch(query)`:
   - Query Character objects via GraphQL: filter by type `${worldPkg}::character::Character`, paginate
   - Match against `metadata.name` (case-insensitive substring)
   - Return matching characters: `{ characterObjectId, characterName, ownerCapId }`
   - Cache results to avoid repeated queries
4. Display search results as selectable list below the input
5. On selection: store the Character object ID as the recipient for `admin_to_player` / `admin_escrow_to_player`
6. Show the selected character name in the destination field
7. Capacity indicator: for new slots, use the SSU's max capacity with 0 used (same as existing synthetic slot logic)

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `contracts/ssu_market/sources/ssu_market.move` | Modify | Add 7 transfer functions + assert_admin helper + TransferEvent |
| `contracts/ssu_market_utopia/sources/ssu_market.move` | Modify | Same changes (utopia copy) |
| `packages/chain-shared/src/config.ts` | Modify | Update `ssuMarket.packageId` after contract upgrade (Phase 2) |
| `apps/ssu-dapp/src/lib/constants.ts` | Modify | Add `getSsuMarketPackageId`/`getSsuMarketOriginalPackageId` helpers (import from chain-shared) |
| `apps/ssu-dapp/src/hooks/useMarketConfig.ts` | Create | Discover + query MarketConfig for SSU (wraps chain-shared helpers) |
| `apps/ssu-dapp/src/hooks/useCharacterSearch.ts` | Create | Search characters by name for admin -> new player transfers |
| `apps/ssu-dapp/src/components/TransferDialog.tsx` | Modify | Role-aware PTB builders, character search UI for admin |
| `apps/ssu-dapp/src/components/InventoryTabs.tsx` | Modify | Role-based destination access (admin vs player) |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Modify | Integrate useMarketConfig, pass market info to TransferContext |
| `apps/ssu-dapp/src/hooks/useInventory.ts` | Modify | Add characterObjectId to LabeledInventory, resolve for player slots |

## Deferred

- Player-to-player direct transfers (requires `withdraw_from_owned<Auth>` which doesn't exist in world contracts)
- Batch transfers (multiple item types in one call)
- Transfer limits / rate limiting
- Non-market SSUs (would need a standalone transfer extension)
