# Plan: Server Switch & Wallet Streamline
**Status:** Complete
**Created:** 2026-03-16
**Updated:** 2026-03-18 (all phases verified complete)
**Module:** periscope (primary), chain-shared, permissions-dapp

## Overview

This plan addresses two related UX improvements. First, **multi-server support** re-engineers how the app handles Stillness and Utopia EVE Frontier servers. Currently, the tenant is stored as a single IndexedDB setting (`db.settings.get("tenant")`) and defaults to `"utopia"`. Characters have an optional `tenant` field, but server switching is ad-hoc -- the `ServerSwitcher` dropdown appears in the Manifest page header and AddCharacterDialog, but changing it does not segment data or wallet addresses between servers. The new system will default to Stillness, add a prominent server setting in the Settings page, and ensure complete data segmentation: each server gets its own wallet address, own contract addresses, own chain queries, and own IndexedDB-persisted data views.

Second, **wallet streamline** simplifies the EVE Vault connection flow. Currently, the app uses `ConnectButton` from `@mysten/dapp-kit-react` which shows a generic wallet selection modal. Since EVE Frontier only supports EVE Vault (zkLogin via `vault.evefrontier.com`), the wallet selection step is unnecessary friction. The new flow will automatically attempt to connect to EVE Vault on app launch if not already connected, remove all "Connect Wallet" buttons, and eliminate the wallet selection modal entirely. The wallet connection becomes invisible -- it either works silently or shows a subtle status indicator.

Third, **character list UI simplification** overhauls the `CharacterSwitcher` sidebar component. The current UI shows too much chrome per character (source icon, online dot, linked icon, server switch button, delete button). The new design collapses to show only the active character by default, expands to show all characters on click, and strips each entry down to just tribe name and character name.

All three changes are tightly coupled because switching servers changes which wallet address is active (EVE Vault derives different Sui addresses per tenant via zkLogin), and the character list is the primary UI for navigating between characters scoped to a server.

## Current State

### Tenant/Server Configuration

- **`packages/chain-shared/src/config.ts`** (L1-46): Defines `TenantId = "stillness" | "utopia" | "nebula"`, `CONTRACT_ADDRESSES` per tenant, and `getContractAddresses()`. Both `TENANTS` (with world/eve package IDs, datahub URLs) and `CONTRACT_ADDRESSES` include a `nebula` entry.
- **`apps/periscope/src/chain/config.ts`** (L1-237): Defines its OWN `TENANTS` object (L13-38) with `stillness`, `utopia`, `nebula` entries and `TenantId = keyof typeof TENANTS` (L40). This is a SEPARATE type from `packages/chain-shared/src/config.ts`'s `TenantId`. Defines `MOVE_TYPES` and `EVENT_TYPES` (hardcoded to stillness package ID, L49-68), `EXTENSION_TEMPLATES` (per-tenant package IDs, L122-233), and helpers like `moveType(tenant, module, type)`. Multiple views import chain-shared's `TenantId` as `ChainTenantId` and cast periscope's tenant to it (e.g., `tenant as ChainTenantId`).
- **`apps/periscope/src/hooks/useOwnedAssemblies.ts`** (L11-14): `useActiveTenant()` reads from `db.settings.get("tenant")` and defaults to `"utopia"`.
- **`apps/periscope/src/components/ServerSwitcher.tsx`** (L1-79): Dropdown showing all 3 tenants (Utopia/Stillness/Nebula) with color-coded dots. Writes to `db.settings.put({ key: "tenant", value: id })`. Currently rendered in Manifest page only.
- **`apps/periscope/src/components/AddCharacterDialog.tsx`** (L860-870): Has `TENANT_COLORS` and `TENANT_LABELS` for all 3 tenants. Includes a tenant selector in the dialog header.
- **`apps/periscope/src/stores/appStore.ts`** (L1-62): Zustand store with no tenant state -- tenant is managed via IndexedDB settings table.

### Character Switcher UI (Current)

