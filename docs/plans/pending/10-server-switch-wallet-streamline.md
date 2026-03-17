# Plan: Server Switch & Wallet Streamline
**Status:** Pending
**Created:** 2026-03-16
**Module:** periscope (primary), chain-shared, permissions-dapp

## Overview

This plan addresses two related UX improvements. First, **multi-server support** re-engineers how the app handles Stillness and Utopia EVE Frontier servers. Currently, the tenant is stored as a single IndexedDB setting (`db.settings.get("tenant")`) and defaults to `"utopia"`. Characters have an optional `tenant` field, but server switching is ad-hoc — the `ServerSwitcher` dropdown appears in the Manifest page header and AddCharacterDialog, but changing it does not segment data or wallet addresses between servers. The new system will default to Stillness, add a prominent server setting in the Settings page, and ensure complete data segmentation: each server gets its own wallet address, own contract addresses, own chain queries, and own IndexedDB-persisted data views.

Second, **wallet streamline** simplifies the EVE Vault connection flow. Currently, the app uses `ConnectButton` from `@mysten/dapp-kit-react` which shows a generic wallet selection modal. Since EVE Frontier only supports EVE Vault (zkLogin via `vault.evefrontier.com`), the wallet selection step is unnecessary friction. The new flow will automatically attempt to connect to EVE Vault on app launch if not already connected, remove all "Connect Wallet" buttons, and eliminate the wallet selection modal entirely. The wallet connection becomes invisible — it either works silently or shows a subtle status indicator.

Both changes are tightly coupled because switching servers changes which wallet address is active (EVE Vault derives different Sui addresses per tenant via zkLogin), so they should be implemented together.

## Current State

### Tenant/Server Configuration

- **`packages/chain-shared/src/config.ts`** (L1-46): Defines `TenantId = "stillness" | "utopia" | "nebula"`, `CONTRACT_ADDRESSES` per tenant, and `getContractAddresses()`. Both `TENANTS` (with world/eve package IDs, datahub URLs) and `CONTRACT_ADDRESSES` include a `nebula` entry.
- **`apps/periscope/src/chain/config.ts`** (L1-237): Defines its OWN `TENANTS` object (L13-38) with `stillness`, `utopia`, `nebula` entries and `TenantId = keyof typeof TENANTS` (L40). This is a SEPARATE type from `packages/chain-shared/src/config.ts`'s `TenantId`. Defines `MOVE_TYPES` and `EVENT_TYPES` (hardcoded to stillness package ID, L49-68), `EXTENSION_TEMPLATES` (per-tenant package IDs, L122-233), and helpers like `moveType(tenant, module, type)`. Multiple views import chain-shared's `TenantId` as `ChainTenantId` and cast periscope's tenant to it (e.g., `tenant as ChainTenantId`).
- **`apps/periscope/src/hooks/useOwnedAssemblies.ts`** (L11-14): `useActiveTenant()` reads from `db.settings.get("tenant")` and defaults to `"utopia"`.
- **`apps/periscope/src/components/ServerSwitcher.tsx`** (L1-79): Dropdown showing all 3 tenants (Utopia/Stillness/Nebula) with color-coded dots. Writes to `db.settings.put({ key: "tenant", value: id })`. Currently rendered in Manifest page only.
- **`apps/periscope/src/components/AddCharacterDialog.tsx`** (L860-870): Has `TENANT_COLORS` and `TENANT_LABELS` for all 3 tenants. Includes a tenant selector in the dialog header.
- **`apps/periscope/src/stores/appStore.ts`** (L1-62): Zustand store with no tenant state — tenant is managed via IndexedDB settings table.

### Tenant Consumption Points (files using `useActiveTenant()` or `tenant` from config)

