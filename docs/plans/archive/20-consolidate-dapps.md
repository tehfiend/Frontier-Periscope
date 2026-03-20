# Plan: Consolidate Standalone dApps

**Status:** Complete
**Created:** 2026-03-19
**Completed:** 2026-03-19
**Module:** ssu-dapp, periscope

## Dependencies

**Plan 21 (Market Architecture Simplification) Phases 1-6 must complete before Phase 1 of this plan.** Plan 21 replaces the on-chain object model (MarketConfig -> SsuConfig, OrgMarket deleted, sell/buy orders move to Market<T>) and updates the chain-shared layer + ssu-dapp hooks accordingly. This plan builds on top of those changes.

Specifically:
- Phase 1 of this plan requires Plan 21's chain-shared types (`SsuConfigInfo`, `MarketSellListing`, `MarketBuyOrder`) and builders (`buildEscrowAndList`, `buildCancelListing`, `buildBuyFromListing`, `buildPostBuyOrder`, `queryMarketListings`, `queryMarketBuyOrders`) to exist.
- Phase 1 of this plan requires Plan 21's Phase 6 ssu-dapp changes (useSsuConfig hook, updated TransferDialog with ssuConfigId/marketId, updated SsuView) to be in place. This plan modifies those files further.
- Phase 2 (Periscope ACLs) has **no dependency** on Plan 21 and can execute in parallel.

## Overview

Two standalone dApps (permissions-dapp, ssu-market-dapp) have no hosting and no independent use case. Their functionality should be absorbed into existing apps (periscope, ssu-dapp) before the hackathon deadline. All chain interactions are already in `@tehfrontier/chain-shared` -- this is purely a UI porting exercise.

## Current State

(After Plan 21 completes)

- `apps/permissions-dapp` (~2,587 LOC): Standalone Gate ACL management SPA. Inline ACL editor, shared ACL browser/editor, admin panel. All chain calls via chain-shared.
- `apps/ssu-market-dapp` (~1,751 LOC): Standalone SSU sell order browser + currency market browser. All chain calls via chain-shared. Post-Plan 21, this app uses `Market<T>` queries and types.
- `apps/periscope`: Already has `/permissions` route with Groups + Policies tabs.
- `apps/ssu-dapp`: Has `useSsuConfig` hook (renamed from useMarketConfig by Plan 21) + market-routed transfers via ssuConfigId. No market orders UI. Current layout: AssemblyHeader -> InventoryTabs -> Owner Controls (MetadataEditor, ExtensionInfo, AssemblyActions).

## Target State

- SSU dApp is reorganized into a two-card layout: SSU Info Card (header + inline edit) + ContentTabs (Inventory / Market).
- Inventory tab gains a "Sell" button for owner-slot items when market is configured (SsuConfig has a linked marketId).
- Market tab shows sell listings (buyer view + admin management) and buy orders. Both come from Market<T> -- no discovery needed beyond the marketId available from `useSsuConfig().marketId`.
- Periscope gains an "ACLs" tab in the existing Permissions view for gate ACL configuration + shared ACL management.
- Standalone apps can be removed post-hackathon.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SSU layout | Two-card: SsuInfoCard + ContentTabs | Clean separation of identity (static) from content (tabbed). Replaces the linear AssemblyHeader -> InventoryTabs -> Owner Controls layout. |
| Edit button on SSU info | Pencil icon in header top-right, toggles inline MetadataEditor | 3 fields don't justify a separate dialog; keeps context |
| Top-level tabs | "Inventory" / "Market" as primary tab bar in ContentTabs | Clean separation; Market tab only shown when ssuConfig.marketId exists |
| Sell button placement | Actions column in InventoryTable, owner slot only | Only SSU owner can use the sell flow (requires OwnerCap borrow). Delegates cannot sell via this PTB path -- they lack the OwnerCap. |
| Sell flow | Single PTB via `buildEscrowAndList` | Atomic: borrow cap -> withdraw -> escrow_and_list -> return cap |
| Market tab structure | Vertical sections (Sell Listings + Buy Orders), not sub-tabs | Both lists are short; avoids 3-level tab nesting |
| coinType for purchases | Hardcode per-tenant in `lib/constants.ts` | Pragmatic for hackathon; can be made dynamic later |
| Buy order source | Market<T> via `queryMarketBuyOrders(client, marketId)` | Buy orders live on Market<T> directly -- no OrgMarket discovery needed. marketId comes from SsuConfig. |
| Buy orders section | Show when ssuConfig.marketId is available; hidden otherwise | Graceful degradation when no market is linked |
| Currency market | Defer | Not SSU-specific, different concern, hackathon time constraint |
| Permissions integration | New "ACLs" tab in existing Permissions view | Same conceptual domain (access control), avoids new routes |
| AdminPanel | Defer | Secondary feature, not critical for hackathon |
| Assembly selection for ACL | Reuse useOwnedAssemblies() dropdown | Periscope already queries owned gates |