- **`apps/periscope/src/components/CharacterSwitcher.tsx`** (L1-246): Renders in the sidebar below the logo. Shows a trigger button with active character name + dropdown chevron. When open, shows:
  - "All Characters" option at top with count badge
  - Per-character entries via `CharacterEntry` component showing:
    - Character name (primary text)
    - Tribe name or tenant as subtitle (secondary text, L52-56)
    - **Source icon** (`SourceIcon` component, L11-22): Gamepad2 for log, Wallet for wallet, PenLine for manual
    - **Online dot** (L61-63): Green dot when `char.isActive === true`
    - **Linked indicator** (L64-69): `Link2` icon in cyan when `suiAddress` exists, gray otherwise
    - **Server switch button** (L73-85): `ArrowLeftRight` icon to move character between tenants
    - **Delete button** (L86-96): `Trash2` icon to soft-delete character
  - "Add Character" button at bottom
- **`apps/periscope/src/components/Sidebar.tsx`** (L190-193): Renders `<CharacterSwitcher />` directly in sidebar, followed by `<WalletConnect />`.

### What the "Online" Button Actually Does

The green "Online" dot (`char.isActive`) is set by the **log watcher** (`useLogWatcher.ts` L119-130). When the log watcher detects a new game log file for a registered character, it calls `db.characters.update(characterId, { isActive: true, lastSeenAt: now })`. This indicates the character has an open game client.

**Problem:** The `isActive` flag is set to `true` but **never reset to `false`**. There is no "offline" detection -- once a character is marked online, it stays green forever until the database is cleared. This makes the indicator unreliable and misleading. It should be removed from the character list UI. (The `isActive` field and `lastSeenAt` can stay in the DB schema for potential future use with proper offline detection.)

### Tenant Consumption Points (files using `useActiveTenant()` or `tenant` from config)

1. **`hooks/useOwnedAssemblies.ts`** -- defines `useActiveTenant()`, passes tenant to `discoverCharacterAndAssemblies()`
2. **`hooks/useSponsoredTransaction.ts`** -- reads `TENANTS[tenant].gasStationUrl`
3. **`hooks/useRadar.ts`** -- reads `TENANTS[tenant].worldPackageId` for event types
4. **`hooks/useOrgMarket.ts`** -- passes tenant to `getContractAddresses()`
5. **`hooks/useExtensionDeploy.ts`** -- passes tenant to transaction builders
6. **`hooks/usePermissionSync.ts`** -- passes tenant to ACL builders
7. **`views/Deployables.tsx`** -- passes tenant to `discoverCharacterAndAssemblies()`
8. **`views/Extensions.tsx`** -- uses tenant for assembly discovery and extension deploy
9. **`views/TurretConfig.tsx`** -- reads `TENANTS[tenant]` for gas station URL
10. **`views/GovernanceDashboard.tsx`** -- passes tenant to `getContractAddresses()`
11. **`views/GovernanceFinance.tsx`** -- passes tenant to `getContractAddresses()`
12. **`views/GovernanceTrade.tsx`** -- passes tenant to `getContractAddresses()`, `buildAuthorizeExtension()`
13. **`views/GovernanceTurrets.tsx`** -- reads `TENANTS[tenant].gasStationUrl`
14. **`views/GovernanceClaims.tsx`** -- passes tenant to `getContractAddresses()`
15. **`views/Assets.tsx`** -- uses `useActiveTenant()` via `useOwnedAssemblies()`
16. **`views/Manifest.tsx`** -- renders `ServerSwitcher`, uses tenant for manifest discovery
17. **`chain/transactions.ts`** -- reads `TENANTS[tenant].worldPackageId`
18. **`chain/queries.ts`** -- reads `moveType(tenant, ...)` for type patterns
19. **`chain/manifest.ts`** -- reads `moveType(tenant, ...)` for Character type
20. **`chain/sync.ts`** -- reads `EVENT_TYPES` (hardcoded to stillness)
21. **`chain/client.ts`** -- `MOVE_TYPES` / `EVENT_TYPES` hardcoded to stillness

### MOVE_TYPES / EVENT_TYPES Hardcoding Problem