1. **`hooks/useOwnedAssemblies.ts`** — defines `useActiveTenant()`, passes tenant to `discoverCharacterAndAssemblies()`
2. **`hooks/useSponsoredTransaction.ts`** — reads `TENANTS[tenant].gasStationUrl`
3. **`hooks/useRadar.ts`** — reads `TENANTS[tenant].worldPackageId` for event types
4. **`hooks/useOrgMarket.ts`** — passes tenant to `getContractAddresses()`
5. **`hooks/useExtensionDeploy.ts`** — passes tenant to transaction builders
6. **`hooks/usePermissionSync.ts`** — passes tenant to ACL builders
7. **`views/Deployables.tsx`** — passes tenant to `discoverCharacterAndAssemblies()`
8. **`views/Extensions.tsx`** — uses tenant for assembly discovery and extension deploy
9. **`views/TurretConfig.tsx`** — reads `TENANTS[tenant]` for gas station URL
10. **`views/GovernanceDashboard.tsx`** — passes tenant to `getContractAddresses()`
11. **`views/GovernanceFinance.tsx`** — passes tenant to `getContractAddresses()`
12. **`views/GovernanceTrade.tsx`** — passes tenant to `getContractAddresses()`, `buildAuthorizeExtension()`
13. **`views/GovernanceTurrets.tsx`** — reads `TENANTS[tenant].gasStationUrl`
14. **`views/GovernanceClaims.tsx`** — passes tenant to `getContractAddresses()`
15. **`views/Assets.tsx`** — uses `useActiveTenant()` via `useOwnedAssemblies()`
16. **`views/Manifest.tsx`** — renders `ServerSwitcher`, uses tenant for manifest discovery
17. **`chain/transactions.ts`** — reads `TENANTS[tenant].worldPackageId`
18. **`chain/queries.ts`** — reads `moveType(tenant, ...)` for type patterns
19. **`chain/manifest.ts`** — reads `moveType(tenant, ...)` for Character type
20. **`chain/sync.ts`** — reads `EVENT_TYPES` (hardcoded to stillness)
21. **`chain/client.ts`** — `MOVE_TYPES` / `EVENT_TYPES` hardcoded to stillness

### MOVE_TYPES / EVENT_TYPES Hardcoding Problem

`apps/periscope/src/chain/config.ts` L49-68 defines `MOVE_TYPES` and `EVENT_TYPES` using only `STILLNESS_PKG`. These constants are imported by `chain/client.ts` (L12, L112) and `chain/sync.ts` (L14). This means `getCharacters()`, `getOwnedAssemblies()`, `getRecentKillmails()`, and `queryEvents()` in `chain/client.ts` only work on Stillness. The `chain/queries.ts` file correctly uses `moveType(tenant, ...)` for tenant-aware queries, but `chain/client.ts` does not.

### Wallet Connection

- **`apps/periscope/src/components/WalletProvider.tsx`** (L1-26): Creates `DAppKitProvider` with `slushWalletConfig` pointing to EVE Vault, `autoConnect: false`.
- **`apps/periscope/src/components/WalletConnect.tsx`** (L1-53): Exports `ConnectWalletButton` (wraps `ConnectButton` from dapp-kit) and `WalletConnect` (shows address + disconnect when connected, or `ConnectWalletButton` when not). NOTE: `WalletConnect` is exported but NEVER imported — only `ConnectWalletButton` is used elsewhere. Used in `GovernanceFinance.tsx` (L482, L940, L1106, L1176, L1254 — 5 instances) and `GovernanceTrade.tsx` (L462, L1074 — 2 instances).
- **`apps/periscope/src/App.tsx`** (L1-26): `WalletProvider` wraps the entire app.
- **`apps/permissions-dapp/src/App.tsx`** (L17-26): Separate `createDAppKit` with `autoConnect: true` (already set), but MISSING `slushWalletConfig` — so it shows a generic wallet picker instead of targeting EVE Vault. Also renders `<ConnectButton />` twice (L57, L66).

### Data Segmentation

Currently there is NO data segmentation between servers. All characters, deployables, assemblies, intel, organizations, currencies, trade nodes, etc. are stored in a single IndexedDB database. Characters have an optional `tenant` field, but other tables do not. Switching servers shows stale data from the other server.

## Target State

### Server Selection

1. **Default to Stillness** — `useActiveTenant()` returns `"stillness"` when no setting exists.
2. **Only Stillness and Utopia** — Remove `nebula` from all tenant type definitions and UI.
3. **Server setting in Settings page** — Add a "Server" section at the top of the Settings page with a clear toggle between Stillness (Production) and Utopia (Sandbox).
4. **Server indicator** — Show the active server in the sidebar header (next to "EF Periscope" label), as a small colored dot + label.
5. **React Query invalidation** — When the server changes, all React Query caches are invalidated so views re-fetch with the correct tenant.
6. **Tenant-aware MOVE_TYPES/EVENT_TYPES** — Convert the hardcoded constants into functions that take a `TenantId` parameter, or use the existing `moveType()` helper.

### Wallet Streamline

