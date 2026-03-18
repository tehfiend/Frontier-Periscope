# CradleOS — Reality Anchor (Hackathon Competitor)

**Repo:** https://github.com/R4WF0D0G23/REALITY_ANCHOR_EVE_FRONTIER_HACKATHON_2026
**Reviewed:** 2026-03-16

## Overview

On-chain governance and economy stack for EVE Frontier tribes. A tribe command center with Move smart contracts + React dapp, branded as "CradleOS." Targets Utopia testnet.

## Tech Stack

- **Blockchain:** Sui testnet (Move smart contracts, v7–v14 iterations)
- **Frontend:** React + TypeScript + Vite
- **Wallet:** EVE Vault authentication
- **Deployment:** GitHub Pages
- **AI:** Nemotron3-Super LLM via custom proxy
- **Backend:** Python-based oracle and intel APIs

## Project Structure

```
cradleos/                  - Core Move contracts (V7–V14)
cradleos-dapp/             - React web application
gate_policy_pkg/           - Access control module
tribe_roles_pkg/           - Role delegation system
cradleos-agent-proxy/      - AI agent integration
oracle_tx.mjs              - Settlement oracle
api.py                     - Intel & oracle APIs
```

## Smart Contracts

| Module | Purpose |
|--------|---------|
| TribeVault | Token (CRDL) and treasury operations |
| DefensePolicy | Security levels and relations management |
| CargoContract | Verified delivery with dispute resolution |
| ShipReimbursement | Combat loss insurance payouts (killmail verified) |
| TurretDelegation | Member turret policy binding |
| BountyBoard | Bounty posting with CRDL rewards |
| AnnouncementBoard | Community coordination |

## Key Features

- **Tribe token (CRDL):** Issuance, treasury control, member balance tracking
- **Ship insurance:** Killmail-verified reimbursement for combat losses
- **Cargo delivery contracts:** Trustless delivery with dispute resolution
- **Defense policy:** Threat levels (GREEN/YELLOW/RED) tied to gate policy
- **Gate access control:** OPEN / TRIBE ONLY / ALLIES / CLOSED
- **On-chain roles:** Admin, Officer, Treasurer, Recruiter
- **Ship fitting calculator:** Authentic game module stats
- **Bounty board:** CRDL-reward bounties
- **Structure monitoring:** Threat intelligence dashboard
- **AI agent:** Nemotron3 LLM for in-game assistance
- **Cross-tribe search:** Via Sui GraphQL
- **Wiki:** Lore and mechanics documentation

## Comparison with Frontier Periscope

| Feature | CradleOS | Periscope |
|---------|----------|-----------|
| Org/Tribe governance | TribeVault + roles | governance::org + tiers |
| Treasury/token | CRDL token + treasury | Token factory + OrgTreasury |
| Gate access control | gate_policy_pkg | gate_unified + ACL/tribe/toll |
| Bounty board | BountyBoard module | bounty_board contract |
| Trade/cargo | CargoContract (delivery) | ssu_market (buy/sell orders) |
| Ship insurance | ShipReimbursement + killmail | — |
| Turret delegation | TurretDelegation | turret_priority (targeting rules) |
| Intel/monitoring | Threat dashboard + oracle | Full intel tool (Periscope) |
| AI integration | Nemotron3 agent proxy | — |
| Ship fitting calc | Module stats calculator | — |
| 3D Star Map | — | React Three Fiber + route planner |
| Log Analyzer | — | Mining/combat/travel/chat parsing |
| Intel Channel | — | Chat log → real-time intel |
| Radar | — | Real-time event monitoring |
| Trade node mgmt | — | Multi-SSU buy/sell orders |
| Claims (sovereignty) | — | Claims system |
| Static data pipeline | — | VULTUR extraction + on-demand import |

### Their strengths (features we lack)

- Ship insurance with killmail verification
- Cargo delivery contracts with dispute resolution
- AI agent proxy (LLM integration)
- Ship fitting calculator with game module stats
- Explicit defense threat levels (GREEN/YELLOW/RED)

### Our strengths (features they lack)

- 3D star map with Dijkstra/A* route planning
- Comprehensive log analyzer (ef-map.com parity)
- Intel channel integration (chat → intel)
- Radar (real-time chain event monitoring)
- Multi-SSU trade node management
- Claims/sovereignty system
- Static data extraction pipeline
- Privacy-first design (IndexedDB + AES-256-GCM encryption)
