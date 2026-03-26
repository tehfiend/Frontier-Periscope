# Plan: Dashboard Landing Page and Structure Location Link

**Status:** Draft
**Created:** 2026-03-26
**Module:** periscope

## Overview

Currently the root route `/` immediately redirects to `/sonar` (router.tsx L94-100). New users land on Sonar with no guidance about what Periscope offers or how to configure the on-chain modules they need -- private maps, standings registries, and governance markets. Returning users have no quick overview of their configured assets.

This plan introduces a Dashboard view at `/` that replaces the redirect. The dashboard presents a grid of module cards, each showing a summary when items exist or explanatory onboarding text when empty. This serves dual purposes: onboarding for new users who need to understand why they should create a private map or standings registry, and a quick-glance overview for returning users who want to see their configured state at a glance.

Additionally, this plan adds a "create private map location" link to the Structures/Deployables view for structures that have no location. Currently, discovering that a structure has no location and then navigating to Private Maps to add one requires the user to know that flow exists. A direct link from the structure row bridges that gap.

## Current State

### Router and Landing (router.tsx L94-100)

The index route at `/` uses `beforeLoad` to throw a redirect to `/sonar`. There is no Dashboard view. The `routeTree` (L240-264) lists all routes but has no dashboard/home route.

### Sidebar Navigation (Sidebar.tsx L42-77)

The sidebar has four nav groups -- Intel, Navigation, Assets, System -- with no "Home" or "Dashboard" entry. The sidebar uses `NavItem[]` with `{ to, icon, label }` shape.

### Existing Views

- **PrivateMaps** (PrivateMaps.tsx) -- queries `db.manifestPrivateMaps` and `db.manifestPrivateMapsV2` filtered by tenant. Shows V1 + V2 maps with location list. Empty state at L261-271 says "No private maps" with contextual description. Create flow requires wallet + encryption key.
- **Standings** (Standings.tsx) -- three tabs: Contacts (local `db.contacts`), Registries (subscribed `db.subscribedRegistries`), My Registries (on-chain query via `queryAllRegistries`). Empty states at L285, L449, L609, L657.
- **Market** (Market.tsx) -- queries `db.currencies` filtered by `notDeleted`. Discovers markets from chain via `queryMarkets()`. Shows currency list + selected market detail.
- **Settings** (Settings.tsx) -- character management via `db.characters.filter(notDeleted)`. Server selection, game logs directory, data management.
- **Deployables** (Deployables.tsx) -- structure datagrid. Location column (L839-861) uses `LocationEditor` inline component. `StructureDetailCard` (StructureDetailCard.tsx L243-249) shows location with MapPin icon, falls back to em dash when no location.

### Data Access Patterns

- Characters: `db.characters.filter(notDeleted).toArray()` via `useActiveCharacter()` (useActiveCharacter.ts L10)
- Private maps V1: `db.manifestPrivateMaps.where("tenant").equals(tenant).toArray()` (PrivateMaps.tsx L76-79)
- Private maps V2: `db.manifestPrivateMapsV2.where("tenant").equals(tenant).toArray()` (PrivateMaps.tsx L82-86)
- Contacts: `db.contacts.toArray()` via `useContacts()` (useContacts.ts L20)
- Subscribed registries: `db.subscribedRegistries.where("tenant").equals(tenant).toArray()` via `useSubscribedRegistries(tenant)` (useRegistrySubscriptions.ts L19-29)
- Currencies/markets: `db.currencies.filter(notDeleted).toArray()` (Market.tsx L80)
- Deployables: `db.deployables.where("owner").equals(chainAddress).filter(notDeleted).toArray()` (Deployables.tsx L230-236)

### Structure Location Link -- Current State

The Deployables datagrid renders a `LocationEditor` component (L853-858) for each row in the location column. This editor lets the user pick a system/planet/L-point combo and saves it locally. The `StructureDetailCard` (StructureDetailCard.tsx L243-249) also shows the location but has no link to private maps.

When a structure has no location, the cell is empty (empty string accessor at L845). There is no indication that private maps could provide this data, and no link to navigate there.

### UI Patterns

- **StatCard** (StatCard.tsx) -- small stat display with icon, label, value, sub-text, color. Used in Sonar and Deployables dashboards. Good for numeric summaries but not for the richer module cards needed here.
- **EmptyState** -- local function defined in both PrivateMaps.tsx (L552-568) and Standings.tsx (L1087-1103). Identical implementation: centered icon + title + description in a bordered container. Not extracted as a shared component.

## Target State

### Feature 1: Dashboard Landing Page

A new `Dashboard` view at `/` replaces the sonar redirect. Layout:

- Full-width page with header "Frontier Periscope" + subtitle
- Grid of module cards (responsive: 1 col on mobile, 2 cols on md+)
- Each card has: icon, title, summary content OR empty-state guidance, action link

**Cards:**

