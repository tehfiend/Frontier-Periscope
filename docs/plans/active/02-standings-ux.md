# Plan: Standings Page UX Improvements
**Status:** Active
**Created:** 2026-03-26
**Module:** periscope

## Overview

The Standings page has two UX issues that need addressing. First, the "My Registries" tab currently gates all content behind a wallet connection check (`if (!walletAddress)` at line 547 of `Standings.tsx`), but viewing your own registries is a read-only operation that queries on-chain data by address -- it does not require a connected wallet. The app already stores Sui addresses on `CharacterRecord.suiAddress` in Dexie, persisted across sessions. We should use the active character's stored address to query registries without demanding wallet connection.

Second, the Contacts vs Registries distinction is non-obvious to new users. Contacts are local-only standings stored in IndexedDB (private labels for characters and tribes), while Registries are on-chain standings published to the Sui blockchain that control how smart assemblies (SSUs, gates, turrets) interact with other players. A concise contextual help section should explain this distinction.

The design philosophy for Periscope is: wallet connection is only required when signing transactions. All read-only views should work with just a stored Sui address.

## Current State

**My Registries wallet gate** (`apps/periscope/src/views/Standings.tsx` lines 547-554):
```tsx
if (!walletAddress) {
    return (
        <EmptyState
            icon={<Star size={48} className="text-zinc-700" />}
            title="Connect wallet"
            description="Connect your wallet to create and manage standings registries."
        />
    );
}
```
The `walletAddress` comes from `useCurrentAccount()?.address` (line 97-100). The component never attempts to use the active character's stored `suiAddress` from Dexie.

**How the query works** (lines 515-531): `handleRefresh` calls `queryAllRegistries(client, packageId)` to fetch ALL registries from chain, then filters client-side: `all.filter((r) => r.owner === walletAddress || r.admins.includes(walletAddress))`. This filtering only needs a Sui address string -- it does not need a connected wallet or signing capability.

**Active character address pattern** -- The Deployables view (`apps/periscope/src/views/Deployables.tsx` lines 216-222) already demonstrates the correct pattern:
```tsx
const { activeCharacter, activeSuiAddresses } = useActiveCharacter();
const account = useCurrentAccount();
const chainAddress = activeCharacter?.suiAddress ?? activeSuiAddresses[0] ?? null;
```
This resolves an address from the locally-stored character first, falling back to the wallet only if needed.

**How addresses are stored**: `useActiveCharacter` (`apps/periscope/src/hooks/useActiveCharacter.ts`) reads from `db.characters` and returns `activeCharacter` (with `.suiAddress`) and `activeSuiAddresses` array. The `activeCharacterId` is persisted in both `localStorage` and `db.settings` via `appStore.ts`. Characters get their `suiAddress` linked via `useOwnedAssemblies` (line 36-43 of `useOwnedAssemblies.ts`) when a wallet is connected.

**No contextual help** -- The page header (lines 113-121) has a title and subtitle but no explanation of what Contacts vs Registries are. There are no help icons, tooltips, or info banners in the Standings view.

**Existing icon imports** -- The file already imports `AlertCircle` from lucide-react (line 5) for error banners. The codebase does not use `HelpCircle` or `CircleHelp` anywhere currently.

## Target State

### Issue 1: Wallet-free "My Registries" read-only view

- `MyRegistriesTab` uses the active character's stored Sui address (from Dexie) as the primary address source, with wallet address as fallback
- Read-only operations (listing registries, viewing standings) work without wallet connection
- Transaction-dependent operations (Create Registry, Set Standing, Add Admin, Remove Admin, Remove Standing) still require a connected wallet and show an inline "Connect wallet" prompt only next to those specific action buttons
- The full-page `EmptyState` "Connect wallet" gate is removed

### Issue 2: Contextual help for Contacts vs Registries

- An info banner below the page subtitle explains the two concepts concisely
- The banner is dismissible (stores dismissal in `localStorage`) so it doesn't clutter the UI for returning users
- Each tab also gets a one-line description below the tab bar when active
- Written for a game-player audience -- brief, no jargon

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Address source for My Registries | `useActiveCharacter().activeCharacter?.suiAddress` with fallback chain: `activeSuiAddresses[0]` -> `account?.address` | Matches the Deployables pattern (line 222). Stored address persists across sessions without wallet. |
| Wallet gate behavior | Remove full-page gate; show inline "Connect Wallet" hint on transaction buttons only | Keeps read-only browsing frictionless. Transaction buttons already guard on `walletAddress` presence (e.g., lines 738, 747, 758). |
| Help text placement | Dismissible info banner below page subtitle + per-tab one-liner | Info banner for first-time explanation; per-tab descriptions reinforce context without being heavy. Dismissible avoids noise for experienced users. |
| Help dismiss persistence | `localStorage` key `periscope:standings-help-dismissed` | Simple, no DB migration needed. If cleared, user sees help again -- acceptable tradeoff. |
| Icon for help | `Info` from lucide-react | Standard info icon. `HelpCircle` is also available but `Info` is more compact and matches the existing UI style. |

## Implementation Phases

### Phase 1: Remove wallet gate from My Registries

