# Frontier Periscope

## Problem

Current EVE Frontier community tools (maps, route planners, asset trackers) are hosted online services. When a player uses them, the tool operator can observe the player's activity — what routes they're plotting, what systems they're searching, what assets they're tracking. With on-chain locations now obfuscated, this intel is strategically valuable. Players are forced to choose between convenience and operational security.

## Solution

A privacy-first intelligence management tool that runs **100% in the browser** with **zero server-side components**. All data is collected, stored, processed, and visualized locally. Nothing leaves the player's machine unless they explicitly choose to share it.

## Principles

- **Local-first** — all data stays on the player's device by default
- **Zero trust** — no server, no operator, no third party sees your data
- **Progressive enhancement** — useful solo, more useful with allies, most useful on-chain
- **Minimal infrastructure** — deployable as a static site, installable as a PWA
- **Composable** — reads EVE Frontier chain data directly, works alongside other tools

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (100% local)                                           │
│                                                                 │
│  ┌── Data Sources ───────────────────────────────────────────┐  │
│  │                                                           │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐  │  │
│  │  │ Sui RPC      │ │ EVE Frontier │ │ Client Log Files │  │  │
│  │  │ (chain data) │ │ API          │ │ (chat, game log) │  │  │
│  │  └──────┬───────┘ └──────┬───────┘ └────────┬─────────┘  │  │
│  │         │                │                   │            │  │
│  │  ┌──────┴────┐    ┌──────┴────┐    ┌────────┴────────┐   │  │
│  │  │Static Data│    │Manual     │    │File System      │   │  │
│  │  │Cache      │    │Input /    │    │Access API       │   │  │
│  │  │(star map, │    │Import     │    │(user-granted    │   │  │
│  │  │ types,    │    │           │    │ directory)      │   │  │
│  │  │ blueprints│    │           │    │                 │   │  │
│  │  └──────┬────┘    └─────┬────┘    └────────┬────────┘   │  │
│  └─────────┼───────────────┼──────────────────┼────────────┘  │
│            └───────────────┼──────────────────┘               │
│                      ┌─────▼──────┐                           │
│                      │ Storage    │                            │
│                      │ (IndexedDB)│                            │
│                      │            │◄── auto-backup to user     │
│                      │ (optional  │    directory (Google Drive, │
│                      │ encryption)│     custom path)           │
│                      └─────┬──────┘                           │
│                            │                                  │
│  ┌─────────────────────────▼───────────────────────────────┐  │
│  │  Views                                                  │  │
│  │  ├── Dashboard (overview, recent activity, stats)       │  │
│  │  ├── Star Map + Route Planner (3D R3F, Dijkstra/A*)    │  │
│  │  ├── Deployable Fleet (own assemblies, fuel, labels)    │  │
│  │  ├── Assemblies (observed, other players')              │  │
│  │  ├── Locations (bookmarks, annotations)                 │  │
│  │  ├── Watchlist (target tracking, surveillance)          │  │
│  │  ├── Players (profiles, affiliations, notes)            │  │
│  │  ├── Killmails (combat intel)                           │  │
│  │  ├── Blueprints (manufacturing calculator, BOM)         │  │
│  │  ├── Log Analyzer (mining, combat, travel analytics)    │  │
│  │  ├── Intel Channel (real-time chat intel, link parsing) │  │
│  │  ├── Notes (freeform intel, entity-linked)              │  │
│  │  └── OPSEC Dashboard (exposure analysis, risk flags)    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Data Management                                        │  │
│  │  ├── Import / Export (JSON backup/restore)              │  │
│  │  ├── Encryption (WebCrypto, passphrase-based)           │  │
│  │  ├── Auto-Backup (IndexedDB + optional directory export) │  │
│  │  └── Service Worker (offline PWA, auto-updates)         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Windows Integration (installed PWA)                     │  │
│  │  ├── Taskbar icon (pinnable, own window, Alt-Tab)       │  │
│  │  ├── Badge count (new intel reports, fuel alerts)        │  │
│  │  ├── Toast notifications (hostile reports, target activity)│
│  │  ├── Jump list shortcuts (Star Map, Intel Feed, Fuel)    │  │
│  │  └── Auto-update (SW checks → prompt → reload)          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  P2P Layer (Phase 2)                                     │  │
│  │  ├── Multi-Box Sync (full CRDT replication, your alts)  │  │
│  │  ├── Intel Sharing (selective, tagged, allies)           │  │
│  │  ├── WebRTC DataChannels (browser-to-browser, E2E)      │  │
│  │  └── Peer management (pairing, auto-reconnect, status)  │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phased Roadmap

### Phase 1 — Solo Periscope (Hackathon Target)

Standalone local-only tool for a single player. No networking, no sharing.

**1.1 — Foundation**
- [ ] New `apps/periscope` package — Vite + React SPA
- [ ] IndexedDB storage layer (via Dexie.js)
- [ ] Basic data model and CRUD operations
- [ ] Passphrase-based encryption at rest (WebCrypto AES-GCM)
- [ ] Import/export (JSON file download/upload for backup)
- [ ] Auto-backup directory (optional, Chromium only — periodic export to user-chosen folder)

**1.2 — Static Data (Comprehensive Client Extraction)**
- [ ] Extract ALL available static data from client ResFiles (see Static Data section)
- [ ] Star map: 24,026 solar systems with x,y,z coordinates, jump connections (6,876 jumps)
- [ ] Solar system content: celestials, planets, moons, NPC stations per system
- [ ] Type registry: all item/ship/module types with names, groups, categories, attributes
- [ ] Blueprint data: full bill of materials, inputs/outputs, manufacturing chains
- [ ] Space components: component attributes by type ID (9.5MB of module/ship stats)
- [ ] Localization: English name resolution for all type IDs
- [ ] Bundle baseline dataset at build time (~5-8MB compressed)
- [ ] Import UI: drag-and-drop or file picker for user-extracted JSON updates
- [ ] Cache management UI (version, source, last update, storage usage, refresh)

**1.3 — Data Ingestion (API + Chain)**
- [ ] World API client with adapter pattern (swappable when API changes)
- [ ] Discover and document Cycle 5 API endpoints on launch day
- [ ] Direct Sui RPC queries from browser (reuse `@tehfrontier/sui-client`)
- [ ] Fetch Smart Assembly states (gates, storage units, turrets)
- [ ] Fetch player profiles and characters
- [ ] Fetch killmail data
- [ ] Configurable endpoints (API base URL, RPC endpoint)
- [ ] Data source fallback: API → RPC → cache

**1.4 — Client Log Parsing**
- [ ] File System Access API — user grants access to EVE Frontier log directory
- [ ] Chat log parser — extract system visits, local player presence, timestamps
- [ ] Game log parser — extract mining yields, damage events, loot drops
- [ ] Activity analytics — calculate mining rates, DPS, income per session
- [ ] Continuous watching — poll log directory for new/updated files
- [ ] Persist directory handle across sessions (IndexedDB stored handle)

**1.4a — Intel Channel Integration**
- [ ] Chat log parser — detect and parse in-game object links (system links, player links, item links)
- [ ] Link format reverse engineering — document Cycle 5 chat link markup on launch day
- [ ] Intel report extraction — convert linked objects into structured intel entries (system sighted, player reported, etc.)
- [ ] Real-time intel feed — live updating dashboard of parsed chat intel from monitored channels
- [ ] Channel configuration — select which chat channels are intel channels vs. ignored
- [ ] Intel aging — reports fade/expire after configurable time (default: 15 min active, 30 min stale, 60 min expired)
- [ ] Sound/visual alerts — configurable notifications for new intel reports (hostile in system, new target sighted)
- [ ] Star map integration — flash/highlight systems on the 3D map when reported in intel channels
- [ ] Player cross-reference — auto-link reported players to existing PlayerIntel records, threat levels
- [ ] Intel history — searchable archive of all parsed intel channel reports

**1.5 — Deployable Management**
- [ ] Fetch all owned assemblies from chain (by owner address)
- [ ] Display status, type, fuel, energy source for each deployable
- [ ] User labels and notes per deployable
- [ ] Fuel calculator — time remaining, depletion ETA
- [ ] Fuel alerts — configurable low-fuel warnings
- [ ] Subscribe to FuelEvent emissions for real-time fuel tracking
- [ ] Network node topology — which assemblies connect to which nodes, energy budget

**1.6 — Target Tracking & Surveillance**
- [ ] Add target by Sui address — auto-discover all their assemblies
- [ ] Periodic polling of target assembly state (fuel, inventory, status)
- [ ] Target profile view — assemblies, fuel trends, activity timeline
- [ ] Inventory change tracking — detect deposits/withdrawals on target SSUs
- [ ] Configurable alerts (new assembly, low fuel, killmail involvement, dormancy)
- [ ] Watchlist dashboard — all targets with status summary
- [ ] Correlate physical sightings with on-chain object IDs

**1.7 — OPSEC Awareness**
- [ ] "Your exposure" dashboard — what's visible about you on-chain
- [ ] Assembly risk flags — possible compromised locations
- [ ] Transaction awareness warnings
- [ ] Gate pair exposure tracking

**1.8 — Intel Views**
- [ ] Dashboard — summary of collected intel, recent changes, session stats
- [ ] Star map + route planner — interactive 3D map with integrated pathfinding and smart gate awareness (see Star Map & Route Planner section)
- [ ] Deployable fleet — all your assemblies with status, fuel %, labels, plotted on map
- [ ] Assembly browser — observed (other players') assemblies with metadata
- [ ] Player tracker — known players, notes, last seen activity
- [ ] Location bookmarks — save and annotate locations/systems, visible on map
- [ ] Killmail feed — recent combat activity, filterable, mapped to systems
- [ ] Blueprint calculator — manufacturing BOM, material costs, production chains
- [ ] Log analyzer — parsed client log data with mining/combat/travel analytics (ef-map.com parity)
- [ ] Intel channel — real-time feed of parsed chat intel (system reports, player sightings, linked objects)
- [ ] Manual notes — freeform intel entries tagged to entities
- [ ] Target watchlist — tracked targets with status, fuel trends, alerts
- [ ] OPSEC dashboard — your on-chain exposure and risk assessment

**1.9 — PWA, Windows Integration & Updates**
- [ ] Service Worker for full offline capability (via vite-plugin-pwa)
- [ ] PWA manifest (installable on desktop — own taskbar icon, own window)
- [ ] Taskbar badge count — `navigator.setAppBadge(count)` for new intel / fuel alerts
- [ ] Windows toast notifications — hostile reports, target activity, fuel warnings (Notification API)
- [ ] Jump list shortcuts — right-click taskbar icon for Star Map, Intel Feed, Fuel Alerts, Watchlist
- [ ] Window Controls Overlay — custom title bar with status indicators
- [ ] Auto-update via Service Worker — prompt user when new version available, reload to activate
- [ ] Version display in Settings with changelog on update
- [ ] Data retention controls (auto-expire stale intel)
- [ ] Settings (RPC endpoint, encryption toggle, auto-backup directory, dark theme)
- [ ] Keyboard shortcuts (Ctrl+K search, Escape close panels, number keys switch views)
  - **Ctrl+K global search:** Opens a command palette modal with categorized results across systems (name), players (name/address), assemblies (label/objectId), notes (title), and bookmarks. Results grouped by category, keyboard-navigable (arrow keys + Enter). Encrypted payload fields (notes body, rawMessage) are excluded from search unless decrypted in the current session.
- [ ] Dexie schema migration on version bumps (`db.version(N).upgrade()`)

### Phase 2 — P2P Intel Sharing & Multi-Box Sync

Direct browser-to-browser communication via WebRTC. Two trust tiers: **multi-box** (full sync between your own accounts) and **intel sharing** (selective sharing with allies).

**2.1 — Connection Layer**
- [ ] WebRTC DataChannel implementation
- [ ] Manual signaling (copy-paste offer/answer codes)
- [ ] Connection management (connect, disconnect, reconnect)
- [ ] Shared-secret signaling relay (optional convenience mode)
- [ ] Peer type designation: `multibox` (full trust) vs `intel` (selective trust)
- [ ] LAN peer discovery (mDNS or manual IP:port for same-network multi-box)

**2.2 — Multi-Box Sync (Full Trust)**
- [ ] Full bidirectional Dexie replication between multi-box peers
- [ ] CRDT-based conflict resolution (all data merges seamlessly)
- [ ] Active account selector — each instance centers UI on its own character
- [ ] Shared intel from all alts: watchlists, bookmarks, notes, deployables, targets
- [ ] Shared fuel alerts across all accounts' assemblies
- [ ] Shared travel history — combined "fog of war" from all characters
- [ ] Shared intel channel reports — chat parsed on any box appears on all
- [ ] Automatic reconnect on network interruption (queue changes, sync on restore)
- [ ] Sync status indicator (connected, syncing, offline/queued)
- [ ] Multi-box peer management UI (pair boxes, view sync status, unpair)

**2.3 — Selective Intel Sharing (Allies)**
- [ ] Tag intel items with sharing groups (e.g., "alliance", "scouts", "private")
- [ ] Per-connection share filters (choose what categories to share)
- [ ] E2E encryption on shared payloads (symmetric group key)
- [ ] Conflict resolution for concurrent edits (last-write-wins or CRDT)
- [ ] Received intel marked with source peer (who shared it)

**2.4 — Group Management**
- [ ] Alliance/group creation with shared encryption key
- [ ] Member list and trust levels
- [ ] Full mesh connection topology (suitable for ~5-20 peers)
- [ ] Sync protocol — catch up missed intel on reconnect

### Phase 3 — On-Chain Sharing (Sui)

Use Sui blockchain as a decentralized, asynchronous communication layer.

**3.1 — Alliance Contract**
- [ ] Move smart contract: alliance object with access control
- [ ] Encrypted intel storage as dynamic fields
- [ ] Member management (add/remove via AdminCap or shared authority)

**3.2 — Chain Integration**
- [ ] Write encrypted intel to Sui objects
- [ ] Read and decrypt alliance intel from chain
- [ ] Subscribe to on-chain events for real-time updates
- [ ] Gas management (self-funded or gas pool)

**3.3 — Hybrid Mode**
- [ ] Local-first with selective chain sync
- [ ] Choose per-item: local only, P2P shared, or on-chain
- [ ] Fallback gracefully when offline (queue writes, sync later)

---

## Tech Stack

### apps/periscope (new)

| Layer | Choice | Rationale |
|---|---|---|
| **Framework** | Vite + React | Fast builds, pure SPA, no server needed. React aligns with existing `apps/web` and `@evefrontier/dapp-kit` |
| **Styling** | Tailwind CSS v4 | Consistent with existing `apps/web` |
| **State** | Zustand | Already used in `apps/web`, lightweight |
| **Storage** | Dexie.js (IndexedDB) | Clean async API over IndexedDB, supports versioned schemas, reactive queries |
| **Encryption** | WebCrypto API | Browser-native, no dependencies. AES-256-GCM with PBKDF2 key derivation |
| **3D Star Map** | React Three Fiber + Three.js + drei | Declarative 3D in React. InstancedMesh for 24k systems (single draw call). Proven at 200k by ef-map.com |
| **Post-processing** | `@react-three/postprocessing` | Bloom/glow effects for star rendering (optional, 3-5ms overhead) |
| **Pathfinding** | Custom Dijkstra/A* in Web Worker | Jump graph routing, smart gate integration, configurable weights |
| **Sui RPC** | `@mysten/sui` via `@tehfrontier/sui-client` | Already in monorepo, direct browser-compatible RPC calls |
| **PWA** | vite-plugin-pwa | Service worker, manifest, offline support, prompt-based updates |
| **Notifications** | Notification API + Badging API | Windows toast notifications, taskbar badge count (Chromium PWA) |
| **Charts** | Recharts or lightweight alternative | Mining rates, fuel trends, activity timelines |
| **Router** | TanStack Router | Type-safe client-side routing, URL-addressable views, PWA shortcut URLs |
| **Data Fetching** | TanStack React Query | Cache, dedup, retry, stale-while-revalidate for API/RPC calls |
| **P2P (Phase 2)** | WebRTC DataChannels | Browser-native, no dependencies for basic usage |
| **Multi-Box Sync** | CRDTs + Hybrid Logical Clock | Conflict-free merge across instances, causal ordering without synced clocks |

**State management boundaries:**
- **Dexie (IndexedDB)** — all persistent data: intel records, settings, static data cache. Source of truth. Survives page refreshes and app restarts.
- **Zustand** — ephemeral UI state: selected system, active sidebar panel, map camera position, search query, modal open/close, in-progress form data, filter selections. Lost on page refresh (acceptable).
- **React Query** — remote data fetch lifecycle: loading/error/stale states for API/RPC calls. Writes results to Dexie on success; UI reads from Dexie live queries, not from React Query cache directly. React Query manages *when* to fetch, Dexie manages *what's stored*.

### Reused Packages

- `@tehfrontier/sui-client` — Sui RPC wrapper, chain queries
- `@tehfrontier/shared` — shared types, constants
- `@tehfrontier/tsconfig` — TypeScript configs

---

## Data Model

All data stored in IndexedDB via Dexie.js. Each table corresponds to an intel category.

```typescript
// Core identity — all intel records extend this
interface IntelEntry {
  id: string;              // UUID v4 via crypto.randomUUID() (built-in, requires secure context: HTTPS or localhost)
  type: IntelType;
  createdAt: number;       // timestamp
  updatedAt: number;       // timestamp
  source: IntelSource;
  tags: string[];          // user-defined tags
  sharing: SharingLevel;   // 'private' | 'group' | 'alliance' (Phase 2+)

  // Sync fields (Phase 1: optional, Phase 2: required — see SyncableEntry)
  _hlc?: string;           // Hybrid Logical Clock timestamp
  _deleted?: boolean;      // Tombstone for soft deletes
  _origin?: string;        // Instance ID that created/last modified this entry
}

// Observed assemblies — any player's assemblies discovered via chain, logs, or intel
// For YOUR OWN managed fleet with labels/fuel/notes, see DeployableIntel
interface AssemblyIntel extends IntelEntry {
  type: 'assembly';
  assemblyType: 'gate' | 'storage_unit' | 'turret' | 'network_node' | 'nursery' | 'nest' | 'shell_sheet' | 'construction_site' | 'unknown';
  turretClass?: 'mini' | 'standard' | 'heavy';  // only set when assemblyType === 'turret'
  status: 'online' | 'offline' | 'anchored' | 'unanchored' | 'destroyed' | 'unknown';
  objectId: string;        // Sui object ID
  owner: string;           // owner Sui address
  name?: string;           // display name if known
  location?: LocationData; // coordinates if known/deduced
  state: Record<string, unknown>; // raw on-chain state
  linkedGate?: string;     // for gates: the paired gate object ID
  notes: string;           // player annotations
}

// Player profiles
interface PlayerIntel extends IntelEntry {
  type: 'player';
  address: string;         // Sui address
  name?: string;           // in-game name
  tribe?: string;          // tribe (EVE Frontier organizational unit)
  threat: ThreatLevel;     // 'unknown' | 'friendly' | 'neutral' | 'hostile'
  // NOTE: Do not store a cached `assemblies` array here — it goes stale with no reliable sync mechanism.
  // Instead, query assemblies by owner address at read time: `db.assemblies.where('owner').equals(address)`
  // This avoids phantom references and ensures the player profile always reflects current data.
  lastSeen?: number;       // timestamp of last observed activity
  notes: string;
}

// Locations / bookmarks
interface LocationIntel extends IntelEntry {
  type: 'location';
  name: string;            // player-given name
  system?: string;         // solar system identifier
  coordinates?: {
    x: number;
    y: number;
    z: number;
  };
  category: string;        // 'base' | 'gate_hub' | 'resource' | 'danger' | 'poi' | custom
  notes: string;
}

// Killmails
interface KillmailIntel extends IntelEntry {
  type: 'killmail';
  killmailId: string;      // on-chain ID
  victim: string;          // Sui address
  finalBlow: string;       // Sui address of killing blow
  involved?: string[];     // Sui addresses of other participants
  timestamp: number;       // kill time
  location?: LocationData;
  loot?: Record<string, unknown>;
  notes: string;
}

// Freeform notes
interface NoteIntel extends IntelEntry {
  type: 'note';
  title: string;
  body: string;            // markdown
  linkedEntities: string[]; // IDs of related intel entries
}

// Activity records (parsed from client logs)
interface ActivityIntel extends IntelEntry {
  type: 'activity';
  activityType: 'mining' | 'combat' | 'travel' | 'loot' | 'trade';
  sessionId?: string;      // groups entries from same play session
  system?: string;         // solar system where activity occurred
  duration?: number;       // seconds
  metrics: Record<string, number>; // e.g., { oreYield: 1500, iskValue: 25000 }
  rawLog?: string;         // original log line(s) for reference
  notes: string;
}

// Chat intel reports (parsed from intel channels)
interface ChatIntelEntry extends IntelEntry {
  type: 'chat_intel';
  channel: string;            // chat channel name (e.g., "Alliance Intel", "Scout Channel")
  reporter: string;           // player who posted the report
  rawMessage: string;         // original chat message text
  parsedLinks: ChatLink[];    // extracted object links from the message
  system?: string;            // primary system referenced (if any)
  reportedPlayers: string[];  // Sui addresses of mentioned players (display names in parsedLinks)
  severity: 'info' | 'warning' | 'critical'; // auto-classified or manual
  // NOTE: `status` is computed at read time from `createdAt` + aging config (see updateIntelStatus),
  // NOT stored in Dexie. Use `expiresAt` index for efficient cleanup queries instead.
  // This avoids O(n) periodic writes to update status on every record.
  expiresAt: number;          // createdAt + expiredMinutes * 60000. When aging config changes,
                              // bulk-update all records: db.chatIntel.toCollection().modify(e => {
                              //   e.expiresAt = e.createdAt + newConfig.expiredMinutes * 60000;
                              // });
                              // NOTE: only `expiresAt` is indexed — the active/stale boundary is
                              // computed at read time via updateIntelStatus(). This is acceptable
                              // because the live feed only renders recent records (not a full scan).
}

interface ChatLink {
  linkType: 'system' | 'player' | 'item' | 'assembly' | 'tribe' | 'unknown';
  linkId: string;             // game object ID referenced by the link
  displayText: string;        // visible text of the link
  rawMarkup: string;          // original link markup from chat
}

// Multi-box sync — these fields become required on all records in Phase 2
// In Phase 1, they exist as optional fields on IntelEntry (above)
// Shown here as the required interface for Phase 2 migration reference
interface SyncableEntry {
  _hlc: string;            // Hybrid Logical Clock timestamp (causal ordering)
  _deleted: boolean;       // Tombstone for soft deletes (synced deletions)
  _origin: string;         // Instance ID that created/last modified this entry
}

// Target surveillance record — stored in `targets` table.
// NOT an IntelEntry — joined with PlayerIntel (by address) at read time to build TargetProfile.
// Phase 2: add _hlc, _deleted, _origin for CRDT sync.
interface TargetRecord {
  id: string;              // UUID
  address: string;         // Sui address (FK → PlayerIntel.address)
  watchStatus: 'active' | 'paused' | 'archived';
  pollInterval: number;    // seconds between chain queries
  lastPolled: number;      // timestamp
  lastActivity: number;    // timestamp of most recent observed on-chain action
  tags: string[];
}

// Target activity event — stored in `targetEvents` table
interface TargetEventRecord {
  id: string;              // UUID
  targetId: string;        // FK → TargetRecord.id
  timestamp: number;
  event: TargetEventType;
  details: Record<string, unknown>;
  assemblyId?: string;     // related assembly object ID (if applicable)
}

// Inventory change record — stored in `inventoryDiffs` table
interface InventoryDiffRecord {
  id: string;              // UUID
  targetId: string;        // FK → TargetRecord.id
  assemblyId: string;      // SSU object ID where the change occurred
  timestamp: number;
  typeId: number;          // item type ID
  typeName?: string;       // resolved item name (denormalized for display)
  quantityDelta: number;   // positive = deposit, negative = withdrawal
}

// Supporting types
type IntelType = 'assembly' | 'deployable' | 'player' | 'location' | 'killmail' | 'note' | 'activity' | 'chat_intel';
type IntelSource = 'chain' | 'api' | 'log' | 'chat' | 'manual' | 'p2p' | 'sync' | 'import';
type SharingLevel = 'private' | 'group' | 'alliance';
type ThreatLevel = 'unknown' | 'friendly' | 'neutral' | 'hostile';
type ChatIntelStatus = 'active' | 'stale' | 'expired'; // computed at read time, NOT stored in Dexie
type TargetEventType = 'fuel_deposit' | 'item_transfer' | 'gate_jump' | 'kill' | 'death' | 'assembly_deployed' | 'assembly_removed';

interface LocationData {
  system?: string;         // solar system ID as string (e.g., "30001234"), NOT the display name.
                           // Resolve display names from solarSystems table at read time.
                           // All `system` fields across the data model follow this convention.
  x?: number;
  y?: number;
  z?: number;
}

// Chain state → typed status: see resolveStatus() in the evedatacore reference section.
// It maps numeric chain states (0-4) to AssemblyIntel['status'] and infers 'offline' from fuel state.
```

### Dexie Schema

```typescript
const db = new Dexie('frontier-periscope');

db.version(1).stores({
  // Intel tables
  deployables: 'id, objectId, assemblyType, status, label, updatedAt, *tags',
  assemblies:  'id, assemblyType, objectId, owner, status, updatedAt, *tags',
  players:    'id, address, name, threat, updatedAt, *tags',
  locations:  'id, name, system, category, updatedAt, *tags',
  killmails:  'id, killmailId, victim, finalBlow, timestamp, *tags',
  notes:      'id, title, updatedAt, *tags, *linkedEntities',
  activities:      'id, activityType, sessionId, system, createdAt, *tags',
  chatIntel:       'id, channel, reporter, system, createdAt, expiresAt, *reportedPlayers, *tags',
  targets:         'id, address, watchStatus, lastPolled, lastActivity, *tags',
  targetEvents:    'id, targetId, timestamp, event, assemblyId',
  inventoryDiffs:  'id, targetId, assemblyId, timestamp, typeId',

  // Static data cache
  solarSystems:   'id, name, constellationId, regionId', // security not indexed — all 24k systems are loaded into memory for star map rendering, so color-coding reads from the in-memory array, not Dexie queries
  constellations: 'id, name, regionId',
  regions:        'id, name',
  jumps:          '[fromSystemId+toSystemId], fromSystemId, toSystemId', // 6,876 bidirectional jump connections stored as TWO directed records each (A→B + B→A = 13,752 rows). Compound PK prevents duplicates on re-import. Graph builder reads edges directly — no reversal needed.
  itemTypes:      'id, name, category',
  blueprints:     'id, outputTypeId, *inputTypeIds',
  spaceComponents: 'typeId',                          // module/ship stats by type ID

  // Multi-box sync (Phase 2 — tables created via schema migration)
  syncPeers:      'instanceId, lastSeen',           // paired multi-box instances
  syncLog:        '++seq, hlc, table, entryId',      // change log for sync protocol

  // App state
  settings:       'key',
  cacheMetadata:  'key',         // data version, last update, source
  logOffsets:     'fileName',    // tracks last-read position per log file
});

// Dedup rule: assemblies discovered via chain scan where owner === your address
// go into `deployables` (your managed fleet), NOT `assemblies` (observed others).
// The `assemblies` table stores only OTHER players' assemblies.
```

---

## Encryption Design

### At Rest (Phase 1)

- Encryption is **off by default** (opt-in via Settings)
- PBKDF2 derives a 256-bit AES key from the passphrase (100k+ iterations, random salt)
- Each IndexedDB record is AES-256-GCM encrypted before storage
- Salt and IV stored alongside ciphertext (not secret, just unique)
- Passphrase never stored — user must enter it each session
- If no passphrase set, data stored in plaintext (user's choice)

**Encryption state transitions:**
- **Enabling encryption** — when user sets a passphrase for the first time, all existing plaintext payload fields on intel records are encrypted in-place via a Dexie transaction. Show progress ("Encrypting database... N/M records"). Indexed fields remain plaintext (see below).
- **Disabling encryption** — reverse: decrypt all payload fields in-place. Requires the current passphrase to unlock the key first.
- **Changing passphrase** — decrypt with old key, derive new key from new passphrase (fresh salt), re-encrypt all payload fields. Old passphrase required.
- **Consistency guard** — all three operations run in a single Dexie transaction. If interrupted (tab closed mid-migration), the app detects inconsistent encryption state on next launch (mix of encrypted/plaintext records) and prompts the user to retry with their passphrase.

**What gets encrypted:**
- **Intel tables only:** deployables, assemblies, players, locations, killmails, notes, activities, chatIntel, targets, targetEvents, inventoryDiffs
- **NOT encrypted:** static data tables (solarSystems, constellations, regions, jumps, itemTypes, blueprints, spaceComponents), settings, cacheMetadata, logOffsets
- **Indexed fields** (those in Dexie schema key paths) remain as plaintext metadata so Dexie `where()` queries and multi-entry indexes (`*tags`) continue to work. Only payload fields (`notes`, `body`, `rawMessage`, `state`, `metrics`, `rawLog`, etc.) are encrypted.
- **Implication:** with encryption enabled, full-text search across encrypted payload fields requires decrypt-on-read. Keep payload fields out of Dexie indexes.

### In Transit (Phase 2)

- WebRTC DataChannels are DTLS-encrypted by default
- Additional layer: group symmetric key (AES-256-GCM) encrypts payloads
- Key exchanged out-of-band (paste in Discord, etc.)

### On Chain (Phase 3)

- Intel encrypted client-side before writing to Sui objects
- Group key used for encryption — only members can decrypt
- Chain observers see encrypted blobs, not content

---

## Location System — How It Works On-Chain

### Locations Are Hashed, Not Stored as Coordinates

From `contracts/world/sources/primitives/location.move`, locations on-chain are stored as **Poseidon2 hashes** of the actual coordinates:

```move
public struct Location has store {
    location_hash: vector<u8>,  // Poseidon2 hash — NOT raw coordinates
}
```

This means:
- **No one can read assembly coordinates from the chain** by just querying the object
- Each `Assembly` struct embeds a `Location` directly (not a reference)
- The hash is set on anchoring (`location::attach(location_hash)`) and cleared on unanchoring (`location.remove()`)

### Proximity Verification

Since coordinates aren't on-chain, proximity is verified via **signed server proofs**:

```move
public struct LocationProofMessage has drop {
    server_address: address,
    player_address: address,
    source_structure_id: ID,
    source_location_hash: vector<u8>,
    target_structure_id: ID,
    target_location_hash: vector<u8>,
    distance: u64,
    data: vector<u8>,
    deadline_ms: u64,
}
```

- The game server calculates the actual distance between two locations
- It signs a proof containing the distance and a deadline
- Smart contracts call `verify_proximity()` or `verify_distance()` to validate the proof
- This is used for gate linking (>20km apart), storage unit access (proximity check), etc.

### Future: Zero-Knowledge Proofs

The `eve-frontier-proximity-zk-poc` repo demonstrates replacing server signatures with ZK proofs:
- **Location circuit:** ~2,359 constraints, ~320ms proof generation
- **Distance circuit:** ~1,010 constraints, ~250ms proof generation
- Uses Groth16 circuits with Poseidon hashing
- Would allow fully decentralized proximity verification without trusting the game server

### What This Means for Frontier Periscope

**Your own assemblies:** You know where you deployed them (you were there). The tool stores your assembly locations from your own knowledge — either entered manually or captured from client logs when you anchored. The on-chain `location_hash` can be stored alongside as a unique identifier, but coordinates come from you.

**Other players' assemblies:** Coordinates are NOT readable from chain. You can see that an assembly *exists* (object ID, owner, type, status, fuel) but NOT *where* it is. Intel about other players' locations comes from:
- Personal observation (you flew there and saw it)
- Client logs (if you visited the system)
- Shared intel from allies (Phase 2/3)
- Correlating `location_hash` values (same hash = same location, but you need at least one known reference point)

**This is exactly why this tool is valuable** — location intel cannot be scraped from the chain. It must be gathered through gameplay and shared selectively.

---

## OPSEC & Threat Model

### What's Public On-Chain

All Sui on-chain data is readable by anyone. No authentication needed. If an enemy knows your Sui address, they can observe:

| Data | Visible? | How |
|---|---|---|
| All your assemblies (object IDs, types) | **Yes** | `suix_getOwnedObjects` by address |
| Fuel levels on every assembly | **Yes** | `sui_getObject` on each assembly |
| SSU inventory contents | **Yes** | Dynamic fields on SSU objects |
| When you deposit/withdraw items | **Yes** | Transaction history is public |
| Which specific SSU you interacted with | **Yes** | Transaction references the object ID |
| Your EVE token balance | **Yes** | `sui_getCoins` by address |
| Gate pair links (which two gates connect) | **Yes** | Gate contract state |
| Player profile / character name | **Yes** | Character contract |
| **Where** any assembly is located | **No** | Only Poseidon2 hash stored |

### The Escalation Chain

1. **Address discovery** — Enemy links your in-game character to your Sui address (via player profile lookup). Now they can surveil all your on-chain activity without ever finding you in space.

2. **Passive monitoring** — Enemy watches your transactions. They see you depositing items into SSU `0xABC`, fueling gate `0xDEF`, etc. They know *what* you're doing but not *where*.

3. **Physical discovery** — Enemy physically finds one of your assemblies in space. They can now match the location to an object ID. For that one assembly, they have full visibility: location + contents + fuel + activity.

4. **Gate correlation** — If they find one end of a gate pair, they know the object ID of the other end. They can watch both gates' fuel/status and see when someone jumps (JumpEvent). They just don't know where the other end is — yet.

5. **Pattern analysis** — By watching transaction timing and fuel consumption patterns across your assemblies, an enemy can infer activity levels, operational tempo, and which assemblies are most important to you.

### OPSEC Awareness Features

The tool should help the user understand and manage their on-chain exposure:

- **"Your exposure" dashboard** — "Here's what anyone who knows your address can see right now"
- **Assembly risk assessment** — flag assemblies that may be compromised (e.g., if you've seen hostile players in the same system via logs)
- **Transaction awareness** — "You just interacted with SSU 0xABC — anyone watching your address now knows this SSU is yours"
- **Gate pair exposure** — "Gate A's location may be compromised — this means the object ID of its paired Gate B is known, even though Gate B's location is still hidden"
- **Address separation advice** — recommend using different addresses for different operational areas to limit blast radius of compromise

### Using the Threat Model Offensively

The same chain surveillance capabilities the tool warns you about can be used to monitor targets. See **Target Tracking** section below.

---

## Target Tracking & Surveillance

### Overview

The tool doesn't just protect your own intel — it's also used to monitor enemy players, track hostile activity, and build intelligence profiles on targets. All of this is done by reading publicly available on-chain data.

### How It Works

Given a target's Sui address, the tool can automatically pull and continuously monitor:

| Intelligence | Method | Update Frequency |
|---|---|---|
| All owned assemblies | `suix_getOwnedObjects` | Periodic poll |
| Assembly types and count | Object queries | On change |
| Fuel levels on each assembly | `sui_getObject` | Periodic poll |
| Fuel trends (burning faster? refueling?) | Historical tracking | Continuous |
| SSU inventory contents | Dynamic field queries | Periodic poll |
| SSU inventory changes (deposits/withdrawals) | Event subscription or diff | Near real-time |
| Gate pairs (which gates are linked) | Gate state queries | On change |
| EVE token balance and transfers | Coin queries + events | Periodic poll |
| Killmail involvement (kills and deaths) | `sui_queryEvents` | Periodic poll |
| Transaction activity patterns | Transaction history | Continuous |

### Target Profiles

```typescript
// Application-level view model. In Dexie storage, data is normalized:
// - Core target fields → `targets` table (indexed: id, address, watchStatus, lastPolled, lastActivity, tags)
//   The `targets` table stores ONLY surveillance-specific fields — it does NOT duplicate PlayerIntel fields.
//   At read time, TargetProfile is assembled by joining `targets` (by address) with `players` (by address).
//   If a target has no `players` record yet, one is created when they're added as a target.
// - trackedAssemblies → populated from `assemblies` table filtered by target address
// - activityLog → `targetEvents` table (indexed by targetId)
// - Inventory changes → `inventoryDiffs` table (indexed by targetId + assemblyId)
interface TargetProfile extends PlayerIntel {
  // Extends the basic player intel with surveillance data
  watchStatus: 'active' | 'paused' | 'archived';
  pollInterval: number;          // seconds between chain queries
  lastPolled: number;            // timestamp

  // Tracked assemblies (auto-discovered from chain)
  trackedAssemblies: {
    objectId: string;
    assemblyType: AssemblyIntel['assemblyType'];
    status: AssemblyIntel['status'];
    fuel?: {
      quantity: number;
      depletionEta?: number;
      trend: 'stable' | 'declining' | 'refueled' | 'offline';
    };
    inventory?: {
      itemCount: number;
      lastChanged: number;
      recentChanges: InventoryChange[];
    };
    locationHash: string;
    knownLocation?: LocationData; // if we've physically found it
  }[];

  // Activity timeline
  activityLog: {
    timestamp: number;
    event: TargetEventType;
    details: Record<string, unknown>;
    assemblyId?: string;
  }[];

  // Analysis
  operationalTempo: 'high' | 'medium' | 'low' | 'dormant'; // computed from lastActivity: high = active within 24h, medium = within 7d, low = within 30d, dormant = 30d+ inactive
  lastActivity: number;
  totalAssemblies: number;
  estimatedNetWorth?: number;    // based on visible assets
}

interface InventoryChange {
  timestamp: number;
  typeId: number;
  typeName?: string;
  quantityDelta: number;        // positive = deposit, negative = withdrawal
}
```

### Surveillance Views

- **Watchlist** — all tracked targets with status summary, last activity, alert count
- **Target detail** — full profile: assemblies, fuel status, inventory, activity timeline
- **Fuel monitor** — track when targets are refueling (indicates active operations) or running low (potential vulnerability)
- **Inventory tracker** — see what items are moving in/out of their SSUs, detect stockpiling or asset extraction
- **Activity timeline** — chronological view of all observed on-chain actions
- **Alerts** — configurable notifications:
  - "Target deployed a new assembly"
  - "Target's gate fuel is critically low"
  - "Target transferred X items to SSU"
  - "Target involved in a killmail"
  - "Target has been dormant for X days"

### Correlation with Physical Intel

When you or an ally physically discovers a target's assembly in space:
1. Note the object ID visible in-game
2. Match it to the target's on-chain assembly list
3. Now you have location + full on-chain visibility for that specific asset
4. The tool links the physical sighting to the on-chain data automatically

### Privacy Considerations

All surveillance queries are standard Sui RPC reads — the same queries anyone can make. The target cannot tell they're being watched (there's no "who viewed my profile" on a blockchain). However:
- The **RPC node operator** can see you're querying specific objects repeatedly. Use multiple RPC endpoints or a VPN if OPSEC matters.
- Querying at high frequency could be rate-limited by RPC providers. The tool should use reasonable poll intervals (30s-5min depending on priority).

---

## Deployable Management

### Overview

The tool tracks all of the player's own deployed assemblies — gates, storage units, turrets (mini/standard/heavy), network nodes, nurseries, nests, shell sheets, and construction sites — with annotations, fuel status, and organizational tools that the game client doesn't provide.

### What's Tracked Per Deployable

| Field | Source | Notes |
|---|---|---|
| Object ID | Chain (Sui RPC) | Unique identifier |
| Assembly type | Chain | gate, storage_unit, turret (mini/standard/heavy), network_node, nursery, nest, shell_sheet, construction_site |
| Status | Chain | online/offline/anchored |
| Owner | Chain | Your Sui address |
| Location (coordinates) | Manual / Log | You know where you put it |
| Location hash | Chain | Poseidon2 hash from on-chain Location struct |
| Name / label | Manual | User-given name ("Main Base SSU", "Pipe Gate Alpha") |
| Fuel quantity | Chain | Current fuel amount |
| Fuel burn rate | Chain | `burn_rate_in_ms` from Fuel struct |
| Fuel efficiency | Chain | 10-100% from FuelConfig |
| Estimated fuel remaining | Calculated | Based on quantity, burn rate, efficiency |
| Fuel depletion ETA | Calculated | When fuel runs out at current rate |
| Energy source | Chain | Linked network node ID |
| Linked gate | Chain | For gates: the paired gate object ID |
| Notes | Manual | Freeform annotations |
| Tags | Manual | User-defined categories |

### Fuel Monitoring

The on-chain `Fuel` struct provides:
```
max_capacity, burn_rate_in_ms, quantity, is_burning,
previous_cycle_elapsed_time, burn_start_time, last_updated
```

The tool calculates:
- **Fuel consumed since burn started** = `(Date.now() - burn_start_time + previous_cycle_elapsed_time) / (burn_rate_in_ms × fuel_efficiency / 100)`
- **Remaining quantity** = `quantity - fuel_consumed` (clamped to 0)
- **Time remaining** = `remaining_quantity × burn_rate_in_ms × fuel_efficiency / 100` (in ms)
- **Depletion date** = current time + time remaining
- If `is_burning === false`, time remaining is static (no active consumption)
- If `burn_rate_in_ms === 0`, skip fuel calculation entirely — display as "No fuel consumption". Guards against division by zero in the fuel consumed formula.
- **Fuel alerts** — configurable warnings (e.g., "< 24 hours of fuel remaining")

### Fuel Events

The chain emits `FuelEvent` with actions: `DEPOSITED`, `WITHDRAWN`, `BURNING_STARTED`, `BURNING_STOPPED`, `BURNING_UPDATED`, `DELETED`. The tool can subscribe to these via `sui_queryEvents` to stay current without polling every object.

### Deployable Views

- **Fleet overview** — all your deployables in one table with status, fuel %, location
- **Fuel dashboard** — sorted by depletion urgency, alerts for low fuel
- **Map overlay** (future) — your deployables plotted on the star map
- **Group by** — region, type, fuel status, custom tags
- **Network topology** — which assemblies are connected to which network nodes, energy usage vs capacity

### Data Model Addition

```typescript
// YOUR OWN deployables — managed fleet with labels, fuel tracking, notes
// See AssemblyIntel (Data Model section) for observed/other players' assemblies
interface DeployableIntel extends IntelEntry {
  type: 'deployable';
  objectId: string;           // Sui object ID
  assemblyType: 'gate' | 'storage_unit' | 'turret' | 'network_node' | 'nursery' | 'nest' | 'shell_sheet' | 'construction_site' | 'unknown';
  turretClass?: 'mini' | 'standard' | 'heavy';  // only set when assemblyType === 'turret'
  status: 'online' | 'offline' | 'anchored' | 'unanchored' | 'destroyed' | 'unknown';
  label: string;              // user-given name
  location?: LocationData;    // coordinates (from your knowledge)
  locationHash?: string;      // on-chain Poseidon2 hash
  fuel?: {
    quantity: number;
    maxCapacity: number;
    burnRateMs: number;
    fuelEfficiency: number;   // 10-100 (divide by 100 to get fuelFactor — e.g., efficiency 10 → fuelFactor 0.1, efficiency 1 → fuelFactor 0.01). Verify exact semantics against on-chain FuelConfig on launch day.
    isBurning: boolean;
    burnStartTime?: number;
    previousCycleElapsedTime?: number; // from on-chain Fuel struct — needed for fuel formula
    lastUpdated?: number;     // on-chain last_updated timestamp — for staleness detection
    depletionEta?: number;    // calculated timestamp
  };
  energySourceId?: string;    // linked network node
  linkedGateId?: string;      // for gates: paired gate
  notes: string;
  // `tags` inherited from IntelEntry — do not redeclare here
}
```

---

## Star Map & Route Planner

### Overview

The tool includes a full interactive 3D star map and route planner — a local, privacy-first alternative to ef-map.com. Unlike ef-map.com (which is a hosted service), our star map runs entirely in the browser with all data stored locally. This means route planning, system searches, and bookmarks never leave the player's machine.

**Reference implementation:** ef-map.com (Three.js, WebAssembly Dijkstra, in-browser SQLite). We replicate the core features while adding intel integration that ef-map.com doesn't have (target overlays, OPSEC indicators, private annotations).

### Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **3D Renderer** | React Three Fiber (R3F) + Three.js | Proven at 200k systems by ef-map.com. R3F gives declarative React integration vs ef-map's imperative 9k-line component. Drei library provides OrbitControls, Html overlays, instancing helpers |
| **Star rendering** | `<instancedMesh>` | Single draw call for 24k systems. Per-instance color/scale via `setMatrixAt()`/`setColorAt()`. ef-map achieves 4ms frame time at 200k — our 24k is trivial |
| **Jump connections** | `<lineSegments>` + BufferGeometry | Single draw call for all 6,876 visual lines (one per undirected connection). Float32Array of start/end coordinates. Note: the pathfinding graph uses 13,752 directed edges (see jumps schema) — rendering only needs the undirected visual representation. |
| **Picking** | Raycaster with instanceId | Three.js raycaster checks bounding volume first, then ~100 nearby instances. Returns instanceId mapping to system data |
| **Pathfinding** | Dijkstra (Web Worker) | Runs in Web Worker to keep UI responsive. Graph built from jump connections + smart gate links |
| **Post-processing** | `@react-three/postprocessing` | UnrealBloomPass for star glow effects (optional, 3-5ms overhead) |

### Star Map Features

**Core:**
- 3D point cloud of 24,026 solar systems with orbit camera controls
- Jump connections rendered as lines between systems
- System search with autocomplete
- Click to select system → detail panel (name, region, constellation, security, celestials)
- Zoom to system / zoom to region
- URL deep linking: `/map?system=30001234` auto-centers on a system, `/map?route=A,B` pre-loads a route. Supports PWA jump list shortcuts and cross-view navigation (e.g., intel feed "show on map" → map view with system focused).
- Color-coding modes: by region, by security class, by custom data
- Label rendering: region names at far zoom, system names at medium zoom, full detail on click/hover. Labels use drei `<Html>` overlays, limited to ~50 nearest/selected systems to prevent DOM bloat. Frustum culling hides off-screen labels.

**Fog of war** (visited vs unknown):
- Per-instance color attribute on the InstancedMesh, driven by travel history from `activities` table
- Unvisited systems rendered at 30% opacity; visited systems at full brightness
- Color blending priority: threat overlay > fog of war > region/security base color

**Intel Integration (unique to our tool):**
- Overlay your deployable locations on the map (from Deployable Management)
- Overlay target assembly locations (known/discovered positions)
- Bookmark pins with private annotations
- Threat indicators (systems with hostile activity, from killmails/logs)
- Travel history visualization (from parsed game logs)
- "Fog of war" — highlight systems you've visited vs unknown

**Route Planning:**
- Click two systems → show shortest path
- Smart gate awareness — include player-deployed gates in routing
- Gate directionality — handle one-way gates correctly
- Multi-waypoint routes
- Route cost display: jump count, estimated fuel, distance
- Route visualization: highlighted path on the map
- Heat-aware routing (avoid dangerous systems, if threat data available)
- Discovery mode: prefer unvisited systems (from travel history)

### Route Planner Architecture

```
┌──────────────────────────────────────────────────┐
│  Main Thread                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐  │
│  │ React UI │◄──│ Zustand  │◄──│ 3D Map (R3F) │  │
│  │ (route   │   │ route    │   │ (highlight   │  │
│  │  panel)  │   │ store    │   │  path)       │  │
│  └────┬─────┘   └────▲─────┘   └──────────────┘  │
│       │              │                             │
│  ┌────▼──────────────┴──────────────────────────┐  │
│  │  Web Worker (Pathfinder)                      │  │
│  │  ┌─────────────┐  ┌────────────────────────┐  │  │
│  │  │ Jump Graph   │  │ Dijkstra / A*          │  │  │
│  │  │ (adjacency   │  │ (bidirectional search, │  │  │
│  │  │  list from   │  │  smart gate edges,     │  │  │
│  │  │  static data │  │  configurable weights) │  │  │
│  │  │  + live gate │  │                        │  │  │
│  │  │  data)       │  │                        │  │  │
│  │  └─────────────┘  └────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Jump graph construction:**
1. Base graph: 24,026 nodes + 13,752 directed edges from static jump data (6,876 bidirectional connections × 2)
2. Smart gate edges: added dynamically from on-chain gate pair data (fetched via Sui RPC)
3. Edge weights: configurable (uniform = fewest jumps, distance-weighted, threat-weighted)
4. One-way gate handling: directed edges for gates with access control restrictions

**Pathfinding algorithm:**
- Dijkstra for uniform weights (fewest jumps) — simplest, fast enough for 24k nodes
- A* with Euclidean distance heuristic for distance-weighted routing
- Bidirectional search for faster convergence on long routes
- All runs in a Web Worker, posts result back to main thread
- Handles disconnected graph: if no path exists (unreachable system, offline gates), return "no route found" with explanation

### Blueprint Calculator

Integrated manufacturing tool using extracted blueprint data:

- Search blueprints by name or output product
- Bill of materials tree: recursive material requirements
- Quantity calculator: scale materials for batch production
- Material shopping list: aggregate materials across multiple blueprints
- Type info: display item stats, group, category from extracted data

### Data Dependencies

| Feature | Required Static Data | Source |
|---|---|---|
| Star map | `stellar_systems.json` (24k systems with x,y,z) | VULTUR extraction |
| Jump connections | `jumps` data (6,876 connections) | VULTUR `stellar_cartography.json` or Scetrov `static_data.db` |
| System details | `solarsystemcontent.static` (planets, moons, stations) | VULTUR extraction or direct parsing |
| Region/constellation labels | `stellar_regions.json`, `stellar_constellations.json` | VULTUR extraction |
| Route planner (base) | Same as star map + jumps | — |
| Route planner (smart gates) | Live on-chain gate data | Sui RPC queries |
| Blueprint calculator | `blueprints_bom.json`, `materials_to_blueprints.json` | VULTUR extraction |
| Type names | `type_names_all.json` | VULTUR extraction |
| Item stats | `spacecomponentsbytype` (9.5MB) | VULTUR FSDBinary extraction |

---

## Data Sources (Phase 1)

The tool reads from three data layers. The exact API surface for Cycle 5 (Sui migration, launching March 11 2026) is **TBD until launch** — the old Ethereum-era World API (v0.1.38) will likely change significantly. The design must be flexible.

### Layer 1: EVE Frontier World API (TBD — pending Cycle 5 launch)

CCP runs a REST API gateway (previously at `blockchain-gateway-stillness.live.tech.evefrontier.com`). The old API had endpoints for assemblies, characters, solar systems, killmails, types, tribes, and fuels. The new Sui-era API is expected to be similar but details are unknown.

**Known from old API (may change):**

| Endpoint Pattern | Data | Auth? |
|---|---|---|
| `GET /v2/smartassemblies` | All assemblies (paginated) | No |
| `GET /v2/smartassemblies/{id}` | Single assembly detail | No |
| `GET /v2/smartcharacters/{address}` | Character profile | No |
| `GET /v2/smartcharacters/me/jumps` | Your jump history | **Yes (Bearer token)** |
| `GET /v2/killmails` | All killmails (paginated) | No |
| `GET /v2/solarsystems` | Solar systems with coordinates | No |
| `GET /v2/types` | Item type registry | No |
| `GET /v2/tribes` | Tribe data | No |
| `GET /v2/fuels` | Fuel type info | No |

**Critical uncertainty — assembly locations:**

The old API returned `location(x,y,z)` for all assemblies publicly. However, the Sui contracts now store locations as **Poseidon2 hashes**, a deliberate privacy decision. The new API almost certainly will NOT expose coordinates for all assemblies publicly. Expected behavior:

| Data | Likely Public? | Reasoning |
|---|---|---|
| Assembly existence, type, status, fuel | Yes | On-chain, already public |
| Your own assembly locations | Authenticated only | Via `/me/` endpoints |
| Other players' assembly locations | **No** | Defeats purpose of location hashing |
| SSU inventory contents | Uncertain | On-chain but may be gated |
| Solar system data | Yes | Static, non-strategic |
| Killmails | Yes | On-chain events |

**Action:** Investigate API on launch day. Build the data layer with an adapter pattern so the API client can be updated without rewriting the rest of the tool.

### Layer 2: Sui RPC (direct chain queries)

All on-chain data is readable by anyone via Sui RPC. No authentication needed. This is the fallback for anything the World API doesn't expose, and the primary source for real-time event subscriptions.

| Data | Method |
|---|---|
| Assembly state (type, status, owner) | `sui_getObject` |
| Assembly fuel status | `sui_getObject` + dynamic fields |
| Fuel events (deposit, burn, etc.) | `sui_queryEvents` (FuelEvent) |
| Location hash (NOT coordinates) | `sui_getObject` → Location struct |
| Gate links | Gate contract state queries |
| SSU inventory contents | Dynamic field queries on SSU objects |
| Player profiles | Character contract object queries |
| Killmails | `sui_queryEvents` (killmail events) |
| EVE token balances | `sui_getCoins` |
| Transaction history | `sui_queryTransactionBlocks` |
| Jump events | `sui_queryEvents` (JumpEvent) |

**Note:** Sui JSON-RPC is deprecated — migration to GraphQL or gRPC required by April 2026. The `@mysten/sui` SDK provides `SuiGrpcClient` and `SuiGraphQLClient` with the same API surface as `SuiClient`. Our `@tehfrontier/sui-client` wrapper abstracts the transport — migrating off JSON-RPC is a config change (swap client constructor), not a rewrite.

All queries go directly to a public Sui RPC endpoint from the browser. The RPC node sees your IP and what objects you're querying, but:
- It doesn't know *why* you're querying
- You can use any RPC node (not just CCP's)
- You can rotate endpoints or use a VPN for additional privacy

**Rate limiting and query batching:**
Public Sui RPC endpoints enforce rate limits (e.g., 100 requests per 30 seconds on testnet). With multiple targets, owned assemblies, and event subscriptions, individual queries can quickly exceed this. Strategy:
- **Query queue** with priority levels: user-triggered (immediate), polling (normal), background (low)
- **Multi-object batching** — `sui_multiGetObjects` for bulk state reads instead of individual `sui_getObject` calls
- **Pagination** — `suix_getOwnedObjects` returns paginated results (default 50/page). Auto-paginate and aggregate.
- **Exponential backoff** on rate limit errors (HTTP 429)
- **Configurable poll intervals** — deployable fuel: 60s, target tracking: 30s-5min, killmails: 5min
- **React Query deduplication** — TanStack React Query prevents duplicate in-flight requests for the same data

### Layer 3: Client-Side Data (logs, static files, manual input)

Data that never touches a network:

| Source | Data | Access Method |
|---|---|---|
| Client log files | System visits, local chat, mining yields, DPS, loot | File System Access API |
| Static game data (ResFiles) | Star map, type registry, blueprints | Pre-extracted JSON import |
| Manual input | Location annotations, notes, threat assessments | User entry |
| Physical observation | Assembly locations (coordinates) | Manual or from logs |

### Data Source Priority

When the same data is available from multiple sources, prefer:
1. **World API** — pre-indexed, friendlier format, likely includes derived data
2. **Sui RPC** — authoritative on-chain state, real-time events
3. **Client logs** — unique data not available elsewhere (coordinates, activity metrics)
4. **Manual input** — user knowledge, annotations, threat assessments

### Offline Behavior & Data Freshness

When the network is unavailable (Sui RPC or World API unreachable):
- **Cached data** served normally — star map, routes, blueprints, saved intel all work offline
- **Stale indicators** — chain-sourced data shows "last updated: X ago" when it can't be refreshed
- **Automatic retry** — React Query retries failed queries with exponential backoff
- **Offline banner** — subtle indicator in the title bar when connectivity is lost
- **Queued operations** — pending poll schedules resume automatically on reconnect
- **PWA Service Worker** — entire app shell and static data cached; app loads instantly with no network

---

## Client Log Parsing

### Overview

The EVE Frontier game client writes log files locally. By granting the browser access to the log directory (one-time prompt via the File System Access API), the tool can automatically parse these logs to extract gameplay intel without any manual data entry.

### Known Log Locations (Windows)

| Location | Contents | Status |
|---|---|---|
| `%APPDATA%\EVE Frontier\logs\` | **Launcher logs** — app startup, migrations, auth, updates | Confirmed (analyzed) |
| `%APPDATA%\EVE Frontier\logs\analytics\` | Launcher UI click tracking (`clicks.json`) | Confirmed |
| `%LOCALAPPDATA%\EVE Frontier\logs\` | **Game client logs** — chat, combat, mining (expected) | TBD — Cycle 5 not launched yet |

**Note:** The launcher logs at `%APPDATA%` are NOT useful for intel — they only contain launcher lifecycle events. The actual game logs (chat, combat, mining) are expected at `%LOCALAPPDATA%` but this path needs verification when Cycle 5 launches on March 11.

### Launcher Log Format (Analyzed)

Format: `YYYY-MM-DD HH:MM:SS.mmm    {source}    {level}:    [{component}] {message}`

Example lines:
```
2026-02-21 15:43:21.319    app     info:    [migrations] Running state migrations from 1 to 1
2026-02-21 15:43:31.768    app     info:    [launcher:GameStartup] Starting game...
2026-02-21 15:43:31.780    app     info:    [analytics:events:game-start] action:game-start-to-login
```

Fields:
- **Timestamp:** ISO-like with milliseconds
- **Source:** `app`, `browser`, `main`, etc.
- **Level:** `info`, `warn`, `error`
- **Component:** bracketed identifier like `[migrations]`, `[launcher:GameStartup]`
- **Message:** freeform text

Log rotation: `.log-audit.json` tracks rotation policy (14-day retention, SHA-256 hashing of rotated files).

### Character Settings Data (Binary)

Location: `%LOCALAPPDATA%\CCP\EVE\c_ccp_eve_frontier_stillness_stillness.servers.evefrontier.com\settings_Default\`

These `.dat` files are binary but contain embedded readable strings including:
- **Solar system IDs** (e.g., 30001565, 30014958) — reveals systems visited
- **Player UUIDs** — contacts or recently seen players
- **Chat channel names** — local, corp, custom channels (e.g., "DMNA Public")
- **Item/ship type names** — reveals equipment used

These could be parsed for supplementary intel (last-visited systems, known contacts) but are low priority since game logs will be more structured.

### Game Log Format (TBD — Cycle 5 Not Yet Launched)

Actual game logs (chat, combat, mining) are expected to follow EVE-family patterns but the exact format, file naming convention, and directory structure are unknown until Cycle 5 launches. The log parser must be designed with a pluggable parser architecture to accommodate the actual format once discovered.

**Expected log types (based on EVE Online patterns):**
- Chat logs (per-channel text files with timestamps, speaker, message)
- Game/combat logs (timestamped events for damage, mining, loot)
- Notification logs (system messages, alerts)

**Day-1 investigation plan:** On March 11, launch the game, perform various activities (chat, mine, combat), and document the exact log file formats, naming patterns, and content structure.

### File System Access

**Chromium (Chrome, Edge, Brave):** Directory picker + persistent handle for auto-watching.

```typescript
// One-time: user picks their EVE Frontier log directory
const dirHandle = await window.showDirectoryPicker();

// Persist the handle across sessions (stored in IndexedDB)
await db.settings.put({ key: 'logDirHandle', value: dirHandle });

// On subsequent launches, re-request permission
const savedHandle = await db.settings.get('logDirHandle');
const permission = await savedHandle.value.requestPermission({ mode: 'read' });
if (permission === 'granted') {
  // Start watching for new log entries
}
```

**Firefox fallback:** File System Access API is not available. Firefox users manually select log files via `<input type="file">` or drag-and-drop. No continuous watching — user re-imports files when they want updated data. Same parser pipeline processes the files, just triggered manually instead of automatically.

**Firefox desktop PWA limitations:** Beyond log parsing, Firefox desktop does not support installing PWAs at all. Firefox users experience the tool as a regular web page — no standalone window, no taskbar icon, no badge count (`navigator.setAppBadge` unsupported), no jump list shortcuts, no window controls overlay, and limited Notification API support. Core features (star map, chain queries, routing, blueprints, intel) all work, but the native desktop integration is Chromium-only. This is an additional reason to recommend Chrome/Edge for the best experience.

```typescript
// Firefox: manual file selection
const input = document.createElement('input');
input.type = 'file';
input.multiple = true;
input.accept = '.txt,.log';
input.onchange = async (e) => {
  const files = (e.target as HTMLInputElement).files;
  for (const file of files) {
    const content = await file.text();
    const entries = parseLogEntries(content);
    await storeEntries(entries);
  }
};
```

### Data Extracted from Logs

| Log Source | Intel Extracted | Use Case |
|---|---|---|
| **Chat log** | System names visited, timestamps | Auto-build travel history, map your route |
| **Chat log** | Player names in local chat | Track who was in each system, when |
| **Chat log** | Chat messages | Searchable comms history |
| **Chat log** | Dragged object links (system, player, ship) | Intel channel integration — real-time threat feed |
| **Game log** | Mining yield events | Calculate ore/hr, ISK/hr mining rates |
| **Game log** | Damage dealt/received | DPS calculations, weapon comparisons |
| **Game log** | Loot/salvage drops | Income tracking per session |
| **Game log** | Ship/module events | Fit effectiveness analysis |

### Log Watcher

The tool polls the log directory on an interval (e.g., every 5-10 seconds) for new or modified files. It tracks the last-read byte offset per file so it only processes new lines. This runs in a Web Worker to avoid blocking the UI.

```typescript
// Simplified log watcher loop (runs in Web Worker).
// The dirHandle is obtained via showDirectoryPicker() on the main thread (requires user gesture),
// then transferred to this Worker via worker.postMessage(dirHandle) — FileSystemDirectoryHandle
// is structured-cloneable. The Worker can use the handle with the permission already granted
// on the main thread. If permission is revoked, it must be re-requested on the main thread
// (requires user gesture) — Workers cannot call requestPermission() themselves.
async function watchLogs(dirHandle: FileSystemDirectoryHandle) {
  for await (const [name, fileHandle] of dirHandle.entries()) {
    if (fileHandle.kind !== 'file') continue;
    const file = await fileHandle.getFile();
    let lastOffset = await getLastOffset(name);
    if (file.size < lastOffset) {
      // File was rotated/truncated — reset and re-process from start
      lastOffset = 0;
    }
    if (file.size > lastOffset) {
      const newContent = await file.slice(lastOffset).text();
      const entries = parseLogEntries(newContent);
      await storeEntries(entries);
      await setLastOffset(name, file.size);
    }
  }
}
```

### Real-Time Monitoring Architecture

The log watcher runs as a continuous background process while the tool is open:

```
┌─────────────────────────────────────────────────┐
│  Main Thread                                     │
│  ┌───────────┐    ┌──────────┐    ┌──────────┐  │
│  │ React UI  │◄───│ Zustand  │◄───│ Dexie    │  │
│  │           │    │ Store    │    │ (live     │  │
│  │           │    │          │    │  queries) │  │
│  └───────────┘    └──────────┘    └────▲─────┘  │
│                                        │         │
│  ┌─────────────────────────────────────┼───────┐ │
│  │  Web Worker (Log Monitor)           │       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌─────┴────┐  │ │
│  │  │ File     │─►│ Parser   │─►│ Store    │  │ │
│  │  │ Poller   │  │ Pipeline │  │ (write   │  │ │
│  │  │ (5-10s)  │  │          │  │  to DB)  │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Cross-context Dexie access:** Both the main thread and Web Worker create their own Dexie instance pointing to the same IndexedDB database. Dexie uses `BroadcastChannel` to notify the main thread's live queries when the worker writes new data — this is what makes "new data appears instantly in the UI" work without manual polling or refresh.

- **Web Worker** handles file I/O and parsing off the main thread
- **Dexie live queries** automatically update the UI when new data is written
- **Parser pipeline** is pluggable — register parsers per log type/format
- **Byte offset tracking** per file ensures only new content is processed
- **File handle persistence** via IndexedDB avoids re-prompting the user

### Privacy Note

Log parsing happens entirely in the browser. The raw log files are never uploaded, copied, or transmitted. Only the parsed, structured intel entries are stored in the local database.

---

## Intel Channel Integration

### Overview

EVE Frontier players use in-game chat channels as real-time intel networks. Scouts and allies drag system links, player links, and other game objects into designated "intel channels" to report enemy movement, system status, and threats. These links are clickable in-game — they reference specific game objects (solar systems, characters, items, assemblies).

By monitoring the chat log files for these channels, the tool can automatically parse the dragged links into structured intel entries and feed them into a real-time intel dashboard. This transforms a wall of scrolling chat text into an actionable, map-integrated, time-decaying intelligence feed.

### How Intel Channels Work (EVE-Family Pattern)

In EVE Online (and expected in EVE Frontier), intel channels follow a well-established pattern:

1. **Scouts** sit in systems watching for hostile activity
2. When they see something, they **drag the solar system name** from the game UI into the chat channel — this creates a clickable link
3. They may also drag **player names**, **ship types**, or **tribe links**
4. Other players watch the channel and react to reports
5. Reports are implicitly time-limited — a report from 30 minutes ago is stale

**Example chat intel messages:**
```
[15:42:31] ScoutAlpha > <systemlink:30001234>Jita</systemlink> 3 reds
[15:42:45] ScoutAlpha > <playerlink:0x1a2b...>HostilePlayer</playerlink> <systemlink:30001234>Jita</systemlink> in <shiplink:84321>Destroyer</shiplink>
[15:43:12] ScoutBeta > <systemlink:30005678>Amarr</systemlink> clear
[15:44:01] ScoutAlpha > <systemlink:30001234>Jita</systemlink> spike +5
```

**Note:** The exact link markup format for EVE Frontier Cycle 5 is TBD. The above is illustrative based on EVE Online patterns. The actual format must be reverse-engineered on launch day from the chat log files.

### Chat Link Parsing

The parser must detect and extract structured links embedded in chat messages. EVE-family games typically use XML-like or custom markup for object links in chat.

**Expected link types:**

| Link Type | What It References | Intel Value |
|---|---|---|
| **System link** | Solar system ID + name | "Enemy was seen in this system" — primary intel |
| **Player link** | Character ID/address + name | "This specific player was reported" — target identification |
| **Ship/type link** | Item type ID + name | "Flying this ship class" — threat assessment |
| **Tribe link** | Tribe ID + name | "This group is active" — organizational intel |
| **Assembly link** | Assembly object ID | "This structure was spotted" — asset discovery |

**Parser architecture:**

```typescript
// Link parser — extracts structured links from chat messages
interface ChatLinkParser {
  // Detects if a message contains game object links
  hasLinks(message: string): boolean;

  // Extracts all links from a message
  parseLinks(message: string): ChatLink[];

  // Classifies the intel significance of a message
  classifyMessage(message: string, links: ChatLink[]): {
    severity: 'info' | 'warning' | 'critical';
    primarySystem?: string;     // main system referenced
    reportedPlayers: string[];  // players mentioned
    shipTypes: string[];        // ship types mentioned
    freeText: string;           // non-link text (e.g., "3 reds", "clear", "spike +5")
  };
}

// Example link regex patterns (TBD — actual format from launch day investigation)
const LINK_PATTERNS = {
  system: /<systemlink:(\d+)>([^<]+)<\/systemlink>/g,
  player: /<playerlink:([^>]+)>([^<]+)<\/playerlink>/g,
  ship:   /<shiplink:(\d+)>([^<]+)<\/shiplink>/g,
  tribe:  /<tribelink:([^>]+)>([^<]+)<\/tribelink>/g,
};
```

### Real-Time Intel Dashboard

The intel channel dashboard is the centerpiece of this feature — a live, continuously updating view of parsed intel from monitored chat channels.

```
┌────────────────────────────────────────────────────────────────┐
│  Intel Channel Dashboard                                       │
│                                                                │
│  ┌─ Channel Selector ─────────────────────────────────────┐    │
│  │ [✓] Alliance Intel  [✓] Scout Channel  [ ] Local Chat  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌─ Live Intel Feed ──────────────────────────┐ ┌─ Map ──────┐│
│  │                                             │ │            ││
│  │ 🔴 15:44 ScoutAlpha                         │ │  Systems   ││
│  │    Jita — spike +5                          │ │  flash on  ││
│  │    [Jita] [HostilePlayer] [Destroyer]       │ │  report    ││
│  │                                             │ │            ││
│  │ 🟢 15:43 ScoutBeta                          │ │  Color =   ││
│  │    Amarr — clear                            │ │  threat    ││
│  │    [Amarr]                                  │ │  level     ││
│  │                                             │ │            ││
│  │ 🔴 15:42 ScoutAlpha                         │ │  Fade =    ││
│  │    Jita — 3 reds                            │ │  report    ││
│  │    [Jita]                                   │ │  age       ││
│  │                                             │ │            ││
│  │ ⚪ 15:38 ScoutGamma (stale)                  │ │            ││
│  │    Hek — 1 neutral                          │ │            ││
│  │                                             │ │            ││
│  └─────────────────────────────────────────────┘ └────────────┘│
│                                                                │
│  ┌─ System Summary ───────────────────────────────────────┐    │
│  │ Jita: 🔴 HOSTILE (5 reds, last report 1m ago)           │    │
│  │ Amarr: 🟢 CLEAR (last report 2m ago)                    │    │
│  │ Hek: ⚪ STALE (last report 7m ago)                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

**Dashboard features:**

- **Live feed** — new reports appear instantly as chat logs are parsed (via Dexie live queries)
- **Channel filtering** — toggle which channels to monitor, mark channels as intel-designated
- **Intel aging** — reports automatically transition through status levels:
  - **Active** (0-15 min) — full color, prominent display
  - **Stale** (15-30 min) — dimmed, moved to secondary section
  - **Expired** (30-60 min) — hidden from feed, archived in history
  - Aging timers are configurable per channel or globally
- **System summary** — aggregated threat status per system across all reports
- **Clickable links** — click a system to zoom to it on the star map, click a player to open their intel profile
- **Sound alerts** — optional audio notification for new reports matching filters (e.g., "alert me for any report in my home system")
- **Visual alerts** — browser notification API for reports when the tool is in the background

### Star Map Integration

Intel channel reports are overlaid on the 3D star map in real time:

- **System flash** — when a system is reported, the star flashes/pulses briefly on the map
- **Threat color** — reported systems change color based on threat level:
  - Red: hostile activity reported
  - Yellow: neutral/unknown activity
  - Green: explicitly reported clear
  - Fading: color intensity decreases as the report ages
- **Report count badge** — systems with active reports show a count indicator
- **Click interaction** — clicking a highlighted system shows the intel reports for that system
- **Animated decay** — threat indicators visually fade as reports expire, providing intuitive time-awareness

### Intel Aging System

Reports have a lifecycle that reflects the time-sensitive nature of intel:

```typescript
interface IntelAgingConfig {
  activeMinutes: number;     // default: 15 — report is current and reliable
  staleMinutes: number;      // default: 30 — report is aging, less reliable
  expiredMinutes: number;    // default: 60 — report is archived, hidden from live feed
  // NOTE: Actual record deletion is handled by the global data retention policy
  // (see "IndexedDB Storage Quota" section — chatIntel default: 30 days).
  // Do NOT duplicate deletion logic here — aging config controls UI visibility only.
}

// Status transitions (run on a timer, e.g., every 30 seconds)
function updateIntelStatus(entry: ChatIntelEntry, config: IntelAgingConfig): ChatIntelStatus {
  const ageMinutes = (Date.now() - entry.createdAt) / 60000;
  if (ageMinutes < config.activeMinutes) return 'active';
  if (ageMinutes < config.staleMinutes) return 'stale';
  return 'expired';
}
```

### Player Cross-Referencing

When a player link is parsed from an intel channel, the tool automatically:

1. **Looks up existing PlayerIntel** — does this player already have a profile?
2. **Updates last seen** — records when and where this player was last reported
3. **Applies threat level** — if the player has a known threat classification, the report inherits it
4. **Creates new profile** — if unknown, creates a stub PlayerIntel entry marked as `source: 'chat'`
5. **Builds activity pattern** — over time, builds a picture of which systems a player frequents

### Processing Pipeline

The intel channel parser extends the existing log watcher architecture:

```
┌───────────────────────────────────────────────────────────────┐
│  Log Monitor Web Worker                                        │
│                                                                │
│  File Poller (5-10s)                                           │
│       │                                                        │
│       ▼                                                        │
│  ┌──────────────────────────────────┐                          │
│  │  Parser Router                    │                          │
│  │  ├── Chat Log? ──► Chat Parser    │                          │
│  │  │                    │           │                          │
│  │  │               ┌───▼────────┐  │                          │
│  │  │               │ Link       │  │                          │
│  │  │               │ Detector   │  │                          │
│  │  │               └───┬────────┘  │                          │
│  │  │                   │           │                          │
│  │  │          ┌────────▼────────┐  │                          │
│  │  │          │ Intel Channel?  │  │                          │
│  │  │          │ (channel config)│  │                          │
│  │  │          └──┬──────────┬───┘  │                          │
│  │  │          Yes│          │No    │                          │
│  │  │     ┌──────▼──────┐   │      │                          │
│  │  │     │ Link Parser │   │      │                          │
│  │  │     │ + Classifier│   │      │                          │
│  │  │     └──────┬──────┘   │      │                          │
│  │  │            │          │      │                          │
│  │  │     ┌──────▼──────────▼───┐  │                          │
│  │  │     │ Store to Dexie      │  │                          │
│  │  │     │ (chatIntel table    │  │                          │
│  │  │     │  or activities)     │  │                          │
│  │  │     └─────────────────────┘  │                          │
│  │  │                              │                          │
│  │  ├── Game Log? ──► Game Parser  │                          │
│  │  └── Other? ──► Generic Parser  │                          │
│  └──────────────────────────────────┘                          │
└───────────────────────────────────────────────────────────────┘
```

### Configuration

```typescript
interface IntelChannelConfig {
  // Which channels to treat as intel channels
  channels: {
    name: string;               // channel name as it appears in log files
    enabled: boolean;           // whether to parse this channel
    agingConfig?: IntelAgingConfig; // per-channel aging overrides
  }[];

  // Alert settings
  alerts: {
    enabled: boolean;
    sound: boolean;             // play audio on new report
    notification: boolean;      // browser Notification API
    filterSystems?: string[];   // only alert for these systems (e.g., home systems)
    filterPlayers?: string[];   // only alert for these specific players
    minSeverity: 'info' | 'warning' | 'critical';
  };

  // Map integration
  mapOverlay: {
    enabled: boolean;
    flashDuration: number;      // ms to flash system on report (default: 3000)
    showReportCount: boolean;   // show badge with active report count
  };
}
```

### Privacy Considerations

- Chat log parsing happens entirely in the browser — no chat content is transmitted
- Intel channel names and report content are stored locally in IndexedDB
- In Phase 2 (P2P), individual intel reports can be selectively shared with allies
- The tool never writes to or modifies chat logs — read-only access
- **Sanitization** — `rawMessage` is always text-rendered (React's default JSX escaping), never via `dangerouslySetInnerHTML`. Parsed links are rendered from structured `ChatLink` objects (typed fields: `linkType`, `linkId`, `displayText`), not from raw markup strings. This prevents XSS via crafted chat content.
- Users control which channels are monitored via the configuration UI

---

## Multi-Box Architecture

### Overview

Multi-boxing — running multiple EVE Frontier accounts simultaneously on separate machines — is a core gameplay pattern. Each box runs its own game client and its own Periscope instance. Multi-box sync unifies all intel into a single seamless view while each instance centers on its own active character.

### Two Trust Tiers

Multi-box sync shares the same WebRTC P2P transport layer as intel sharing with allies, but with different trust and data access levels:

```
┌──────────────────────────────────────────────────────────┐
│                P2P Connection Layer (WebRTC)               │
├────────────────────────────┬─────────────────────────────┤
│    Multi-Box Peer          │    Intel Peer               │
│    (your alts)             │    (other players)          │
├────────────────────────────┼─────────────────────────────┤
│  Trust: FULL               │  Trust: SELECTIVE           │
│  Sync: All data            │  Sync: Tagged intel only    │
│  Direction: Bidirectional  │  Direction: Pub/sub         │
│  Merge: CRDT replication   │  Merge: Append-only         │
│  Identity: Same player     │  Identity: Separate players │
│  Access: Complete database │  Access: Filtered by rules  │
└────────────────────────────┴─────────────────────────────┘
```

### Data Flow

Each Periscope instance maintains its own IndexedDB and is fully functional standalone. Multi-box sync replicates data bidirectionally so all instances converge to the same state.

```
Box A (Main)               Box B (Scout Alt)          Box C (Hauler Alt)
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│  Periscope        │     │  Periscope        │     │  Periscope        │
│  ┌─────────────┐  │     │  ┌─────────────┐  │     │  ┌─────────────┐  │
│  │ IndexedDB   │  │     │  │ IndexedDB   │  │     │  │ IndexedDB   │  │
│  │ (full copy) │◄─┼─────┼─►│ (full copy) │◄─┼─────┼─►│ (full copy) │  │
│  └─────────────┘  │     │  └─────────────┘  │     │  └─────────────┘  │
│                   │     │                   │     │                   │
│  Chat Logs (Main) │     │  Chat Logs (Alt1) │     │  Chat Logs (Alt3) │
│  Chain: Main addr │     │  Chain: Alt1 addr │     │  Chain: Alt3 addr │
│                   │     │                   │     │                   │
│  UI centered on:  │     │  UI centered on:  │     │  UI centered on:  │
│  Main's location  │     │  Alt1's location  │     │  Alt3's location  │
└───────────────────┘     └───────────────────┘     └───────────────────┘
        │                         │                         │
        └─────────────────────────┴─────────────────────────┘
                    Full CRDT Sync (all data)
```

**What syncs between multi-box peers (everything):**
- Intel entries (assemblies, players, locations, killmails, notes)
- Chat intel reports (parsed from any box's local chat logs)
- Watchlists and target profiles
- Bookmarks and annotations
- Deployable management data (all accounts' assemblies)
- Travel history (combined fog of war)
- Settings shared across instances (alert configs, intel channel configs)

**What stays local per instance:**
- Active character identity (which account this instance is centered on)
- Raw chat log file handles (File System Access API handles are per-browser)
- Window position, UI preferences, view state
- Encryption passphrase (never synced — each instance uses the same passphrase set by the user)

### Centered on Active Account

Each Periscope instance knows which character is "active" on that box. The UI pivots around that character while displaying the unified intel from all alts:

| Feature | Behavior |
|---|---|
| **Star map center** | Zooms to the active character's current system |
| **Threat alerts** | Prioritized by proximity to the active character |
| **Route planner** | Origin defaults to the active character's system |
| **Deployable fleet** | Shows ALL accounts' assemblies, active character's highlighted |
| **Fuel alerts** | Fires for ANY account's depleting assemblies |
| **Intel feed** | Unified — reports from all boxes' chat logs appear together |
| **Target tracking** | Shared — a target added on any box appears on all |
| **OPSEC dashboard** | Shows exposure for the active character's address |
| **Travel history** | Combined fog of war from all characters' movements |

**How "current system" is determined:**
The active character's current system is not readable from the chain (locations are hashed). It comes from:
1. **Parsed game logs** — the log parser detects system entry events and updates current system automatically (Chromium with directory watching)
2. **Manual selection** — user clicks a system on the star map and sets it as "current" (Firefox fallback, or if logs don't contain system entries)
3. **Intel channel** — if the active character appears in a local chat log for a system, that system is inferred as current

This is investigated on launch day (Step 7) when game log format is documented.

**Example scenario:**
- Main (Box A) is mining in system Alpha
- Scout alt (Box B) spots hostiles in system Beta
- Box B's chat log parser picks up the sighting and stores it
- CRDT sync pushes the intel entry to Box A and Box C
- Main's Periscope immediately shows the threat on the star map and fires a notification
- Hauler alt (Box C) sees the same threat and can reroute to avoid Beta

### Multi-Box Pairing

Pairing is a one-time setup per box pair, using the same WebRTC signaling mechanism as intel sharing:

1. **Box A** generates a pairing code (WebRTC offer + shared secret)
2. User copies the code to **Box B** (paste, QR scan, or LAN broadcast)
3. **Box B** responds with an answer code
4. Connection established — full sync begins
5. Pairing is persisted — reconnects automatically on subsequent launches

**LAN optimization:** For boxes on the same network (most common), the signaling can use direct IP:port without an external signaling relay. The pairing UI can detect local network peers via mDNS or manual IP entry.

### CRDT Sync Strategy

Multi-box sync uses CRDTs (Conflict-free Replicated Data Types) to ensure all instances converge without conflicts:

```typescript
// Sync fields live on IntelEntry (optional in Phase 1, required in Phase 2):
//   _hlc: string    — Hybrid Logical Clock timestamp (causal ordering)
//   _deleted: boolean — Tombstone for soft deletes
//   _origin: string  — Instance ID that created/last modified this entry
//
// HLC ensures causal ordering across instances without synchronized clocks.
// Tombstones ensure deletes propagate (can't just remove a record).
// See IntelEntry and SyncableEntry in the Data Model section.
```

**Sync protocol:**
1. On connect, each peer exchanges its latest HLC vector
2. Peers send all entries with HLC > partner's last-seen HLC
3. Receiving peer merges entries:
   - New entries (unknown ID): insert
   - Existing entries (known ID): keep the one with higher HLC
   - Deleted entries: apply tombstone, mark `_deleted: true`
4. During connected session, changes stream in real-time via DataChannel
5. On disconnect, changes queue locally and sync on reconnect

**Conflict resolution priority:**
- Last-write-wins based on HLC (most recent change takes precedence)
- Field-level merging where possible (e.g., updating `notes` and `threat` on the same player from different boxes merges both fields)
- Deletions always win over updates at the same HLC (prevent zombie entries)

**Tombstone garbage collection:**
Tombstoned records (`_deleted: true`) accumulate over time. GC strategy:
- Tombstones retained for a configurable period (default: 30 days)
- GC runs on app launch and periodically (daily)
- A tombstone is only purged after ALL known peers have synced past its HLC (tracked via per-peer HLC watermarks in `syncPeers` table)
- Solo mode (no peers): tombstones purged on next GC cycle
- Conservative: if unsure whether a peer has seen the tombstone, keep it

### Multi-Box Configuration

```typescript
interface MultiBoxConfig {
  // This instance's identity
  instanceId: string;        // Unique per Periscope instance (generated on first launch)
  instanceName: string;      // User-given name ("Main PC", "Scout Box", "Laptop")
  activeCharacter: {
    address: string;         // Sui address of the character on this box
    name?: string;           // Character display name
  };

  // Paired instances
  peers: {
    instanceId: string;
    instanceName: string;
    character: {
      address: string;
      name?: string;
    };
    lastSeen: number;        // Timestamp of last successful sync
    connectionMethod: 'lan' | 'manual' | 'relay';
    autoConnect: boolean;    // Reconnect automatically on launch
  }[];

  // Sync settings
  sync: {
    enabled: boolean;
    syncOnConnect: boolean;  // Full sync on reconnect (catch up)
    realtimeSync: boolean;   // Stream changes during connected session
    syncIntervalMs: number;  // Batch sync interval if not real-time (default: 1000)
  };
}
```

### Multi-Box UI

**Peer status bar** (always visible when multi-box is configured):
```
┌────────────────────────────────────────────────────────┐
│  🟢 Main PC (you)  │  🟢 Scout Box  │  🔴 Laptop     │
│  Char: TehFiend     │  Char: AltOne   │  Last: 2h ago  │
│  System: Alpha      │  System: Beta   │  Offline       │
└────────────────────────────────────────────────────────┘
```

**Settings → Multi-Box page:**
- Pair new box (generate/enter pairing code)
- View paired instances with sync status
- Set active character for this instance
- Toggle auto-connect per peer
- View sync queue size (pending changes)
- Unpair a box (stops sync, keeps local data)

### Privacy & Security

- Multi-box sync happens directly between your own machines (WebRTC DataChannel, DTLS encrypted)
- No data passes through any server (signaling can be manual copy-paste)
- If using a signaling relay, only the encrypted WebRTC offer/answer passes through it — no intel data
- Each instance can use encryption at rest independently (same passphrase recommended)
- Unpairing a box stops sync but does NOT delete data already synced to that instance
- If a box is lost/stolen, the threat is the same as losing any device with the data — encryption at rest mitigates this

---

## Static Data & Caching

### The Problem

Some game data (star map, item types, blueprints) is relatively static and large. Querying it live every time is wasteful. Additionally, some of this data is not available via API or chain — it must be extracted from the game client's resource files.

### Client ResFiles — Analyzed Structure

**Install location:** `C:\CCP\EVE Frontier\`
**ResFiles directory:** `C:\CCP\EVE Frontier\ResFiles\` (hashed subdirectory structure, e.g., `2e/2edadfca...`)
**Index file:** `C:\CCP\EVE Frontier\stillness\resfileindex.txt`

**Index format:**
```
res:{logical_path},{file_path},{hash},{size},{compressed_size}
```

Example:
```
res:/staticdata/starmapcache.pickle,res:/2e/2edadfca...,abc123,4200000,1800000
```

The `{logical_path}` is the meaningful name; `{file_path}` points to the actual file in the hashed directory tree.

### Key Static Data Files (Identified)

| Logical Path | Size | Format | Contents |
|---|---|---|---|
| `starmapcache.pickle` | 4.2 MB | Python pickle | Star map: regions, constellations, solar systems, jump connections, coordinates |
| `solarsystemcontent.static` | 84 MB | Binary (schema+static pair) | Detailed solar system content (celestials, stations, belts, etc.) |
| `constellations.schema` / `.static` | 275 KB | Binary (schema+static pair) | Constellation definitions |
| `regions.schema` / `.static` | 157 KB | Binary (schema+static pair) | Region definitions |
| `jumps.schema` / `.static` | 223 KB | Binary (schema+static pair) | Jump connections between solar systems |
| `blueprints.static` | 123 KB | Binary | Blueprint data |
| `blueprintsbymaterialtypeids.pickle` | 3.3 KB | Python pickle | Blueprint lookup by material type |
| `industry_blueprints.fsdbinary` | 22 KB | FSDBinary | Industry blueprint data |
| `groups.fsdbinary` | 71 KB | FSDBinary | Item group definitions |
| `categories.fsdbinary` | 2.3 KB | FSDBinary | Item category definitions |
| `spacecomponentsbytype.fsdbinary` | 9.5 MB | FSDBinary | Space component attributes by type ID |

### File Formats

| Format | Description | How to Read |
|---|---|---|
| `.pickle` | Python serialized objects | Python `pickle.loads()` → JSON export |
| `.fsdbinary` | CCP custom binary (typed columns, row-based) | Python decoder in VULTUR/eve-frontier-tools |
| `.schema` + `.static` | Paired schema definition + binary data | Schema defines column types; static contains rows |
| `.db` / `.sqlite` | SQLite databases | Standard SQLite readers |

### Data Sources

| Data | Primary Source | Fallback | Format |
|---|---|---|---|
| **Star map** (24,000+ systems) | Extracted from `starmapcache.pickle` | ef-map.com data | JSON (coordinates, names, regions, constellations, jumps) |
| **Type registry** (items, ships, modules) | Extracted from `.fsdbinary` files | VULTUR extracted JSON | JSON (typeId → name, category, attributes) |
| **Blueprints** (manufacturing) | Extracted from `blueprints.static` + industry files | VULTUR extracted JSON + SQLite | JSON/SQLite (inputs, outputs, costs) |
| **Solar system content** | Extracted from `solarsystemcontent.static` | Not available elsewhere | JSON (celestials, belts, stations per system) |
| **Assembly states** | Sui RPC (live) | Local cache | On-chain objects |
| **Killmails** | Sui RPC (live) | Local cache | On-chain events |

### Client Data Extraction (Tools & Sources)

Three sources for extracted static data, in order of preference:

**1. [VULTUR/eve-frontier-tools](https://github.com/VULTUR-EveFrontier/eve-frontier-tools)** — Most comprehensive
- Extracts ALL game data from client ResFiles (FSDBinary → JSON via game's own Python `.pyd` loaders)
- Uses game's `bin64/*Loader.pyd` modules + `localization_fsd_en-us.pickle` for name resolution
- Pipeline: `setup` → `index` → `fsdbinary` → `types` → `blueprints` → `stellar` (run via `npm run pipeline`)
- Requirements: Node.js 18+, Python 3.12, EVE Frontier client installed
- **Output files (`data/extracted/`):**

| File | Contents |
|---|---|
| `stellar_cartography.json` | Master file: all regions, constellations, systems with coordinates, jumps, celestials |
| `stellar_systems.json` | 24,026 solar systems with `center: [x,y,z]`, `regionId`, `constellationId`, `security`, `navigation.neighbours`, `navigation.stargates`, `celestials` |
| `stellar_constellations.json` | Constellations with member system IDs |
| `stellar_regions.json` | Regions with member constellation/system IDs |
| `stellar_labels.json` | Combined name labels for systems, constellations, regions |
| `type_names_all.json` | Complete type ID → name mapping: `{ typeID: "name" }` |
| `type_names_published.json` | Published types only |
| `types_by_group.json` | Types grouped by groupID with `{ typeID, name, basePrice, volume, published }` |
| `blueprints_bom.json` | Blueprint bill of materials: `{ blueprintName, materials: [{typeID, name, quantity}], products: [{typeID, name, quantity}] }` |
| `materials_to_blueprints.json` | Reverse BOM: material → blueprints that use it |
| `type_extraction_summary.json` | Stats: totalTypes, namedTypes, publishedTypes, totalGroups |
| `bom_summary.json` | Blueprint statistics |
| `pipeline_results.json` | Extraction audit log |

**2. [Scetrov/evefrontier_datasets](https://github.com/Scetrov/evefrontier_datasets)** — Pre-built SQLite database
- Published as GitHub releases (latest: `e6c4`, 31.4 MB)
- SQLite `static_data.db` with tables: `SolarSystems`, `Jumps`, `Planets`, `Moons`, `NpcStations`
- Columns: `solarSystemId`, `name`, `centerX`, `centerY`, `centerZ`
- Also includes `ship_data.csv` and `icons.zip`
- Used by frontier-reapers/starmap as their data source
- **Advantage:** No extraction needed — just download the release
- **Disadvantage:** Fewer data types than VULTUR (no blueprints, no type registry, no space components)

**3. [frontier-reapers/frontier-static-data](https://github.com/frontier-reapers/frontier-static-data)** — Archived
- **Status: Archived (Nov 2024).** Superseded by Scetrov/evefrontier_datasets + ProtoDroidBot/Phobos
- Simple Python tool that extracts `starmapcache.pickle` → JSON via `jsonpickle`
- User has previously used this tool
- Output preserves Python object types (less clean than VULTUR's processed JSON)

**Related: [frontier-reapers/starmap](https://github.com/frontier-reapers/starmap)** — Active web star map
- Consumes Scetrov SQLite DB and produces optimized binary assets (`.bin` files)
- Outputs: `systems_ids.bin`, `systems_positions.bin` (Float32Array), `systems_names.json`, `jumps.bin`, `systems_with_stations.bin`, `systems_black_holes.bin`, `manifest.json`
- Coordinate transform: meters → light-years, Rx(-90°) rotation
- Filters out V-### and AD### test/dev systems
- 98 systems with NPC stations, 3 black hole systems identified

### Extraction Strategy

Frontier Periscope does NOT run extraction pipelines itself (they require Python + game client). Instead:

1. **Bundled baseline** — The tool ships with a complete dataset extracted via VULTUR at build time. This includes the full star map (24k systems), type registry, blueprint BOM, and labels. Estimated size: ~5-8MB compressed for the core bundle (star map, jumps, type names, blueprints, labels). Detailed solar system content (84MB raw) is large — it is imported on-demand via the UI rather than bundled, keeping the initial download fast. Space components (~9.5MB raw, compresses well) ARE bundled since they're needed for the blueprint calculator and ship/module stats. The user has a fully functional star map and blueprint calculator immediately on first launch.
2. **Scetrov SQLite fallback** — If VULTUR extraction isn't available, the Scetrov `static_data.db` release provides star map + jumps + stations as a downloadable SQLite file (31MB). Convert to JSON externally (e.g., via a Node.js script using `better-sqlite3`) and import the resulting JSON files — avoids bundling `sql.js` (~1MB WASM) in the browser app.
3. **User updates** — When a game patch changes static data, the user can re-extract via VULTUR and re-import the JSON files. The tool shows the data version and last update date.
4. **API augmentation** — Where EVE Frontier API exposes the same data, prefer it over extracted data (fresher, authoritative).

**Build-time extraction pipeline:**
```
VULTUR/eve-frontier-tools (npm run pipeline)
    → data/extracted/*.json
        → copy to apps/periscope/public/data/
            → bundled with Vite build
                → loaded into IndexedDB on first launch
```

```typescript
// Static data tables are included in the main Dexie schema (see Data Model section).
// Future schema migrations use Dexie's versioning:
db.version(2).stores({
  // ... all existing tables carry forward ...
  newTable: 'id, someField',  // example: add new tables as needed
  cacheMetadata:   'key',  // tracks version, last update, source
});
```

### EVE Frontier API

In addition to Sui RPC for on-chain data, the tool queries the EVE Frontier API for game state data that isn't on-chain. API responses are cached locally with configurable TTLs.

| Endpoint | Data | Cache TTL |
|---|---|---|
| Solar system data | System names, coordinates, connections | Long (days) — rarely changes |
| Player data | Names, tribes, public profiles | Medium (hours) |
| Market/economy data | Prices, trade volumes | Short (minutes) |
| Live game state | Active players, events | No cache or very short |

API queries are made directly from the browser to the EVE Frontier API. The API operator sees your IP and query patterns (same privacy consideration as Sui RPC — mitigatable with VPN).

---

## Auto-Backup & Storage

### Default: IndexedDB

By default, all data is stored in the browser's IndexedDB. This is the simplest option — zero configuration, works immediately. Data lives in the browser profile directory.

### Auto-Backup Directory (File System Access API — Chromium only)

Primary storage is always IndexedDB (Dexie) — all queries, live updates, CRDT sync, and Web Worker access operate on Dexie. The custom directory feature provides **automated periodic backup**, not an alternative storage engine.

Use cases:
- **Google Drive / OneDrive / Dropbox** — pick a synced folder, backups auto-upload to cloud
- **External drive** — keep a backup on USB for portability
- **NAS / network share** — backup to a home server

### Implementation

```typescript
// User picks a backup directory (one-time setup in Settings)
const backupDir = await window.showDirectoryPicker({ mode: 'readwrite' });
await db.settings.put({ key: 'backupDirHandle', value: backupDir });

// Backup file format — returned by exportDatabase(), consumed by import and checkForNewerBackup
interface PeriscopeBackup {
  schemaVersion: number;       // matches Dexie db.version(N) — for compatibility checks
  appVersion: string;          // e.g., "0.1.0" — for informational display
  exportedAt: number;          // epoch ms — when this backup was created
  instanceId?: string;         // which Periscope instance created this backup
  tables: {                    // full dump of all intel tables (NOT static data — too large)
    deployables: DeployableIntel[];
    assemblies: AssemblyIntel[];
    players: PlayerIntel[];
    locations: LocationIntel[];
    killmails: KillmailIntel[];
    notes: NoteIntel[];
    activities: ActivityIntel[];
    chatIntel: ChatIntelEntry[];
    targets: TargetRecord[];
    targetEvents: TargetEventRecord[];
    inventoryDiffs: InventoryDiffRecord[];
  };
  settings: Record<string, unknown>[];  // user settings (key-value pairs)
  // Excluded tables (intentionally NOT backed up):
  // - solarSystems, constellations, regions, jumps, itemTypes, blueprints, spaceComponents
  //     → static data is too large and can be re-imported from VULTUR extraction
  // - cacheMetadata → tracks static data versions, regenerated on import
  // - logOffsets → machine-specific file byte offsets, not portable
  // - syncPeers, syncLog → Phase 2 sync state, instance-specific
}

// Periodic auto-backup (configurable: every 5 min, 30 min, or on change).
// "On change" mode: triggered by the `lastModified` Dexie hooks (see above). When those hooks
// fire, schedule a debounced backup (e.g., 30s delay to batch rapid writes). This avoids
// backing up on every single DB write while still capturing changes promptly.
async function autoBackup(dir: FileSystemDirectoryHandle) {
  const exported: PeriscopeBackup = await exportDatabase();
  // Overwrite the main backup file (createWritable truncates by default)
  const fileHandle = await dir.getFileHandle('periscope-backup.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(exported));
  await writable.close();
}

// On launch: check if backup dir has newer data than local IndexedDB
async function checkForNewerBackup(dir: FileSystemDirectoryHandle) {
  try {
    const backupFile = await dir.getFileHandle('periscope-backup.json');
    const file = await backupFile.getFile();
    const backup = JSON.parse(await file.text());
    // Verify schema version compatibility before offering import.
    // The backup includes schemaVersion (matches Dexie db.version(N)).
    // If the backup was created by a newer app version, warn the user.
    // If by an older version, Dexie's upgrade handlers will migrate on import.
    if (backup.schemaVersion > CURRENT_SCHEMA_VERSION) {
      // Prompt: "Backup was created by a newer app version. Update the app first."
      return;
    }
    if (backup.exportedAt > localDb.lastUpdated) {
      // Prompt: "Backup from [other device] is newer. Import?"
    }
  } catch {
    // Backup file missing, corrupted, or unreadable — skip silently
    // (user can manually import from Settings if needed)
  }
}

// localDb.lastUpdated — tracked via a 'lastModified' settings entry:
//   const lastMod = await db.settings.get('lastModified');
//   const localDb = { lastUpdated: lastMod?.value ?? 0 };
// Updated automatically via Dexie creating/updating hooks on all intel tables:
//   const INTEL_TABLES = ['deployables','assemblies','players','locations',
//     'killmails','notes','activities','chatIntel','targets','targetEvents','inventoryDiffs'];
//   INTEL_TABLES.forEach(name => {
//     db.table(name).hook('creating', () => db.settings.put({ key: 'lastModified', value: Date.now() }));
//     db.table(name).hook('updating', () => db.settings.put({ key: 'lastModified', value: Date.now() }));
//     db.table(name).hook('deleting', () => db.settings.put({ key: 'lastModified', value: Date.now() }));
//   });
// CURRENT_SCHEMA_VERSION = db.verno (Dexie's current schema version number)
```

### Storage Modes

| Mode | Primary Store | Backup | Cross-Device |
|---|---|---|---|
| **IndexedDB only** (default) | Browser IndexedDB | Manual export/import | No |
| **Auto-backup** (Chromium) | Browser IndexedDB | Auto-export to user-chosen directory | Yes, via cloud sync folder |

### Considerations

- **Chromium only** — File System Access API requires Chrome, Edge, Brave, or Opera. Firefox users use IndexedDB with manual export/import for backup.
- **Not a dual-write** — Dexie is the single source of truth. The backup directory is a periodic snapshot, not a real-time mirror. This avoids the complexity of maintaining two synchronized storage engines.
- **Google Drive sync** — works well for the single JSON backup file. `createWritable()` truncates then writes, minimizing the window for sync conflicts.
- **Encryption** — when using auto-backup, encryption at rest is especially important since the backup file is readable JSON on disk if unencrypted. Enable encryption in Settings before configuring auto-backup.

### IndexedDB Storage Quota

IndexedDB has browser-imposed storage limits. Strategy:
- **Request persistent storage** on PWA install: `navigator.storage.persist()` — prevents the browser from evicting data under storage pressure
- **Monitor quota** via `navigator.storage.estimate()` — display used/available in Settings
- **Data retention policies** — configurable per table for unbounded tables:
  - `activities`: default 90 days
  - `chatIntel`: default 30 days (expired reports)
  - `targetEvents`: default 60 days
  - `inventoryDiffs`: default 60 days
  - `syncLog`: purge after all peers have synced past the entry's HLC
- **Pruning** runs on app launch and daily, similar to tombstone GC

---

## PWA, Windows Integration & App Updates

### PWA Install

When installed via Chrome or Edge ("Install Frontier Periscope" prompt), the app becomes a standalone Windows application:

- **Own taskbar icon** — pinnable, separate from the browser
- **Own window** — no browser chrome (address bar, tabs). Feels like a native app.
- **Alt-Tab** — appears as its own application in the task switcher
- **Start menu** — listed as an installed application
- **Launch on startup** — users can configure via Windows Settings → Apps → Startup

### Taskbar Badge (Badging API)

Show a notification count on the taskbar icon for unread intel and alerts:

```typescript
// Update badge when new intel arrives or fuel alerts fire
async function updateBadge() {
  // Count "active" intel: reports created within the last activeMinutes (default 15 min)
  const activeThreshold = Date.now() - 15 * 60 * 1000; // Phase 1: hardcoded default. Phase 2: read from IntelAgingConfig in settings.
  const unreadIntel = await db.chatIntel.where('createdAt').above(activeThreshold).count();
  const fuelAlerts = await db.deployables
    .filter(d => d.fuel && d.fuel.depletionEta < Date.now() + 24 * 60 * 60 * 1000)
    .count();
  const targetAlerts = await db.targetEvents.where('timestamp').above(activeThreshold).count();
  const total = unreadIntel + fuelAlerts + targetAlerts;

  if (total > 0) {
    navigator.setAppBadge(total);
  } else {
    navigator.clearAppBadge();
  }
}

// Call on new data from log watcher, chain poller, etc.
// Debounce with ~2s delay to batch rapid writes (e.g., log parser processing multiple entries).
```

Use cases:
- **"3"** — 3 new intel channel reports since you last looked
- **"1"** — a deployable has < 24 hours of fuel remaining
- **"5"** — 5 target activity alerts (new assembly, killmail involvement, etc.)
- Clears when the user views the relevant dashboard

### Windows Toast Notifications (Notification API)

System-level notifications that appear even when the app is in the background:

```typescript
// Request permission once (on first launch or settings toggle)
const permission = await Notification.requestPermission();

// Intel channel alert
function notifyIntelReport(report: ChatIntelEntry) {
  if (permission !== 'granted') return;

  new Notification('Frontier Periscope — Intel Report', {
    body: `${report.reporter}: ${report.system ?? 'Unknown'} — ${report.rawMessage.slice(0, 80)}`,
    icon: '/icons/periscope-192.png',
    tag: `intel-${report.system ?? report.id}`,  // replaces previous notification for same system; falls back to report ID when system is undefined to prevent tag collision
    data: { view: '/intel', system: report.system },
  });
}

// Fuel alert
function notifyFuelWarning(deployable: DeployableIntel) {
  if (permission !== 'granted') return;
  if (!deployable.fuel?.depletionEta) return; // guard: fuel or depletionEta may be undefined
  new Notification('Frontier Periscope — Fuel Warning', {
    body: `${deployable.label}: fuel depletes in ${formatDuration(deployable.fuel.depletionEta - Date.now())}`,
    icon: '/icons/periscope-192.png',
    tag: `fuel-${deployable.objectId}`,
    data: { view: '/deployables', objectId: deployable.objectId },
  });
}

// Target activity
function notifyTargetActivity(target: TargetProfile, event: TargetEventType) {
  if (permission !== 'granted') return;
  new Notification('Frontier Periscope — Target Activity', {
    body: `${target.name ?? target.address.slice(0, 10)}: ${event}`,
    icon: '/icons/periscope-192.png',
    tag: `target-${target.address}`,
    data: { view: '/targets', address: target.address },
  });
}

// Handle notification click — focus existing window or open new
// NOTE: This runs in the Service Worker (sw.ts), not the main app context
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { view } = event.notification.data;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing app window if one is open
      for (const client of windowClients) {
        if ('navigate' in client) {
          return (client as WindowClient).navigate(view).then(() => client.focus());
        }
      }
      // No existing window — open new
      return clients.openWindow(view);
    })
  );
});
```

**Notification categories (user-configurable in Settings):**

| Category | Default | Example |
|----------|---------|---------|
| Intel channel reports | On | "ScoutAlpha: Jita — 3 reds" |
| Fuel warnings (< 24h) | On | "Main Gate Alpha: fuel depletes in 6h" |
| Fuel critical (< 6h) | On + sound | "Pipe Gate Beta: fuel depletes in 2h" |
| Target activity | On | "HostilePlayer deployed a new assembly" |
| Target dormancy | Off | "Target X has been dormant for 3 days" |
| Killmail involvement | On | "Your target was involved in a kill" |

### Jump List Shortcuts (PWA Manifest)

Right-clicking the taskbar icon shows quick-access shortcuts:

```json
{
  "name": "Frontier Periscope",
  "short_name": "Periscope",
  "description": "Privacy-first intel tool for EVE Frontier. See without being seen.",
  "start_url": "/",
  "display": "standalone",
  "display_override": ["window-controls-overlay"],
  "theme_color": "#0a0a0f",
  "background_color": "#0a0a0f",
  "icons": [
    { "src": "/icons/periscope-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/periscope-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/periscope-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    {
      "name": "Star Map",
      "short_name": "Map",
      "url": "/map",
      "icons": [{ "src": "/icons/shortcut-map.png", "sizes": "96x96" }]
    },
    {
      "name": "Intel Feed",
      "short_name": "Intel",
      "url": "/intel",
      "icons": [{ "src": "/icons/shortcut-intel.png", "sizes": "96x96" }]
    },
    {
      "name": "Fuel Alerts",
      "short_name": "Fuel",
      "url": "/deployables?filter=fuel-low",
      "icons": [{ "src": "/icons/shortcut-fuel.png", "sizes": "96x96" }]
    },
    {
      "name": "Watchlist",
      "short_name": "Targets",
      "url": "/targets",
      "icons": [{ "src": "/icons/shortcut-target.png", "sizes": "96x96" }]
    }
  ]
}
```

### Window Controls Overlay

With `display_override: ["window-controls-overlay"]`, the title bar area becomes available for app content. The app can render status indicators, a search bar, or the Periscope logo directly in the title bar — just like native desktop apps (VS Code, Spotify, etc.).

```css
/* Title bar area styling */
.titlebar {
  position: fixed;
  top: 0;
  left: env(titlebar-area-x, 0);
  width: env(titlebar-area-width, 100%);
  height: env(titlebar-area-height, 32px);
  -webkit-app-region: drag; /* draggable */
}

.titlebar-controls {
  -webkit-app-region: no-drag; /* clickable buttons within title bar */
}
```

The title bar could show:
- Periscope logo + app name
- Connection status (RPC connected / offline)
- Active intel count badge
- Quick search input

### App Updates

#### Update Strategy: Prompt-Based

Frontier Periscope is a static site served from a CDN. Updates are deployed by pushing new files — no installer, no app store. The Service Worker handles update detection and activation.

```
┌──────────────────────────────────────────────────────────┐
│  Update Flow                                              │
│                                                          │
│  1. Developer pushes new build to hosting                │
│  2. Browser checks for new Service Worker (on each visit)│
│  3. New SW downloads in background (user doesn't notice) │
│  4. App shows "Update available" prompt                  │
│  5. User clicks "Update Now" (or defers with "Later")   │
│  6. Page reloads with new version                        │
│  7. Dexie schema migration runs if needed                │
│                                                          │
│  User is NEVER interrupted during gameplay.              │
│  Updates only activate when the user chooses.            │
└──────────────────────────────────────────────────────────┘
```

#### vite-plugin-pwa Configuration

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'prompt',  // user controls when to update
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Cache static data files
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-data',
              expiration: { maxAgeSeconds: 30 * 24 * 60 * 60 }, // 30 days
            },
          },
        ],
      },
      manifest: {
        // ... manifest from above
      },
    }),
  ],
});
```

#### Update Prompt UI

```typescript
import { useRegisterSW } from 'virtual:pwa-register/react';

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="update-banner">
      <p>New version of Frontier Periscope available</p>
      <button onClick={() => updateServiceWorker(true)}>Update Now</button>
      <button onClick={() => /* dismiss */}>Later</button>
    </div>
  );
}
```

#### Version Tracking & Changelog

```typescript
const APP_VERSION = '0.1.0';  // or import from package.json at build time

// On app load, check if version changed (use Dexie settings table, not localStorage)
const prev = await db.settings.get('app-version');
if (prev?.value && prev.value !== APP_VERSION) {
  showChangelogModal(prev.value, APP_VERSION);
}
await db.settings.put({ key: 'app-version', value: APP_VERSION });
```

Version is visible in Settings alongside build date, data version, and storage usage.

#### Database Schema Migration

Dexie.js handles schema migrations natively. IndexedDB data survives app updates — it's browser storage, independent of the app files.

```typescript
const db = new Dexie('frontier-periscope');

// Initial schema
db.version(1).stores({
  deployables: 'id, objectId, assemblyType, status, label, updatedAt, *tags',
  // ... all Phase 1 tables
});

// Future migration: add a new table or index
db.version(2).stores({
  deployables: 'id, objectId, assemblyType, status, label, updatedAt, *tags',
  newTable: 'id, someField',
}).upgrade(tx => {
  // Migrate existing data if needed
  return tx.table('deployables').toCollection().modify(d => {
    d.newField = d.newField ?? 'default';
  });
});
```

Migrations run automatically when the app loads with a new schema version. Dexie queues them and applies them in order.

### Hosting & Deployment

The app is 100% static files — no server. Any static hosting works:

| Option | Cost | Auto-Deploy | CDN | Notes |
|--------|------|-------------|-----|-------|
| **GitHub Pages** | Free | GitHub Actions | Cloudflare CDN | Simple, repo-integrated |
| **Cloudflare Pages** | Free | Git push | Global edge | Fastest, generous limits |
| **Vercel** | Free tier | Git push | Edge network | Good DX, preview deploys |
| **Netlify** | Free tier | Git push | Global CDN | Easy, good PWA support |
| **Self-hosted** | Varies | Manual | None | Full control |

Recommended: **Cloudflare Pages** or **GitHub Pages** — free, fast, zero config after initial setup.

**Content Security Policy:** Strict CSP headers to prevent XSS and data exfiltration:
- `script-src 'self'` — no inline scripts, no external scripts
- `worker-src 'self'` — Web Workers for pathfinding and log parsing (same-origin only)
- `connect-src 'self' https://fullnode.testnet.sui.io:443` + EVE API domain — restrict network requests to known endpoints. **Note:** since users can configure custom RPC endpoints (Settings), the CSP must accommodate this. Options: (a) use a permissive `connect-src` that allows any HTTPS origin, (b) set CSP dynamically at the hosting layer based on allowed endpoints, or (c) maintain a whitelist of known Sui RPC providers. Option (a) is simplest for Phase 1; tighten in production once endpoint list stabilizes.
- No external analytics, tracking, or third-party resources
- **Note:** CSP headers are production-only (set on the static host). Vite dev mode injects inline scripts and HMR WebSocket connections that `script-src 'self'` would block.

**CI/CD pipeline (GitHub Actions):**
```
git push → build (pnpm turbo build --filter=@tehfrontier/periscope)
         → deploy to static host
         → users' Service Workers detect new version on next visit
         → prompt to update
```

---

## Monorepo Integration

```
TehFrontier/
├── apps/
│   ├── api/          # existing — tRPC API server
│   ├── web/          # existing — Next.js frontend
│   └── periscope/    # NEW — Vite + React SPA (Frontier Periscope)
│       ├── index.html
│       ├── package.json
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── db/           # Dexie schema, encryption layer
│       │   ├── chain/        # Sui RPC query hooks
│       │   ├── api/          # World API client (adapter pattern)
│       │   ├── map/          # 3D star map (R3F components)
│       │   │   ├── StarMap.tsx        # Canvas + camera + controls
│       │   │   ├── StarField.tsx      # InstancedMesh for 24k systems
│       │   │   ├── JumpLines.tsx      # LineSegments for connections
│       │   │   ├── RoutePath.tsx      # Route visualization overlay
│       │   │   ├── MapOverlays.tsx    # Deployables, targets, bookmarks
│       │   │   └── SystemDetail.tsx   # Selected system info panel
│       │   ├── routing/      # Pathfinding (Web Worker + graph)
│       │   ├── logs/         # Log parser (Web Worker + parsers)
│       │   ├── intel/        # Intel channel parser + dashboard (chat → intel feed)
│       │   ├── sync/         # P2P layer: WebRTC, CRDT, multi-box sync, intel sharing
│       │   ├── components/   # UI components
│       │   ├── views/        # page-level views
│       │   ├── stores/       # Zustand stores
│       │   └── lib/          # crypto, helpers, utils
│       └── public/
│           ├── manifest.json # PWA manifest
│           └── data/         # Bundled static data (star map, types, blueprints)
├── packages/
│   ├── sui-client/   # reused — Sui RPC wrapper
│   ├── shared/       # reused — shared types
│   └── tsconfig/     # reused — TS configs
└── docs/
    └── Intel_Tool_Design.md  # this document (Frontier Periscope design)
```

---

## Reference Projects & Resources

### Client Data Extraction

| Project | Language | What It Extracts | URL |
|---|---|---|---|
| **VULTUR/eve-frontier-tools** | Node.js + Python | Types, blueprints, stellar cartography, space components from ResFiles | https://github.com/VULTUR-EveFrontier/eve-frontier-tools |
| **Scetrov/evefrontier_datasets** | Python (Phobos) | Pre-built SQLite DB: systems, jumps, planets, moons, stations | https://github.com/Scetrov/evefrontier_datasets |
| **ProtoDroidBot/Phobos** | Python | Raw data extraction from client (EVE Frontier fork of pyfa-org/Phobos) | https://github.com/ProtoDroidBot/Phobos |
| **frontier-reapers/frontier-static-data** | Python | Star map cache from ResFiles **(archived)** | https://github.com/frontier-reapers/frontier-static-data |

### Community Tools (reference implementations)

| Tool | What It Does | Key Tech | URL |
|---|---|---|---|
| **ef-map.com** | 3D star map, route planner, killboard, blueprint calc, log parser | Three.js, WASM Dijkstra, sql.js, Web Workers | https://ef-map.com |
| **ef-map.com/log-parser** | Game log analyzer: mining, combat, travel analytics | Web Workers, IndexedDB, drag-and-drop | https://ef-map.com/log-parser/ |
| **EF Helper Bridge** | Native Windows app: syncs ef-map routes to in-game DX12 overlay | C++, Win32, DirectX 12, ImGui, localhost HTTP | ef-map.com (not open source) |
| **beaukode/evedatacore** | Blockchain data explorer at evedataco.re — browse on-chain assemblies, players, types | TypeScript, Vite, 817 commits, CC-BY-NC-4.0 | https://github.com/beaukode/evedatacore |
| **beaukode/evedatacore-route-planner** | High-performance A* route planner (CLI + REST API + Docker) | Rust, starmap.bin preprocessed format | https://github.com/beaukode/evedatacore-route-planner |
| **shish/eftb** | EVE Frontier Toolbox — pathfinding, blockchain sync, data viz | Rust (40%) + TypeScript/React (45%) + Python (10%), 27 stars | https://github.com/shish/eftb |
| **alpha-strike-space** | Killboard / leaderboard API + frontend | C++ (Crow), PostgreSQL, Go websockets, JS frontend | https://github.com/alpha-strike-space |
| **frontier-reapers/starmap** | 3D web star map (optimized binary assets) | Three.js, Float32Array, binary data | https://github.com/frontier-reapers/starmap |
| **Scetrov/void-eid** | Tribe management portal | TypeScript | https://github.com/Scetrov/void-eid |
| **Scetrov/FrontierSharp** | C#/.NET API client for EVE Frontier World API | C#, 65 releases, targets blockchain-gateway API | https://github.com/Scetrov/FrontierSharp |
| **frontier.scetrov.live** | Unofficial EVE Frontier developer notes/docs | Python (static site) | https://frontier.scetrov.live |
| **kandrsn99/frontierRwrapper** | R language API wrapper for EVE Frontier Swagger API | R, httr2 | https://github.com/kandrsn99/frontierRwrapper |
| **VULTUR/stellar-cartography** | Rust spatial indexing API for star map (KD-tree, sub-ms queries) | Rust, Axum, SQLite, KD-tree | https://github.com/VULTUR-EveFrontier/stellar-cartography |
| **VULTUR/eve-frontier-icons** | CDN deployment for game icons | JavaScript | https://github.com/VULTUR-EveFrontier/eve-frontier-icons |

### Smart Contract Examples & Builder Tools

| Project | What It Does | Language | URL |
|---|---|---|---|
| **evefrontier/world-contracts** | Official Sui Move contracts (location, fuel, assembly, inventory, etc.) | Move | https://github.com/evefrontier/world-contracts |
| **evefrontier/builder-scaffold** | Templates and tools to build in EVE Frontier world | TypeScript | https://github.com/evefrontier/builder-scaffold |
| **evefrontier/builder-documentation** | Official docs site source (docs.evefrontier.com) | MDX | https://github.com/evefrontier/builder-documentation |
| **projectawakening/builder-examples** | Example DApps: SSU vending machine, smart turret, smart gate, scaffold | Solidity (59%), TypeScript, 93 stars | https://github.com/projectawakening/builder-examples |
| **projectawakening/world-chain-contracts** | Old Ethereum-era smart contracts (MUD framework, Solidity) | Solidity (98%), 56 stars, 35 releases | https://github.com/projectawakening/world-chain-contracts |
| **projectawakening/pod-flow** | ZK proof mocking env: PODs + GPC circuits for location/inventory proofs | TypeScript, Circom, snarkjs, Groth16 | https://github.com/projectawakening/pod-flow |
| **Algorithmic-Warfare/TribeDispenser-DApp** | Tribe dispenser DApp (React + Viem + Material UI) | TypeScript (97%), React | https://github.com/Algorithmic-Warfare/TribeDispenser-DApp |

### EVE Frontier Official (evefrontier org — 7 repos)

| Resource | Language | URL |
|---|---|---|
| world-contracts (Move) | Move | https://github.com/evefrontier/world-contracts |
| builder-scaffold | TypeScript | https://github.com/evefrontier/builder-scaffold |
| evevault (zkLogin wallet) | TypeScript | https://github.com/evefrontier/evevault |
| builder-documentation | MDX | https://github.com/evefrontier/builder-documentation |
| sui-gas-pool | Rust | https://github.com/evefrontier/sui-gas-pool |
| eve-frontier-proximity-zk-poc | TypeScript | https://github.com/evefrontier/eve-frontier-proximity-zk-poc |
| sui-go-sdk | Go | https://github.com/evefrontier/sui-go-sdk |

### ef-map.com Feature Parity Targets

Features from ef-map.com that our tool will replicate locally:

| ef-map.com Feature | Our Implementation | Advantage |
|---|---|---|
| 3D WebGL star map (24k systems) | React Three Fiber + Three.js | R3F declarative components vs imperative 9k-line component |
| WebAssembly Dijkstra routing | Web Worker Dijkstra/A* | Same perf, no WASM compilation step |
| Smart gate route planning | Live gate data from Sui RPC | Direct chain reads, no intermediary API |
| Heat-aware routing | Threat-weighted routing from intel data | Personalized threat data, not just global stats |
| Combat log parser | File System Access API + Web Worker | Real-time monitoring vs one-time upload |
| Blueprint calculator | Extracted BOM data in IndexedDB | Offline-first, no server dependency |
| Killboard | On-chain killmail events | Direct from chain, private viewing |
| Tribe marks | Private annotations + bookmarks | OPSEC: annotations never leave your machine |
| N/A (no intel channel feature) | Intel channel integration: real-time chat→map pipeline | **Unique feature** — no existing tool parses intel channels locally |
| Embeddable widget | N/A (local tool, no embeds) | — |

### Technical Blog References (ef-map.com)

Key architecture posts from ef-map.com's blog that inform our implementation:

| Post | Key Takeaway |
|---|---|
| Three.js Rendering: 3D Starfield for 200k Systems | InstancedMesh = 125x perf gain (500ms → 4ms). Single draw call. Raycaster picking via instanceId |
| Smart Gate Routing: Bidirectional Dijkstra | One-way gate handling, fuel/jump optimization, directed edges |
| Scout Optimizer: Traveling Salesman in Space | Genetic algorithm for multi-waypoint optimization |
| A* vs Dijkstra | A* with Euclidean heuristic for distance-weighted, Dijkstra for uniform |
| Database Architecture | PostgreSQL → in our case IndexedDB via Dexie, same concept of materialized views |
| CPU Optimization: 28% → 4% Idle | Idle render throttling, separate event capture from display |
| Log Parser: Flight Recorder | Privacy-first, Web Workers, IndexedDB storage, drag-and-drop input |

### evedatacore Deep Dive (beaukode/evedatacore)

The most architecturally relevant reference project. TypeScript/Vite/React, 817 commits, actively maintained. Licensed CC-BY-NC-4.0. Live at [evedataco.re](https://evedataco.re).

**Architecture:**
- **UI:** React 18 + Material-UI + Emotion styling + React Hook Form
- **State:** TanStack React Query for async data, wagmi for Web3 wallet state
- **Blockchain:** Viem for low-level chain reads/writes, Lattice XYZ MUD framework for structured data
- **API layers:**
  - `api/stillness/` — Generated client from EVE Frontier's World API OpenAPI spec (12 endpoints)
  - `api/mudweb3/` — Direct blockchain reads via MUD table schema (custom client)
  - `api/evedatacore-v2/` — Their own backend API (route planner, enriched data)
  - `api/prismic/` — CMS for blog/content

**Key insight — dual data source pattern:**
evedatacore reads from BOTH the World API AND direct chain reads:
- World API (`/smartassemblies`, `/smartcharacters`, `/solarsystems`, etc.) for indexed, paginated data
- MUD table reads (`evefrontier__Location`, `evefrontier__DeployableState`, etc.) for real-time on-chain state

**World API endpoints confirmed (from generated SDK):**
```
GET /health              — API status
GET /config              — Chain config (RPC URLs, contract addresses, chain ID)
GET /abis/config         — World contract ABIs
GET /smartassemblies     — All assemblies (paginated)
GET /smartassemblies/{id} — Single assembly detail
GET /smartcharacters     — All characters
GET /smartcharacters/{id} — Single character
GET /solarsystems        — All solar systems
GET /killmails           — All killmails
GET /types               — All item types
GET /types/{id}          — Single type
POST /metatransaction    — Submit meta-transaction
```

**MUD table reads (direct chain):**
```
evefrontier__Location         — Assembly location (hash)
evefrontier__DeployableState  — Assembly state (anchored, online, etc.)
+ character, gate, turret tables
```

**Assembly data model (from API types):**
- `types_SmartAssembly`: full detail with fuel, gates, inventory, proximity, location, state
- `types_SimpleSmartAssembly`: lightweight list item with type, location, online status, owner
- `types_FuelModule`: consumption and capacity data
- `types_GateLinkModule`: destination and range
- `types_InventoryModule`: storage + ephemeral items with capacity metrics
- `types_SmartCharacter`: address, balances, assemblies list, metadata

**Route planner:**
- Delegates to their own backend API (`evedatacore-v2`) for pathfinding
- Parameters: start/destination system, jump distance limit, optimization preference, smart gate usage mode (restricted/none/enabled), character account for gate ACL
- Frontend `enrichRoute()` adds system names, distances (in light-years), jump/hop counts
- `solarSystemsIndex` provides client-side system search with first-letter bucketing

**What we can learn:**
1. The World API endpoint structure is confirmed and stable — we can build our adapter around these same paths
2. MUD table schema gives us direct chain read patterns for assembly state/location
3. Their route planner offloads to a server — we can do this client-side in a Web Worker
4. Assembly type IDs are numeric (84556=turret, etc.) — we need these mappings
5. Fuel calculation uses `fuelFactor: 0.01` constant
6. Ship definitions include mass and fuel type — 10 ship classes defined
7. Smart assembly states: NULL(0), UNANCHORED(1), ANCHORED(2), ONLINE(3), DESTROYED(4)

**Chain state → typed status mapping** (used by both AssemblyIntel and DeployableIntel):
```typescript
const ASSEMBLY_STATUS_MAP: Record<number, AssemblyIntel['status']> = {
  0: 'unknown',      // NULL — no state set
  1: 'unanchored',   // UNANCHORED
  2: 'anchored',     // ANCHORED
  3: 'online',       // ONLINE
  4: 'destroyed',    // DESTROYED
};
// 'offline' is NOT a chain state — it's inferred from anchored + fuel state.
// Always use resolveStatus() instead of raw ASSEMBLY_STATUS_MAP lookup:
function resolveStatus(
  chainState: number,
  fuel?: { isBurning: boolean; quantity: number }
): AssemblyIntel['status'] {
  const base = ASSEMBLY_STATUS_MAP[chainState] ?? 'unknown';
  if (base === 'anchored' && fuel && !fuel.isBurning) return 'offline';
  return base;
}
```

**Important caveat:** evedatacore is built for the **Ethereum/MUD era** (Redstone L2, Solidity, MUD tables). The Cycle 5 Sui migration changes the data access patterns significantly:
- MUD table reads → Sui object queries (`sui_getObject`, `sui_getDynamicFields`)
- Viem/wagmi → `@mysten/sui` SDK
- World API endpoints may change (same concept, different URLs/fields)
- The *types* of data are the same, but the *access methods* differ

---

## Cycle 5 Patch Notes — Design Implications

Source: Cycle 5 Patch Notes Reveal stream (transcript in `docs/`). Key changes that affect Periscope:

**New assembly types (Cycle 5):**
- **Nursery** — manufactures shells (20 Building Foam, 3.2 min build time; shell production itself takes longer)
- **Nest** — small-scale shell storage
- **Shell Sheet** — shell customization/enhancement station
- **Construction Site** — intermediate build state (temporary, becomes final structure)
- **Three turret tiers** — Mini Turret (small targets), Turret (medium), Heavy Turret (large). Built-in weapons, no longer player-applied. Turret cap removed; limited by power only.
- All added to `assemblyType` union on AssemblyIntel/DeployableIntel. `turretClass` field distinguishes tiers.

**Signature & scanning system (passive observation):**
- New core mechanic: ships passively detect "unverified signatures" at range with a resolution gradient (not binary see/don't-see)
- Gravitational signatures (mass detection) only type in Cycle 5; EM, heat, communication signatures planned
- Smaller ships resolve larger signatures faster — scouts have asymmetric advantage
- Line-of-sight blocking by terrain; signatures degrade when obstructed
- **Periscope impact:** Not on-chain data, but if game logs capture signature contacts, this becomes a log-derived intel source (contact patterns, system activity heatmaps). Monitor log format on launch day.

**Location obfuscation (validates our design):**
- Structures now shown as hashes only on-chain — exact coordinates hidden
- Opt-in coordinate broadcast planned (point release)
- Our model already handles this: `locationHash?: string` + `location?: LocationData`

**Multi-anchor co-location:**
- 5-20 anchor points per L-point; one network node per player per L-point
- Multiple players can base at same location hash → assembly tracking must handle co-located assemblies from different owners at the same `locationHash`

**Drive modules (ship fitting data):**
- Skip (starting ship), Hop (medium), Leap (large) + four new leap drive variants for different ship classes
- Relevant for target profiling: drive module type indicates ship capability and likely engagement range

**Ship rebalancing:**
- New ship: Exclave frigate LAI (2100 HP, 440 max velocity, 2/2/2 slots)
- Tatis (destroyer) nerfed — tier 2 engines removed from destroyers
- Recurve/Reaver rebalanced with distinct identities
- Mass now affects detectability (larger = easier to spot)
- Ship type registry needs updating from Cycle 5 client data

**NPC overhaul:**
- NPCs now have AI behavior, objectives, memory; patrol systems and player bases
- No longer drop loot directly — guard wrecks/caches instead
- Old feral groups removed; new clades introduced
- **Periscope impact:** NPC contacts may create noise in signature/log intel. Consider filtering NPC activity from player intel.

**Orbital zones:**
- All resources now inside orbital zones (deployed to every system)
- 20 unique variants; micro-rifts in most systems for basic resources
- Resource distribution rebalanced universe-wide
- **Periscope impact:** System intel value increases — knowing which orbital zones have which resources is actionable intel. Future consideration for resource mapping.

**Construction system:**
- Place construction site → deposit materials from any nearby storage
- Any player can contribute; placer owns final structure
- 20% faster build times
- **Periscope impact:** `construction_site` is likely ephemeral on-chain — may appear and disappear as builds complete. Don't over-poll.

---

## Open Questions

1. ~~**App name**~~ — **Resolved: Frontier Periscope.** Submarine/periscope metaphor fits EVE's space-sub gameplay. "See without being seen." Package: `@tehfrontier/periscope`, app dir: `apps/periscope`, DB: `frontier-periscope`.
2. ~~**Map visualization**~~ — **Resolved: Yes.** Full 3D interactive star map using React Three Fiber + Three.js. Route planner with Dijkstra/A* in a Web Worker.
3. **Chain data scope** — Which world contract objects should we prioritize querying? Need to map the exact Sui object IDs and data structures from the deployed Cycle 5 contracts.
4. ~~**Encryption default**~~ — **Resolved: Opt-in, off by default.** Data is already protected by Windows login for solo users. Encryption can be enabled in Settings when sharing or OPSEC matters.
5. ~~**Hackathon demo strategy**~~ — **Resolved: Build for real gameplay first, demo follows naturally.** Priority features based on actual Cycle 5 play needs: (1) **Asset tracking** — deployable management with locations, contents, fuel, notes, labels (the in-game asset system is lacking). (2) **Route planner** — 3D star map with smart gate routing for daily navigation. (3) **Log monitoring** — track travel history, mining efficiencies, session analytics from parsed game logs. (4) **Target tracker** — when encountering hostiles, monitor their on-chain activity to deduce play times, operational tempo, and patterns. Demo is a live walkthrough of the tool being used in an actual play session — not a scripted showcase.
6. ~~**Log file format**~~ — **Partially resolved.** Launcher logs analyzed. Game logs TBD on launch day. ef-map.com's log parser confirms the format supports mining, combat, and travel extraction.
7. ~~**Static data bundling**~~ — **Resolved: Bundle everything, fresh from Cycle 5.** Run VULTUR extraction on launch day against the updated game client. Ship complete dataset (~5-8MB compressed). Star map, types, blueprints, labels all available on first launch. Re-extract after major game patches.
8. ~~**Browser compatibility**~~ — **Resolved: Support both Chrome and Firefox.** File System Access API (Chromium-only) needs a Firefox fallback: manual file upload / drag-and-drop for log files instead of directory watching, and IndexedDB-only storage (no custom directory picker) on Firefox. Core features (star map, chain queries, intel, routing) work on both. Firefox users get a slightly degraded log parsing experience (manual file selection instead of auto-watching).
9. ~~**EVE Frontier API**~~ — **Deferred.** Old API documented. New Sui-era API TBD until Cycle 5 launch (March 11).
10. **Game log directory** — Verify exact location of game client logs on Cycle 5 launch day. ef-map.com says `%LOCALAPPDATA%\EVE Frontier\logs\`.
11. ~~**solarsystemcontent.static**~~ — **Resolved: Extract fresh from client on Cycle 5 launch.** New cycle changes data significantly — need fresh extraction from the game client, not stale pre-cycle data. Run VULTUR pipeline on launch day. Include the 84MB file if it contains useful in-system data (belt positions, anomaly data). Bundled baseline will be built from Cycle 5 extractions.
12. **VULTUR vector types** — The FSDBinary decoder has a TODO for `*_vector` types (currently returns `None`). Need to check if this affects any data we need (e.g., coordinate vectors in space components).
13. **Chat log link format** — How does EVE Frontier encode dragged object links (systems, players, items) in chat log files? Need to reverse-engineer the exact markup format on Cycle 5 launch day. Key unknowns: is it XML-like tags, custom binary, or plaintext with delimiters? Does the log file preserve the link metadata or only the display text?
14. **Chat log file structure** — Are chat logs written per-channel (one file per channel) or combined? Per-session or appended? This affects the log watcher's file monitoring strategy and the intel channel parser's ability to filter by channel.
15. ~~**CRDT library vs custom**~~ — **Resolved: Custom lightweight HLC-based LWW.** Our data model is document-level (whole records), not collaborative text editing. ~200 lines of custom code vs 50-100KB library dependency. Can swap in a library later if edge cases warrant it.
16. ~~**Multi-box signaling**~~ — **Resolved: All three methods, prioritized in order.** (1) Copy-paste signaling codes — primary, works everywhere, no infrastructure. (2) Shared file via cloud sync folder (Google Drive) — write offer.json, other box reads it, zero-server automation. (3) Manual IP:port — LAN shortcut for same-network boxes. Implement in that priority order.
17. **Current system detection** — How do game logs expose which system the character is in? If logs contain system-entry events, the tool auto-detects current system. If not, the user must manually select it on the star map. Investigate on launch day (Step 7).
18. **Assembly type ID mappings** — What numeric type IDs map to gate, SSU, turret (mini/standard/heavy), network node, nursery, nest, shell sheet, construction site? evedatacore uses `84556=turret` etc. Cycle 5 adds new structure types (nursery, nest, shell sheet) and three turret tiers with built-in weapons. Need the full mapping from Cycle 5 contracts/API.
19. **Multi-account in Phase 1** — Should Phase 1 support switching between multiple Sui addresses (same machine, different characters) or is that strictly a Phase 2/multi-box feature? Some solo players alternate characters without multi-boxing.
20. **Signature log events** — Do game logs capture passive signature detection events (contacts, resolutions, losses)? If so, this is a new log-derived intel source for system activity heatmaps and contact pattern analysis. Investigate on launch day.
21. **Drive module detection** — Can we determine a target's drive module (Skip/Hop/Leap) from chain data or killmails? Knowing mobility capability is valuable for target profiling.
22. **Construction site lifecycle** — Are construction sites on-chain objects? If so, are they ephemeral (destroyed on completion) or do they persist? Affects polling strategy — don't over-poll temporary objects.
23. **Ship type registry update** — Cycle 5 adds the Exclave frigate LAI (2100 HP, 440 vel, 2/2/2 slots), rebalances Tatis/Recurve/Reaver, and ties mass to detectability. Four new leap drive types. Extract full ship type list from Cycle 5 client data.

---

## Implementation Plan — Phase 1

### Timeline Context

- **Hackathon:** March 11-31, 2026 (20 days)
- **Cycle 5 launch:** March 11 (API/chain data available from this day)
- **Sandbox:** Utopia server (dedicated hackathon dev environment, access via `--frontier-test-servers=Utopia` launcher flag)
- **Today:** March 9 (2 days before launch)

### Phase 1 Scope Summary

**Phase 1 delivers:** 3D star map, route planner (Dijkstra/A* with smart gates), blueprint calculator, deployable management (asset tracking, fuel monitoring, alerts), target tracking (chain surveillance), client log parsing (travel/mining/combat analytics), intel channel integration (chat link parsing, real-time feed), player intelligence, OPSEC dashboard, killmail feed, PWA with offline support and Windows integration.

**Phase 1 does NOT include:** P2P networking, multi-box sync, CRDT replication, selective intel sharing, group/alliance management, on-chain intel storage (Move contracts).

**Default theme:** Dark (space-appropriate, minimizes contrast with the game client). No light theme in Phase 1.

**First-launch setup:** User enters their Sui address (manual paste or wallet connection via EVE Vault). This is required to fetch owned assemblies, display OPSEC exposure, and center the UI. Character name is resolved from the Character contract on-chain. Changing the address later (Settings) triggers a re-fetch of owned assemblies and re-evaluation of deployables. Existing deployables for the old address are archived, not deleted.

**Timestamps:** All timestamps stored as epoch milliseconds (UTC). Displayed in user's local timezone. Recent events shown as relative time ("3 min ago"); historical events shown as absolute ("Mar 15, 14:32"). Fuel depletion ETAs shown as both relative duration ("6h 12m remaining") and absolute time.

### Pre-Launch (March 9-10) — Foundation

**Goal:** Have the app skeleton running before Cycle 5 launches so we can immediately start integrating real data.

#### Step 1: Project Scaffolding
- Create `apps/periscope` as a Vite + React SPA
- Configure: TypeScript, Tailwind CSS v4, Biome, Turborepo integration
- Wire up workspace dependencies: `@tehfrontier/tsconfig`, `@tehfrontier/sui-client`, `@tehfrontier/shared`
- PWA manifest + vite-plugin-pwa boilerplate
- Verify `pnpm dev` runs the app at `localhost:5173`

```
apps/periscope/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── manifest.json
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── db/
    │   ├── index.ts          # Dexie instance + schema
    │   └── encryption.ts     # WebCrypto AES-GCM wrapper
    ├── router.tsx            # TanStack Router routes (see route table below)
    ├── stores/
    │   └── appStore.ts       # Zustand global state
    ├── components/
    │   ├── Layout.tsx
    │   ├── Sidebar.tsx
    │   └── ui/               # shared UI primitives
    ├── views/
    │   ├── Dashboard.tsx
    │   ├── Settings.tsx
    │   └── Setup.tsx         # first-launch setup (Sui address entry)
    └── lib/
        └── utils.ts
```

**Route table** (TanStack Router paths — used by PWA shortcuts, notification handlers, and cross-view navigation):

| Path | View | Notes |
|------|------|-------|
| `/` | Dashboard | Overview with status cards |
| `/map` | Star Map + Route Planner | 3D star map with integrated route planner, supports `?system=<id>` and `?route=<id>,<id>` params |
| `/deployables` | Deployable Fleet | Own fleet management, supports `?filter=fuel-low` |
| `/assemblies` | Assembly Browser | Observed (other players') assemblies with metadata |
| `/locations` | Locations | Bookmarks, annotations, system notes |
| `/targets` | Watchlist | Target surveillance dashboard |
| `/intel` | Intel Channel | Chat intel feed and reports |
| `/players` | Player Tracker | Known players database |
| `/killmails` | Killmail Feed | Kill activity feed |
| `/blueprints` | Blueprint Calculator | BOM calculator |
| `/logs` | Log Analyzer | Mining/combat/travel analytics |
| `/opsec` | OPSEC Dashboard | Exposure analysis |
| `/notes` | Notes | Freeform intel notes, linked to entities |
| `/settings` | Settings | App configuration, static data, encryption |
| `/setup` | First-Launch Setup | Sui address entry (redirects to `/` after setup) |

#### Step 2: Database Layer
- Dexie.js schema (all tables from Data Model section)
- CRUD helpers for each intel type
- Settings store (key-value in IndexedDB)
- Optional encryption layer (AES-256-GCM via WebCrypto)
  - `encrypt(plaintext, key) → { ciphertext, iv }`
  - `decrypt(ciphertext, iv, key) → plaintext`
  - `deriveKey(passphrase, salt) → CryptoKey` (PBKDF2, 100k iterations)
- Import/export (full DB dump to JSON file, restore from JSON)

#### Step 3: Static Data Pipeline
- Run VULTUR extraction pipeline against local game client → `data/extracted/*.json`
- Copy extracted JSON to `apps/periscope/public/data/` for build-time bundling
- First-launch loader: fetch bundled JSON → bulk-insert into Dexie tables via `Dexie.bulkPut()` (not individual `.put()` — 10-100x faster for large imports). Note: static data tables are NOT encrypted (see Encryption Design), so `bulkPut()` runs at full speed. For backup imports of intel records with encryption enabled, records must be individually encrypted before `bulkPut()`, which is slower. Show a progress screen during first-launch import ("Loading star map... 24,026 systems", "Loading jump connections... 13,752 edges", etc.) since the full import may take several seconds. (13,752 = 6,876 bidirectional connections × 2 directed records each — see jumps schema.) App views remain unavailable until core data (systems + jumps) is loaded; type registry and blueprints can load in background.
- Tables loaded on first launch:
  - `solarSystems` — 24,026 systems with x,y,z, regionId, constellationId, security (from `starmapcache.pickle`, ~5-8MB compressed). NOTE: detailed celestial content (planets, moons, belts, stations) comes from `solarsystemcontent.static` (84MB raw) and is NOT bundled — it is imported on-demand via the Settings → Static Data UI after first launch.
  - `jumps` — 13,752 directed edge records (6,876 bidirectional connections × 2 — see jumps schema)
  - `constellations` — constellation definitions with member system IDs
  - `regions` — region definitions with member constellation IDs
  - `itemTypes` — complete type registry (typeId → name, group, category, basePrice, volume)
  - `blueprints` — bill of materials (inputs, outputs, quantities)
  - `spaceComponents` — module/ship stats by type ID
- Cache metadata tracking (version, source, import date)
- Re-import UI: drag-and-drop JSON files to update after game patches. Static data re-import is **wipe-and-replace** per table (not merge) — delete all rows, then `bulkPut()` the new dataset. This is safe because static data is authoritative and reproducible from extraction.
- Fallback: import Scetrov `static_data.db` — convert SQLite to JSON externally (e.g., via a Node.js script using `better-sqlite3`) rather than bundling `sql.js` (~1MB WASM). Import the resulting JSON files the same way as VULTUR output.

#### Step 4: 3D Star Map
- React Three Fiber setup with `<Canvas>`, `<OrbitControls>` (from drei)
- `<instancedMesh>` for 24k star systems — single draw call, per-instance color/scale
- `<lineSegments>` for 6,876 jump connections — single draw call
- Raycaster picking → click system → detail panel (name, region, security, celestials)
- System search with autocomplete (search Dexie by name)
- Color-coding modes: by region, by security class, custom (threat level, visited)
- Camera: 30° FOV telephoto, orbit controls with damping, zoom constraints
- Optional bloom post-processing via `@react-three/postprocessing`
- Performance: target 60 FPS. Use `<Canvas frameloop="demand">` with `invalidate()` on user interaction and data changes — prevents continuous 60fps rendering when the map is idle (saves CPU/GPU/battery).
- WebGL context loss: R3F handles basic recovery, but InstancedMesh buffers (star positions, colors) must be rebuilt. Store buffer data in a ref for reinitialization on `webglcontextrestored` event.
- Error boundary: Wrap the R3F `<Canvas>` in a React error boundary with a "Map unavailable — click to retry" fallback. Prevents WebGL/GPU crashes from taking down the entire app.

#### Step 5: Route Planner
- Build jump graph: adjacency list from static jump data (24k nodes, 13.8k directed edges)
- Dijkstra pathfinding in Web Worker (fewest jumps)
- A* with Euclidean distance heuristic (shortest distance)
- Route UI: click origin → click destination → show path
- Route visualization: highlighted path on star map (distinct LineSegments material)
- Route details panel: jump count, system list, estimated distance
- Multi-waypoint routing (sequential A-B-C)
- Smart gate integration: add on-chain gate edges to graph dynamically (from Sui RPC)
- One-way gate handling: directed edges for access-controlled gates

#### Step 6: Basic UI Shell
- Layout: sidebar navigation + content area
- Views: Dashboard (placeholder), Star Map (with integrated route planner), Locations (bookmarks + annotations CRUD), Notes (freeform intel CRUD), Settings
- First-launch setup: prompt for Sui address (paste or wallet connect), resolve character name from chain
- Settings page: Sui address, passphrase setup, auto-backup directory, RPC endpoint config
- Blueprint calculator view: search blueprints, show BOM tree, quantity scaling
- Locations and Notes are simple CRUD views with no chain data dependency — buildable pre-launch
- Dark theme (default and only theme for Phase 1)
- TanStack Router for client-side routing (URL paths for PWA shortcuts)
- Tailwind v4 styling consistent with `apps/web`

### Launch Day (March 11) — Data Integration Sprint

**Goal:** Investigate the live API and chain, then build the data pipeline.

#### Step 7: API & Chain Discovery
- Launch EVE Frontier, perform various activities
- Document the Cycle 5 API endpoints (URL, auth, response format)
- Identify deployed contract package IDs on Sui testnet
- Document game log file format, location, naming convention
- Map Sui object structures to TypeScript interfaces

#### Step 8: Chain Data Client
- Build Sui RPC query module using `@tehfrontier/sui-client`
- Queries needed:
  - `getOwnedObjects(address)` → discover all assemblies
  - `getObject(objectId)` → assembly details (type, status, fuel, location hash)
  - `queryEvents({ MoveEventType: "FuelEvent" })` → fuel changes
  - `queryEvents({ MoveEventType: "KillmailEvent" })` → combat data
  - Dynamic field queries for SSU inventory
- Response parsing → Dexie storage
- Configurable RPC endpoint

#### Step 9: World API Client
- Adapter-pattern API client (easy to swap/update)
- Endpoints: assemblies, characters, solar systems, killmails, types
- Response normalization → same Dexie tables
- Bearer token auth for `/me/` endpoints
- Error handling + retry with backoff

### Week 1 (March 12-17) — Core Features

#### Step 10: Deployable Management
- "My Deployables" view — fetch all owned assemblies by address
- Display: object ID, type, status, fuel %, depletion ETA
- User labels, notes, tags per deployable
- Fuel calculator (based on on-chain Fuel struct)
- Fuel alerts (configurable thresholds)
- Periodic polling for fuel state changes
- FuelEvent subscription for real-time updates
- Plot owned assemblies on star map (known locations)
- Assembly browser view — observed (other players') assemblies discovered via chain scans and target tracking

#### Step 11: Target Tracking
- Add target by Sui address
- Auto-discover target's assemblies via `getOwnedObjects`
- Target profile view: assemblies, fuel trends, last activity
- Watchlist dashboard: all targets with status summary
- Periodic polling with configurable interval (30s - 5min)
- Inventory change detection on target SSUs
- Activity timeline (chronological event feed)

#### Step 12: Client Log Integration
- Investigate actual game log format (from Step 7 findings)
- File System Access API: directory picker for log folder
- Persist directory handle in IndexedDB
- Build parser pipeline for discovered log format (ef-map.com log parser parity):
  - Mining analytics: ore types, quantities, efficiency, ISK/hr
  - Combat stats: damage dealt/received, kills, losses
  - Travel history: systems visited, jump counts
  - Session summaries: activity comparison across sessions
- Web Worker for background polling (5-10s interval)
- Byte-offset tracking per file (process only new content)
- Store parsed entries in `activities` table
- Travel history overlay on star map (systems visited, routes taken)
- Log analyzer dashboard with mining/combat/travel tabs

#### Step 12a: Intel Channel Integration
- Reverse-engineer chat log link format from Cycle 5 game logs (Step 7 findings)
- Chat link parser: detect and extract system links, player links, ship/type links from chat messages
- Intel channel configuration UI: mark channels as intel channels
- Real-time intel feed: Dexie live queries updating a scrolling dashboard
- Intel aging system: active → stale → expired status transitions (configurable timers)
- Store parsed reports in `chatIntel` Dexie table
- Star map overlay: flash/highlight systems on new intel report
- Player cross-referencing: link reported players to existing PlayerIntel records
- Sound/notification alerts for reports matching user-configured filters
- Intel history: searchable archive with filters (system, player, channel, time range)

### Week 2 (March 18-24) — Intelligence & OPSEC

#### Step 13: Player Intelligence
- Player profile view: address, name, tribe, threat level
- Manual notes and threat assessment per player
- Link players to observed assemblies
- "Known players" list with search and filters

#### Step 14: OPSEC Dashboard
- "Your Exposure" view — what's publicly visible about you on-chain
- Assembly risk flags — correlate hostile sightings (from intel channel reports, log data, manual reports) with your assembly locations. If a hostile was reported in a system where you have a deployable, flag that assembly as potentially compromised. Risk levels: **safe** (no hostile intel), **caution** (hostile seen in region), **warning** (hostile seen in system), **critical** (hostile seen + your assembly discovered via physical observation)
- Transaction awareness indicators
- Gate pair exposure tracking
- Address separation recommendations

#### Step 15: Killmail Feed
- Fetch killmail events from chain
- Killmail list view with filters (attacker, victim, time range)
- Link killmails to known players and target profiles
- Combat activity heatmap on star map (which systems are active)

### Week 3 (March 25-31) — Polish & Demo

#### Step 16: Data Management
- Import/Export: full database backup to encrypted JSON
- Auto-backup directory (Chromium only): periodic export to user-chosen folder
- Data retention controls (auto-expire old activity data, tombstone GC)
- Storage usage display

#### Step 17: PWA, Windows Integration & Updates
- vite-plugin-pwa with `registerType: 'prompt'` — user-controlled updates
- PWA manifest: name, icons, shortcuts (Star Map, Intel Feed, Fuel Alerts, Watchlist)
- Window Controls Overlay for custom title bar (connection status, search, badge)
- Service Worker: cache app shell + static data files, offline capability
- Offline indicator in UI
- PWA install prompt (banner or Settings → "Install as Desktop App")
- Taskbar badge: `navigator.setAppBadge()` — driven by new intel count + fuel alerts
- Toast notifications: intel channel reports, fuel warnings, target activity (Notification API)
- Notification settings UI: per-category toggles (intel, fuel, targets, killmails)
- Update prompt component: "New version available" banner with Update Now / Later
- Version tracking: show current version in Settings, changelog modal on update
- Dexie schema migration hooks for future schema changes
- Deploy pipeline: build → push to static host (Cloudflare Pages / GitHub Pages)

#### Step 18: Hackathon Demo Prep
- Dashboard with live data flowing in
- Live walkthrough: asset tracking → route planning → log analytics → target tracking → private annotations
- Polish key views, fix bugs, performance optimization
- README and submission materials

### Post-Hackathon — Phase 2 Implementation

#### Step 19: P2P Connection Layer
- WebRTC DataChannel abstraction (create/accept connections, manage lifecycle)
- Signaling: manual copy-paste offer/answer codes (no server dependency)
- Optional LAN peer discovery (mDNS or manual IP:port entry)
- Peer type designation on connect: `multibox` vs `intel`
- Connection persistence: store peer configs in IndexedDB, auto-reconnect on launch
- Connection status UI: peer bar showing connected/disconnected/syncing state

#### Step 20: Multi-Box Sync
- Hybrid Logical Clock (HLC) implementation — causal ordering without synced clocks
- Add `_hlc`, `_deleted`, `_origin` fields to all Dexie table records
- Change log table (`syncLog`): tracks every write for efficient delta sync
- CRDT merge logic: insert new / last-write-wins update / tombstone delete
- Initial sync: exchange HLC vectors, send all entries newer than partner's last-seen
- Real-time sync: stream changes over DataChannel as they happen
- Offline queue: buffer changes while disconnected, flush on reconnect
- Active character config per instance (UI perspective)
- Multi-box pairing wizard (generate code → paste on other box → connected)
- Peer management UI (Settings → Multi-Box): pair, unpair, view sync status
- Sync status indicator in peer bar (connected/syncing/queued changes count)

#### Step 21: Selective Intel Sharing (Allies)
- Sharing group system: tag intel items with groups ("alliance", "scouts", "private")
- Per-connection share filters: choose what categories to share with each intel peer
- E2E encryption on shared payloads (symmetric group key, AES-256-GCM)
- Received intel attributed to source peer
- Alliance/group creation with shared encryption key
- Member management and trust levels
- Full mesh topology for small groups (~5-20 peers)

### Implementation Dependencies

```
Phase 1 (Solo):
Step 1 (scaffolding)
  └─► Step 2 (database)
       ├─► Step 3 (static data pipeline)
       │    ├─► Step 4 (3D star map)
       │    │    └─► Step 5 (route planner)
       │    └─► Step 6 (UI shell + blueprint calc)
       │         └─► Step 10 (deployables) ──► Step 14 (OPSEC)
       ├─► Step 8 (chain client) ──► Step 11 (targets) ──► Step 15 (killmails)
       ├─► Step 9 (API client) ──┘
       └─► Step 12 (log parsing) ──► Step 12a (intel channels) ──► Step 13 (players) ◄── Steps 8-9 (chain/API)

Step 7 (launch day discovery) ──► Steps 8, 9, 12, 12a

Steps 16-18 run in parallel after core features are stable

Phase 2 (P2P + Multi-Box):
Step 2 (database) ──► Step 19 (P2P connection layer)
                          ├─► Step 20 (multi-box sync)
                          └─► Step 21 (selective intel sharing)
```

### Critical Path

Build order optimized for **real gameplay utility during Cycle 5** — every feature gets tested in live play:

1. **Steps 1-6** (pre-launch) → running app with 3D star map, route planner, blueprint calc, settings
2. **Step 7** (launch day) → investigate live API/chain, extract fresh static data from updated client
3. **Steps 8-9** (post-launch) → data flowing from chain/API into the tool
4. **Step 10** (deployable management) → **top priority** — asset tracking with locations, contents, fuel, notes (fills the gap in the game's asset UI)
5. **Step 12** (log monitoring) → travel history, mining efficiencies, session analytics
6. **Step 12a** (intel channel integration) → real-time chat intel parsing, the tool's primary differentiating feature
7. **Step 11** (target tracking) → encounter a hostile, add their address, monitor play times and patterns
8. **Step 18** (demo prep) → live walkthrough of actual gameplay use

Steps 13-17 are valuable but not on the critical path.

### Minimum Viable Product (gameplay-first)

The tool should be useful in a real play session from day one. Priority order based on actual gameplay needs:

1. **Asset tracker** — all your deployables with locations, fuel status, contents, labels, notes. The in-game asset system is lacking — this fills that gap immediately.
2. **Route planner** — 3D star map with smart gate routing for daily navigation. "How do I get from here to there?"
3. **Log monitor** — where you've been, mining rates, combat stats, session comparisons. "How efficient was that mining run?"
4. **Target tracker** — add a hostile's address after an encounter, watch their on-chain activity. Deduce play times, operational tempo, when they're active vs dormant. "When is it safe to operate near them?"
5. **Private annotations** — bookmarks, labels, notes, threat levels on systems/players/assemblies. All local, nothing leaked.
6. **Blueprint calculator** — manufacturing BOM from extracted game data for planning builds.

The demo is not scripted — it's a live walkthrough of the tool being used alongside actual gameplay. Real data, real intel, real decisions.

The story: "The in-game UI doesn't track your assets well. The star map doesn't remember your routes. Nobody tells you when your enemy is online. Frontier Periscope fills every gap — asset management, route planning, activity analytics, enemy surveillance — and **nothing ever leaves your browser**. See without being seen."