1. **Auto-connect on mount** — Change `autoConnect: false` to `autoConnect: true` in `WalletProvider.tsx`. Since `slushWalletConfig` is already set to EVE Vault, the DAppKit will automatically attempt to reconnect to the last-used wallet.
2. **Remove ConnectButton/ConnectWalletButton** — Remove the generic wallet selector button. Replace all "Connect Wallet" UI with either (a) nothing (the action just happens when wallet is connected), or (b) a subtle "Wallet not connected" status message with a text link.
3. **Remove WalletConnect component usage from header** — The sidebar or header should not show a "Connect" button. Instead, show a connection status indicator (green dot = connected, gray = not connected).
4. **Handle "wallet needed" states gracefully** — Views that require wallet signing (GovernanceFinance, GovernanceTrade, Extensions, TurretConfig) should show an inline message like "Connect EVE Vault to perform this action" instead of a button, since auto-connect should handle it.

### Data Segmentation Strategy

Rather than creating separate IndexedDB databases per tenant (which would complicate CRDT sync in Phase 2), the approach is:

1. **Characters already have a `tenant` field** — This is the primary segmentation key. When the user switches servers, the character switcher filters to characters matching the active tenant.
2. **Query-time filtering** — Chain queries already pass the tenant to `discoverCharacterAndAssemblies()`, `getContractAddresses()`, etc. React Query keys include the tenant, so switching servers naturally triggers re-queries with the correct package IDs.
3. **Local data tables** — Deployables, assemblies, extensions, organizations, currencies, and trade nodes are already associated with a character/address. Since different servers produce different Sui addresses (EVE Vault zkLogin), the data is naturally segmented by address.
4. **Settings** — The tenant setting itself is global (not per-server). Static data (star map, game types) is shared across servers.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default tenant | Stillness | Stillness is the production server; most users play there |
| Supported tenants | Stillness + Utopia only | Nebula is a test environment not used by players |
| Tenant storage | Keep in IndexedDB settings | Works with existing Dexie live query pattern; Zustand would require migration |
| Data segmentation | Query-time filtering via address + tenant | Simpler than separate databases; characters already have tenant field; addresses differ per server due to zkLogin |
| MOVE_TYPES refactor | Convert to functions `getMoveTypes(tenant)` / `getEventTypes(tenant)` | Fixes the hardcoded stillness-only bug; minimal API change |
| Wallet auto-connect | Set `autoConnect: true` | DAppKit supports this natively; EVE Vault handles reconnection |
| Connect button removal | Replace with status indicators | Since auto-connect handles connection, explicit buttons add unnecessary friction |
| permissions-dapp wallet | Add `slushWalletConfig` to permissions-dapp | Consistency; EVE Vault is the only supported wallet |
| Server indicator location | Sidebar header, next to logo text | Always visible, does not clutter navigation |
| React Query invalidation | Use `queryClient.invalidateQueries()` on tenant change | Ensures all views re-fetch with correct contract addresses |

## Implementation Phases

### Phase 1: Remove Nebula, Default to Stillness
1. In `packages/chain-shared/src/config.ts`: Change `TenantId` to `"stillness" | "utopia"`. Remove `nebula` from `CONTRACT_ADDRESSES` (L40). Note: This file defines `TenantId` at L3 as a literal union type.
2. In `apps/periscope/src/chain/config.ts`: Remove `nebula` from `TENANTS` (L36-37). The `TenantId = keyof typeof TENANTS` (L40) will automatically narrow.
3. In `apps/periscope/src/hooks/useOwnedAssemblies.ts` L13: Change default from `"utopia"` to `"stillness"`.
4. In `apps/periscope/src/components/ServerSwitcher.tsx`: Remove `nebula` from `SERVER_COLORS` and `SERVER_LABELS`. Only iterate over `stillness` and `utopia`.
5. In `apps/periscope/src/components/AddCharacterDialog.tsx`: Remove `nebula` from `TENANT_COLORS` (L861) and `TENANT_LABELS` (L866).
6. In `apps/gas-station/src/config.ts` L72: Remove nebula world package from the hardcoded list.
7. After both `TenantId` types are aligned to `"stillness" | "utopia"`, the `as ChainTenantId` casts in governance views (GovernanceDashboard, GovernanceFinance, GovernanceTrade, GovernanceClaims, Extensions) become unnecessary. Remove the `type TenantId as ChainTenantId` import alias and use the periscope `TenantId` directly. This cleanup affects ~17 cast sites across 5 view files.