## Phase 1: SSU Market -> SSU dApp (Two-Card Redesign + Market Tab)

### Target Layout

```
+---------------------------------------+
| SSU Info Card                   [Edit] |
|  Name, status, type, owner, extension  |
|  dApp URL, connected wallet            |
|  [MetadataEditor -- expanded on Edit]  |
+---------------------------------------+

+---------------------------------------+
| [Inventory]  [Market]                  |
|---------------------------------------|
| (active tab content)                   |
|                                        |
| Inventory: capacity bar, slot sub-tabs |
|   item table w/ Transfer + Sell btns   |
|                                        |
| Market: sell listings (admin/buyer)    |
|   buy orders + Create Buy Order btn    |
+---------------------------------------+
```

### Component Hierarchy

```
SsuView (container -- all data fetching)
|
|-- SsuInfoCard
|     |-- AssemblyHeader (+ [Edit] button when isOwner)
|     |-- MetadataEditor (inline, toggled by Edit)
|
|-- ContentTabs
      |
      |-- Tab: "Inventory" --> InventoryTabs (existing component)
      |     |-- Capacity bar (existing)
      |     |-- Slot sub-tabs: owner / escrow / player (existing)
      |     |-- InventoryTable (existing + Sell button in Actions)
      |     |-- TransferDialog (existing)
      |     |-- SellDialog (new -- qty + price inputs)
      |
      |-- Tab: "Market" (when ssuConfig.marketId) --> MarketContent
            |-- Sell Listings section
            |     |-- Admin: ListingAdminList (edit price/qty, cancel)
            |     |-- Non-admin: ListingBuyerList -> ListingCard
            |
            |-- Buy Orders section (inline in MarketContent)
                  |-- buy order cards (inline)
                  |-- [Create Buy Order] -> CreateBuyOrderDialog
```

### Phase 1A: SSU Info Card + Edit Toggle

1. **Create `ssu-dapp/src/components/SsuInfoCard.tsx`** (~60 LOC)
   - Renders AssemblyHeader + optional MetadataEditor
   - Manages `isEditing` state
   - Props: assembly, itemId, ownerCharacterName, connectedWalletAddress, connectedCharacterName, isOwner, characterObjectId, ownerCap

2. **Modify `ssu-dapp/src/components/AssemblyHeader.tsx`**
   - Add `onEdit?: () => void` prop to `AssemblyHeaderProps`
   - Render pencil icon button in top-right when `onEdit` is provided
   - Remove `buildMarketDappUrl()` function and "View Market" link (market is now inline in ContentTabs)
   - Remove `isMarketExtension()` helper (no longer needed)

3. **Modify `ssu-dapp/src/views/SsuView.tsx`**
   - Replace `<AssemblyHeader>` + owner controls section with `<SsuInfoCard>`
   - MetadataEditor no longer renders in separate "Owner Controls" section

### Phase 1B: Content Tabs + Sell Action

