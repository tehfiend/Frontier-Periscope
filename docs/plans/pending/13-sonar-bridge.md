# Plan: Sonar & Bridge — Unified Event Log + Curated Dashboard

**Status:** Draft
**Created:** 2026-03-17
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
- **GraphQL queries:** `packages/chain-shared/src/graphql-queries.ts` — `queryEventsGql()` function that polls events by Move event type with cursor-based pagination
- **Radar hook:** `apps/periscope/src/hooks/useRadar.ts` — existing pattern for polling chain events (killmails, fuel, status, assembly, jumps) every 15s; stores events in `radarEvents` table
- **Config:** `apps/periscope/src/chain/config.ts` — `getEventTypes()` already defines some event type strings; `moveType()` helper for constructing Move type paths

### Navigation
- **Sidebar:** `apps/periscope/src/components/Sidebar.tsx` — NavItem array with groups; Log Analyzer at `/logs` under "Tools"
- **Router:** `apps/periscope/src/router.tsx` — TanStack Router with lazy-loaded `Logs` view

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
- **Deployables table:** `db.deployables` stores all owned assemblies including SSUs (type `storage_unit` / `smart_storage_unit`), with `objectId` and `owner` (Sui address)
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

### Sidebar Changes

Replace "Log Analyzer" in the "Tools" group with two new entries in the "Intelligence" group:

```
Intelligence:
  /radar     — Radar
  /sonar     — Sonar (with status indicator dots)
  /bridge    — Bridge
  /intel     — Intel Channel
  ...
```

The Sonar nav item includes a status indicator dot showing the combined health of both channels:
- Green: at least one channel active, no errors
- Gray: both channels off
- Red: any channel has an error

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

**`useLocalSonar.ts`** — Wraps the existing `useLogWatcher` but additionally writes `system_change` events to the `sonarEvents` table. Does NOT replace the existing log analyzer data flow (logEvents table continues to be populated for backward compatibility with the Logs view).

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

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Separate `sonarEvents` table vs reuse `logEvents` | New table | `logEvents` has a different schema (sessionId-centric, game-log-specific fields). Sonar events need a unified schema for both sources. |
| Local Sonar duplicates events to sonarEvents | Yes, write to both | The Logs view (7-tab analyzer) stays intact. Sonar only copies the subset it cares about (system_change, chat). Avoids a risky migration of the 1800-line Logs view. |
| Chain Sonar uses same polling pattern as Radar | Yes | Proven pattern. `queryEventsGql` with cursor persistence works. No subscriptions available on GraphQL. |
| Filter chain events by owned SSU IDs | Client-side post-filter | `queryEventsGql` only filters by event type, not by assembly_id. We fetch all events and discard non-matching ones client-side. For Phase 1 this is fine since SSU events are low volume. |
| Bridge as separate route vs tab on Sonar | Separate route | Bridge is a dashboard with widgets, not a grid view. Mixing them in one page adds complexity. Users navigate between them as needed. |
| Keep `/logs` route working | Redirect to `/sonar` | Don't break bookmarks. Users who want the old detail view can access it from Sonar. |
| Sonar store persistence | IndexedDB via `sonarState` table | Toggle state and cursors must survive page reloads. Zustand is ephemeral; persist to Dexie on change. |
| Status indicator in sidebar | Dot next to "Sonar" label | Consistent with existing server indicator pattern (green/amber dot next to logo). |

## Implementation Phases

### Phase 1: Sonar Infrastructure + Local Sonar (4 steps)

1. **Add `sonarEvents` and `sonarState` tables to Dexie schema** — New DB version (v16). `sonarEvents` with indexes on `[source+eventType]`, `timestamp`, `characterId`, `assemblyId`. `sonarState` keyed by `channel`.

2. **Create `sonarStore.ts`** — Zustand store for UI state (channel toggles, status). Initialize from `sonarState` DB table on app load. Persist toggle changes back to DB.

3. **Create `useLocalSonar.ts` hook** — Imports from existing `useLogWatcher`. On each poll cycle, after writing to `logEvents`, also writes `system_change` events to `sonarEvents` table. Reads `sonarStore.localEnabled` to determine if active. Updates `sonarStore.localStatus` based on watcher state.

4. **Create `Sonar.tsx` view** — Unified DataGrid with channel toggles in header. Columns: Timestamp, Source, Type, Character, Details. Uses `useLiveQuery` on `sonarEvents` table. Excel-style filtering via existing `ColumnFilter` + `excelFilterFn`. Wire up route at `/sonar`, add redirect from `/logs`.

### Phase 2: Chain Sonar (3 steps)

5. **Add inventory event types to `chain/config.ts`** — Add `ItemDeposited`, `ItemWithdrawn`, `ItemMinted`, `ItemBurned` to `getEventTypes()`.

6. **Create `useChainSonar.ts` hook** — Poll-based event listener using `queryEventsGql`. Loads known SSU IDs from `db.deployables` for the active character. Filters incoming events by matching `assembly_id`. Resolves item type names from `db.gameTypes`. Writes to `sonarEvents`. Persists cursors to `sonarState`. 15s poll interval, matching Radar.

7. **Integrate Chain Sonar into Sonar view** — Add the `useChainSonar()` call. Chain toggle controls enable/disable. Status dot reflects poll state.

### Phase 3: Bridge Dashboard (3 steps)

8. **Create `Bridge.tsx` view** — Dashboard layout with widget cards. Location Card queries latest `system_change` event per character from `sonarEvents`. SSU Activity Summary queries recent `item_deposited`/`item_withdrawn` events grouped by assembly.