`apps/periscope/src/chain/config.ts` L49-68 defines `MOVE_TYPES` and `EVENT_TYPES` using only `STILLNESS_PKG`. These constants are imported by `chain/client.ts` (L12, L112) and `chain/sync.ts` (L14). This means `getCharacters()`, `getOwnedAssemblies()`, `getRecentKillmails()`, and `queryEvents()` in `chain/client.ts` only work on Stillness. The `chain/queries.ts` file correctly uses `moveType(tenant, ...)` for tenant-aware queries, but `chain/client.ts` does not.

### Wallet Connection

- **`apps/periscope/src/components/WalletProvider.tsx`** (L1-26): Creates `DAppKitProvider` with `slushWalletConfig` pointing to EVE Vault, `autoConnect: false`.
- **`apps/periscope/src/components/WalletConnect.tsx`** (L1-91): Exports `WalletConnect` (shows green dot + truncated address when connected, or "Connect Wallet" button when not) and `ConnectWalletButton` (compact inline connect button -- dead code, not imported anywhere). Both use `useCurrentAccount`, `useWallets`, and `useDAppKit` from `@mysten/dapp-kit-react` directly. `WalletConnect` is rendered in the sidebar (`Sidebar.tsx` L192).
- **`apps/periscope/src/App.tsx`** (L1-26): `WalletProvider` wraps the entire app.
- **`apps/permissions-dapp/src/App.tsx`** (L16-29): Already updated with `autoConnect: true`, `slushWalletConfig` targeting EVE Vault, and no `ConnectButton` usage. Shows a status indicator (green dot + truncated address) when connected. No further changes needed.

### Data Segmentation

Currently there is NO data segmentation between servers. All characters, deployables, assemblies, intel, organizations, currencies, trade nodes, etc. are stored in a single IndexedDB database. Characters have an optional `tenant` field, but other tables do not. Switching servers shows stale data from the other server.

## Target State

### Server Selection

1. **Default to Stillness** -- `useActiveTenant()` returns `"stillness"` when no setting exists.
2. **Only Stillness and Utopia** -- Remove `nebula` from all tenant type definitions and UI.
3. **Server setting in Settings page** -- Add a "Server" section at the top of the Settings page with a clear toggle between Stillness (Production) and Utopia (Sandbox).
4. **Server indicator** -- Show the active server in the sidebar header (next to "EF Periscope" label), as a small colored dot + label.
5. **React Query invalidation** -- When the server changes, all React Query caches are invalidated so views re-fetch with the correct tenant.
6. **Tenant-aware MOVE_TYPES/EVENT_TYPES** -- Convert the hardcoded constants into functions that take a `TenantId` parameter, or use the existing `moveType()` helper.
7. **Remove ServerSwitcher component** -- Server switching is handled exclusively in Settings. The `ServerSwitcher.tsx` component and all its imports are deleted.

### Wallet Streamline

1. **Auto-connect on mount** -- Change `autoConnect: false` to `autoConnect: true` in `WalletProvider.tsx`. Since `slushWalletConfig` is already set to EVE Vault, the DAppKit will automatically attempt to reconnect to the last-used wallet.
2. **Remove ConnectButton/ConnectWalletButton** -- Remove the generic wallet selector button. Replace all "Connect Wallet" UI with either (a) nothing (the action just happens when wallet is connected), or (b) a subtle "Wallet not connected" status message with a text link.
3. **Remove WalletConnect component usage from header** -- The sidebar or header should not show a "Connect" button. Instead, show a connection status indicator (green dot = connected, gray = not connected).
4. **Handle "wallet needed" states gracefully** -- Views that require wallet signing (GovernanceFinance, GovernanceTrade, Extensions, TurretConfig) should show an inline message like "Connect EVE Vault to perform this action" instead of a button, since auto-connect should handle it.

### Character List UI

1. **Collapsible list** -- The `CharacterSwitcher` defaults to collapsed, showing only the active character (or "All Characters"). Clicking expands to show the full list. A chevron icon indicates expand/collapse state.
2. **Minimal character entries** -- Each entry shows only:
   - **Tribe name** (small text, secondary color) -- from `char.tribe` field, or `Tribe #${char.tribeId}` if no name resolved, or blank if neither
   - **Character name** (primary text, white/cyan for active)
   - **Delete button** (Trash2, only visible on hover)
