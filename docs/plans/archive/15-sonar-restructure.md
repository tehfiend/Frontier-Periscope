# Plan: Sonar Restructure & Log Analyzer Integration

**Status:** Nearly Complete
**Created:** 2026-03-17
**Updated:** 2026-03-18
**Module:** periscope

## Overview

The Sonar view has been restructured from a flat event grid into a tabbed interface with three distinct feeds: Pings (filtered alerts with audio), Log Feed (live game log activity from the Log Analyzer's Live tab), and Chain Feed (on-chain inventory events). This consolidation makes Sonar the single entry point for all real-time monitoring.

The Radar page was removed (view, hook, route, sidebar entry, DB tables, TypeScript types -- all gone). DB tables dropped in V20.

The "Local Sonar" -> "Log Sonar" rename in user-facing labels is complete in `Sonar.tsx`, `Sidebar.tsx`, and `Bridge.tsx`.

The Log Analyzer detail view (`/logs/detail`) remains accessible for deep session analysis (Sessions, Mining, Combat, Travel, Structures, Chat tabs). The Live tab has been removed since its functionality now lives in Sonar's Log Feed tab.

## Current State (as of 2026-03-18)

**Sonar** (`apps/periscope/src/views/Sonar.tsx`, route `/sonar`):
- Tabbed interface with three tabs: Pings, Log Feed, Chain Feed
- Pings tab: collapsible settings panel (event type checkboxes, audio toggle, notify toggle) + filtered DataGrid
- Log Feed tab: stat cards (Mining Rate, DPS Dealt/Received, Session Totals) + Activity Feed (last 50 events) + GrantAccessView inline if no access
- Chain Feed tab: DataGrid filtered to `source === "chain"` events
- Header retains: SonarPing animation, ChannelToggle buttons ("Log" / "Chain"), "Open Analyzer" link
- `activeTab` state managed by `useSonarStore`

**Hooks at Layout level** (`apps/periscope/src/components/Layout.tsx`):
- `useLogWatcher()`, `useLocalSonar()`, `useChainSonar()` all called at Layout level (lines 18-20)
- No duplicate calls from `Sonar.tsx`, `Logs.tsx`, or `Bridge.tsx`
- `useLogWatcher` registers `grantAccess`/`clearAndReimport` on `useLogStore` so other views read them from the store

**Sonar Store** (`apps/periscope/src/stores/sonarStore.ts`):
- `activeTab: SonarTab` (default `"pings"`)
- `pingEventTypes: Set<SonarEventType>` (default: `system_change`, `item_deposited`, `item_withdrawn`)
- `pingAudioEnabled`, `pingNotifyEnabled` booleans
- `togglePingEventType`, `setPingEventTypes`, `setPingAudioEnabled`, `setPingNotifyEnabled` actions
- Ping settings persisted to `db.settings` with key `"sonarPingTypes"`

**Log Store** (`apps/periscope/src/stores/logStore.ts`):
- `activeTab` type excludes `"live"` -- uses `"sessions" | "mining" | "combat" | "travel" | "structures" | "chat"`
- Default `activeTab` is `"sessions"`
- `grantAccess` and `clearAndReimport` callback fields populated by `useLogWatcher` from Layout

**Log Analyzer** (`apps/periscope/src/views/Logs.tsx`, route `/logs/detail`):
- 6 tabs: Sessions, Mining, Combat, Travel, Structures, Chat (LiveTab removed)
- No `useLogWatcher` call -- reads callbacks from `useLogStore`

**Extracted Components**:
- `apps/periscope/src/components/LogEventRow.tsx` -- event row with EVENT_COLORS/EVENT_LABELS maps
- `apps/periscope/src/components/StatCard.tsx` -- reusable stat card
- `apps/periscope/src/components/GrantAccessView.tsx` -- directory access prompt
- `apps/periscope/src/lib/format.ts` -- `fmtDateTime`, `fmtTime`, `formatDuration` utilities

**Ping Alerts** (`apps/periscope/src/hooks/useSonarAlerts.ts`):
- Hook created with high-water-mark tracking, audio alerts (Web Audio API beep fallback), desktop notifications
- References `/sounds/alert.mp3` (with Web Audio API beep as fallback when file missing)
- NOT yet wired into Layout.tsx

**Radar** (FULLY REMOVED):
- View, hook, route, sidebar entry removed in prior commits
- `RadarWatch`, `RadarEventKind`, `RadarEvent` types removed from `db/types.ts`
- Class declarations removed from `db/index.ts`
- V20 drops `radarWatches` and `radarEvents` tables (set to `null`)

**DB version** (`apps/periscope/src/db/index.ts`):
- Current latest version: 20 (V18: celestials, V19: structure locations, V20: drop radar tables)

## Target State

All target state items have been implemented except:

1. **Wire `useSonarAlerts()` into Layout.tsx** -- The hook exists but is not imported or called in Layout. Needs one import + one hook call.
2. **Optional: Add `/sounds/alert.mp3`** -- The hook uses Web Audio API as fallback, so this is optional. If desired, add an alert tone file to `apps/periscope/public/sounds/alert.mp3`.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Keep internal `"local"` naming in code | Yes -- only rename user-facing labels | Renaming `source: "local"` in DB, hooks, and store would require a migration + widespread code changes for zero functional benefit |
| Sonar tab state management | New `activeTab` field in `useSonarStore` | Sonar already has a Zustand store; adding a tab field keeps all Sonar UI state together |
| Ping settings persistence | `sonarPingTypes` key in `settings` table | Reuse the existing `settings` key-value table rather than a new Dexie table -- no migration needed |
| Ping event types data structure | `Set<SonarEventType>` in store | Set provides O(1) has/delete; serialized to array for persistence |
| Default ping types | `system_change`, `item_deposited`, `item_withdrawn` (3 of 6) | Most actionable events; `chat`, `item_minted`, `item_burned` are higher-frequency and less critical |
| Activity Feed data source | Query `logEvents` table directly in Sonar view | The `logEvents` table is populated by `useLogWatcher` -- once moved to Layout level, log events stream on all pages |
| Audio alert for Pings | Web Audio API beep as fallback, optional `/sounds/alert.mp3` file | No external dependency; works without bundled audio file |
| Remove Radar DB tables | Schema version 20 (V18-19 taken by celestials + structure locations) | Dexie drops tables when they're removed from the schema in a new version |
| Log Analyzer Live tab removal | Remove `LiveTab` component + "live" from TABS array | The Activity Feed + stat cards move to Sonar's Log Feed tab -- no point keeping them in both places |
| Move hooks to Layout level | `useLogWatcher`, `useLocalSonar`, `useChainSonar` all in Layout | Log and sonar events stream regardless of which page is active, enabling both the Log Feed tab and the alert hook to work everywhere |
| Expose `useLogWatcher` callbacks via store | Register `grantAccess`/`clearAndReimport` on `useLogStore` | `useLogWatcher` uses refs for interval/handle state -- calling it from multiple components creates duplicate polling. Moving callbacks to the store decouples "where the hook runs" from "where UI needs the callbacks" |
| Define `SonarEventType` union | Already in `db/types.ts` (DONE) | Union type with 6 values including `"chat"` enables type-safe ping configuration and filtering |

## Implementation Phases

### Phase 1: DB & Type Cleanup (Radar removal + SonarEventType) -- DONE

- `SonarEventType` union type exists in `db/types.ts` with 6 values
- `SonarEvent.eventType` typed as `SonarEventType`
- Radar types (`RadarWatch`, `RadarEventKind`, `RadarEvent`) removed from `db/types.ts`
- Radar class declarations removed from `db/index.ts`
- V20 drops `radarWatches` and `radarEvents` tables

### Phase 2: Move Hooks to Layout Level -- DONE

- `useLogWatcher()`, `useLocalSonar()`, `useChainSonar()` called only at Layout level (Layout.tsx lines 18-20)
- `useLogWatcher` registers `grantAccess`/`clearAndReimport` on `useLogStore` via `useEffect` (lines 381-388)
- `logStore.ts` has `grantAccess`/`clearAndReimport` callback fields with `setGrantAccess`/`setClearAndReimport` actions
- `Logs.tsx` no longer calls `useLogWatcher` -- reads callbacks from `useLogStore`
- `Bridge.tsx` no longer calls `useLocalSonar` or `useChainSonar`
- `logStore.ts` `activeTab` type excludes `"live"`, default is `"sessions"`

### Phase 3: Extract Shared Components -- DONE

- `LogEventRow.tsx` extracted with `EVENT_COLORS` and `EVENT_LABELS` maps
- `StatCard.tsx` extracted with `LucideIcon` prop type
- `GrantAccessView.tsx` extracted with `onGrant` prop
- `format.ts` extracted with `fmtDateTime`, `fmtTime`, `formatDuration`
- `Logs.tsx` imports from extracted locations

### Phase 4: Restructure Sonar into Tabbed Interface -- DONE

- `sonarStore.ts` has `activeTab`, `pingEventTypes` (Set), `pingAudioEnabled`, `pingNotifyEnabled`, `togglePingEventType`, plus persistence to `db.settings`
- `Sonar.tsx` restructured with `SonarTabBar`, `PingsTab`, `LogFeedTab`, `ChainFeedTab` components
- Pings tab: collapsible settings panel with event type checkboxes, audio/notify toggles, filtered DataGrid
- Log Feed tab: stat cards, activity feed, GrantAccessView, "Open Analyzer" link
- Chain Feed tab: DataGrid filtered to chain events
- No `alert.mp3` file -- `useSonarAlerts` has Web Audio API beep fallback

### Phase 5: Update Log Analyzer -- DONE

- `LiveTab` removed from `Logs.tsx`
- `"live"` removed from TABS array
- `logStore.ts` `activeTab` type excludes `"live"`, default changed to `"sessions"`
- Extracted components removed from `Logs.tsx` and imported from new locations

### Phase 6: Ping Alert Hook -- PARTIAL

**Done:**
- `apps/periscope/src/hooks/useSonarAlerts.ts` created with:
  - High-water-mark tracking via `useRef` (initialized from max `sonarEvents.id` on mount)
  - `useLiveQuery` on `sonarEvents` to detect new events matching `pingEventTypes`
  - Audio alert: tries `/sounds/alert.mp3`, falls back to Web Audio API beep (880 Hz, 0.3s)
  - Desktop notifications (up to 3 per batch) with event type title and details body

**Remaining:**
1. In `apps/periscope/src/components/Layout.tsx`:
   - Add `import { useSonarAlerts } from "@/hooks/useSonarAlerts";`
   - Add `useSonarAlerts();` call inside the `Layout` function (alongside existing hooks at lines 18-20)
2. (Optional) Add `apps/periscope/public/sounds/alert.mp3` -- a short alert tone. The Web Audio API beep works without it.

## File Summary

| File | Action | Status | Description |
|------|--------|--------|-------------|
| `apps/periscope/src/db/index.ts` | Modify | DONE | V20 drops radarWatches/radarEvents, class declarations + type imports removed |
| `apps/periscope/src/db/types.ts` | Modify | DONE | RadarWatch/RadarEventKind/RadarEvent types removed |
| `apps/periscope/src/components/Layout.tsx` | Modify | PARTIAL | Has `useLogWatcher`, `useLocalSonar`, `useChainSonar` -- still needs `useSonarAlerts()` |
| `apps/periscope/src/views/Sonar.tsx` | Rewrite | DONE | Tabbed interface with Pings, Log Feed, Chain Feed tabs |
| `apps/periscope/src/views/Logs.tsx` | Modify | DONE | LiveTab removed, extracted components replaced with imports |
| `apps/periscope/src/views/Bridge.tsx` | Modify | DONE | `useLocalSonar()` and `useChainSonar()` calls removed |
| `apps/periscope/src/stores/sonarStore.ts` | Modify | DONE | activeTab, ping settings (event types as Set, audio, notifications), persistence |
| `apps/periscope/src/stores/logStore.ts` | Modify | DONE | "live" removed from activeTab, default "sessions", grantAccess/clearAndReimport callbacks |
| `apps/periscope/src/hooks/useLogWatcher.ts` | Modify | DONE | Registers callbacks on store via useEffect, return type void |
| `apps/periscope/src/components/LogEventRow.tsx` | Create | DONE | Extracted EventRow component + EVENT_COLORS/EVENT_LABELS maps |
| `apps/periscope/src/components/StatCard.tsx` | Create | DONE | Extracted StatCard component for live stats |
| `apps/periscope/src/components/GrantAccessView.tsx` | Create | DONE | Extracted grant access prompt component |
| `apps/periscope/src/lib/format.ts` | Create | DONE | Extracted `fmtDateTime`, `fmtTime`, `formatDuration` utilities |
| `apps/periscope/src/hooks/useSonarAlerts.ts` | Create | DONE | Layout-level hook for ping audio/notification alerts (not yet wired in) |
| `apps/periscope/public/sounds/alert.mp3` | Create | SKIPPED | Optional -- Web Audio API beep serves as fallback |

## Open Questions

*None -- all design questions have been resolved.*

## Deferred

- **Log event ping integration** -- Adding `LogEventType` as ping sources. Would need rate limiting and smart filtering to avoid alert spam from high-frequency mining/combat events.
- **Ping history / badge count** -- Showing unread ping count on the Sonar sidebar icon. Useful but adds complexity with a new counter in the store.
- **Custom ping sounds** -- Allowing users to upload or select different alert sounds per event type. Nice-to-have but low priority.
- **Radar feature resurrection** -- If users miss Radar's watch-based targeting, the concept could be rebuilt as a "Watchlist Alerts" feature integrated into the existing Watchlist page. Not planned for this iteration.
- **Ping settings restore on load** -- The sonarStore persists `pingEventTypes` to `db.settings` but does not currently restore them on page load. The `sonarState` restore (channel enabled/status) exists, but ping types default to the hardcoded `DEFAULT_PING_TYPES` on every load.
