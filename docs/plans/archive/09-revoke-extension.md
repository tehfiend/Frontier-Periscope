# Plan: Revoke Extension Authorization

**Status:** Complete
**Created:** 2026-03-23
**Completed:** 2026-03-23
**Module:** chain-shared, ssu-dapp, periscope
**Phases:** 3/3 complete
**Depends on:** Plan 10 (update package IDs to v0.0.21) -- Move contract git deps already updated to v0.0.21, but TypeScript extension package IDs still need Plan 10. However, the world package ID for Utopia is already correct in our config, so revoke (which only uses world package) is unblocked for Utopia.
**Availability:** Utopia only (v0.0.19+). Stillness is still on v0.0.18 -- does NOT have `revoke_extension_authorization`.

## Overview

world-contracts v0.0.19 (PR #137, merged 2026-03-20) added `revoke_extension_authorization()` for Gate, Turret, and StorageUnit. Requires OwnerCap, respects extension_freeze, sets extension back to `option::none()`, emits `ExtensionRevokedEvent`. Aborts with `ENoExtensionToRevoke` if no extension is set.

**Status update (2026-03-23):** Confirmed unblocked for Utopia. The on-chain function signatures match our `buildRevokeExtensionAuthorization` in chain-shared. Stillness remains on v0.0.18 and does NOT have this function -- revoke is Utopia-only for now.

**On-chain details confirmed:**
- `ExtensionRevokedEvent` emitted with fields: `assembly_id`, `assembly_key`, `revoked_extension`, `owner_cap_id`
- Error codes: `ENoExtensionToRevoke` -- gate=19, turret=12, storage_unit=16
- Additional guard: `!extension_freeze::is_extension_frozen()` -- cannot revoke after freeze

This plan adds:
1. **chain-shared TX builder** -- `buildRevokeExtensionAuthorization` using borrow-cap -> call -> return-cap PTB pattern
2. **SSU dApp revoke button** -- Replace the disabled "Remove Extension" placeholder in `ExtensionInfo.tsx`
3. **Periscope revoke actions** -- "Reset to Default" in Extensions page (`AssemblyCard`) and Structures page Extension column

## Implementation Notes

Implementation diverged from plan in a few minor ways:

- **On-chain function name:** The actual Move function called is `remove_extension` (not `revoke_extension_authorization`). Both chain-shared and periscope use `remove_extension` as the moveCall target.
- **`ASSEMBLY_MODULE_MAP` includes `network_node`:** The chain-shared map includes all assembly types including `network_node`. The periscope hook uses a separate `REVOCABLE_TYPES` set to exclude `network_node` from the revoke UI.
- **SSU dApp builds TX inline:** Rather than importing `buildRevokeExtensionAuthorization` from chain-shared, `ExtensionInfo.tsx` builds the PTB inline (hardcoded to `storage_unit::remove_extension`). This is pragmatic since SSU dApp only handles StorageUnit.
- **Periscope uses its own builder:** `apps/periscope/src/chain/transactions.ts` exports `buildRemoveExtension()` which is used by the `useExtensionRevoke` hook, rather than the chain-shared `buildRevokeExtensionAuthorization`. The `ASSEMBLY_MODULE_MAP` is re-exported from chain-shared.

## Current State

All target features are implemented and functional:

- **chain-shared:** `packages/chain-shared/src/revoke-extension.ts` exports `ASSEMBLY_MODULE_MAP` and `buildRevokeExtensionAuthorization()`. Re-exported from `index.ts`.
- **ssu-dapp:** `ExtensionInfo.tsx` has functional two-step "Remove Extension" button with error handling. `SsuView.tsx` passes `characterObjectId`, `ownerCap`, and `ssuObjectId` props.
- **periscope:** `hooks/useExtensionRevoke.ts` manages revoke status, TX execution, and DB soft-delete. `views/Extensions.tsx` `AssemblyCard` has "Revoke" button with `RevokeButton` sub-component and two-step confirmation. `views/Deployables.tsx` has "Reset" button in Extension column with confirmation flow.

## Target State

- chain-shared exports `buildRevokeExtensionAuthorization()` and `ASSEMBLY_MODULE_MAP` -- DONE
- SSU dApp has functional "Revoke Extension" button (inline two-step confirm) -- DONE
- Periscope Extensions page has "Revoke" button on `AssemblyCard` -- DONE
- Periscope Structures page has "Reset" button in Extension column -- DONE

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TX builder location | New `revoke-extension.ts` in chain-shared | Both ssu-dapp and periscope need it |
| No type parameter on revoke | `revoke_extension_authorization(assembly, ownerCap)` | Unlike authorize, revoke needs no witness type |
| Confirmation UX | Inline two-step (button text changes) | Lightweight, consistent with existing patterns |
| Extension freeze check | Let on-chain abort handle it, decode error | Full freeze detection deferred |
| Hook pattern in periscope | New `useExtensionRevoke.ts` | Mirrors `useExtensionDeploy.ts` with simpler flow |
| OwnerCap argument style | `tx.object(ownerCapId)` (simple ID) | Both ssu-dapp and periscope callers will provide the ID; Sui SDK resolves Receiving args automatically. Simpler than `tx.receivingRef()` which requires version+digest. Consistent with `buildEscrowAndList` in chain-shared. |
| DB cleanup on revoke | Soft-delete (`_deleted: true`) on `db.extensions` and `db.assemblyPolicies` | Matches codebase soft-delete convention (all queries use `notDeleted` filter) |
| Supported assembly types | gate, turret, storage_unit only (smart_storage_unit/protocol_depot alias to storage_unit) | `revoke_extension_authorization` does not exist on network_node. ASSEMBLY_MODULE_MAP must exclude it. |

## Implementation Phases

### Phase 1: chain-shared TX Builder -- COMPLETE

**Module: chain-shared** -- `packages/chain-shared/`

1. Created `packages/chain-shared/src/revoke-extension.ts` with `ASSEMBLY_MODULE_MAP` and `buildRevokeExtensionAuthorization()`.
2. Added re-export to `packages/chain-shared/src/index.ts`.

### Phase 2: SSU dApp Revoke Button -- COMPLETE

**Module: ssu-dapp** -- `apps/ssu-dapp/`

1. Updated `ExtensionInfo.tsx` with additional props, inline PTB construction for `storage_unit::remove_extension`, two-step confirm, error/success state.
2. Updated `SsuView.tsx` to pass `characterObjectId`, `ownerCap`, `ssuObjectId` to `<ExtensionInfo>`.

### Phase 3: Periscope Revoke Actions -- COMPLETE

**Module: periscope** -- `apps/periscope/`

1. Created `hooks/useExtensionRevoke.ts` with `RevokeStatus` type, `canRevokeExtension()` helper, `useExtensionRevoke()` hook with TX execution and DB soft-delete.
2. Updated `views/Extensions.tsx` -- `AssemblyCard` receives `characterId` prop, renders `RevokeButton` component with two-step confirmation.
3. Updated `views/Deployables.tsx` -- Extension column has "Reset" button with confirmation flow via `handleRevoke` callback.

## File Summary

| File | Action | Status |
|------|--------|--------|
| `packages/chain-shared/src/revoke-extension.ts` | Create | Done |
| `packages/chain-shared/src/index.ts` | Modify | Done |
| `apps/ssu-dapp/src/components/ExtensionInfo.tsx` | Modify | Done |
| `apps/ssu-dapp/src/views/SsuView.tsx` | Modify | Done |
| `apps/periscope/src/hooks/useExtensionRevoke.ts` | Create | Done |
| `apps/periscope/src/views/Extensions.tsx` | Modify | Done |
| `apps/periscope/src/views/Deployables.tsx` | Modify | Done |

## Deferred

- **Extension freeze detection** -- Reading `extension_freeze` dynamic field to hide button. For now, on-chain abort + decoded error message.
- **Move authorize_extension to chain-shared** -- Currently in periscope's `chain/transactions.ts`. Should eventually join revoke builder.
- **Consolidate TX builders** -- SSU dApp builds the revoke TX inline rather than using chain-shared's builder. Periscope uses its own `buildRemoveExtension` in `chain/transactions.ts`. Could consolidate to use chain-shared's builder everywhere.