### Phase 2: Fix MOVE_TYPES / EVENT_TYPES Hardcoding
1. In `apps/periscope/src/chain/config.ts`: Replace the hardcoded `MOVE_TYPES` and `EVENT_TYPES` constants with functions:
   ```ts
   export function getMoveTypes(tenant: TenantId) {
     const pkg = TENANTS[tenant].worldPackageId;
     return {
       Assembly: `${pkg}::assembly::Assembly`,
       Gate: `${pkg}::gate::Gate`,
       // ... etc
     };
   }
   export function getEventTypes(tenant: TenantId) {
     const pkg = TENANTS[tenant].worldPackageId;
     return {
       FuelEvent: `${pkg}::fuel::FuelEvent`,
       // ... etc
     };
   }
   ```
2. In `apps/periscope/src/chain/client.ts`: Update `getCharacters()`, `getOwnedAssemblies()`, `queryEvents()`, and `getRecentKillmails()` to accept a `tenant` parameter and use `getMoveTypes(tenant)` / `getEventTypes(tenant)`.
3. In `apps/periscope/src/chain/sync.ts`: Update event type references to use the function form.
4. Update all callers of these functions to pass the active tenant.

### Phase 3: Server Setting in Settings Page + Sidebar Indicator
1. In `apps/periscope/src/views/Settings.tsx`: Add a "Server" section at the top of the page (before Characters). Show two radio-style buttons for Stillness and Utopia with descriptions ("Production" / "Sandbox"). Writing to `db.settings.put({ key: "tenant", value: id })`.
2. In `apps/periscope/src/views/Settings.tsx`: On server change, invalidate all React Query caches using `useQueryClient().invalidateQueries()`.
3. In `apps/periscope/src/components/Sidebar.tsx`: Add a server indicator next to the "EF Periscope" text in the logo area — a small colored dot (green for Stillness, amber for Utopia) with the server name in small text.
4. Remove the `ServerSwitcher` component from the Manifest page header (it moves to Settings).
5. Optionally keep `ServerSwitcher.tsx` as a component but simplify it (remove nebula, update labels).

### Phase 4: Wallet Auto-Connect & UI Streamline
1. In `apps/periscope/src/components/WalletProvider.tsx` L17: Change `autoConnect: false` to `autoConnect: true`.
2. In `apps/periscope/src/components/WalletConnect.tsx`: Remove `ConnectWalletButton` export. Replace `WalletConnect` with a minimal connection status indicator (green dot + truncated address when connected, gray dot + "Not connected" when disconnected — no button).
3. In `apps/periscope/src/views/GovernanceFinance.tsx`: Replace all `ConnectWalletButton` usages with inline text like "Connect EVE Vault to continue" or just disable the action with a tooltip. There are 5 instances (L482, L940, L1106, L1176, L1254).
4. In `apps/periscope/src/views/GovernanceTrade.tsx`: Same — replace 2 `ConnectWalletButton` instances (L462, L1074).
5. In `apps/periscope/src/views/Extensions.tsx`: Replace "Connect your wallet to deploy extensions" messaging with "EVE Vault not connected" status.
6. Remove the `ConnectButton` import from `WalletConnect.tsx`.
7. In `apps/permissions-dapp/src/App.tsx`: Add `slushWalletConfig` to `createDAppKit` (L17-26). `autoConnect` is already `true`. Remove the two `<ConnectButton />` renders (L57, L66). Add a connection status indicator instead.

