# CCP Feature Requests & Wish List

Capabilities that would unlock significant builder functionality but require changes to the game server, world-contracts, or extension system. Each item includes what we're trying to build, why we need it, the current blocker, and what CCP would need to change.

---

## 1. Turret Extension Config Object Parameter

**What we're building:**
A turret ACL/priority system where players configure friend/foe lists, KOS targets, and priority weights per-turret — then sync those rules to chain without redeploying the extension contract every time.

**Why we need it:**
Gates already support this pattern — `can_jump()` accepts a `config: &ExtensionConfig` shared object, letting players update ACL rules via a separate transaction without republishing the package. Turrets need the same capability. Without it, every targeting rule change requires publishing a new Move package and re-authorizing the extension on the turret — a multi-step process that's impractical for active gameplay.

**Current blocker:**
The turret entry point signature is fixed:
```move
public fun get_target_priority_list(
    turret: &Turret,
    owner_character: &Character,
    target_candidate_list: vector<u8>,
    receipt: OnlineReceipt,
): vector<u8>
```
The game server constructs the devInspect call with exactly these 4 parameters. There's no way to pass additional objects (like `&ExtensionConfig`). In Sui Move, objects must be passed as transaction inputs — you can't read an arbitrary shared object by address from inside a function.

**What CCP would need to change:**
Add an optional 5th parameter to the turret devInspect call — a shared config object ID stored alongside the extension authorization. The game server would pass `config: &ExtensionConfig` (or a generic `&T`) as an additional argument when invoking the extension.

Alternatively, modify `turret::authorize_extension` to also store a config object ID, and have the game server include it in the devInspect PTB automatically.

**Impact if resolved:**
- Dynamic friend/foe targeting without redeployment
- Tribe-based and character-based priority lists (same pattern as gate_acl)
- Per-turret configs stored as dynamic fields on a shared object
- Admin delegation (co-admins can update turret targeting rules)
- Real parity between gate and turret extension capabilities

---

## 2. Manual Turret Priority Re-evaluation Trigger

**What we're building:**
A coordinated defense system where multiple turret owners can adjust targeting in real-time during combat — e.g., "all turrets focus fire on target X" or "switch from anti-frigate to anti-cruiser priority."

**Why we need it:**
Currently, `get_target_priority_list` is only called on behaviour change events (ENTERED, STARTED_ATTACK, STOPPED_ATTACK). If a defender updates their turret's priority config mid-fight, the change doesn't take effect until the next behaviour change trigger fires. In a sustained engagement where all combatants are already in range and attacking, there may be no trigger to re-evaluate priorities.

**Current blocker:**
There is no mechanism for a player to force the game server to re-invoke `get_target_priority_list`. The game server decides when to call the extension based on internal behaviour change detection.

**What CCP would need to change:**
Add a transaction or API endpoint that lets a turret owner (or authorized admin) trigger a priority re-evaluation. For example:
- A `turret::request_retarget(turret, owner_cap)` transaction that signals the game server
- Or emit a specific event type that the game server watches for

**Impact if resolved:**
- Real-time turret control during combat
- Coordinated multi-turret focus fire (each turret owner triggers retarget after config update)
- Dynamic threat response (switch targeting strategy mid-engagement)

---

## 3. Dynamic Fields on Assembly Objects for Extensions

**What we're building:**
Extension-specific storage attached directly to assembly objects (Turret, Gate, SSU) so extensions can read per-assembly config without needing a separate shared config object.