3. **Remove online dot** -- The `isActive` green dot is removed. The field is never reset to `false` (no offline detection), making it permanently stuck on `true` and therefore useless. The DB field stays for future use.
4. **Remove linked indicator** -- The `Link2` icon showing wallet link status is removed. We now resolve the address at character creation time, so it's no longer useful to show this in the compact character list. Address details remain visible in Settings -> Characters.
5. **Remove source icon** -- The `SourceIcon` showing how the character was added (log/wallet/manual) is removed from the character list. This metadata is retained in the DB and visible in Settings -> Characters.
6. **Remove server switch button** -- The `ArrowLeftRight` button to move a character between servers is removed from the character list. Server is verified at creation time. If a user needs to change a character's server, they delete and re-add.
7. **"All Characters" row** -- Kept at the top of the expanded list with a count badge.
8. **"Add Character" button** -- Kept at the bottom of the expanded list.

### Data Segmentation Strategy

Rather than creating separate IndexedDB databases per tenant (which would complicate CRDT sync in Phase 2), the approach is:

1. **Characters already have a `tenant` field** -- This is the primary segmentation key. When the user switches servers, the character switcher filters to characters matching the active tenant.
2. **Query-time filtering** -- Chain queries already pass the tenant to `discoverCharacterAndAssemblies()`, `getContractAddresses()`, etc. React Query keys include the tenant, so switching servers naturally triggers re-queries with the correct package IDs.
3. **Local data tables** -- Deployables, assemblies, extensions, organizations, currencies, and trade nodes are already associated with a character/address. Since different servers produce different Sui addresses (EVE Vault zkLogin), the data is naturally segmented by address.
4. **Settings** -- The tenant setting itself is global (not per-server). Static data (star map, game types) is shared across servers.

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
| Server switch wallet | Silently disconnect | zkLogin derives different address per tenant; stale connection is useless; auto-reconnect handles it |
| AddCharacterDialog tenant | Use global setting only | Simpler UX; user switches global server first; consistent with segmentation design |
| permissions-dapp wallet | Add `slushWalletConfig` to permissions-dapp | Consistency; EVE Vault is the only supported wallet |
| Server indicator location | Sidebar header, next to logo text | Always visible, does not clutter navigation |
| React Query invalidation | Use `queryClient.invalidateQueries()` on tenant change | Ensures all views re-fetch with correct contract addresses |
| Remove ServerSwitcher component | Delete file entirely | Server switching moved to Settings page; no need for a separate dropdown component |
| Remove online dot from character list | Remove UI only, keep DB field | `isActive` is set to `true` by log watcher but never reset to `false` -- no offline detection exists, so the dot is permanently stuck on. The DB field stays for future use when proper offline detection is added. |
| Remove linked indicator | Remove from character list | Address is resolved at creation time; link status is noise in the compact sidebar list; details remain in Settings |
| Remove source icon | Remove from character list | How the character was added is not useful in the sidebar; metadata stays in DB and Settings view |
| Remove server switch button | Remove from character list | Server is verified at creation time; re-add if wrong server; simpler UX than in-place server moves |
| Character list default state | Collapsed (show active only) | Reduces sidebar clutter; most users have 1-3 characters and work with one at a time |
| Character entry content | Tribe name + character name only | Minimal info needed to identify and select a character; everything else is accessible in Settings |

## Implementation Phases

### Phase 1: Remove Nebula, Default to Stillness -- DONE
All steps complete. Nebula removed from all tenant types, default changed to stillness, `ChainTenantId` casts removed.

### Phase 2: Fix MOVE_TYPES / EVENT_TYPES Hardcoding -- DONE
Functions `getMoveTypes(tenant)` and `getEventTypes(tenant)` exist and are used by `client.ts` and `sync.ts`. Deprecated `MOVE_TYPES`/`EVENT_TYPES` constants remain in `config.ts` (L73-77) as aliases but have zero imports -- confirmed dead code. Cleanup can be done opportunistically.

