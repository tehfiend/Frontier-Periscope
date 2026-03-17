# Plan: Sonar Restructure & Log Analyzer Integration

**Status:** Ready
**Created:** 2026-03-17
**Module:** periscope

## Overview

The Sonar view is being restructured from a flat event grid into a tabbed interface with three distinct feeds: Pings (filtered alerts with audio), Log Feed (live game log activity from the Log Analyzer's Live tab), and Chain Feed (on-chain inventory events). This consolidation makes Sonar the single entry point for all real-time monitoring.

The Radar page was already removed (view, hook, route, sidebar entry are gone). What remains is the DB cleanup: dropping the `radarWatches` and `radarEvents` Dexie tables and removing the associated TypeScript types.

The "Local Sonar" -> "Log Sonar" rename in user-facing labels is already complete in `Sonar.tsx`, `Sidebar.tsx`, and `Bridge.tsx`.

The Log Analyzer detail view (`/logs/detail`) remains accessible for deep session analysis (Sessions, Mining, Combat, Travel, Structures, Chat tabs), but its "Live" tab's Activity Feed is absorbed into the Sonar Log Feed tab. The Live tab is removed from the Log Analyzer since its functionality now lives in Sonar.

## Current State

**Sonar** (`apps/periscope/src/views/Sonar.tsx`, route `/sonar`):
- Dual-channel architecture: Log (green, 5s poll via `useLocalSonar`) + Chain (blue, 15s poll via `useChainSonar`)
- Both hooks called inside the `Sonar` view component (lines 155-156), NOT at Layout level
- Single DataGrid table with columns: Timestamp, Source, Type, Character, Details, Actions
- Header with `Radio` icon, `ChannelToggle` buttons ("Log" / "Chain"), "Open Analyzer" link
- Events stored in `sonarEvents` table (Dexie), channel state in `sonarState` table
- State managed by `useSonarStore` (Zustand) in `apps/periscope/src/stores/sonarStore.ts`
- `useLocalSonar` also called in `Bridge.tsx` for location data

**Radar** (ALREADY REMOVED -- view, hook, route, sidebar entry are gone):
- Only remnants: `radarWatches` and `radarEvents` EntityTable declarations + types in `db/index.ts` and `db/types.ts`, plus the V9 migration in `db/index.ts`

**Log Analyzer** (`apps/periscope/src/views/Logs.tsx`, route `/logs/detail`):
- 7 tabs: Live, Sessions, Mining, Combat, Travel, Structures, Chat
- `LiveTab` component (line 214) shows: stat cards (Mining Rate, DPS Dealt/Received, Session Totals) + Activity Feed (last 50 `logEvents` from current session, reverse chronological)
- `useLogWatcher` hook called inside `Logs` component (line 31), NOT at Layout level
- `useLogStore` (Zustand) manages: `hasAccess`, `isWatching`, `activeSessionId`, live stats, `activeTab`, `selectedSessionId`
- Key shared components inside `Logs.tsx`: `EventRow` (line 1640), `StatCard` (line 1571), `GrantAccessView` (line 60), `fmtDateTime` (line 1853), `fmtTime` (line 1849)
- Helper maps: `EVENT_COLORS` (line 1604), `EVENT_LABELS` (line 1622) -- note: there is no `EVENT_TYPE_ICONS` map
- Log events stored in `logEvents` table with types: mining, combat_dealt, combat_received, miss_dealt, miss_received, structure_departed, gate_offline, build_fail, dismantle, notify, info, hint, question, system_change, chat

**Sidebar** (`apps/periscope/src/components/Sidebar.tsx`):
- Intelligence section includes: Sonar (with single combined status dot), Bridge, Intel Channel, Watchlist, Players, Killmails, Manifest
- Radar entry already removed

**Router** (`apps/periscope/src/router.tsx`):
- `/sonar` -> `LazySonar` (lazy loaded)
- `/logs` -> redirects to `/sonar`
- `/logs/detail` -> `LazyLogs` (lazy loaded)
- No `/radar` route (already removed)

**DB version** (`apps/periscope/src/db/index.ts`):
- Current latest version: 17 (parent node linking for deployables + assemblies)
- V9 created `radarWatches` and `radarEvents` tables
- V16 created `sonarEvents` and `sonarState` tables

## Target State

**Sonar** becomes a tabbed view with three tabs:

1. **Pings tab** (default): Filtered sonar events the user cares about
   - Settings panel (gear icon toggle) where user selects which `SonarEventType` values generate pings (`system_change`, `item_deposited`, `item_withdrawn`, `item_minted`, `item_burned`)
   - Audio alert toggle (plays a bundled alert sound)
   - Desktop notification toggle
   - Events shown in a DataGrid, filtered to only include selected event types
   - Persisted in `settings` table with key `"sonarPingSettings"`

2. **Log Feed tab**: All game log activity from `logEvents` table
   - Shows the Activity Feed from the old `LiveTab` -- last 50 events from the active session
   - Includes the stat cards (Mining Rate, DPS, Session Totals)
   - "Open Analyzer" link to `/logs/detail` for deep analysis
   - If log access not granted, shows the `GrantAccessView` prompt inline

3. **Chain Feed tab**: All chain sonar events
   - DataGrid of `sonarEvents` where `source === "chain"`
   - Same columns as current Sonar view but filtered to chain events only
   - Chain channel toggle + status display in the tab header area

**Header** retains: Radio icon, channel toggles (Log + Chain), tab bar below.

**Hooks at Layout level**: `useLogWatcher` must be moved to Layout level so log events stream regardless of which page the user is on. `useLocalSonar` and `useChainSonar` should also be moved to Layout level so sonar events accumulate even when the user isn't on the Sonar page.

**Naming**: "Log" labels already in place for user-facing text. Internal variable names (`localEnabled`, `localStatus`, source `"local"`) remain unchanged.

**Log Analyzer** (`/logs/detail`): Live tab removed. Remaining tabs: Sessions, Mining, Combat, Travel, Structures, Chat. The `activeTab` default changes from `"live"` to `"sessions"`.

**Radar cleanup**: DB tables dropped in version 18, class declarations and types removed.

**New type**: Define `SonarEventType` union type in `db/types.ts` for type-safe ping configuration.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Keep internal `"local"` naming in code | Yes -- only rename user-facing labels | Renaming `source: "local"` in DB, hooks, and store would require a migration + widespread code changes for zero functional benefit |
| Sonar tab state management | New `activeTab` field in `useSonarStore` | Sonar already has a Zustand store; adding a tab field keeps all Sonar UI state together |
| Ping settings persistence | New `sonarSettings` record in `settings` table | Reuse the existing `settings` key-value table rather than a new Dexie table -- no migration needed |
| Activity Feed data source | Query `logEvents` table directly in Sonar view | The `logEvents` table is populated by `useLogWatcher` -- once moved to Layout level, log events stream on all pages |
| Audio alert for Pings | Generate or bundle a short alert tone at `apps/periscope/public/alert.mp3` | No alert sound file currently exists in the project; one must be added |
| Remove Radar DB tables | Schema version 18 (version 17 is already taken by parent node linking) | Dexie drops tables when they're removed from the schema in a new version |
| Log Analyzer Live tab removal | Remove `LiveTab` component + "live" from TABS array | The Activity Feed + stat cards move to Sonar's Log Feed tab -- no point keeping them in both places |
| Move hooks to Layout level | `useLogWatcher`, `useLocalSonar`, `useChainSonar` all move to Layout | Log and sonar events must stream regardless of which page is active, enabling both the Log Feed tab and the alert hook to work everywhere |
| Expose `useLogWatcher` callbacks via store | Register `grantAccess`/`clearAndReimport` on `useLogStore` | `useLogWatcher` uses refs for interval/handle state -- calling it from multiple components creates duplicate polling. Moving callbacks to the store decouples "where the hook runs" from "where UI needs the callbacks" |
| Define `SonarEventType` union | Add to `db/types.ts` | Currently `eventType` is typed as `string`; a union type enables type-safe ping configuration and filtering |

## Implementation Phases

### Phase 1: DB & Type Cleanup (Radar removal + SonarEventType)

1. In `apps/periscope/src/db/index.ts`:
   - Add `version(18)` that sets `radarWatches` and `radarEvents` stores to `null` (Dexie convention to drop tables)
   - Remove `radarWatches!: EntityTable<RadarWatch, "id">` and `radarEvents!: EntityTable<RadarEvent, "id">` class declarations (lines 98-99)
   - Remove `RadarWatch` and `RadarEvent` from the import list (lines 30-31)
2. In `apps/periscope/src/db/types.ts`:
   - Remove the `// -- Radar Types` section: `RadarWatch` interface (lines 432-442), `RadarEventKind` type (lines 444-450), and `RadarEvent` interface (lines 452-461)
   - Add `SonarEventType` union type after the existing `SonarSource` type (line 536):
     ```ts
     export type SonarEventType = "system_change" | "item_deposited" | "item_withdrawn" | "item_minted" | "item_burned";
     ```
   - Update `SonarEvent.eventType` from `string` to `SonarEventType` (line 543)

### Phase 2: Move Hooks to Layout Level

Move `useLocalSonar`, `useChainSonar`, and `useLogWatcher` to run at Layout level so events stream on all pages.

**Problem with `useLogWatcher` idempotency**: The hook uses a `useRef` for `intervalRef` and `dirHandleRef`. Each component instance gets its own refs, so calling the hook from both Layout and Logs would create duplicate polling intervals. The hook is NOT safe to call from multiple components.

**Solution**: Refactor `useLogWatcher` to expose `grantAccess` and `clearAndReimport` through `useLogStore` (Zustand) instead of returning them. The hook itself runs only at Layout level. The Logs view reads these callbacks from the store.

1. In `apps/periscope/src/stores/logStore.ts`:
   - Add `grantAccess: ((h: FileSystemDirectoryHandle) => void) | null` field (default `null`)
   - Add `clearAndReimport: (() => void) | null` field (default `null`)
   - Add `setGrantAccess` and `setClearAndReimport` actions to register the callbacks

2. In `apps/periscope/src/hooks/useLogWatcher.ts`:
   - Instead of returning `{ grantAccess, clearAndReimport }`, register them on the store via `useLogStore.getState().setGrantAccess(grantAccess)` and `useLogStore.getState().setClearAndReimport(clearAndReimport)` on mount
   - Change the return type to `void` (no more returned callbacks)

3. In `apps/periscope/src/components/Layout.tsx`:
   - Import and call `useLogWatcher()` (no return value needed)
   - Import and call `useLocalSonar()`
   - Import and call `useChainSonar()`

4. In `apps/periscope/src/views/Sonar.tsx`:
   - Remove the `useLocalSonar()` and `useChainSonar()` calls (lines 155-156) -- now handled by Layout
   - Remove the corresponding imports

5. In `apps/periscope/src/views/Logs.tsx`:
   - Remove the `useLogWatcher()` call (line 31)
   - Instead, read `grantAccess` and `clearAndReimport` from `useLogStore`
   - Update the destructuring: `const { hasAccess, activeTab, selectedSessionId, grantAccess, clearAndReimport } = useLogStore()`

6. In `apps/periscope/src/views/Bridge.tsx`:
   - Remove the `useLocalSonar()` and `useChainSonar()` calls (lines 243-244) -- now handled by Layout
   - Remove the corresponding imports

### Phase 3: Extract Shared Components

Extract reusable components from `Logs.tsx` before restructuring Sonar, since both Sonar and the Log Analyzer need them.

1. Extract `EventRow` (line 1640 in `Logs.tsx`) into `apps/periscope/src/components/LogEventRow.tsx`
   - The component renders a single `LogEvent` as a compact row with type label badge, timestamp, and message
   - Include the `EVENT_COLORS` and `EVENT_LABELS` maps it depends on (lines 1604-1638)
   - Import `fmtTime` from `@/lib/format` (extracted in step 4 below)
2. Extract `StatCard` (line 1571 in `Logs.tsx`) into `apps/periscope/src/components/StatCard.tsx`
   - Props: `label`, `value`, `sub`, `color`, `icon`, `active`
   - Change `icon` prop type from `typeof Activity` to `LucideIcon` (import from `lucide-react`)
3. Extract `GrantAccessView` (line 60 in `Logs.tsx`) into `apps/periscope/src/components/GrantAccessView.tsx`
   - Requires `requestDirectoryAccess` import from `@/lib/logFileAccess`
   - Also requires `FolderOpen` from `lucide-react`
   - Props: `onGrant: (h: FileSystemDirectoryHandle) => void`
4. Extract `fmtDateTime` utility (line 1853 in `Logs.tsx`) into `apps/periscope/src/lib/format.ts`
   - Also include `fmtTime` (line 1849) and `formatDuration` (line 1858) since they're general-purpose
5. Update all imports in `apps/periscope/src/views/Logs.tsx` to reference the extracted components and utilities

### Phase 4: Restructure Sonar into Tabbed Interface

1. In `apps/periscope/src/stores/sonarStore.ts`:
   - Add `activeTab: "pings" | "logFeed" | "chainFeed"` field (default `"pings"`)
   - Add `setActiveTab` action
   - Add `pingEventTypes: SonarEventType[]` for ping filter config (default: all types -- `["system_change", "item_deposited", "item_withdrawn", "item_minted", "item_burned"]`)
   - Add `pingAudioEnabled: boolean` (default `false`)
   - Add `pingNotifyEnabled: boolean` (default `false`)
   - Add `setPingEventTypes`, `setPingAudioEnabled`, `setPingNotifyEnabled` actions
   - Persist ping settings to `db.settings` with key `"sonarPingSettings"`
   - Restore ping settings from `db.settings` on load (alongside existing sonarState restore at line 43)

2. In `apps/periscope/src/views/Sonar.tsx`, restructure the component:
   - Keep existing `StatusDot`, `ChannelToggle` helper components
   - Add a `SonarTabBar` component with three tabs: Pings, Log Feed, Chain Feed
   - Refactor main `Sonar` export to render: Header (with Radio icon + channel toggles) -> SonarTabBar -> active tab content

3. **Pings tab** component (`PingsTab`):
   - Settings panel (collapsible via gear icon) with:
     - Checkboxes for each `SonarEventType` (`system_change`, `item_deposited`, `item_withdrawn`, `item_minted`, `item_burned`)
     - Audio alert toggle checkbox
     - Desktop notification toggle checkbox
   - DataGrid showing `sonarEvents` filtered to only include the event types selected in settings
   - Uses the same column definitions as the current Sonar grid (Timestamp, Source, Type, Character, Details, Actions)

4. **Log Feed tab** component (`LogFeedTab`):
   - Import and render the extracted `StatCard` components with live stats from `useLogStore` (miningRate, miningOre, dpsDealt, dpsReceived)
   - Session totals: query `db.logEvents` for mining, combat_dealt, combat_received totals using `useLiveQuery`
   - Activity Feed: query `db.logEvents` for the active session (from `useLogStore.activeSessionId`), last 50 events, reverse chronological
   - Use the extracted `LogEventRow` component for rendering events
   - If `useLogStore.hasAccess` is false, show the extracted `GrantAccessView` inline (with `grantAccess` from `useLogStore`)
   - "Open Analyzer" link (`<Link to="/logs/detail">`) for deep analysis

5. **Chain Feed tab** component (`ChainFeedTab`):
   - DataGrid showing `sonarEvents` where `source === "chain"`
   - Uses the same column definitions as Pings tab but pre-filtered to chain events
   - Chain channel toggle + status display in the tab header area

6. Add `apps/periscope/public/alert.mp3`:
   - Source or generate a short, unobtrusive alert tone (similar to a sonar ping sound)
   - Keep file size small (<50 KB)

### Phase 5: Update Log Analyzer

1. In `apps/periscope/src/views/Logs.tsx`:
   - Remove `LiveTab` component entirely (lines 214-320, including the `useLiveQuery` calls for `recentEvents`, `sessionMining`, `sessionDamageDealt`, `sessionDamageRecv`)
   - Remove the `"live"` entry from the `TABS` array (line 180)
   - Remove the `{activeTab === "live" && <LiveTab />}` render branch (line 46)
   - Remove the `Activity` import from lucide-react if no longer used elsewhere in the file
   - Remove extracted components (`EventRow`, `StatCard`, `GrantAccessView`, `EVENT_COLORS`, `EVENT_LABELS`, `fmtDateTime`, `fmtTime`, `formatDuration`) that are now imported from their new locations
2. In `apps/periscope/src/stores/logStore.ts`:
   - Change `activeTab` type to exclude `"live"`: `"sessions" | "mining" | "combat" | "travel" | "structures" | "chat"`
   - Change default `activeTab` from `"live"` to `"sessions"`

### Phase 6: Ping Alert Hook

1. Create `apps/periscope/src/hooks/useSonarAlerts.ts`:
   - Runs at Layout level (add to `apps/periscope/src/components/Layout.tsx`)
   - Tracks a high-water-mark `sonarEvents.id` (auto-increment) in a ref
   - On each poll cycle (or via `useLiveQuery` on `sonarEvents`), checks for new events whose `eventType` is in `pingEventTypes` from the sonar store
   - If `pingAudioEnabled`, plays `/alert.mp3` (volume 0.3) using `new Audio("/alert.mp3")`
   - If `pingNotifyEnabled` and `Notification.permission === "granted"`, shows desktop notification with event summary
   - Initializes high-water-mark from the max existing `sonarEvents.id` on mount to avoid alerting on historical events
2. In `apps/periscope/src/components/Layout.tsx`:
   - Import and call `useSonarAlerts()` alongside the other Layout-level hooks

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/db/index.ts` | Modify | Add version 18 to drop radarWatches/radarEvents, remove class declarations + type imports |
| `apps/periscope/src/db/types.ts` | Modify | Remove RadarWatch/RadarEventKind/RadarEvent types; add `SonarEventType` union; narrow `SonarEvent.eventType` |
| `apps/periscope/src/components/Layout.tsx` | Modify | Add `useLogWatcher()`, `useLocalSonar()`, `useChainSonar()`, `useSonarAlerts()` calls |
| `apps/periscope/src/views/Sonar.tsx` | Rewrite | Tabbed interface with Pings, Log Feed, Chain Feed tabs; remove hook calls moved to Layout |
| `apps/periscope/src/views/Logs.tsx` | Modify | Remove LiveTab + extracted components; update imports |
| `apps/periscope/src/views/Bridge.tsx` | Modify | Remove `useLocalSonar()` and `useChainSonar()` calls (now in Layout) |
| `apps/periscope/src/stores/sonarStore.ts` | Modify | Add activeTab, ping settings (event types, audio, notifications) |
| `apps/periscope/src/stores/logStore.ts` | Modify | Remove "live" from activeTab type, change default to "sessions"; add grantAccess/clearAndReimport callback fields |
| `apps/periscope/src/hooks/useLogWatcher.ts` | Modify | Register callbacks on store instead of returning; change return type to void |
| `apps/periscope/src/components/LogEventRow.tsx` | Create | Extracted EventRow component + EVENT_COLORS/EVENT_LABELS maps |
| `apps/periscope/src/components/StatCard.tsx` | Create | Extracted StatCard component for live stats |
| `apps/periscope/src/components/GrantAccessView.tsx` | Create | Extracted grant access prompt component |
| `apps/periscope/src/lib/format.ts` | Create | Extracted `fmtDateTime`, `fmtTime`, `formatDuration` utilities |
| `apps/periscope/src/hooks/useSonarAlerts.ts` | Create | Layout-level hook for ping audio/notification alerts |
| `apps/periscope/public/alert.mp3` | Create | Alert sound file for ping notifications |

## Open Questions

*None -- all design questions have been resolved:*

- **Ping alert location**: Layout-level hook (`useSonarAlerts`) so alerts work on all pages.
- **Ping data sources**: Only sonar events for initial implementation. Log event pings deferred.

## Deferred

- **Log event ping integration** -- Adding `LogEventType` as ping sources. Would need rate limiting and smart filtering to avoid alert spam from high-frequency mining/combat events.
- **Ping history / badge count** -- Showing unread ping count on the Sonar sidebar icon. Useful but adds complexity with a new counter in the store.
- **Custom ping sounds** -- Allowing users to upload or select different alert sounds per event type. Nice-to-have but low priority.
- **Radar feature resurrection** -- If users miss Radar's watch-based targeting, the concept could be rebuilt as a "Watchlist Alerts" feature integrated into the existing Watchlist page. Not planned for this iteration.
