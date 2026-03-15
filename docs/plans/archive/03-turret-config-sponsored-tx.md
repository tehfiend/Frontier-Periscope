# Turret Priority Customization UI + Sponsored Transactions

**Status:** ARCHIVED (2026-03-14) — All 3 milestones implemented. Gas station API (`apps/gas-station/`) built with all endpoints. Sponsored transaction hook and TurretConfig view exist in Periscope. Turret config UI later enhanced by Plan 04 (GovernanceTurrets view).

**Context:** Users need to configure turret targeting rules (friend/foe lists, weights, ship classes) through the Periscope UI without running CLI tools or paying gas. The turret extension's game-server signature is fixed (4 params, no config object), so targeting rules must be baked as constants at compile time — meaning each customization requires generating, compiling, and publishing a new Move package.

---

## Architecture

### Why not dynamic config?

The game server calls `get_target_priority_list(turret, character, candidates, receipt)` — a fixed signature. Unlike gates (which accept `&ExtensionConfig`), turrets cannot receive extra objects. Constants must be baked at compile time.

### Two components needed

1. **Build Service** (`apps/gas-station`) — lightweight Express API that compiles + publishes Move packages and sponsors gas for transactions. Runs locally or hosted.
2. **Periscope UI** — turret config form + deploy flow using sponsored transactions.

---

## File Structure

### New: `apps/gas-station/` (Express API)

```
apps/gas-station/
  package.json
  tsconfig.json
  src/
    index.ts              — Express server (3 endpoints)
    buildTurret.ts        — Generate source → sui move build → sui client publish
    sponsor.ts            — Validate + co-sign transactions with gas wallet
    config.ts             — Allowed operations whitelist, wallet config
```

### New files in `apps/periscope/src/`

```
hooks/useSponsoredTransaction.ts   — Hook wrapping dapp-kit signing with gas station sponsorship
views/TurretConfig.tsx             — Turret priority configuration form + deploy
components/extensions/TurretPriorityForm.tsx — The actual form fields
```

### Modified files

```
apps/periscope/src/chain/config.ts           — Add gas station URL to tenant config
apps/periscope/src/hooks/useExtensionDeploy.ts — Add sponsored transaction option
apps/periscope/src/router.tsx                — Add /turret-config route
apps/periscope/src/components/Sidebar.tsx     — Add nav item under Tools
packages/chain-shared/src/turret-priority.ts  — Fix hp_ratio() in generator (same bug as contract)
```

---

## Implementation (3 Milestones)

### M1: Gas Station API

**`apps/gas-station/src/index.ts`** — Express server with 3 endpoints:

1. `POST /build-turret` — Accepts `TurretPriorityConfig`, returns `{ packageId }`.
   - Generates Move source via `generateTurretPrioritySource(config)`
   - Generates Move.toml via `generateTurretPriorityManifest()`
   - Writes to temp dir
   - Runs `sui move build` + `sui client publish --skip-dependency-verification --allow-dirty --json`
   - Parses output for packageId
   - Cleans up temp dir
   - Gas paid by station wallet

2. `POST /sponsor` — Accepts `{ txBytes: string }`, returns `{ sponsorSignature: string }`.
   - Deserializes transaction
   - Validates it's an allowed operation (authorize_extension or config call on our packages)
   - Signs as gas owner with station wallet keypair
   - Returns the sponsor's signature

3. `GET /health` — Returns wallet balance and status.

**`apps/gas-station/src/config.ts`**:
- Station wallet private key from `GAS_STATION_PRIVATE_KEY` env var
- Allowed package IDs (our 10 deployed contracts)
- Sui testnet RPC URL

**`apps/gas-station/src/sponsor.ts`**:
- `sponsorTransaction(txBytes)` — loads keypair, signs, returns signature
- Validation: parse transaction, check that all MoveCall targets are in allowed packages
- Reject arbitrary transactions (prevents abuse)

**`apps/gas-station/src/buildTurret.ts`**:
- `buildAndPublishTurret(config)` — full pipeline
- Uses `child_process.execSync` for `sui move build` and `sui client publish`
- Temp dir per request, cleaned up after
- Returns packageId
- Applies the hp_ratio fix and character_id u32→u64 cast in generated source