**Why we need it:**
For turret extensions specifically (see #1), if we could store a `PriorityConfig` as a dynamic field on the Turret object itself, the extension could read it during devInspect since `&Turret` is already passed as a parameter. This would solve the config problem without changing the entry point signature.

**Current blocker:**
Adding a dynamic field requires `&mut UID` access to the object. The Turret struct is defined in the world module, and there's no public function that lets external modules add dynamic fields to a Turret. Extensions can't write to assembly objects they don't own.

**What CCP would need to change:**
Add a function in the turret/assembly module:
```move
public fun add_extension_field<Auth: drop, V: store>(
    turret: &mut Turret,
    owner_cap: &OwnerCap<Turret>,
    auth: Auth,
    key: String,
    value: V,
)
```
This would let authorized extensions attach config data to the turret. The extension could then read it via `dynamic_field::borrow()` during devInspect since it has `&Turret` access.

**Impact if resolved:**
- Per-assembly extension config without separate shared objects
- Works within the existing fixed function signature
- Cleaner data model (config lives with the assembly, not in a separate object)

---

## 4. Extension Config Object Discovery

**What we're building:**
A dApp that lets any authorized player (not just the extension publisher) discover and configure extension settings for assemblies they admin.

**Why we need it:**
When a player authorizes an extension on their assembly, the extension's config shared object ID isn't stored on-chain in a discoverable way. The dApp needs to know the config object ID to read/write ACL settings. Currently, the config object ID must be hardcoded in the dApp or communicated out-of-band.

**Current blocker:**
`ExtensionAuthorizedEvent` (added in v0.0.16) emits the authorized package ID, but there's no standard way to discover the associated config object. Each extension publisher knows their config object ID, but other users (co-admins, tribe admins) must be told it separately.

**What CCP would need to change:**
Either:
1. Store the config object ID alongside the extension authorization on the assembly (e.g., in the extension field), or
2. Standardize a convention where the config object ID is discoverable from the package ID (e.g., a well-known module function that returns it), or
3. Add a `config_object_id` field to `ExtensionAuthorizedEvent`

**Impact if resolved:**
- Any admin can discover and configure extensions without out-of-band communication
- Enables fully permissionless dApps for extension configuration
- Multi-admin delegation works seamlessly (new admins can immediately find the config)

---

## 5. Aggressor Cooldown / Criminal Timer

**What we're building:**
A turret targeting system for trade outposts where friendly tribes/characters can safely operate without being shot, but spies or traitors are immediately and persistently targeted if they attack any structure.

**Why we need it:**
The biggest security hole in the current turret priority system: a spy joins a friendly tribe, gets whitelisted, then attacks an SSU or structure. Our extension detects this via `is_aggressor` and assigns maximum priority weight — but **only while they're actively attacking**. The moment they stop (`STOPPED_ATTACK` trigger), `is_aggressor` resets to `false`, and on re-evaluation they're "friendly" again. This lets spies cycle: attack → stop → repair/recharge → resume attacking, exploiting the amnesia.

In EVE Online, this is solved with a "weapons timer" / "criminal timer" that persists for 60 seconds after the last aggressive action. Something similar would prevent the stop-and-repair exploit entirely.

**Current blocker:**
- `is_aggressor` is a boolean that only reflects *current* combat state — no cooldown/timer after stopping
- Turret extensions run via devInspect (read-only), so we can't persist a "has attacked" blacklist
- There's no `time_since_last_attack` or `aggressor_timer` field on TargetCandidate
- The `behaviour_change` field tells us WHY re-evaluation was triggered, but doesn't tell us about other candidates' recent attack history

**What CCP would need to change:**
Any of these would solve it (ordered from simplest to most flexible):

1. **Aggressor cooldown on `is_aggressor`** (simplest) — Keep `is_aggressor = true` for N seconds after `STOPPED_ATTACK`. The field already exists; just delay when it flips to false. This could be a server-side setting (e.g., 60s cooldown) or configurable per turret/extension.

2. **Add `time_since_last_attack: u64` to TargetCandidate** — Let the extension decide the cooldown duration. Our logic would be: `if (is_friendly && time_since_last_attack < 120_000) { weight = BETRAYAL; }`

3. **Add `has_attacked: bool` to TargetCandidate** — A persistent flag that stays true once a character attacks anything on the grid, only clearing when they leave the grid entirely (warp off / dock). This is the most secure option — once you shoot, you're hostile until you leave.

**Impact if resolved:**
- Safe trade outposts where friendlies can operate without turret fire
- Spies/traitors can't exploit the stop-repair-resume cycle
- No need for turret write capability just for this use case (stays in devInspect)
- Enables "criminal timer" gameplay similar to EVE Online's proven security model

---

## 6. Turret Extension Write Capability (Selective)

**What we're building:**
Turret extensions that can emit events or write minimal state (e.g., kill counters, engagement logs, persistent blacklists) during targeting.

**Why we need it:**
Gate extensions can write to chain (issue permits, modify state). Turret extensions are read-only (devInspect). While read-only is fine for pure targeting logic, there are use cases where minimal writes would be valuable:
- Persistent aggressor blacklist (a "once a traitor, always a traitor" list that survives across evaluations — complements request #5 for cases where the game-level timer isn't enough)
- Engagement counters (how many times a target was prioritized)
- Threat scoring that persists across evaluations
- On-chain audit trail of targeting decisions

Note: Events emitted during devInspect are NOT persisted. The `PriorityListUpdatedEvent` in turret_shoot_all fires during devInspect but is only visible in the devInspect result — it's not recorded on-chain.

**Current blocker:**
The game server runs turret extensions via devInspect, which is explicitly read-only. No state changes or events are persisted.

**What CCP would need to change:**
This is a bigger ask — switching from devInspect to actual transaction execution for turret extensions. The tradeoff is gas costs (someone must pay) and latency (transactions are slower than devInspect). A middle ground might be:
- Keep devInspect for the targeting decision
- Add a separate callback transaction after the turret fires (e.g., `on_target_engaged(turret, target_id, config, ctx)`)

**Impact if resolved:**
- Persistent aggressor blacklists (spy attacks once → blacklisted permanently until owner clears)
- Persistent engagement analytics
- Bounty-linked turret kills (turret fires → on-chain record → bounty claim)
- Progressive threat scoring that improves targeting over time

---

## 7. SSU Extension Entry Points for Access Control

> **STATUS: RESOLVED (verified Cycle 6 / 2026-06-26).** `storage_unit::authorize_extension` exists
> and our own `ssu_unified` already ships payment-gated vending end-to-end: `buy_and_receive` splits
> payment, withdraws from open inventory, and delivers to the payer atomically (shipped v0.0.18,
> Plan 13). The original blocker -- "verify the entry points exist" -- is closed; the SSU extension
> surface is sufficient for access-controlled storage. **This is NOT a Cycle 6 unblock** -- it was
> already possible; C6 only enriches the dashboard (see Cycle 6 Update below). A general
> `can_deposit()`/`can_withdraw()` ACL hook (parity with gate's `can_jump()`) remains a nice-to-have
> for non-payment allowlists, but the headline vending use case is done. Tracked forward as Plan 28
> FR7 (RESOLVED) and the vending price-table feature in Plan 30 Deferred (an our-Move change, not a
> CCP ask).

**What we're building:**
SSU access control — controlling who can deposit/withdraw items from storage units, similar to gate access control.

**Why we need it:**
Gates have `can_jump()`, turrets have `get_target_priority_list()`. SSUs need an equivalent entry point for deposit/withdrawal authorization. This would enable vending machines (payment-gated withdrawal), faction-locked storage, and access-controlled supply depots.

**Current blocker (resolved):**
~~Need to verify what SSU extension entry points exist in world-contracts.~~ Verified: `storage_unit`
exposes `authorize_extension`, and payment-gated vending is built on the open-inventory deposit/
withdraw paths (`deposit_to_open_inventory` / `withdraw_from_open_inventory`), which `ssu_unified`
composes atomically. Remaining gap is only a generic, non-payment ACL predicate hook.

**What CCP would need to clarify/add (remaining nice-to-have):**
1. ~~Document the SSU extension entry point signature~~ (confirmed to exist)
2. Optionally add `can_deposit()` / `can_withdraw()` predicate hooks similar to gate's `can_jump()` for non-payment allowlist gating
3. Clarify whether such predicate hooks would run via devInspect (read-only) or real transactions

**Impact (mostly already deliverable):**
- Access-controlled storage (tribe/character allowlists) — buildable today via our composites
- Vending machines (payment-gated item withdrawal) — **shipped** (`buy_and_receive`)
- Faction supply depots (only allies can access) — needs the remaining predicate-hook nice-to-have

---

## 8. Structure Under Attack Event

**What we're building:**
Real-time betrayal detection and automated defense response. When a whitelisted "friendly" player attacks any structure (SSU, gate, turret), Periscope detects it immediately and offers one-click revocation of their permissions across all assemblies.

**Why we need it:**
Currently, the only on-chain evidence of combat is `KillmailCreatedEvent`, which fires only when a structure is **destroyed** — far too late. By the time we detect the betrayal via killmail, the structure is already dead. We need to detect the attack while it's happening, not after the damage is done.

The turret's `is_aggressor` field detects aggression in real-time, but only within the turret extension's devInspect call — it can't notify external systems (dApps, other extensions). There's no way for Periscope to subscribe to "this player started attacking your base" events.

**Current blocker:**
- `KillmailCreatedEvent` only fires on destruction, not damage
- No `StructureUnderAttackEvent` or `AggressionEvent` exists
- Turret's `is_aggressor` flag is only visible inside the turret extension's devInspect — no external event is emitted
- No way to poll or subscribe to combat state from a dApp

**What CCP would need to change:**
Add an on-chain event (or server-side webhook) when a structure takes damage:

```move
public struct StructureUnderAttackEvent has copy, drop {
    assembly_id: ID,
    attacker_character_id: u64,
    attacker_tribe: u32,
    damage: u64,
    assembly_type: u8,       // turret/gate/ssu
    solar_system_id: u64,
    timestamp: u64,
}
```

This could be:
1. **On-chain event** emitted by the game server when damage is dealt (allows dApp subscription via `suiClient.subscribeEvent`)
2. **Webhook/SSE endpoint** from the game server (lighter weight, no gas cost)
3. **Extension callback** — an optional `on_structure_attacked(assembly, attacker, config, ctx)` entry point called on the assembly's authorized extension

**Impact if resolved:**
- Real-time betrayal detection: dApp instantly knows when a friendly attacks
- Automated defense response: one-click permission revocation across all assemblies
- Alert systems: push notifications to Discord/Slack when structures are under attack
- Combat analytics: track who attacks what, when, and how often
- Insurance/bounty integration: link damage events to economic contracts

---

## Priority Summary

| # | Request | Impact | Effort (CCP) |
|---|---------|--------|---------------|
| 1 | Turret config object in devInspect | High — unlocks dynamic targeting | Medium — PTB construction change |
| 2 | Manual retarget trigger | High — real-time combat control | Medium — new event/transaction |
| 3 | Dynamic fields on assemblies | High — cleaner config model | Low — one new function |
| 4 | Config object discovery | Medium — UX for multi-admin | Low — event field addition |
| 5 | Aggressor cooldown / criminal timer | **Critical** — trade outpost security | **Low** — timer on existing field |
| 6 | Turret write capability | Medium — analytics/blacklists | High — architecture change |
| 7 | SSU extension entry points | ~~Medium~~ **RESOLVED** — vending shipped; only a generic ACL hook remains | Low — optional predicate hook |
| 8 | Structure under attack event | **Critical** — real-time defense | **Low** — emit event on damage |

---

## Recent Updates

- **v0.0.19 (Mar 20):** PR #137 merged -- `revoke_extension_authorization()` shipped for Gate, Turret, StorageUnit. Emits `ExtensionRevokedEvent`. Respects `extension_freeze`. Our issue #139 closed.
- **v0.0.19 also added:** `hp_ratio()`, `shield_ratio()`, `armor_ratio()` public getters on `TargetCandidate`. Useful for turret targeting but doesn't address #5 aggressor cooldown.
- **v0.0.20 (Mar 22):** `JumpPermitIssuedEvent` added for indexable gate permits.
- **v0.0.21 (Mar 22):** Updated package IDs after world upgrade.
- **Open inventory (v0.0.18):** Already used by our `ssu_market` contract.

---

## Cycle 6 Update (2026-06-26)

Cycle 6 ("Sanctuary", Stillness) republished the world contracts (new package IDs; pinned at
`world-contracts` main commit `d1929fad7`). We audited the full `v0.0.23 -> HEAD` delta against all 8
requests above. **Verdict: Cycle 6 added exactly two gameplay changes to the world, and neither
resolves a request on this list.**

**What Cycle 6 actually changed (the only two gameplay deltas):**

1. **`inventory_key` on deposit/withdraw events (PR #155, BREAKING).** `inventory.move` /
   `storage_unit.move` replaced `ItemDepositedEvent`/`ItemWithdrawnEvent` with
   `ItemDepositedEventV2`/`ItemWithdrawnEventV2`, adding an `inventory_key: ID` field that
   self-identifies which inventory partition moved (owner main = `owner_cap_id`, open/escrow = the
   open-inventory key, per-player slot = that player's Character `OwnerCap` id). The V1 structs still
   exist but are **never emitted**. This is purely an **observability** upgrade -- it adds **no new
   callable capability** -- so it unblocks nothing here; it only lets us attribute who-moved-what at
   the event level instead of via separate state reads. (We consume it in Plan 30.) **Action item for
   anyone indexing EVE Frontier events: migrate to the V2 type names or deposit/withdraw events
   silently vanish after the cutover.**

2. **New `rift/rift.move` system (PR #166), NET-NEW.** A server-controlled (`admin_acl.verify_sponsor`)
   shared object emitting `RiftSpawnedEvent { rift_id, rift_key, location_hash }` and
   `RiftLocationBroadcastEvent { rift_id, rift_key, location_hash, solarsystem, x, y, z }`. The
   broadcast reveals plaintext coordinates when mining begins (for PvP interference). Read-only,
   indexable by any dApp. (We index it in Plan 29 -- "Rift Intel".) Not a request on this list, but a
   welcome net-new event stream.

**What did NOT change (requests still unaddressed):**

- **#1, #2, #3, #4, #6, #8 -- still blocked.** `turret.move`, `gate.move`, and `assembly.move` are
  **byte-identical** from v0.0.21 through HEAD. No turret config object, no retarget trigger, no
  dynamic-field write hook, no config discovery, no turret write capability, no structure-under-attack
  event.
- **#5 (aggressor cooldown / criminal timer) -- still blocked, still the most important security ask.**
  No change to `is_aggressor` semantics or `TargetCandidate`.
- **#7 (SSU extension entry points) -- RESOLVED, but not by Cycle 6.** The entry points existed since
  v0.0.18; payment-gated vending has been shipped in our `ssu_unified` since then. C6's `inventory_key`
  only enriches the dashboard. A generic non-payment ACL predicate hook (`can_deposit`/`can_withdraw`)
  remains a nice-to-have.

**Net:** the highest-impact open requests for us remain **#5 (criminal timer)** and **#8 (structure
under attack event)** -- both rated Critical, both Low effort for CCP, both untouched by Cycle 6.

---

*Last updated: 2026-06-26 (Cycle 6 audit)*
*Project: Frontier Periscope*
