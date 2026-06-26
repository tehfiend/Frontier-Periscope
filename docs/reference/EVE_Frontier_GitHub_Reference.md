# EVE Frontier GitHub Reference

**Organization:** https://github.com/evefrontier
**Created:** September 11, 2024
**Website:** https://evefrontier.com
**Twitter:** @EVE_Frontier
**Status:** Verified organization, 7 public repos
**Last Updated:** 2026-03-08

**Legacy Organization:** https://github.com/projectawakening (EVM/Solidity era)

---

## Active Repositories (evefrontier org)

### 1. world-contracts (Core)
- **URL:** https://github.com/evefrontier/world-contracts
- **Language:** Move (74.2%), TypeScript (22.9%), Shell (1.8%)
- **Stars:** 16 | **Forks:** 12
- **Description:** Core Move smart contracts for the EVE Frontier world on Sui
- **Latest Release:** v0.0.16 (Mar 6, 2026) — 15 releases total, 87 commits
- **Status:** ⚠️ "Intended for future use" — not currently active in game or production ready. Under active development.
- **Structure:**
  - `contracts/world/sources/` — Core game contracts (Move)
    - `access/` — Access control (AdminACL, OwnerCap)
    - `assemblies/` — Smart Assemblies (gate, storage_unit, turret)
    - `character/` — Character/identity system
    - `crypto/` — Cryptographic utilities
    - `killmail/` — PvP kill tracking
    - `network_node/` — Power/energy infrastructure
    - `primitives/` — Core primitives (energy, fuel, inventory, location, metadata, status)
    - `registry/` — Object registry and ID derivation
    - `world.move` — Top-level entry point
  - `contracts/extension_examples/` — Third-party extension examples
  - `ts-scripts/` — TypeScript deployment/admin scripts
  - `scripts/` — Shell deployment scripts (localnet/devnet/testnet/mainnet)
  - `docker/` — Containerized deployment
  - `tools/error-decoder/` — Error decoding utility
  - `docs/` — Architecture ADR, debugging guide
- **Key Modules:** world, access_control, character, network_node, assembly, gate, storage_unit, turret, killmail, object_registry
- **Primitives:** energy, fuel, inventory, location, metadata, status, in_game_id

#### Recent Releases (since v0.0.12)
| Version | Date | Key Changes |
|---------|------|-------------|
| **v0.0.16** | Mar 6 | Additional sponsors for deployment flow, assembly-level metadata, ExtensionAuthorizedEvent, unlink/unanchor options, Character type detection fix, PlayerProfile refactor |
| **v0.0.15** | Mar 3 | Inventory item split/join semantics, AdminACL removal from owned interactions, turret additions, energy source function updates |
| **v0.0.14** | Feb 27 | Gate link/unlink events, event emission in sponsored txns, turret implementation, EVE asset creation |
| **v0.0.13** | Feb 23 | Admin-cap-to-admin-acl migration, sponsor verification, Sui SDK v1→v2 upgrade |
| **v0.0.12** | Feb 18 | TypeScript examples, owner cap borrowing fixes, fuel deletion event handling |