1. **Characters** -- shows active character info (name, tribe, linked address status). When no characters: explains that characters are needed to use Periscope, links to Settings.
2. **Private Maps** -- shows count of V1 + V2 maps and total locations. When empty: explains that private maps let you store encrypted structure locations shared with allies, links to Private Maps view.
3. **Standings** -- shows contact count + subscribed registry count. When empty: explains that standings control who can use your structures (SSU access, gate tolls, turret targeting), links to Standings view.
4. **Markets** -- shows count of currencies/markets. When empty: explains that markets let you create and trade governance tokens, links to Markets view.
5. **Structures** -- shows count of owned deployables, fuel status summary (how many critical/warning/OK). When empty: explains how to sync structures from chain, links to Structures view.

Each card with existing items shows a concise summary + "View all ->" link. Each empty card shows 2-3 sentences of explanatory text + a primary action button (e.g., "Create Map", "Go to Standings").

### Feature 2: Structure Location Link

In the Deployables view, when a structure has no location (no systemId):

1. **DataGrid location cell** -- show a "Add to map" link (small, muted) that navigates to `/private-maps` (where the user can select a map and add the location). The link passes the structure's objectId as a search param so the Private Maps view can pre-fill it (deferred -- see Deferred section).
2. **StructureDetailCard** -- in the Location section, when locationStr is the em-dash fallback, show a small "Add via Private Map" link that navigates to `/private-maps`.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dashboard layout | Responsive 2-col grid | Balances information density with readability. 1 col on mobile, 2 on md+. |
| Card component | New `DashboardCard` in Dashboard.tsx | Cards here need richer content than StatCard (which is a simple stat box). Keep it local to the view initially; extract later if reused. |
| Empty state text | Inline in Dashboard.tsx | Each module's empty guidance is unique. No need to abstract. |
| Data queries | Direct `useLiveQuery` calls in Dashboard | Simple, reactive, consistent with other views. No new hooks needed -- reuse `useActiveCharacter`, `useContacts`, `useSubscribedRegistries`. |
| Route change | Replace redirect with component | Change indexRoute from `beforeLoad: redirect` to `component: Dashboard`. |
| Sidebar update | Add "Home" link at top before groups | Uses `LayoutDashboard` icon. Always visible, not inside a group. |
| Structure location link target | Navigate to `/private-maps` | The add-location dialog in PrivateMaps already handles the full flow (system picker, map selector, encryption). No need to duplicate. |
| Lazy loading | Lazy-load Dashboard view | Consistent with other views. Dashboard queries are lightweight (IndexedDB counts). |

## Implementation Phases

### Phase 1: Dashboard View and Route

1. Create `apps/periscope/src/views/Dashboard.tsx` with the Dashboard component:
   - Import `useLiveQuery` from `dexie-react-hooks`, `db` and `notDeleted` from `@/db`, `useActiveCharacter` from `@/hooks/useActiveCharacter`, `useContacts` from `@/hooks/useContacts`, `useSubscribedRegistries` from `@/hooks/useRegistrySubscriptions`, `useActiveTenant` from `@/hooks/useOwnedAssemblies`
   - Query: characters (from `useActiveCharacter`), private maps V1 count + V2 count (via `useLiveQuery`), contacts (from `useContacts`), subscribed registries (from `useSubscribedRegistries`), currencies (via `useLiveQuery` on `db.currencies.filter(notDeleted)`), deployables (via `useLiveQuery` on `db.deployables.filter(notDeleted)`)
   - Render page header with Telescope icon + "Frontier Periscope" title + "Dashboard" subtitle
   - Render responsive grid: `grid grid-cols-1 md:grid-cols-2 gap-4`
   - Each card: bordered container (`rounded-lg border border-zinc-800 bg-zinc-900/50 p-5`) with icon + title row, then conditional content

2. Define a local `DashboardCard` sub-component:
   - Props: `icon: LucideIcon`, `title: string`, `to: string`, `children: ReactNode`
   - Renders the card shell with a `Link` (from `@tanstack/react-router`) wrapping the header that navigates to the detail view
   - Footer: small "View all ->" link in cyan

3. Card content implementations:
   - **Characters card**: show active character name + tribe, total character count. Empty: "Add a character to get started. Characters link your in-game identity to on-chain data, enabling structure sync, sonar tracking, and private maps." + link to `/settings`
   - **Private Maps card**: show `{v1Count + v2Count} maps, {locationCount} locations`. Empty: "Private maps store encrypted structure locations that only invited members can see. Use them to share intel with allies without revealing positions publicly." + link to `/private-maps`
   - **Standings card**: show `{contactCount} contacts, {registryCount} registries`. Empty: "Standings control who can interact with your structures -- gate access, SSU deposits, turret targeting. Create a registry to define friend/foe rules, or add contacts for private tracking." + link to `/standings`
   - **Markets card**: show `{currencyCount} currencies`. Empty: "Governance markets let you publish custom tokens and manage buy/sell orders. Create a token to power your organization's economy." + link to `/markets`
   - **Structures card**: show total count + fuel summary (critical/warning/healthy counts using FUEL_CRITICAL_HOURS and FUEL_WARNING_HOURS constants from `@/lib/constants`). Empty: "Sync your structures from the blockchain to track fuel levels, manage extensions, and monitor locations." + link to `/structures`