1. In `Standings()` (line 96), add `useActiveCharacter()` destructured to get `activeCharacter` and `activeSuiAddresses` (currently line 98 calls it but discards the return value).
2. Compute `chainAddress` using the Deployables pattern: `const chainAddress = activeCharacter?.suiAddress ?? activeSuiAddresses[0] ?? null;`
3. Keep `walletAddress = account?.address` for transaction-gating.
4. Pass both `chainAddress` and `walletAddress` to `MyRegistriesTab`: `<MyRegistriesTab tenant={tenant} chainAddress={chainAddress} walletAddress={walletAddress} />`.
5. In `MyRegistriesTab`, update the props type to accept `chainAddress?: string | null` alongside `walletAddress`.
6. Compute `queryAddress = chainAddress ?? walletAddress ?? null` for the registry filter query.
7. Remove the `if (!walletAddress)` full-page `EmptyState` gate (lines 547-555).
8. Replace it with a check on `queryAddress`: if neither `chainAddress` nor `walletAddress` is available, show an `EmptyState` with message: "Add a character with a linked Sui address to view your registries, or connect your wallet."
9. Update `handleRefresh` (lines 516-531) to filter using `queryAddress` instead of `walletAddress`. Also update the `useCallback` dependency array (line 531) from `walletAddress` to `queryAddress`.
10. Update `fetchedRef` logic (lines 533-539) -- currently tracks `walletAddress` to avoid re-fetching for the same address. Change to track `queryAddress` instead.
11. Update `isOwner` check (line 545) to keep using `walletAddress` -- ownership actions require signing, so this must remain wallet-gated.
12. Update the "owner" badge display (line 625): change `registry.owner === walletAddress` to `registry.owner === queryAddress` so the badge shows even without wallet connected (it's a read-only visual indicator).
13. Gate transaction buttons (`Create Registry` at line 574, `Set Standing` at line 701, `Add Admin` at line 710, `Remove Admin` at line 669) on `walletAddress` presence. Where `walletAddress` is absent, show a small "Connect Wallet" text or the `ConnectWalletButton` component (`apps/periscope/src/components/WalletConnect.tsx` line 62). Import `ConnectWalletButton` from `@/components/WalletConnect`.
14. Update dialog guards (lines 738, 747, 758) to continue requiring `walletAddress`.
15. Update `RegistryStandingsManagement` (line 850-858): change `walletAddress: string` to `walletAddress?: string` in props. The component's `handleRemove` function (line 931) already guards on `if (!packageId || !walletAddress) return;` so this is safe. Hide the per-entry remove button (Trash2 icon, line 1001-1008) when `!walletAddress`.
16. In the parent JSX that renders `RegistryStandingsManagement` (line 723-728), pass `walletAddress={walletAddress}` (which may be undefined when wallet is not connected).

### Phase 2: Add contextual help

1. Add `Info` to the lucide-react imports in `Standings.tsx`.
2. Create a `StandingsHelp` component within `Standings.tsx` that renders a dismissible info banner:
   - Use `useState(() => localStorage.getItem("periscope:standings-help-dismissed") === "1")` to init dismiss state.
   - If not dismissed, render a bordered info panel (zinc-800 border, zinc-900/50 bg) with `Info` icon and two short bullet points explaining Contacts and Registries.
   - Include a close/dismiss button (`X` icon) that sets the `localStorage` key to `"1"` and updates state.
   - Return `null` when dismissed.
3. Place `<StandingsHelp />` between the page subtitle (line 121) and the tabs (line 124).
4. Add per-tab description text -- a single `<p>` element rendered between the tab bar and the tab content, keyed on `activeTab`:
   - "contacts": "Your private standings for characters and tribes, stored locally."
   - "registries": "On-chain standings registries published by other players. Subscribe to track them."
   - "my-registries": "Registries you own or admin. Used by your smart assemblies to set access rules."

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/views/Standings.tsx` (line 96-151) | Modify | Update `Standings()` to destructure `useActiveCharacter()`, compute `chainAddress`, pass to `MyRegistriesTab` |
| `apps/periscope/src/views/Standings.tsx` (line 494-769) | Modify | Update `MyRegistriesTab` props, remove wallet gate, use `queryAddress`, gate transaction buttons on `walletAddress`, update owner badge |
| `apps/periscope/src/views/Standings.tsx` (line 850-858) | Modify | Make `walletAddress` optional in `RegistryStandingsManagement`, hide remove buttons when wallet not connected |
| `apps/periscope/src/views/Standings.tsx` (line 4-17) | Modify | Add `Info` and `X` to lucide-react imports (for info banner and dismiss button) |
| `apps/periscope/src/views/Standings.tsx` (line 20) | Modify | Add `import { ConnectWalletButton } from "@/components/WalletConnect"` |
| `apps/periscope/src/views/Standings.tsx` (new section after line 92) | Add | `StandingsHelp` dismissible info banner component |
| `apps/periscope/src/views/Standings.tsx` (line 110-151) | Modify | Insert `StandingsHelp` and per-tab descriptions into the JSX |

## Open Questions

None -- all resolved.

**Resolved:** Should the "My Registries" tab show a combined address indicator when using a stored address vs connected wallet? **Decision: No.** The active character is already visible in the sidebar's CharacterSwitcher, and the Deployables view uses the same pattern without any address indicator. Adding one here would be inconsistent and add visual clutter.

## Deferred

- **Registry query optimization** -- Currently `queryAllRegistries` fetches ALL registries then filters client-side. A more efficient approach would query by owner address directly on-chain, but this requires a different GraphQL query shape (owner-based object filter). Deferring as it works fine for the current registry count and is a separate concern from the UX fix.
- **Help text localization** -- Help text is hardcoded in English. If the app ever supports i18n, this should be extracted. Not a concern for current scope.