4. **Create `ssu-dapp/src/components/ContentTabs.tsx`** (~100 LOC)
   - Top-level "Inventory" / "Market" tab bar (segmented control style)
   - Market tab only rendered when `ssuConfig.marketId` prop exists
   - Manages `activeTab` state (`"inventory" | "market"`)
   - Manages `sellDialogItem` state for SellDialog (set via `onSell` callback from InventoryTabs)
   - When inventory tab active: renders existing `InventoryTabs` component with `onSell`/`canSell` props
   - When market tab active: renders `MarketContent` component
   - Renders `SellDialog` when `sellDialogItem` is set

5. **Modify `ssu-dapp/src/components/InventoryTabs.tsx`**
   - Add `onSell?: (item: InventoryItem) => void` and `canSell?: boolean` props to `InventoryTabsProps`
   - Thread `onSell` and `canSell` to `InventoryTable`
   - SellDialog is NOT managed here -- `onSell` callback bubbles up to ContentTabs which owns the dialog state (it has access to ssuObjectId, characterObjectId, ownerCap, ssuConfig)

6. **Modify `ssu-dapp/src/components/InventoryTable.tsx`**
   - Add `canSell?: boolean` and `onSell?: (item: InventoryItem) => void` props to `InventoryTableProps`
   - Render "Sell" button (amber color) in Actions column alongside existing Transfer button
   - Actions column shows: [Transfer] [Sell] when both available

7. **Create `ssu-dapp/src/components/SellDialog.tsx`** (~120 LOC)
   - Modal dialog (same pattern as `TransferDialog`)
   - Inputs: quantity (max = `item.quantity`), price per unit
   - Preview: total value = qty * price
   - Submit: calls `buildEscrowAndList` from `@tehfrontier/chain-shared`
   - Props: item, ssuObjectId, characterObjectId, ownerCap, ssuConfig (with ssuConfigId, marketId, packageId), coinType, onClose

### Phase 1C: Market Tab

8. **Create `ssu-dapp/src/hooks/useMarketListings.ts`** (~30 LOC)
   - Uses `queryMarketListings` from `@tehfrontier/chain-shared` (market.ts)
   - Uses `resolveItemNames` from `@/lib/items` (local to ssu-dapp, NOT chain-shared)
   - Query key: `["marketListings", marketId]`
   - Enabled only when `marketId` is provided

9. **Create `ssu-dapp/src/components/MarketContent.tsx`** (~60 LOC)
   - Container: Sell Listings section + Buy Orders section
   - Receives: ssuConfig (with marketId, packageId), listings, buyOrders, isAuthorized, characterObjectId, isConnected, coinType

10. **Create `ssu-dapp/src/components/ListingAdminList.tsx`** (~130 LOC)
    - Port of `ssu-market-dapp/src/components/OwnerView.tsx`
    - Admin sell listing management: inline edit price/qty, cancel listing
    - Uses `buildUpdateSellListing` from chain-shared (market.ts) for price/qty updates
    - Uses `buildCancelListing` from chain-shared (ssu-market.ts) for cancellation (returns items to SSU owner inventory)

11. **Create `ssu-dapp/src/components/ListingBuyerList.tsx`** (~40 LOC) + **`ListingCard.tsx`** (~90 LOC)
    - Port of `ssu-market-dapp/src/components/BuyerView.tsx` + `ListingCard.tsx`
    - Buyer-facing: browse listings, qty slider, buy button
    - Uses `buildBuyFromListing` from chain-shared (ssu-market.ts)
    - `characterObjectId` now available (was TODO in market dApp)

12. **Create `ssu-dapp/src/hooks/useBuyOrders.ts`** (~25 LOC)
    - Uses `queryMarketBuyOrders(client, marketId)` from chain-shared (market.ts)
    - Enabled only when `marketId` is provided
    - Query key: `["marketBuyOrders", marketId]`
    - No discovery needed -- marketId comes directly from `useSsuConfig().marketId`

