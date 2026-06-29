# Runbook -- EVE Frontier Log Format Audit

**Purpose:** EVE Frontier does not document its client log format or changelog. Every client
update can silently add new event tags, change a line format (breaking our regexes), or
introduce new content (deployables, mechanics). This runbook is the tripwire: re-run it after
each client patch to detect drift and decide whether `logParser.ts` needs updating.

**Run cadence:** after every EVE Frontier client update, or at the start of each new cycle.

**Related:** plan `docs/plans/active/37-log-event-capture-expansion.md` -- the implementation work
this audit feeds.

**Environment:** Git Bash on Windows. Logs live at
`/c/Users/tehfiend/Documents/Frontier/logs` with subdirs `Gamelogs/`, `Chatlogs/`,
`Fleetlogs/`, `Marketlogs/`. Gamelogs are ASCII/UTF-8; **Chatlogs are UTF-16LE** (decode or
strip null bytes before grepping).

---

## Procedure

### Step 0 -- Set the window

Pick the date the client updated (or cycle start). Everything modified on/after that is "new".

```bash
LOGS=/c/Users/tehfiend/Documents/Frontier/logs
SINCE=2026-06-25          # client-update / cycle-start date
# List new gamelogs by mtime, largest last
find "$LOGS/Gamelogs" -name '*.txt' -newermt "$SINCE" -printf '%TY-%Tm-%Td %10s  %p\n' | sort
```

### Step 1 -- Extract the tag set + frequencies

The tag is the parenthesized token after the timestamp: `[ ts ] (tag) payload`.

```bash
# All message-type tags across new gamelogs, with counts
find "$LOGS/Gamelogs" -name '*.txt' -newermt "$SINCE" -print0 \
  | xargs -0 grep -hoE '^\[ [0-9.]+ [0-9:]+ \] \(([A-Za-z]+)\)' \
  | grep -oE '\([A-Za-z]+\)' | sort | uniq -c | sort -rn
```

Compare the output against the **Baseline tag set** below.
- A tag NOT in the baseline = **new tag** -> the parser has no `case` for it -> data is being
  dropped. High priority. Add it to the `switch` in `logParser.ts` and to the baseline here.
- A baseline tag missing from output = the activity just didn't happen this window (not drift).

### Step 2 -- Within each tag, extract distinct message templates

Raw lines vary by numbers/names. Normalize them to templates so distinct *formats* collapse:
strip EVE markup, replace digits with `#`, then take the leading words.

```bash
# Distinct normalized templates for a given tag (e.g. notify)
TAG=notify
find "$LOGS/Gamelogs" -name '*.txt' -newermt "$SINCE" -print0 \
  | xargs -0 grep -hE "\($TAG\)" \
  | sed -E 's/<[^>]+>//g'         `# strip markup` \
  | sed -E 's/\([A-Za-z]+\)//'    `# drop the tag` \
  | sed -E 's/[0-9][0-9.,]*/#/g'  `# numbers -> #` \
  | sed -E 's/^[][ 0-9.:#-]+//'   `# drop leading timestamp remnants` \
  | cut -c1-60 | sort | uniq -c | sort -rn | head -50
```

Repeat for each tag (`combat`, `mining`, `info`, `hint`, `question`, `warning`, `None`, `SYS`).
Eyeball the templates against the **Known captured patterns** table. Anything unfamiliar is a
candidate new event.

### Step 3 -- Chatlogs (UTF-16LE)

```bash
# Distinct chat "system" lines (Keeper) -- channel changes, MOTDs, etc.
find "$LOGS/Chatlogs" -name '*.txt' -newermt "$SINCE" -print0 \
  | xargs -0 -I{} sh -c "iconv -f UTF-16LE -t UTF-8 '{}' 2>/dev/null || tr -d '\000' < '{}'" \
  | grep -aE '\] Keeper >' \
  | sed -E 's/[0-9][0-9.,]*/#/g' | sed -E 's/^.*Keeper > //' \
  | sort | uniq -c | sort -rn | head -30
```

`iconv` may be unavailable; the `tr -d '\000'` fallback strips null bytes well enough to grep.
Confirm `Channel changed to Local : <system>` still matches `SYSTEM_CHANGE_RE` -- it is the
location signal sonar depends on.

### Step 4 -- Map findings to parser coverage

For each unfamiliar template from Steps 2-3, classify against `apps/periscope/src/lib/logParser.ts`:
- **Dropped** -- tag has no `case`, or a `combat` line matches none of the 4 combat regexes ->
  nothing stored. (Worst: invisible.)
- **Generic** -- lands in catch-all `notify`/`info`/`hint`/`question` -> stored but never
  synthesized into a sonar event/ping.
- **Captured** -- matches a specific `*_RE` -> typed event exists.

A quick way to see which regexes exist:

```bash
grep -nE '_RE =|case "' /c/Projects/periscope/apps/periscope/src/lib/logParser.ts
```

### Step 5 -- Regression check (did a format break?)

For each baseline-captured pattern, confirm it still appears for activity that clearly happened
this window. If you mined but `MINING_RE` produced zero hits, the markup/format changed -> the
regex is broken even though the tag is unchanged. This is the silent-breakage case the audit
exists to catch.

```bash
# Example: confirm mining lines still carry the expected color/font markup
find "$LOGS/Gamelogs" -name '*.txt' -newermt "$SINCE" -print0 \
  | xargs -0 grep -hE '\(mining\)' | head -3
