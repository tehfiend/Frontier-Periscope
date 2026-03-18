# Plan: Sonar & Bridge — Unified Event Log + Curated Dashboard

**Status:** Complete
**Created:** 2026-03-17
**Completed:** 2026-03-17
**Module:** periscope

## Overview

Sonar is a unified event log system for Periscope that combines two event sources into a single, filterable DataGrid. **Local Sonar** watches game and chat log files on disk (the existing Log Analyzer functionality, renamed and refactored). **Chain Sonar** listens for on-chain blockchain events, starting with SSU inventory item events (deposits, withdrawals, mints, burns). Both channels feed into a common `sonarEvents` IndexedDB table with a unified schema, displayed in a single DataGrid with Excel-style column filtering.

Bridge is a curated dashboard built from Sonar data. Rather than showing raw event logs, Bridge presents derived intelligence: character location tracking (parsed from Local channel system changes), SSU activity summaries, and status indicators. Bridge is the "so what" layer on top of Sonar's raw data.

This plan covers Phase 1: location tracking via Local Sonar, and SSU inventory events via Chain Sonar. The existing Log Analyzer views (Logs.tsx with its 7 tabs) remain accessible in their current form as a detail drill-down from Sonar, but the primary navigation shifts to Sonar as the entry point.

## Current State

### Log Analyzer (Local file watching)
- **Route:** `/logs` in sidebar under "Tools" group
- **View:** `apps/periscope/src/views/Logs.tsx` (~1800 lines) — 7 tabs: Live, Sessions, Mining, Combat, Travel, Structures, Chat
- **Hook:** `apps/periscope/src/hooks/useLogWatcher.ts` — polls every 5s via File System Access API; processes both `Gamelogs/` and `Chatlogs/` subdirectories
- **Parser:** `apps/periscope/src/lib/logParser.ts` — regex-based parsing for game log entries (combat, mining, notify, hint, question, info) and chat log entries (chat, system_change)
- **File Access:** `apps/periscope/src/lib/logFileAccess.ts` — File System Access API wrapper with handle persistence in IndexedDB
- **Store:** `apps/periscope/src/stores/logStore.ts` — Zustand store for UI state (activeTab, liveStats, sessionId)
- **DB Tables:** `logEvents` (auto-increment id, sessionId+type compound index), `logSessions`, `logOffsets`
- **Types:** `apps/periscope/src/db/types.ts` — `LogEvent`, `LogSession`, `LogEventType` (15 event types)

### Chain Event Infrastructure
- **GraphQL queries:** `packages/chain-shared/src/graphql-queries.ts` — `queryEventsGql(client, eventType, opts?)` function that polls events by Move event type with cursor-based pagination; returns `{ data: Array<{parsedJson, sender, timestampMs}>, hasNextPage, nextCursor }`
- **Radar hook:** `apps/periscope/src/hooks/useRadar.ts` — existing pattern for polling chain events (killmails, fuel, status, assembly, jumps) every 15s; stores events in `radarEvents` table. Note: Radar defines its own local `getEventTypes(worldPkg)` function rather than importing the one from `chain/config.ts`. Chain Sonar should import from `chain/config.ts`.
- **Config:** `apps/periscope/src/chain/config.ts` — `getEventTypes(tenant: TenantId)` returns event type strings keyed by name (currently: FuelEvent, JumpEvent, KillmailCreated, AssemblyCreated, StatusChanged, CharacterCreated); `moveType()` helper for constructing Move type paths

### Navigation (post-implementation)
- **Sidebar:** `apps/periscope/src/components/Sidebar.tsx` — NavItem array with groups; Sonar at `/sonar` and Bridge at `/bridge` under "Intelligence" group; status dots on Sonar nav item; old Log Analyzer removed from sidebar
- **Router:** `apps/periscope/src/router.tsx` — TanStack Router with lazy-loaded `Sonar`, `Bridge`, and `Logs` views; `/logs` redirects to `/sonar`; old Logs accessible at `/logs/detail`