13. **Create `ssu-dapp/src/components/CreateBuyOrderDialog.tsx`** (~110 LOC)
    - Port of `ssu-market-dapp/src/components/PostBuyOrderForm.tsx` as modal dialog
    - Inputs: payment coin ID, item type ID, quantity, price per unit
    - Uses `buildPostBuyOrder` from chain-shared (market.ts)
    - Requires marketId + coinType props (no orgMarketId/orgObjectId needed)

14. **Update `ssu-dapp/src/views/SsuView.tsx` render tree**
    - Final structure: `<SsuInfoCard>` + `<ContentTabs>`
    - Add `useMarketListings(ssuConfig?.marketId)` call
    - Add `useBuyOrders(ssuConfig?.marketId)` call
    - Remove separate "Owner Controls" section (MetadataEditor moved into SsuInfoCard)
    - Keep `AssemblyActions` and `ExtensionInfo` at bottom for now (deferred)
    - Thread all data down to ContentTabs

15. **Update `ssu-dapp/src/hooks/useSignAndExecute.ts`**
    - Add `queryClient.invalidateQueries({ queryKey: ["marketListings"] })` after successful TX
    - Add `queryClient.invalidateQueries({ queryKey: ["marketBuyOrders"] })` after successful TX

## Sell Flow Detail

```
User clicks "Sell" on item in owner inventory slot
  -> SellDialog opens (qty + price inputs)
  -> Submit calls buildEscrowAndList({
       packageId: ssuConfig.packageId,
       worldPackageId: getWorldPackageId(getTenant()),
       ssuConfigId: ssuConfig.ssuConfigId,
       marketId: ssuConfig.marketId,
       coinType: getCoinType(),
       ssuObjectId,
       characterObjectId,
       ownerCapReceivingId: ownerCap.objectId,
       typeId: item.typeId,
       quantity,
       pricePerUnit,
       senderAddress
     })
  -> Single PTB: borrow_owner_cap -> withdraw_by_owner -> escrow_and_list<T> -> return_owner_cap
  -> On success: invalidate ["ssu-inventories", ...] + ["marketListings", ...] queries
```

## Sell Button Visibility Rules