#### Notable Recent Commits (Mar 2026)
- Fix offline guard for extension withdraw in storage units (#120)
- PlayerProfile refactor — create temp profile and transfer to wallet address (#119)
- Integration test CI job added (#109)
- Killmail refactor (#114)

### 2. builder-scaffold (Developer Toolkit)
- **URL:** https://github.com/evefrontier/builder-scaffold
- **Language:** TypeScript (68.9%), Move (14.2%), Shell (12.2%)
- **Stars:** 2 | **Forks:** 4
- **Description:** Templates and tools to build in the EVE Frontier world
- **License:** MIT
- **Structure:**
  - `docker/` — Dev container (Sui CLI + Node.js), simplified single entrypoint
  - `move-contracts/` — Move contract templates:
    - `smart_gate/` — Gate extension example
    - `storage_unit/` — Storage unit extension example
    - `tokens/` — Token contract templates
    - More standalone contracts (multisig, DAO) planned
  - `ts-scripts/` — TypeScript interaction scripts using PTBs
  - `dapps/` — Reference dApp with commenting feature, uses @evefrontier/dapp-kit v0.1.2
  - `zklogin/` — zkLogin CLI for OAuth-based tx signing
  - `setup-world/` — World deployment helpers
- **Three Dev Flows:**
  1. **Docker Flow** (recommended) — No local Sui CLI/Node.js needed, everything containerized
  2. **Host Flow** — Requires local Sui CLI + Node.js
  3. **Existing World** — Build on already-deployed worlds (WIP)
- **Dev Workflow:** Clone → Choose flow → Deploy world → Write Move logic → TS scripts → Build dApp

#### Recent Changes (Feb-Mar 2026)
- PostgreSQL Indexer + GraphQL support added
- dApp commenting feature
- @evefrontier/dapp-kit v0.1.2 integration
- Contributing guidelines (CONTRIBUTING.md)
- Simplified Docker setup (single entrypoint)
- Sui SDK migrated from v1 to v2
- AdminACL sponsor verification
- Stable world-contracts version pinning

### 3. builder-documentation (Docs Site)
- **URL:** https://github.com/evefrontier/builder-documentation
- **Language:** MDX
- **Stars:** 3 | **Forks:** 2
- **Description:** Documentation website for building third-party modifications on EVE Frontier
- **Hosts:** https://docs.evefrontier.com/ (GitBook)
- **Status:** Actively being rewritten for Sui migration; ~18/34 pages complete

### 4. evevault (Wallet)
- **URL:** https://github.com/evefrontier/evevault
- **Language:** TypeScript (94.4%), CSS (4.4%)
- **Stars:** 8 | **Forks:** 0 | **Commits:** 37
- **Description:** Chrome extension and web wallet for Sui using zkLogin authentication
- **Latest Release:** v0.0.6 (Mar 13, 2026)
- **Tech Stack:** WXT (Chrome MV3), React, Zustand, Bun, Turborepo, Biome
- **Architecture:**
  - `packages/shared/` — Cross-platform business logic
  - `apps/extension/` — Chrome MV3 extension
  - `apps/web/` — Web app (forthcoming)
- **Auth:** FusionAuth OAuth → Enoki zkLogin → Sui address derivation
- **Features:** OAuth login (no seed phrases), Sui Wallet Standard, multi-network (devnet/testnet), balance display, tx signing, sponsored transaction signing/execution
- **Requirements:** Node.js 22+, Bun, FusionAuth credentials, Enoki API key
- **Known Limitation:** MaxEpoch expiration requires manual re-authentication
- **Download:** https://github.com/evefrontier/evevault/releases

#### Release History
| Version | Date | Key Changes |
|---------|------|-------------|
| **v0.0.6** | Mar 13 | Balance/transaction refresh improvements, incoming transactions, standardized EVE Token handling, service worker import fix, GraphQL error handling, sponsored tx fix for Utopia |
| **v0.0.3** | Mar 2 | Build fixes, rsync for Amplify, Quasar HTTP proxy, sponsored transaction signing/execution |
| **v0.0.2** | Feb 17 | JWT nonce handling, vault unlock prompts, PWA support, direct extension downloads |
| **v0.0.1** | Feb 6 | Network switching, token transfers, sponsored transactions, core auth workflow |
| **v0.0.0** | Dec 18 | Initial: ephemeral keys, encrypted vault, end-to-end zkLogin, devnet wallet ops |

### 5. eve-frontier-proximity-zk-poc (ZK Proofs)
- **URL:** https://github.com/evefrontier/eve-frontier-proximity-zk-poc
- **Language:** TypeScript
- **Stars:** 1 | **Forks:** 0
- **Description:** Zero-knowledge proof system for obfuscated location and distance verification on Sui
- **Status:** Proof of concept (last updated Dec 2025)
- **ZK System:** Groth16 circuits with Poseidon hashing
  - Location Circuit: ~2,359 constraints, ~320ms proof gen
  - Distance Circuit: ~1,010 constraints, ~250ms proof gen
- **Features:**
  - On-chain verification via Groth16
  - Off-chain POD (Provable Object Datatype) integration with GPC
  - Poseidon Merkle trees for efficient verification
  - Ed25519 signatures for cryptographic binding
  - Distance: Manhattan formula (|x1-x2| + |y1-y2| + |z1-z2|)²
- **Privacy Levels:** POD attestation, selective ZK proofs, Merkle inclusion proofs
- **Dependencies:** Node.js v20+, Rust, Sui CLI, pnpm, Powers of Tau files

### 6. sui-gas-pool (Fork)
- **URL:** https://github.com/evefrontier/sui-gas-pool
- **Language:** Rust
- **Stars:** 0 | **Forks:** 21
- **Description:** Fork for gas sponsorship infrastructure
- **License:** Apache-2.0
- **Status:** Forked repo, last updated Feb 20, 2026

### 7. sui-go-sdk (Fork)
- **URL:** https://github.com/evefrontier/sui-go-sdk
- **Language:** Go
- **Stars:** 0 | **Forks:** 90
- **Description:** Go language SDK for Sui (forked from MystenLabs)
- **License:** Apache-2.0
- **Status:** Forked repo, last updated Nov 20, 2025

---

## Legacy Repositories (projectawakening org — EVM Era)

### 1. world-chain-contracts
- **URL:** https://github.com/projectawakening/world-chain-contracts
- **Language:** Solidity
- **Stars:** 55
- **Description:** EVM smart contracts using MUD framework (tables/systems/namespaces)
- **Last Release:** v0.1.18 (Dec 18, 2025) — development winding down
- **Status:** Being superseded by evefrontier/world-contracts (Sui)

### 2. builder-examples
- **URL:** https://github.com/projectawakening/builder-examples
- **Language:** Solidity
- **Stars:** 91
- **Description:** Examples for Builders to learn from and create in EVE Frontier (EVM era)
- **Status:** Still referenced but being superseded by builder-scaffold

### 3. pod-flow
- **URL:** https://github.com/projectawakening/pod-flow
- **Language:** TypeScript
- **Description:** Mocking environment for POD and smart contract development
- **Status:** Last updated Aug 2025

### 4. contracts-go
- **URL:** https://github.com/projectawakening/contracts-go
- **Language:** Shell
- **Stars:** 4
- **Description:** Abigen generated Go packages from ABIs
- **Status:** Last updated Jun 2025

---

## Repository Dependency Graph

```
evefrontier/world-contracts (Core Move contracts)
    ↑ depends on
evefrontier/builder-scaffold (Dev toolkit + examples)
    ↑ documented by
evefrontier/builder-documentation (docs.evefrontier.com)

evefrontier/evevault (Wallet - standalone)
    → Uses: Sui zkLogin, FusionAuth, Enoki

evefrontier/eve-frontier-proximity-zk-poc (ZK PoC - standalone)
    → Uses: Groth16, Poseidon hashing, Sui derived objects

evefrontier/sui-gas-pool (Fork - infrastructure)
evefrontier/sui-go-sdk (Fork - Go SDK)
```

---

## Key NPM Packages

| Package | Purpose |
|---------|---------|
| `@evefrontier/dapp-kit` | React SDK for building EVE Frontier dApps |
| `@mysten/sui` | Sui TypeScript SDK (dependency) |
| `@mysten/dapp-kit` | Mysten dApp kit for wallet integration |

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Blockchain | Sui L1 |
| Smart Contracts | Move |
| Frontend SDK | TypeScript, React |
| Wallet | Chrome MV3 extension (WXT + React + Zustand) |
| Auth | zkLogin via Enoki + FusionAuth OAuth |
| Package Manager | pnpm (contracts), Bun (wallet) |
| Monorepo | Turborepo (wallet) |
| Privacy | Poseidon2 hashing, Groth16 ZK proofs |
| Deployment | Docker, shell scripts |
| Testing | Move test framework |