4. Update `apps/periscope/src/router.tsx`:
   - Add lazy import: `const LazyDashboard = lazy(() => import("@/views/Dashboard").then((m) => ({ default: m.Dashboard })));`
   - Add wrapper: `function DashboardPage() { return <Suspense fallback={<LoadingFallback />}><LazyDashboard /></Suspense>; }`
   - Change `indexRoute` from `beforeLoad: () => { throw redirect({ to: "/sonar" }); }` to `component: DashboardPage`
   - Remove the `redirect` import if no longer used by indexRoute (check other routes -- deployablesRoute, assembliesRoute, locationsRoute, targetsRoute, logsRoute, extensionsRoute all still use it, so keep the import)

5. Update `apps/periscope/src/components/Sidebar.tsx`:
   - Add `LayoutDashboard` to the lucide-react import
   - Add a standalone "Home" link before the nav groups: `<NavLink to="/" icon={LayoutDashboard} label="Home" />` with `activeOptions={{ exact: true }}` to avoid highlighting on all routes
   - This link sits above the first group header, visually separated

### Phase 2: Structure Location Link

1. Update `apps/periscope/src/views/Deployables.tsx` -- location column cell (L850-860):
   - In the `LocationEditor` component (defined at ~L1234), when `displayText` is empty (no systemId and no lPoint), render an additional small link below the picker trigger: `<Link to="/private-maps" className="text-[10px] text-zinc-500 hover:text-cyan-400">Add to map</Link>`
   - Import `Link` from `@tanstack/react-router` (already imported indirectly via components, but add explicit import if needed)

2. Update `apps/periscope/src/components/StructureDetailCard.tsx` -- location display (L243-249):
   - When `locationStr` equals the em-dash (`"\u2014"`) fallback, render a small link after the location text: `<Link to="/private-maps" className="text-[10px] text-zinc-500 hover:text-cyan-400">Add via Private Map</Link>`
   - Import `Link` from `@tanstack/react-router`

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/views/Dashboard.tsx` | CREATE | New dashboard view with module cards |
| `apps/periscope/src/router.tsx` | MODIFY | Replace index redirect with Dashboard component, add lazy import |
| `apps/periscope/src/components/Sidebar.tsx` | MODIFY | Add "Home" link with LayoutDashboard icon |
| `apps/periscope/src/views/Deployables.tsx` | MODIFY | Add "Add to map" link in LocationEditor when no location |
| `apps/periscope/src/components/StructureDetailCard.tsx` | MODIFY | Add "Add via Private Map" link when location is empty |

## Open Questions

1. **Should the dashboard show a "quick actions" section (e.g., "Sync structures", "Open Sonar")?**
   - **Option A: Module cards only** -- Pros: simpler, focused on configuration status. Cons: returning users may want quick shortcuts.
   - **Option B: Module cards + quick actions row** -- Pros: more useful for daily users. Cons: adds complexity, risks cluttering the page.
   - **Recommendation:** Option A for initial implementation. Quick actions can be added in a follow-up if users request it. The sidebar already provides navigation to all views.

2. **Should the Sidebar "Home" link use exact matching or prefix matching?**
   - **Option A: Exact match (`activeOptions: { exact: true }`)** -- Pros: only highlights when actually on `/`. Cons: requires overriding NavLink's default `exact: false`.
   - **Option B: Prefix match (default)** -- Pros: consistent with other nav items. Cons: would highlight on every route since all routes start with `/`.
   - **Recommendation:** Option A. The Home link must use exact matching or it will appear active on every page. The NavLink component already accepts `activeOptions` via the underlying TanStack `Link` -- the Home link will need a separate rendering or the `NavLink` component needs an `activeOptions` prop override.

3. **Dependency on Plan 04 (Manifest Expansion) for market/registry counts?**
   - **Option A: Use existing data sources (db.currencies, db.subscribedRegistries)** -- Pros: works now, no dependency. Cons: currencies only include markets the user has interacted with (sync'd from Market view), not all markets they could access.
   - **Option B: Wait for Plan 04 to cache all markets/registries in manifest** -- Pros: accurate counts. Cons: blocks this plan.
   - **Recommendation:** Option A. The dashboard shows what the user has configured locally, not what exists on-chain. The existing queries accurately reflect "your stuff." Plan 04 can enhance this later.

## Deferred

- **Pre-fill structure on Private Maps navigation** -- when clicking "Add to map" from a structure row, pass the structure objectId/systemId as URL search params so Private Maps can pre-select the structure in the add-location dialog. Requires adding search param support to the private maps route and wiring it into the dialog. Low complexity but separable from the initial link implementation.
- **Dashboard live stats** -- show real-time sonar event count, active log sessions, chain poll status. These are ephemeral stats that change frequently; the dashboard should focus on configuration state first.
- **Shared EmptyState component** -- both PrivateMaps.tsx and Standings.tsx define identical local `EmptyState` functions. Extract to `components/EmptyState.tsx` and reuse in Dashboard. Separable cleanup task.