### Relevant Event Types (from world contracts)
The `world::inventory` module emits these events for all inventory operations:
```
ItemDepositedEvent  { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemWithdrawnEvent  { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemMintedEvent     { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemBurnedEvent     { assembly_id, assembly_key, character_id, character_key, item_id, type_id, quantity }
ItemDestroyedEvent  { assembly_id, assembly_key, item_id, type_id, quantity }
```

### Existing Data for SSU Filtering
- **Deployables table:** `db.deployables` stores all owned assemblies including SSUs (types: `storage_unit`, `smart_storage_unit`, `protocol_depot`), with `objectId` and `owner` (Sui address)
- **Characters table:** `db.characters` stores active characters with `suiAddress` and `manifestId`
- **Manifest:** `db.manifestCharacters` provides character object IDs and item IDs for chain lookups

## Target State

### Data Model

**New Dexie table: `sonarEvents`**
```typescript
interface SonarEvent {
  id?: number;              // auto-increment
  timestamp: string;        // ISO 8601
  source: "local" | "chain"; // which sonar channel
  eventType: string;        // e.g. "system_change", "chat", "item_deposited", "item_withdrawn"
  characterName?: string;   // who generated the event
  characterId?: string;     // character item_id (from logs or chain)
  assemblyId?: string;      // SSU/assembly object ID (chain events)
  assemblyName?: string;    // human-readable assembly label
  typeId?: number;          // item type_id (chain events)
  typeName?: string;        // resolved item type name from gameTypes
  quantity?: number;        // item quantity (chain events)
  systemName?: string;      // solar system name (local events)
  details?: string;         // additional context (message text, raw JSON)
  sessionId?: string;       // link to log session (local events only)
  txDigest?: string;        // transaction digest (chain events only)
}
```

**New Dexie table: `sonarState`**
```typescript
interface SonarChannelState {
  channel: "local" | "chain"; // primary key
  enabled: boolean;
  status: "active" | "off" | "error";
  lastError?: string;
  // Local-specific: high-water-mark for logEvents.id
  lastProcessedLogId?: number;
  // Chain-specific cursor tracking
  cursors?: Record<string, string>; // eventType -> GraphQL cursor
  lastPollAt?: string;
}
```

**New Zustand store: `sonarStore`**
```typescript
interface SonarState {
  localEnabled: boolean;
  chainEnabled: boolean;
  localStatus: "active" | "off" | "error";
  chainStatus: "active" | "off" | "error";
  // Actions
  setLocalEnabled: (v: boolean) => void;
  setChainEnabled: (v: boolean) => void;
  setLocalStatus: (s: "active" | "off" | "error") => void;
  setChainStatus: (s: "active" | "off" | "error") => void;
}
```

### Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/sonar` | `Sonar` | Unified event DataGrid with channel toggles |
| `/bridge` | `Bridge` | Curated dashboard with location, activity widgets |
| `/logs` | Redirect to `/sonar` | Backward compatibility |

### Sidebar Changes (Implemented)

Replaced "Log Analyzer" in the "Tools" group with new entries in the "Intelligence" group. Radar was also removed from the sidebar in a separate commit:

```
Intelligence:
  /sonar     — Sonar (with dual status indicator dots: green=local, orange=chain)
  /bridge    — Bridge
  /intel     — Intel Channel
  /targets   — Watchlist
  /players   — Players
  /killmails — Killmails
  /manifest  — Manifest
```

The Sonar nav item includes two status indicator dots (one per channel):
- Green dot (local): active when log polling succeeds
- Orange dot (chain): active when chain polling succeeds
- Gray: channel off
- Red: channel has an error

### Components

**Sonar View (`Sonar.tsx`)**
- Header with two toggle switches: "Local" and "Chain", each with a dot indicator
- Unified DataGrid with columns: Timestamp, Source (Local/Chain), Type, Character, Details
- Excel-style ColumnFilter on each column (reuses existing `ColumnFilter` component)
- "Details" column shows context-sensitive content: system name for location events, item name + quantity for inventory events, message text for chat
- Optional: "Open in Log Analyzer" button to jump to the full Logs view for a session