### Phase 5: Character Filtering by Server
1. In `apps/periscope/src/components/CharacterSwitcher.tsx`: Filter `allCharacters` to only show characters matching the active tenant (from `useActiveTenant()`). Include characters with no tenant set (legacy characters).
2. In `apps/periscope/src/components/AddCharacterDialog.tsx`: Remove the tenant selector from the dialog header — new characters automatically get the active global tenant.
3. In `apps/periscope/src/views/Settings.tsx` (CharacterSection): Show the tenant badge on each character card. Add a note that characters are filtered by the active server.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/chain-shared/src/config.ts` | Modify | Remove `nebula` from `TenantId` and `CONTRACT_ADDRESSES` |
| `apps/periscope/src/chain/config.ts` | Modify | Remove `nebula`; convert `MOVE_TYPES`/`EVENT_TYPES` to functions |
| `apps/periscope/src/chain/client.ts` | Modify | Add `tenant` param to `getCharacters()`, `getOwnedAssemblies()`, event queries; import `getMoveTypes`/`getEventTypes` instead of constants |
| `apps/periscope/src/chain/sync.ts` | Modify | Use tenant-aware event types; pass tenant through sync functions |
| `apps/periscope/src/chain/index.ts` | Modify | Update barrel exports: `MOVE_TYPES`/`EVENT_TYPES` constants become `getMoveTypes`/`getEventTypes` functions |
| `apps/periscope/src/hooks/useOwnedAssemblies.ts` | Modify | Change default tenant to `"stillness"` |
| `apps/periscope/src/hooks/useRadar.ts` | No change | Already tenant-aware: has local `getEventTypes(worldPkg)` function using `TENANTS[tenant].worldPackageId` |
| `apps/periscope/src/components/WalletProvider.tsx` | Modify | Set `autoConnect: true` |
| `apps/periscope/src/components/WalletConnect.tsx` | Modify | Remove `ConnectWalletButton`; replace with status indicator |
| `apps/periscope/src/components/ServerSwitcher.tsx` | Modify | Remove `nebula`; simplify to 2 servers |
| `apps/periscope/src/components/Sidebar.tsx` | Modify | Add server indicator in header area |
| `apps/periscope/src/components/AddCharacterDialog.tsx` | Modify | Remove `nebula`; remove tenant selector (use global tenant) |
| `apps/periscope/src/components/CharacterSwitcher.tsx` | Modify | Filter characters by active tenant |
| `apps/periscope/src/views/Settings.tsx` | Modify | Add "Server" section with Stillness/Utopia toggle |
| `apps/periscope/src/views/GovernanceFinance.tsx` | Modify | Replace 5 `ConnectWalletButton` instances; remove `ChainTenantId` cast |
| `apps/periscope/src/views/GovernanceTrade.tsx` | Modify | Replace 2 `ConnectWalletButton` instances; remove `ChainTenantId` cast |
| `apps/periscope/src/views/Extensions.tsx` | Modify | Update wallet-not-connected messaging; remove `ChainTenantId` cast |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | Modify | Remove `ChainTenantId` import alias and casts (~5 sites) |
| `apps/periscope/src/views/GovernanceTurrets.tsx` | Modify | Verify tenant-aware; no `ChainTenantId` but uses `TENANTS[tenant]` |
| `apps/periscope/src/views/GovernanceClaims.tsx` | Modify | Remove `ChainTenantId` import alias and casts (~3 sites) |
| `apps/periscope/src/views/Manifest.tsx` | Modify | Remove `ServerSwitcher` from header |
| `apps/periscope/src/db/types.ts` | Modify | Update comments on L193 and L394 to say `(stillness/utopia)` instead of `(stillness/utopia/nebula)` |
| `apps/periscope/src/stores/appStore.ts` | No change | Tenant stays in IndexedDB (not Zustand) |
| `apps/gas-station/src/config.ts` | Modify | Remove nebula world package ID |
| `apps/permissions-dapp/src/App.tsx` | Modify | Add `slushWalletConfig` (`autoConnect` already `true`), remove 2 `ConnectButton` renders |

## Open Questions

1. **Should switching servers disconnect and reconnect the wallet?**
   - **Option A: Yes, force reconnect** — Pros: Ensures the correct zkLogin-derived address is used for the new server. Cons: Disruptive UX; user sees a vault popup on every switch.
   - **Option B: No, keep connection but show warning** — Pros: Smoother UX. Cons: The wallet address is per-tenant (zkLogin), so the connected address may not match the new server's address. The character's `suiAddress` field already handles this — read-only views use the character's stored address, not the wallet address.
   - **Recommendation:** Option B. The wallet connection is only needed for signing transactions, and the user can reconnect manually if they switch servers and need to sign. Read-only views use the character's stored `suiAddress`, not the connected wallet. Add a subtle warning badge if the connected wallet address doesn't match the active character's address.

2. **Should the AddCharacterDialog still allow choosing a different server than the global setting?**
   - **Option A: Remove server selector entirely** — Pros: Simpler UI, fewer choices. Cons: User must switch global server setting before adding a character from the other server.
   - **Option B: Keep server selector but default to global** — Pros: Flexible. Cons: Adds complexity; may confuse users if the character's tenant doesn't match the global setting.
   - **Recommendation:** Option A. The user should switch the global server setting first. The AddCharacterDialog should always use the active tenant. This is consistent with the "complete segmentation" design.

## Deferred

- **Separate IndexedDB databases per server** — Would provide complete data isolation but adds significant complexity for Phase 2 CRDT sync. Current approach (query-time filtering by address + tenant) is sufficient.
- **Auto-switching server based on game client detection** — Could detect which server the game client is connected to from log files. Deferred to Phase 2.
- **Permissions-dapp full server support** — The permissions-dapp is a standalone tool with manual contract config. Full multi-server support with dropdowns deferred.
- **Gas station multi-server support** — Gas station already handles all tenants via `CONTRACT_ADDRESSES`. No changes needed beyond removing nebula.
