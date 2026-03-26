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
- Deployables (owned): `db.deployables.where("owner").equals(chainAddress).filter(notDeleted).toArray()` (Deployables.tsx L230-236) -- scoped by active character's Sui address. The dashboard should similarly scope by owned addresses to show "your" structure count.

### Structure Location Link -- Current State

The Deployables datagrid renders a `LocationEditor` component (L853, defined at L1239) for each row in the location column. This editor lets the user pick a system/planet/L-point combo and saves it locally. When closed with no location, it renders a button showing an em-dash (L1333-1349). The `StructureDetailCard` (StructureDetailCard.tsx L243-249) also shows the location but has no link to private maps.

When a structure has no location, the cell shows an em-dash button (LocationEditor L1346). There is no indication that private maps could provide this data, and no link to navigate there. Neither Deployables.tsx nor StructureDetailCard.tsx imports `Link` from `@tanstack/react-router` -- both will need a new import.

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

1. **DataGrid location cell** -- show a "Add to map" link (small, muted) that navigates to `/private-maps` where the user can select a map and add the location. Initially a plain navigation link; pre-filling the structure in the add-location dialog is deferred (see Deferred section).
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
   - Queries (all reactive via `useLiveQuery` or existing hooks):
     - Characters: `useActiveCharacter()` -> `allCharacters`, `activeCharacter`
     - Private maps V1: `db.manifestPrivateMaps.where("tenant").equals(tenant).count()`
     - Private maps V2: `db.manifestPrivateMapsV2.where("tenant").equals(tenant).count()`
     - Map locations: `db.manifestMapLocations.where("tenant").equals(tenant).count()` (total across all maps)
     - Contacts: `useContacts()` -> `.length`
     - Subscribed registries: `useSubscribedRegistries(tenant)` -> `.length`
     - Currencies: `db.currencies.filter(notDeleted).count()`
     - Owned deployables: `activeSuiAddresses.length > 0 ? db.deployables.where("owner").anyOf(activeSuiAddresses).filter(notDeleted).toArray() : []` (need full records for fuel calculation; guard empty array for `anyOf`)
   - Note: use `.count()` where only a number is needed (lighter than `.toArray()`) except for deployables where fuel status requires iterating records
   - Render page header with Telescope icon + "Frontier Periscope" title + "Dashboard" subtitle
   - Render responsive grid: `grid grid-cols-1 md:grid-cols-2 gap-4`
   - Each card: bordered container (`rounded-lg border border-zinc-800 bg-zinc-900/50 p-5`) with icon + title row, then conditional content

2. Define a local `DashboardCard` sub-component:
   - Props: `icon: LucideIcon`, `title: string`, `to: string`, `children: ReactNode`
   - Renders the card shell with a `Link` (from `@tanstack/react-router`) wrapping the header that navigates to the detail view
   - Footer: small "View all ->" link in cyan

3. Card content implementations (use same icons as Sidebar for consistency):
   - **Characters card** (icon: `User`, to: `/settings`): show active character name + tribe, total character count. Empty: "Add a character to get started. Characters link your in-game identity to on-chain data, enabling structure sync, sonar tracking, and private maps."
   - **Private Maps card** (icon: `Lock`, to: `/private-maps`): show `{v1Count + v2Count} maps, {locationCount} locations`. Empty: "Private maps store encrypted structure locations that only invited members can see. Use them to share intel with allies without revealing positions publicly."
   - **Standings card** (icon: `BookUser`, to: `/standings`): show `{contactCount} contacts, {registryCount} registries`. Empty: "Standings control who can interact with your structures -- gate access, SSU deposits, turret targeting. Create a registry to define friend/foe rules, or add contacts for private tracking."
   - **Markets card** (icon: `Coins`, to: `/markets`): show `{currencyCount} currencies`. Empty: "Governance markets let you publish custom tokens and manage buy/sell orders. Create a token to power your organization's economy."
   - **Structures card** (icon: `Package`, to: `/structures`): show total count + fuel summary (critical/warning/healthy counts using FUEL_CRITICAL_HOURS and FUEL_WARNING_HOURS constants from `@/lib/constants`). Empty: "Sync your structures from the blockchain to track fuel levels, manage extensions, and monitor locations."

4. Update `apps/periscope/src/router.tsx`:
   - Add lazy import: `const LazyDashboard = lazy(() => import("@/views/Dashboard").then((m) => ({ default: m.Dashboard })));`
   - Add wrapper: `function DashboardPage() { return <Suspense fallback={<LoadingFallback />}><LazyDashboard /></Suspense>; }`
   - Change `indexRoute` from `beforeLoad: () => { throw redirect({ to: "/sonar" }); }` to `component: DashboardPage`
   - Remove the `redirect` import if no longer used by indexRoute (check other routes -- deployablesRoute, assembliesRoute, locationsRoute, targetsRoute, logsRoute, extensionsRoute all still use it, so keep the import)