**Bridge View (`Bridge.tsx`)**
- **Location Card:** Shows current system for each active character (derived from most recent `system_change` sonar events)
- **SSU Activity Summary:** Table of recent SSU inventory activity: which SSU, what items, net flow
- **Channel Status:** Compact display of Local/Chain sonar status with toggle controls

### Hooks

**`useLocalSonar.ts`** — Taps into the existing log data by polling the `logEvents` table for recent `system_change` (and optionally `chat`) entries, then copies them to the `sonarEvents` table. Uses a high-water-mark (last processed `logEvents.id`) persisted in `sonarState` to avoid re-processing. Does NOT replace or wrap `useLogWatcher` -- instead it reads from the same `logEvents` table that `useLogWatcher` writes to. This avoids modifying the tightly-coupled `useLogWatcher` internals (where `processGameLog` and `processChatLog` are private functions). The existing log analyzer data flow is unaffected.

Note: `system_change` events originate from chat logs (`Chatlogs/` directory), parsed in `parseChatEntries()` when the speaker is "Keeper" and the message matches `Channel changed to Local : <systemName>`. They are NOT produced by the game log parser (`parseEntries()`). The `logEvents` table stores both game and chat events with a unified schema, so `useLocalSonar` can simply query `db.logEvents.where("type").equals("system_change")`.