```

### Step 6 -- Record decisions and bump the baseline

In the **Audit log** below, add a dated row: client/cycle, new tags, new templates, what was
broken, and the decision (capture now / defer / no change). Then update the **Baseline tag set**
and **Known captured patterns** so the next run only flags genuinely new drift. If new capture
work is warranted, open or update a plan (e.g. plan 37) referencing this audit entry.

---

## Baseline -- last verified cycle 6 (2026-06-25 .. 2026-06-29)

### Baseline tag set (gamelogs)

`mining`, `combat`, `notify`, `info`, `hint`, `question`, `None`, `warning`, `SYS`.

> Parser `switch` has cases for: `mining`, `combat`, `notify`, `info`, `hint`, `question`,
> `warning`, `None`, `SYS` (plan 37 added `warning` and `None`). No missing cases as of cycle 6.

### Known captured patterns (regex -> event type, logParser.ts)

| Regex const | Tag | Event type | Status |
|---|---|---|---|
| `MINING_RE` | mining | `mining` | captured |
| `DAMAGE_DEALT_RE` | combat | `combat_dealt` | captured |
| `DAMAGE_RECV_RE` | combat | `combat_received` | captured |
| `MISS_DEALT_RE` | combat | `miss_dealt` | captured |
| `MISS_RECV_RE` | combat | `miss_received` | captured |
| `STRUCTURE_DEPARTED_RE` | notify | `structure_departed` | captured |
| `GATE_OFFLINE_RE` | notify | `gate_offline` | captured |
| `BUILD_FAIL_RE` | notify/hint | `build_fail` | captured |
| `DISMANTLE_RE` | question | `dismantle` | captured |
| `ASTEROID_DEPLETED_RE` | SYS | `asteroid_depleted` | captured |
| `CARGO_FULL_RE` | notify/info/hint/SYS | `cargo_full` | captured |
| (chat) `SYSTEM_CHANGE_RE` | -- | `system_change` | captured |
| `SELF_DESTRUCT_RE` | warning/notify | `self_destruct` | captured (plan 37) |
| `AGGRESSION_LOCK_RE` | notify | `aggression_lock` | captured (plan 37) |
| `WARP_BLOCKED_RE` | notify | `warp_blocked` | captured (plan 37; inbound tackle) |
| `PLACEMENT_FAIL_RE` | notify/hint | `placement_fail` | captured (plan 37) |
| `MINING_RANGE_RE` | notify | `mining_interrupted` | captured (plan 37; feeds mining-end reason) |
| `TARGET_RANGE_RE` | notify | `target_out_of_range` | captured (plan 37) -- **format unverified for cycle 6** (absent from cycle 6 logs); verify wording on next combat-heavy log |
| `MODULE_FAIL_RE` | notify | `module_failed` | captured (plan 37; cap/PowerGrid) |
| `DISRUPTION_RE` | info | `disruption` | captured (plan 37) |
| `SIGHTLINE_RE` | combat | `sightline_obscured` | captured (plan 37; presence flag, name is literal "Unknown") |
| `CONVO_INVITE_RE` | None | `conversation_invite` | captured (plan 37) |
| `FLEET_INVITE_RE` | question | `fleet_invite` | captured (plan 37) |
| `CANCEL_CONSTRUCTION_RE` | question | `cancel_construction` | captured (plan 37) |

### Known-but-uncaptured templates as of cycle 6

Plan 37 landed (2026-06-29); the cycle 6 captures above moved into the captured table. What
remains intentionally generic (decided in plan 37 -- do not re-flag as "new"):

- `(notify)` SSU/container errors (singleton items / locked / withdraw fail) -> generic `notify`
  (G12: UI misclicks, already legible in the raw feed; capturing them adds noise, not signal).

Watch items for the next audit:

- `TARGET_RANGE_RE` (`target_out_of_range`, G13) ships with its regex **unverified** -- the format
  `The target <ShipType> is too far away. It must be within N km.` was absent from cycle 6 logs.
  Confirm the wording (and that the ship-type capture works) against an older combat-heavy log or
  the next live combat, and adjust if CCP changed it.
- The mining-module vs warp/jump "External factors are preventing your X from responding" split:
  the mining variant is captured via `MINING_RANGE_RE` ("deactivates without transfering ore"), the
  warp/jump variant via `WARP_BLOCKED_RE`. If CCP unifies or rewords either, both regexes need a look.

### Cycle 6 content vocabulary (for recognizing context, not regexes)

Deployables/structures: **Network Node, Assembly, Field Cairn, Refuge**. Ship class:
**Creation** (e.g. `Creation #EX-JLN`). Mining module: **Small Cutting Laser**. Ore types:
Aromatic Carbon Veins, Cargo Debris, Feldspar Crystals, Hydrated Sulfide Matrix, Iridosmine
Nodules, Methane Ice Shards, Platinum-Palladium Matrix, Primitive Kerogen Matrix, Tholin Nodules.

### Known data-quality issues

- Localization template leak in a `notify` line:
  `The {targetGroupName} is too far away, you need to be within {[numeric]desiredRange,
  decimalPlaces=2} meters of it.` -- a proximity parser must tolerate this malformed variant.
- `Fleetlogs/` and `Marketlogs/` exist but are empty -- no parser work until populated.

---

## Audit log

| Date | Client / Cycle | New tags | New/changed templates | Broken regexes | Decision |
|---|---|---|---|---|---|
| 2026-06-29 | Cycle 6 (live 06-25) | none | 13 uncaptured (see list above) | none | Capture via plan 37; established this runbook + baseline |
| 2026-06-29 | Cycle 6 (live 06-25) | none | -- | none | Plan 37 landed: 12 new `*_RE` captures (`warning`/`None` cases added). G12 container fumbles left generic; `TARGET_RANGE_RE` regex ships unverified (G13 absent from cycle 6) -- flagged for next audit |