5. Update `apps/periscope/src/components/Sidebar.tsx`:
   - Add `LayoutDashboard` to the lucide-react import (L6-23)
   - The existing `NavLink` component (L98-132) hardcodes `activeOptions={{ exact: false }}` on the underlying `<Link>` (L105). Since `/` would match every route with prefix matching, the Home link needs special handling. Two approaches:
     - **Approach A (recommended):** Add an optional `exact` prop to `NavLink`, and when truthy set `activeOptions={{ exact: true }}` instead. Minimal change.
     - **Approach B:** Render a separate `<Link>` for the Home item outside the `NavLink` component.
   - Add the Home link in the `<nav>` element (L181) before the `navGroups.map(...)` loop. Use `<NavLink to="/" icon={LayoutDashboard} label="Home" exact />` (with approach A) or a standalone `<Link>` (with approach B).
   - Visually: add a small bottom margin or divider between the Home link and the first group.

### Phase 2: Structure Location Link

1. Update `apps/periscope/src/views/Deployables.tsx`:
   - Add `import { Link } from "@tanstack/react-router"` (not currently imported in this file)
   - In the `LocationEditor` component (defined at L1239), modify the closed state (L1333-1349). Currently it returns a single `<button>`. When `displayText` is empty (no location), wrap the return in a `<div className="flex items-center gap-2">` containing both the existing em-dash button and a new `<Link>`:
     ```
     <div className="flex items-center gap-2">
       <button ...>{/* existing em-dash */}</button>
       <Link to="/private-maps" className="text-[10px] text-zinc-500 hover:text-cyan-400">
         Add to map
       </Link>
     </div>
     ```
   - When `displayText` is non-empty (location exists), keep the existing button-only return unchanged
   - Note: a `<Link>` cannot be nested inside a `<button>` (invalid HTML), so they must be siblings

2. Update `apps/periscope/src/components/StructureDetailCard.tsx`:
   - Add `import { Link } from "@tanstack/react-router"` (not currently imported in this file)
   - In the Location section (L243-249), when `!systemName && !row.lPoint` (i.e., locationStr is the em-dash fallback), render an additional link after the em-dash span: `<Link to="/private-maps" className="ml-2 text-[10px] text-zinc-500 hover:text-cyan-400">Add via Private Map</Link>`

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
   - **Recommendation:** Option A. The Home link must use exact matching or it will appear active on every page. The NavLink component currently hardcodes `activeOptions={{ exact: false }}` at L105 -- it needs either (a) an optional `exact` prop added, or (b) the Home link rendered separately from NavLink. Option (a) is simpler and keeps the Home link visually consistent with other nav items.

3. **Dependency on Plan 04 (Manifest Expansion) for market/registry counts?**
   - **Option A: Use existing data sources (db.currencies, db.subscribedRegistries)** -- Pros: works now, no dependency. Cons: currencies only include markets the user has interacted with (sync'd from Market view), not all markets they could access.
   - **Option B: Wait for Plan 04 to cache all markets/registries in manifest** -- Pros: accurate counts. Cons: blocks this plan.
   - **Recommendation:** Option A. The dashboard shows what the user has configured locally, not what exists on-chain. The existing queries accurately reflect "your stuff." Plan 04 can enhance this later.

## Cross-Plan Dependencies

- **Plan 03 (Storage Datagrid)** modifies `Deployables.tsx` (location formatting, extension column, data source refactor) and `StructureDetailCard.tsx` (formatLocation, reset button). This plan's location link changes touch different sections (LocationEditor closed state, StructureDetailCard location display) but line numbers may shift. Execute Phase 2 of this plan after Plan 03's Deployables changes are merged, or verify line numbers at execution time.
- **Plan 04 (Manifest Expansion)** is an optional enhancement for dashboard data accuracy. Dashboard works without it using existing local data. Plan 04 could later enrich the dashboard with globally-cached market/registry counts.
- **Plan 05 (Misc Fixes)** modifies `Deployables.tsx` (category column, actions reorder, notes placeholder). Independent from this plan's location link changes.
- **Plan 06 (Extension Fixes)** modifies both `Deployables.tsx` and `StructureDetailCard.tsx` (stale turret indicators). Independent from this plan's changes but adds more content to the same detail card file.
- **No plan conflicts with Phase 1** (Dashboard view + route + sidebar) -- these files are not touched by other plans.

## Deferred

- **Pre-fill structure on Private Maps navigation** -- when clicking "Add to map" from a structure row, pass the structure objectId/systemId as URL search params so Private Maps can pre-select the structure in the add-location dialog. Requires adding search param support to the private maps route and wiring it into the dialog. Low complexity but separable from the initial link implementation.
- **Dashboard live stats** -- show real-time sonar event count, active log sessions, chain poll status. These are ephemeral stats that change frequently; the dashboard should focus on configuration state first.
- **Shared EmptyState component** -- both PrivateMaps.tsx and Standings.tsx define identical local `EmptyState` functions. Extract to `components/EmptyState.tsx` and reuse in Dashboard. Separable cleanup task.