**`useChainSonar.ts`** — Polls for inventory events using `queryEventsGql`:
1. On enable, loads known SSU object IDs from `db.deployables` (filtered by active character's `owner` address)
2. Restores cursors from `sonarState` table
3. Polls every 15s for `ItemDepositedEvent`, `ItemWithdrawnEvent`, `ItemMintedEvent`, `ItemBurnedEvent`
4. Filters events: only stores events where `assembly_id` matches a known SSU
5. Resolves `type_id` to item name via `db.gameTypes` cache
6. Writes matching events to `sonarEvents` table
7. Persists cursors to `sonarState` table

### Event Type Additions to chain/config.ts

Add to `getEventTypes()`:
```typescript
ItemDeposited: `${pkg}::inventory::ItemDepositedEvent`,
ItemWithdrawn: `${pkg}::inventory::ItemWithdrawnEvent`,
ItemMinted: `${pkg}::inventory::ItemMintedEvent`,
ItemBurned: `${pkg}::inventory::ItemBurnedEvent`,
```

Note: `ItemDestroyedEvent` is intentionally excluded -- it lacks `character_id`/`character_key` fields, making it less useful for intel attribution. Can be added later if needed.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Separate `sonarEvents` table vs reuse `logEvents` | New table | `logEvents` has a different schema (sessionId-centric, game-log-specific fields). Sonar events need a unified schema for both sources. |
| Local Sonar reads from logEvents, copies to sonarEvents | Yes, poll + copy | `useLogWatcher` writes to `logEvents` as before (no changes). `useLocalSonar` polls `logEvents` for `system_change` entries using a high-water-mark and copies them to `sonarEvents`. This avoids modifying the tightly-coupled `useLogWatcher` (where `processGameLog`/`processChatLog` are private functions). The Logs view stays intact. |
| Chain Sonar uses same polling pattern as Radar | Yes | Proven pattern. `queryEventsGql` with cursor persistence works. No subscriptions available on GraphQL. |
| Filter chain events by owned SSU IDs | Client-side post-filter | `queryEventsGql` only filters by event type, not by assembly_id. We fetch all events and discard non-matching ones client-side. For Phase 1 this is fine since SSU events are low volume. |
| Bridge as separate route vs tab on Sonar | Separate route | Bridge is a dashboard with widgets, not a grid view. Mixing them in one page adds complexity. Users navigate between them as needed. |
| Keep `/logs` route working | Redirect to `/sonar` | Don't break bookmarks. Users who want the old detail view can access it from Sonar. |
| Sonar store persistence | IndexedDB via `sonarState` table | Toggle state and cursors must survive page reloads. Zustand is ephemeral; persist to Dexie on change. |
| Status indicator in sidebar | Dot next to "Sonar" label | Consistent with existing server indicator pattern (green/amber dot next to logo). |

## Implementation Phases

### Phase 1: Sonar Infrastructure + Local Sonar (4 steps) -- COMPLETE

1. [x] **Add `sonarEvents` and `sonarState` tables to Dexie schema** — New DB version (v16). `sonarEvents` with indexes on `[source+eventType]`, `timestamp`, `characterId`, `assemblyId`. `sonarState` keyed by `channel`.

2. [x] **Create `sonarStore.ts`** — Zustand store for UI state (channel toggles, status). Initialize from `sonarState` DB table on app load. Persist toggle changes back to DB. *Implementation note: also includes `pingLocal`/`pingChain` actions and ping counters for sonar animation.*

3. [x] **Create `useLocalSonar.ts` hook** — Polls the `logEvents` table for new `system_change` entries. *Implementation note: uses timestamp-based deduplication instead of the planned high-water-mark approach -- functionally equivalent, avoids ID ordering issues.* On each poll (every 5s), queries `db.logEvents.where("type").equals("system_change")`, converts matching entries to `SonarEvent` format, and writes to `sonarEvents`. Reads `sonarStore.localEnabled` to determine if active.

4. [x] **Create `Sonar.tsx` view** — Unified DataGrid with channel toggles in header. Columns: Timestamp, Source, Type, Character, Details, plus Actions column with "Open in Log Analyzer" link. Uses `useLiveQuery` on `sonarEvents` table. Excel-style filtering via `excelFilterFn`. Route at `/sonar`, redirect from `/logs`. Includes sonar ping animation component.

### Phase 2: Chain Sonar (3 steps) -- COMPLETE

5. [x] **Add inventory event types to `chain/config.ts`** — Added `ItemDeposited`, `ItemWithdrawn`, `ItemMinted`, `ItemBurned` to `getEventTypes()`.

6. [x] **Create `useChainSonar.ts` hook** — Poll-based event listener using `queryEventsGql`. Loads known SSU IDs from `db.deployables` for all registered characters (Option B from open question #2). Filters incoming events by matching `assembly_id`. Resolves item type names from `db.gameTypes`. Writes to `sonarEvents`. Persists cursors to `sonarState`. 15s poll interval.

7. [x] **Integrate Chain Sonar into Sonar view** — *Implementation note: both sonar hooks are activated globally in `Layout.tsx` rather than only in the Sonar view, ensuring events are collected regardless of which page is active.* Chain toggle controls enable/disable. Status dot reflects poll state.

### Phase 3: Bridge Dashboard (3 steps) -- COMPLETE

8. [x] **Create `Bridge.tsx` view** — Dashboard layout with widget cards. Location Card queries latest `system_change` event per character from `sonarEvents`. SSU Activity Summary queries recent `item_deposited`/`item_withdrawn` events grouped by assembly. Channel Status card with toggle controls. *Implementation note: Radar was removed from the sidebar in a separate commit; the Intelligence group now has Sonar and Bridge as the primary entries.*

9. [x] **Wire up routing and navigation** — `/bridge` route added. Sidebar updated: Sonar + Bridge in Intelligence group, old Log Analyzer entry removed. Status indicator dots on Sonar nav item. *Implementation note: Radar view (`Radar.tsx`) was removed; `useRadar.ts` hook still exists but has no view.*

10. [x] **Add sidebar status indicators** — `NavItem` type extended with optional `statusDot` field. `useSonarDots()` hook reads from `sonarStore` to compute per-channel dot colors (green for local, orange for chain). Rendered inline with label text.

### Phase 4: Polish + Old Logs Access (2 steps) -- COMPLETE

11. [x] **Add "Open in Log Analyzer" link from Sonar** — Per-event FileText icon link to `/logs/detail?sessionId=...` for local events with a `sessionId`. Also an "Open Analyzer" button in the Sonar header. Logs view accessible at `/logs/detail`.

12. [x] **Backfill existing log data into Sonar** — V16 upgrade handler scans `logEvents` for `system_change` events, resolves character names from `logSessions`, and bulk-adds them to `sonarEvents`. Sets `lastProcessedLogId` high-water-mark.

## File Summary

| File | Action | Status | Description |
|------|--------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Edit | Done | Added `SonarEvent`, `SonarChannelState`, `SonarSource`, `SonarEventType`, `SonarChannelStatus` types |
| `apps/periscope/src/db/index.ts` | Edit | Done | Added v16 schema: `sonarEvents` and `sonarState` tables with indexes; backfill migration |
| `apps/periscope/src/stores/sonarStore.ts` | Create | Done | Zustand store for channel toggle state, status indicators, ping counters |
| `apps/periscope/src/hooks/useLocalSonar.ts` | Create | Done | Polls logEvents table for system_change entries, copies to sonarEvents with timestamp-based dedup |
| `apps/periscope/src/hooks/useChainSonar.ts` | Create | Done | Polls inventory events via queryEventsGql, filters by owned SSUs across all characters |
| `apps/periscope/src/views/Sonar.tsx` | Create | Done | Unified DataGrid view with channel toggles, Excel filtering, sonar ping animation |
| `apps/periscope/src/views/Bridge.tsx` | Create | Done | Curated dashboard: location card, SSU activity summary, channel status |
| `apps/periscope/src/chain/config.ts` | Edit | Done | Added ItemDeposited, ItemWithdrawn, ItemMinted, ItemBurned to `getEventTypes()` |
| `apps/periscope/src/components/Sidebar.tsx` | Edit | Done | Replaced Log Analyzer nav with Sonar + Bridge in Intelligence group; added `useSonarDots()` hook + status dots |
| `apps/periscope/src/components/Layout.tsx` | Edit | Done | Added global activation of `useLocalSonar()` and `useChainSonar()` (not in original plan) |
| `apps/periscope/src/router.tsx` | Edit | Done | Added `/sonar`, `/bridge` routes; redirect `/logs` to `/sonar`; old Logs at `/logs/detail` |
| `apps/periscope/src/views/Logs.tsx` | Edit | Done | Export for lazy-load at new route path |

## Open Questions (Resolved)

1. **How many local event types should Sonar capture?**
   - **Resolved: Option A** -- Only `system_change` for now. Chat not yet included. Mining/combat stay in the dedicated Logs analyzer tabs.

2. **Should chain events be globally visible or filtered by active character?**
   - **Resolved: Option B** -- `useChainSonar` loads all characters with a `suiAddress` and monitors SSUs owned by any of them.

3. **Should the old Logs view remain directly navigable or only accessible via Sonar drill-down?**
   - **Resolved: Option A** -- Logs at `/logs/detail` with no sidebar entry. "Open Analyzer" button in Sonar header + per-event drill-down links.

## Deferred

- **Chain Sonar: Gate jump events** — Monitor who jumps through your gates. Uses `JumpEvent` type already in getEventTypes(). Deferred because it overlaps with Radar functionality.
- **Chain Sonar: Status change events** — Monitor when SSUs go online/offline. Also overlaps with Radar.
- **Bridge: Activity graphs** — Charts showing mining rate over time, combat activity, etc. Requires charting library (recharts or similar). Deferred to a future Bridge enhancement.
- **Bridge: Alerts/notifications** — Push notifications when interesting events happen (e.g., someone withdraws from your SSU). Deferred; Radar already handles alert patterns.
- **Sonar: Real-time chain subscriptions** — Replace polling with GraphQL subscriptions when/if `SuiGraphQLClient` adds support. Currently not available.
- **Sonar: Fleet log parsing** — Game also produces fleet logs at `Fleetlogs/`. Not yet analyzed; deferred until fleet mechanics are better understood.
- **Sonar: Market log parsing** — Market logs at `Marketlogs/`. Useful for trade intelligence but requires separate parser research.
- **Cross-Sonar correlation** — Link chain events to local events (e.g., a deposit event on chain correlating with a cargo notification in game logs). Complex; deferred.