The "Sell" button appears on inventory items when ALL of:
- `isOwner` -- connected wallet is the SSU owner (the sell PTB requires borrowing OwnerCap<StorageUnit> which only the owner's Character holds; delegates cannot use this flow)
- `ssuConfig.marketId` exists -- SSU has a linked market
- Current slot is `"owner"` type -- items must come from owner inventory
- Wallet is connected

## Buy Order Discovery

Buy orders live on Market<T> directly. No separate discovery mechanism needed.

1. `useSsuConfig` hook discovers the SsuConfig for the SSU and returns `marketId` (if set).
2. `useBuyOrders(marketId)` queries `queryMarketBuyOrders(client, marketId)` to get all buy orders.
3. When `marketId` is null (no market linked to SsuConfig), both buy orders and sell listings sections are hidden.

Key chain-shared functions for buy orders:
- `queryMarketBuyOrders(client, marketId)` from `market.ts` -- list all buy orders on Market<T>
- `buildPostBuyOrder(params)` from `market.ts` -- create buy order with escrowed payment on Market<T>

Key chain-shared functions for sell listings:
- `queryMarketListings(client, marketId)` from `market.ts` -- list all sell listings on Market<T>
- `buildEscrowAndList(params)` from `ssu-market.ts` -- escrow items + post listing (ssu_market -> market)
- `buildBuyFromListing(params)` from `ssu-market.ts` -- buy from listing (ssu_market -> market)
- `buildCancelListing(params)` from `ssu-market.ts` -- cancel listing + return items (ssu_market -> market)
- `buildUpdateSellListing(params)` from `market.ts` -- update listing price/qty directly on Market<T>

## Phase 2: Permissions dApp -> Periscope (ACL Tab)

### Files to Create

| File | LOC | Source |
|------|-----|--------|
| `periscope/src/components/permissions/AclTab.tsx` | ~150 | New container with assembly dropdown + sub-modes |
| `periscope/src/components/permissions/AclEditor.tsx` | ~400 | Port from permissions-dapp |
| `periscope/src/components/permissions/SharedAclBrowser.tsx` | ~100 | Port from permissions-dapp |
| `periscope/src/components/permissions/SharedAclEditor.tsx` | ~350 | Port from permissions-dapp |
| `periscope/src/components/permissions/SharedAclCard.tsx` | ~55 | Port from permissions-dapp |
| `periscope/src/components/permissions/CreateAclForm.tsx` | ~120 | Port from permissions-dapp |

### Files to Modify

- **`periscope/src/views/Permissions.tsx`** -- Add "ACLs" to tab type, add tab button, render AclTab when active.

### Key Adaptations

- Replace `useCurrentClient() as SuiGraphQLClient` -> `useSuiClient()`
- Replace `dAppKit.signAndExecuteTransaction` -> `useSignAndExecuteTransaction().mutateAsync`
- Replace manual assembly ID input -> `useOwnedAssemblies()` dropdown (gates only)
- Auto-resolve packageId/configObjectId from periscope's `EXTENSION_TEMPLATES` for active tenant
- ACL registry packageId: hardcode as constant for now

### Component Hierarchy

```
Permissions (existing view)
  |-- tab: "groups" (existing)
  |-- tab: "policies" (existing)
  |-- tab: "acls" -> AclTab
        |-- sub-mode: "gate-acl"
        |     |-- Assembly dropdown (gates from useOwnedAssemblies)
        |     |-- AclEditor
        |-- sub-mode: "shared-acls"
              |-- SharedAclBrowser
                    |-- SharedAclCard[]
                    |-- SharedAclEditor (when editing)
                    |-- CreateAclForm (when creating)
```

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `ssu-dapp/src/components/SsuInfoCard.tsx` | Create | Header + edit toggle + inline MetadataEditor |
| `ssu-dapp/src/components/ContentTabs.tsx` | Create | Top-level Inventory/Market tab switcher |
| `ssu-dapp/src/components/SellDialog.tsx` | Create | Sell listing creation dialog (qty + price) |
| `ssu-dapp/src/components/MarketContent.tsx` | Create | Market tab container (listings + buy orders) |
| `ssu-dapp/src/components/ListingAdminList.tsx` | Create | Port of OwnerView (admin listing mgmt) |
| `ssu-dapp/src/components/ListingBuyerList.tsx` | Create | Port of BuyerView (browse listings) |
| `ssu-dapp/src/components/ListingCard.tsx` | Create | Port of ListingCard (buy controls) |
| `ssu-dapp/src/components/CreateBuyOrderDialog.tsx` | Create | Buy order creation dialog |
| `ssu-dapp/src/hooks/useMarketListings.ts` | Create | Hook wrapping queryMarketListings(marketId) |
| `ssu-dapp/src/hooks/useBuyOrders.ts` | Create | Hook wrapping queryMarketBuyOrders(marketId) |
| `ssu-dapp/src/views/SsuView.tsx` | Modify | Restructure: SsuInfoCard + ContentTabs |
| `ssu-dapp/src/components/AssemblyHeader.tsx` | Modify | Add onEdit prop, pencil button, remove market link |
| `ssu-dapp/src/components/InventoryTabs.tsx` | Modify | Add onSell/canSell props, thread to table |
| `ssu-dapp/src/components/InventoryTable.tsx` | Modify | Add Sell button in Actions column |
| `ssu-dapp/src/hooks/useSignAndExecute.ts` | Modify | Add marketListings + marketBuyOrders to invalidation keys |
| `periscope/src/components/permissions/AclTab.tsx` | Create | ACL tab container |
| `periscope/src/components/permissions/AclEditor.tsx` | Create | Port inline ACL editor |
| `periscope/src/components/permissions/SharedAclBrowser.tsx` | Create | Port shared ACL list |
| `periscope/src/components/permissions/SharedAclEditor.tsx` | Create | Port shared ACL editor |
| `periscope/src/components/permissions/SharedAclCard.tsx` | Create | Port ACL list item |
| `periscope/src/components/permissions/CreateAclForm.tsx` | Create | Port ACL creation form |
| `periscope/src/views/Permissions.tsx` | Modify | Add "ACLs" tab |

## Chain-Shared Functions Used

**From `packages/chain-shared/src/ssu-market.ts` (post-Plan 21):**
- `buildEscrowAndList` -- Escrow items from owner inventory + post sell listing on Market<T> (single PTB with borrow/withdraw/escrow_and_list)
- `buildCancelListing` -- Cancel listing on Market<T>, return items to owner inventory
- `buildBuyFromListing` -- Buyer purchases from sell listing via Market<T>

**From `packages/chain-shared/src/market.ts` (new in Plan 21):**
- `buildUpdateSellListing` -- Update existing sell listing price/qty on Market<T>
- `buildPostBuyOrder` -- Create buy order with escrowed payment on Market<T>
- `queryMarketListings` -- Query all sell listings for a Market<T>
- `queryMarketBuyOrders` -- Query all buy orders for a Market<T>

**Types (from `packages/chain-shared/src/types.ts` post-Plan 21):**
- `SsuConfigInfo` -- SsuConfig data (objectId, owner, ssuId, delegates, marketId)
- `MarketSellListing` -- Sell listing data (listingId, seller, ssuId, typeId, pricePerUnit, quantity, postedAtMs)
- `MarketBuyOrder` -- Buy order data (orderId, buyer, typeId, pricePerUnit, quantity)

## Verification

1. **Build:** `pnpm build` -- must pass with no errors
2. **Dev server:** `pnpm --filter ssu-dapp dev` -- load with `?itemId=<ssu>&tenant=stillness`
3. **SSU Info Card:** Verify header renders, edit button appears when owner wallet connected, MetadataEditor expands inline
4. **Inventory tab:** Capacity bar, slot sub-tabs, item table all render. Transfer button still works. Sell button appears on owner slot items when isOwner + ssuConfig.marketId.
5. **Sell dialog:** Click Sell -> dialog opens -> enter qty + price -> submit -> TX succeeds -> inventory + listings refresh
6. **Market tab:** Appears only when SSU has a linked market (ssuConfig.marketId). Shows sell listings. Owner/authorized users see edit/cancel. Buyer sees buy controls.
7. **Buy orders:** When marketId is set, buy orders section appears with Create Buy Order button.

## Execution Strategy

Phase 2 (Periscope ACLs) has **no dependency** on Plan 21 and can be dispatched immediately as a parallel worktree agent.

Phase 1 (SSU Market integration) depends on Plan 21 Phases 1-6. Once those complete, Phase 1 can proceed. Plan 21's Phase 6 modifies `SsuView.tsx`, `TransferDialog.tsx`, `InventoryTabs.tsx`, and `useMarketConfig.ts` (renamed to `useSsuConfig.ts`). Plan 20's Phase 1 builds **on top of** those changes -- it does not conflict because it adds new components/hooks and restructures the view rather than modifying the same lines.

Phase 1 sub-phases (1A, 1B, 1C) are sequential -- each builds on the prior. They should be implemented by a single agent in order.

## Deferred

- AssemblyActions + ExtensionInfo positioning -- keep at bottom for now, absorb into SsuInfoCard later
- Currency market browser -- not SSU-specific, different concern
- AdminPanel (co-admin/tribe management) -- secondary feature
- Remove standalone apps -- post-hackathon cleanup
- Dynamic coinType discovery from SsuConfig/Market -- post-hackathon (hardcode per tenant for now)
- Delegate management UI -- delegates field exists on SsuConfig but no UI for managing it in ssu-dapp yet