9. **Wire up routing and navigation** — Add `/bridge` route. Update Sidebar: move Sonar + Bridge to Intelligence group, remove old Log Analyzer entry. Add status indicator dot to Sonar nav item.

10. **Add sidebar status indicators** — Extend `NavItem` type with optional `statusDot` field. SonarNavItem reads from `sonarStore` to compute dot color. Render dot inline with label text.

### Phase 4: Polish + Old Logs Access (2 steps)

11. **Add "Open in Log Analyzer" link from Sonar** — For local events that have a `sessionId`, render a link/button that navigates to the old Logs view filtered to that session. Keep the Logs view accessible at a route (e.g., `/logs/detail`).

12. **Backfill existing log data into Sonar** — On first load after upgrade, scan existing `logEvents` table for `system_change` events and copy them to `sonarEvents`. One-time migration in the DB version upgrade handler.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/types.ts` | Edit | Add `SonarEvent` and `SonarChannelState` interfaces |
| `apps/periscope/src/db/index.ts` | Edit | Add v16 schema: `sonarEvents` and `sonarState` tables with indexes; backfill migration |
| `apps/periscope/src/stores/sonarStore.ts` | Create | Zustand store for channel toggle state, status indicators |
| `apps/periscope/src/hooks/useLocalSonar.ts` | Create | Wraps useLogWatcher, writes system_change events to sonarEvents |
| `apps/periscope/src/hooks/useChainSonar.ts` | Create | Polls inventory events via queryEventsGql, filters by owned SSUs |
| `apps/periscope/src/views/Sonar.tsx` | Create | Unified DataGrid view with channel toggles and Excel filtering |
| `apps/periscope/src/views/Bridge.tsx` | Create | Curated dashboard: location card, SSU activity summary |
| `apps/periscope/src/chain/config.ts` | Edit | Add inventory event types to `getEventTypes()` |
| `apps/periscope/src/components/Sidebar.tsx` | Edit | Replace Log Analyzer nav with Sonar + Bridge in Intelligence group; add status dots |
| `apps/periscope/src/router.tsx` | Edit | Add `/sonar`, `/bridge` routes; redirect `/logs` to `/sonar`; keep old Logs at `/logs/detail` |
| `apps/periscope/src/views/Logs.tsx` | Edit | Minor: export for lazy-load at new route path |

## Open Questions

1. **How many local event types should Sonar capture?**
   - **Option A: Only `system_change` and `chat`** — Pros: Minimal noise, focused on the intel-relevant events. Sonar stays lean. Cons: Users who want mining/combat events in the unified grid can't get them.
   - **Option B: All local event types** — Pros: Complete unified view. Cons: High volume (mining fires every 4s), duplicates all data already in logEvents table.
   - **Recommendation:** Option A. Start with system_change only (needed for Bridge location tracking). Chat is useful for intel. Mining/combat stay in the dedicated Logs analyzer tabs where they have specialized UI (DPS charts, mining rate windows). Users can enable more types later if needed.

2. **Should chain events be globally visible or filtered by active character?**
   - **Option A: Only show events for active character's SSUs** — Pros: Focused, lower query volume. Cons: Missing events for other owned characters.
   - **Option B: Show events for all registered characters' SSUs** — Pros: Complete view across all characters. Cons: More SSU IDs to filter against, potentially higher noise.
   - **Recommendation:** Option B. The user has multiple characters registered in the Characters table. Chain Sonar should check all characters that have a `suiAddress`, loading their SSUs from the deployables table. This matches the existing multi-character architecture.

3. **Should the old Logs view remain directly navigable or only accessible via Sonar drill-down?**
   - **Option A: Keep it at `/logs/detail` with no sidebar entry** — Pros: Clean navigation. Cons: Power users lose quick access to the 7-tab analyzer.
   - **Option B: Keep "Log Analyzer" in sidebar under a collapsed "Legacy" or "Advanced" section** — Pros: Easy access for power users. Cons: Extra sidebar clutter.
   - **Recommendation:** Option A. The Logs view is a detail/power-user tool. Sonar is the primary entry point. A clear "Open Analyzer" button in Sonar's header (and on individual local events) provides the drill-down path.

## Deferred

- **Chain Sonar: Gate jump events** — Monitor who jumps through your gates. Uses `JumpEvent` type already in getEventTypes(). Deferred because it overlaps with Radar functionality.
- **Chain Sonar: Status change events** — Monitor when SSUs go online/offline. Also overlaps with Radar.
- **Bridge: Activity graphs** — Charts showing mining rate over time, combat activity, etc. Requires charting library (recharts or similar). Deferred to a future Bridge enhancement.
- **Bridge: Alerts/notifications** — Push notifications when interesting events happen (e.g., someone withdraws from your SSU). Deferred; Radar already handles alert patterns.
- **Sonar: Real-time chain subscriptions** — Replace polling with GraphQL subscriptions when/if `SuiGraphQLClient` adds support. Currently not available.
- **Sonar: Fleet log parsing** — Game also produces fleet logs at `Fleetlogs/`. Not yet analyzed; deferred until fleet mechanics are better understood.
- **Sonar: Market log parsing** — Market logs at `Marketlogs/`. Useful for trade intelligence but requires separate parser research.
- **Cross-Sonar correlation** — Link chain events to local events (e.g., a deposit event on chain correlating with a cargo notification in game logs). Complex; deferred.