### Phase 3: Server Setting in Settings Page + Sidebar Indicator -- DONE
All steps complete. `ServerSection` exists in `Settings.tsx` with two-server toggle, React Query invalidation, and wallet disconnect. Sidebar indicator with colored dot + tenant name in header. `ServerSwitcher` removed from Manifest. `ServerSwitcher.tsx` deleted in commit `4980373`.

### Phase 4: Wallet Auto-Connect & UI Streamline -- DONE
All steps complete (commit `4980373`):
- `WalletProvider.tsx` has `autoConnect: true`.
- `WalletConnect.tsx` simplified to a status-only indicator: gray dot + "Not connected" when disconnected, green dot + truncated address when connected. `ConnectWalletButton` export removed entirely.
- GovernanceFinance, GovernanceTrade, Extensions: `ConnectWalletButton` was never imported -- no view changes needed.
- permissions-dapp: Already had `slushWalletConfig`, `autoConnect: true`, status indicator, no `ConnectButton`.

**Note:** The working tree has uncommitted reversions of these changes (autoConnect reverted to `false`, WalletConnect reverted to button-based UI). The committed code at HEAD is correct per this plan.

### Phase 5: Character Filtering by Server -- DONE
Character list filters by active tenant. Legacy characters are backfilled to `"stillness"` by `useActiveCharacter.ts`. AddCharacterDialog uses global tenant (no per-dialog selector). Settings CharacterCard shows tenant badge.

### Phase 6: Character List UI Simplification -- DONE
All steps complete (commit `4980373`):
- `CharacterEntry` simplified to tribe name + character name only.
- `SourceIcon` component removed. Online dot removed. `Link2` linked indicator removed. `ArrowLeftRight` server switch button removed. `TENANT_IDS` constant removed. `onChangeServer` prop removed.
- Unused imports cleaned up: no `Link2`, `Gamepad2`, `Wallet`, `PenLine`, `ArrowLeftRight`, `TENANTS`, `TenantId`, `CharacterSource`.
- Collapsible dropdown pattern retained from existing implementation.
- "All Characters" row and "Add Character" button retained.

**Minor deviations from spec (acceptable):**
- Delete button is always visible, not hover-only (simpler implementation, small target count).
- Trigger subtitle for active character shows tribe name; "All Characters" trigger does not show count subtitle (count is visible in the dropdown badge).

**Note:** The working tree has uncommitted reversions of these changes (CharacterSwitcher reverted to old UI with all indicators). The committed code at HEAD is correct per this plan.