### M2: Sponsored Transaction Hook in Periscope

**`hooks/useSponsoredTransaction.ts`**:
```typescript
// Flow:
// 1. Build Transaction object
// 2. Serialize to bytes
// 3. POST /sponsor → get sponsor signature
// 4. User signs via wallet (signTransaction, NOT signAndExecute)
// 5. Combine both signatures
// 6. Execute with client.executeTransactionBlock({ signatures: [user, sponsor] })
```

Uses `useSignTransaction()` from dapp-kit (sign-only, not execute) + `useSuiClient()` for manual execution with both signatures.

**`hooks/useExtensionDeploy.ts`** — modify to support sponsored mode:
- Add `sponsored: boolean` option to `deploy()` params
- When sponsored: use `useSponsoredTransaction` instead of `signAndExecute`
- Fallback: if gas station is down, use normal user-pays flow

### M3: Turret Config UI

**`views/TurretConfig.tsx`** — Route: `/turret-config`
- Dropdown: select which turret to configure (from owned turrets in db.deployables)
- Turret type auto-detected → pre-fills effective ship classes
- Form sections:
  - **Weights**: sliders for DEFAULT, KOS, AGGRESSOR, BETRAYAL, LOW_HP, CLASS (with defaults pre-filled)
  - **Friendly List**: add tribe IDs / character IDs (8 slots each)
  - **KOS List**: add tribe IDs / character IDs (4 slots each)
  - **Ship Classes**: checkboxes for the 6 ship classes
- Preview: "This turret will..." summary of targeting behavior
- **Deploy button**:
  1. POST to gas station `/build-turret` with config → gets packageId
  2. Build authorize_extension transaction
  3. Sponsor + sign → execute
  4. Record in db.extensions
  5. Show success with Suivision link

**`components/Sidebar.tsx`** — Add "Turret Config" under Tools group

**`router.tsx`** — Add `/turret-config` route (lazy-loaded)

**`chain/config.ts`** — Add `gasStationUrl` to tenant config:
```typescript
gasStationUrl: "http://localhost:3100", // local dev
```

---

## Sponsored Transaction Flow (detail)

```
User (Periscope)                    Gas Station                     Sui Network
     │                                   │                               │
     │  POST /build-turret {config}      │                               │
     │──────────────────────────────────>│                               │
     │                                   │ generate source               │
     │                                   │ sui move build                │
     │                                   │ sui client publish ──────────>│
     │                                   │<─────── packageId ───────────│
     │<──────── { packageId } ──────────│                               │
     │                                   │                               │
     │  Build authorize_extension tx     │                               │
     │  POST /sponsor { txBytes }        │                               │
     │──────────────────────────────────>│                               │
     │                                   │ validate + sign as gas owner  │
     │<──── { sponsorSignature } ───────│                               │
     │                                   │                               │
     │  Sign tx via EVE Vault            │                               │
     │  Execute with [user, sponsor]     │                               │
     │──────────────────────────────────────────────────────────────────>│
     │<──────────────────────────── tx digest ──────────────────────────│
```

---

## Key Design Decisions

**Gas station is minimal:** ~150 lines of Express. Runs locally for dev, can be deployed to any Node.js host for production. No database — stateless.

**Validation prevents abuse:** The `/sponsor` endpoint only signs transactions that call our deployed package IDs. Arbitrary transactions are rejected.

**Graceful fallback:** If gas station is unreachable, Periscope falls back to normal user-pays-gas flow via EVE Vault.

**Station wallet = deploy wallet:** Reuses the same `0xa4dee9...` wallet that deployed the contracts. Already has 1.78 SUI. Can be topped up via faucet.

**hp_ratio commented out in generator too:** The `generateTurretPrioritySource()` still references `candidate.hp_ratio()` which doesn't exist in world-contracts v0.0.18. Fix it to match the deployed contract.

---

## Verification

```bash
# Gas station
cd C:/Dev/TehFrontier && corepack pnpm --filter @tehfrontier/gas-station build && corepack pnpm --filter @tehfrontier/gas-station start

# Periscope
cd C:/Dev/TehFrontier && corepack pnpm exec tsc --noEmit -p apps/periscope/tsconfig.json && corepack pnpm --filter @tehfrontier/periscope build
```
