# Feature Request: Runtime Turret Configuration

**Submitted by:** TehFrontier Periscope
**Date:** 2026-03-26
**Status:** Confirmed planned by CCP (post-hackathon). CCP Legolas confirmed shared object support for turrets is planned after the hackathon (Discord, 2026-03-26).

## Summary

Request runtime-configurable turret targeting behavior, analogous to how gates handle standings configuration today.

## Current Behavior (Turrets)

Turret extensions use Move modules with **compile-time constants** for all targeting parameters. When a turret owner wants to change targeting rules (weights, friend/foe lists), they must:

1. Generate new Move source code with updated constants
2. Compile the new package
3. Publish the new package (paying gas + storage fees)
4. Authorize the new extension on the turret (revoking the old one)

This makes standings-based targeting impractical -- every time a registry entry changes, every turret referencing that registry needs a full republish cycle.

## Current Behavior (Gates -- the model to follow)

Gate extensions use a **shared config object** (`GateStandingsConfig`) stored on-chain. The gate extension reads this config at runtime via `config::get_gate_config()`. When standings change, the gate automatically picks up the new values on the next access check. Gate owners can update config via `config::set_gate_config()` without republishing anything.

## Requested Behavior (Turrets)

Add a shared config object for turrets (e.g., `TurretPriorityConfig`) that the turret extension reads at runtime, containing:

- **Weight constants:** `defaultWeight`, `kosWeight`, `aggressorBonus`, `betrayalBonus`, `lowHpBonus`, `lowHpThreshold`, `classBonus`
- **Effective classes:** ship class group IDs the turret is effective against
- **Registry reference:** `registryId` pointing to a `StandingsRegistry` object
- **Standing thresholds:** `friendlyThreshold` and `kosThreshold` for classifying registry entries

The turret extension would read the config + registry at runtime (like gates do), eliminating the need for republishing when standings or weights change.

## Benefits

1. **No republish cycle** -- changing targeting rules is a single config transaction
2. **Live standings integration** -- turrets automatically pick up registry changes
3. **Consistent model** -- turrets work the same way as gates (runtime config object)
4. **Lower cost** -- config updates are cheap transactions vs. full package publish
5. **Better UX** -- one-click config changes vs. multi-step compile/publish/authorize flow

## Reference Implementation

The gate standings system (`gate-standings` package) provides a working reference:
- `set_gate_config()` stores config in a shared object
- The gate extension reads config + registry at runtime per access check
- Config updates are instant, no republish needed

A similar pattern for turrets would store targeting weights + registry reference in a shared config object, and the turret extension would read this config when computing priority lists.