## File Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `packages/chain-shared/src/config.ts` | **Done** | 1 | Nebula removed from `TenantId` and `CONTRACT_ADDRESSES` |
| `apps/periscope/src/chain/config.ts` | **Done** | 1,2 | Nebula removed; `getMoveTypes`/`getEventTypes` functions added; deprecated constants remain |
| `apps/periscope/src/chain/client.ts` | **Done** | 2 | Uses `getMoveTypes(tenant)` / `getEventTypes(tenant)` |
| `apps/periscope/src/chain/sync.ts` | **Done** | 2 | Uses `getEventTypes(tenant)` |
| `apps/periscope/src/chain/index.ts` | **Done** | 2 | Exports both functions and deprecated constants |
| `apps/periscope/src/hooks/useOwnedAssemblies.ts` | **Done** | 1 | Defaults to `"stillness"` |
| `apps/periscope/src/hooks/useRadar.ts` | No change | -- | Already tenant-aware |
| `apps/periscope/src/components/WalletProvider.tsx` | **Done** | 4 | `autoConnect: true` |
| `apps/periscope/src/components/WalletConnect.tsx` | **Done** | 4 | Simplified to status indicator; `ConnectWalletButton` removed |
| `apps/periscope/src/components/ServerSwitcher.tsx` | **Done** | 3 | File deleted |
| `apps/periscope/src/components/Sidebar.tsx` | **Done** | 3 | Server indicator in header area |
| `apps/periscope/src/components/AddCharacterDialog.tsx` | **Done** | 1,5 | Nebula removed; uses global tenant |
| `apps/periscope/src/components/CharacterSwitcher.tsx` | **Done** | 6 | Simplified: tribe + name only, no source/online/linked/server-switch |
| `apps/periscope/src/views/Settings.tsx` | **Done** | 3,5 | Server section + tenant badge on character cards |
| `apps/periscope/src/views/GovernanceFinance.tsx` | **Done** | 4 | `ConnectWalletButton` not imported (already clean) |
| `apps/periscope/src/views/GovernanceTrade.tsx` | **Done** | 4 | `ConnectWalletButton` not imported (already clean) |
| `apps/periscope/src/views/Extensions.tsx` | **Done** | 4 | `ConnectWalletButton` not imported (already clean) |
| `apps/periscope/src/views/GovernanceDashboard.tsx` | **Done** | 1 | `ChainTenantId` casts removed |
| `apps/periscope/src/views/GovernanceTurrets.tsx` | **Done** | 1 | Tenant-aware, no casts |
| `apps/periscope/src/views/GovernanceClaims.tsx` | **Done** | 1 | `ChainTenantId` casts removed |
| `apps/periscope/src/views/Manifest.tsx` | **Done** | 3 | `ServerSwitcher` removed from header |
| `apps/periscope/src/db/types.ts` | No change | -- | `isActive` kept for future offline detection; `CharacterSource` kept for Settings |
| `apps/periscope/src/stores/appStore.ts` | No change | -- | Tenant stays in IndexedDB |
| `apps/gas-station/src/config.ts` | **Done** | 1 | Nebula removed |
| `apps/permissions-dapp/src/App.tsx` | **Done** | 4 | Already has `slushWalletConfig`, `autoConnect: true`, status indicator |

## Resolved Questions

1. **Should switching servers disconnect and reconnect the wallet?**
   - **Decision:** Yes, silently disconnect. Switching servers changes the zkLogin-derived address, so the existing connection is stale. The wallet will auto-reconnect via `autoConnect: true`.

2. **Should the AddCharacterDialog still allow choosing a different server than the global setting?**
   - **Decision:** No, remove the per-dialog server selector. Use the global setting. User must switch the global server setting before adding a character from the other server.

3. **Should the "online" green dot be kept?**
   - **Decision:** Remove from character list UI. The `isActive` flag is set to `true` by the log watcher when it detects a game log file, but it is **never reset to `false`** -- there is no offline detection. This means once a character is marked online, it stays green forever, making the indicator permanently stuck and misleading. The DB field (`isActive`, `lastSeenAt`) is retained for future use when proper session-end detection is implemented.

4. **Should the linked indicator be kept?**
   - **Decision:** Remove from character list. The Sui address is resolved at character creation time (via wallet detection, chain lookup, or log-based chain resolution). Showing link status in the compact sidebar adds visual noise without actionable benefit. Full address details are still visible in Settings -> Characters.

5. **Should character addition method be shown?**
   - **Decision:** Remove from character list. The `source` field (log/wallet/manual) is retained in the DB and visible in the Settings -> Characters detail cards via the `SourceBadge` component. It has no value in the compact sidebar list.

## Deferred

- **Separate IndexedDB databases per server** -- Would provide complete data isolation but adds significant complexity for Phase 2 CRDT sync. Current approach (query-time filtering by address + tenant) is sufficient.
- **Auto-switching server based on game client detection** -- Could detect which server the game client is connected to from log files. Deferred to Phase 2.
- **Permissions-dapp full server support** -- The permissions-dapp is a standalone tool with manual contract config. Full multi-server support with dropdowns deferred.
- **Gas station multi-server support** -- Gas station already handles all tenants via `CONTRACT_ADDRESSES`. No changes needed beyond removing nebula.
- **Proper offline detection for `isActive`** -- The log watcher could detect when a game log file stops growing (no new bytes for N minutes) and reset `isActive` to `false`. This would make the online indicator reliable. Deferred to a future plan.
- **Character reorder / pinning** -- Allow users to reorder characters in the list or pin favorites. Not needed now with small character counts.
