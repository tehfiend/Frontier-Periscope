# EVE Frontier Documentation Reference

**Source:** https://docs.evefrontier.com/
**Date Captured:** 2026-03-08 (updated from 2026-02-21)
**Status:** Documentation is actively being rewritten for the Sui blockchain migration. Site was significantly restructured in early March 2026 — sections grouped by user journey, duplicate content removed, new pages added. Some pages still //TODO.

---

## Table of Contents

1. [Site Structure](#site-structure)
2. [Welcome / Getting Started](#welcome--getting-started)
   - [Smart Infrastructure](#smart-infrastructure)
   - [Constraints](#constraints)
   - [Sui and Move Fundamentals](#sui-and-move-fundamentals)
   - [Wallets and Identity](#wallets-and-identity)
3. [Tools](#tools)
   - [Environment Setup](#environment-setup)
   - [Gas Faucet](#gas-faucet)
4. [Smart Contracts](#smart-contracts)
   - [Introduction to Smart Contracts](#introduction-to-smart-contracts)
   - [EVE Frontier World Explainer](#eve-frontier-world-explainer)
   - [Interfacing with the EVE Frontier World](#interfacing-with-the-eve-frontier-world)
   - [Object Model](#object-model)
   - [Ownership Model](#ownership-model)
5. [Smart Assemblies](#smart-assemblies)
   - [Introduction to Modding Smart Assemblies](#introduction-to-modding-smart-assemblies)
   - [Smart Character](#smart-character)
   - [Network Node](#network-node)
   - [Storage Unit](#storage-unit)
   - [Storage Unit Build Guide](#storage-unit-build-guide)
   - [Turret](#turret)
   - [Turret Build Guide](#turret-build-guide)
   - [Gate](#gate)
   - [Gate Build Guide](#gate-build-guide)
6. [dApps](#dapps)
   - [dApps Quick Start](#dapps-quick-start)
   - [Connecting from an External Browser](#connecting-from-an-external-browser)
   - [Customizing External dApps](#customizing-external-dapps)
   - [Connecting In-Game](#connecting-in-game)
7. [dApp Kit SDK](#dapp-kit-sdk)
8. [EVE Vault](#eve-vault)
   - [Introduction to EVE Vault](#introduction-to-eve-vault)
   - [Wallet Game Setup](#wallet-game-setup)
   - [Browser Extension](#browser-extension)
9. [Troubleshooting](#troubleshooting)
10. [Contributing](#contributing)

---

## Site Structure

**March 2026 Restructure:** The docs were significantly reorganized in early March 2026. Key changes:
- Sections grouped by user journey
- Constraints page removed (not deemed helpful)
- Wallets and identity moved under EVE Vault section
- Environment setup removed from /tools (now 404) — content absorbed elsewhere
- Gas faucet folded in (no longer separate section)
- Tools section reorganized to: Interfacing with World, efctl (community), dApp kit, Debugging Tools
- Move patterns documentation added
- Community-built docs and tools section added
- OwnerCap transfer documentation added
- In-game fuel efficiency details added

The full sitemap:

```
https://docs.evefrontier.com/                                          (Landing page)
https://docs.evefrontier.com/welcome/smart-infrastructure
https://docs.evefrontier.com/welcome/sui-and-move-fundamentals
https://docs.evefrontier.com/smart-contracts/introduction-to-smart-contracts
https://docs.evefrontier.com/smart-contracts/eve-frontier-world-explainer
https://docs.evefrontier.com/smart-contracts/interfacing-with-the-eve-frontier-world
https://docs.evefrontier.com/smart-contracts/object-model
https://docs.evefrontier.com/smart-contracts/ownership-model
https://docs.evefrontier.com/smart-assemblies/introduction              (RESTRUCTURED - references efctl)
https://docs.evefrontier.com/smart-assemblies/smart-character
https://docs.evefrontier.com/smart-assemblies/network-node
https://docs.evefrontier.com/smart-assemblies/storage-unit
https://docs.evefrontier.com/smart-assemblies/storage-unit/build       (PARTIAL - intro + links, no step-by-step)
https://docs.evefrontier.com/smart-assemblies/turret
https://docs.evefrontier.com/smart-assemblies/turret/build             (EMPTY - heading only)
https://docs.evefrontier.com/smart-assemblies/gate
https://docs.evefrontier.com/smart-assemblies/gate/build               (COMPLETE - detailed guide)
https://docs.evefrontier.com/dapps/dapps-quick-start                   (//TODO)
https://docs.evefrontier.com/dapps/connecting-from-an-external-browser (//TODO)
https://docs.evefrontier.com/dapps/customizing-external-dapps          (//TODO)
https://docs.evefrontier.com/dapps/connecting-in-game                  (//TODO)
https://docs.evefrontier.com/dapp-kit-sdk/dapp-kit                     (COMPLETE - updated)
https://docs.evefrontier.com/eve-vault/introduction-to-eve-vault
https://docs.evefrontier.com/eve-vault/wallet-game-setup               (//TODO)
https://docs.evefrontier.com/eve-vault/browser-extension               (NEW CONTENT - install + sign-in guide)
https://docs.evefrontier.com/troubleshooting/builder                   (STUB - heading + empty list)
https://docs.evefrontier.com/troubleshooting/player                    (//TODO)
https://docs.evefrontier.com/troubleshooting/wallet                    (//TODO)
https://docs.evefrontier.com/contributing/a-work-in-progress
https://docs.evefrontier.com/contributing/contributing
```

**Removed pages (404):**
- `/welcome/contstraints` — Removed entirely
- `/welcome/wallets-and-identity` — Moved under EVE Vault
- `/tools/environment-setup` — Removed, content absorbed elsewhere
- `/tools/gas-faucet` — Removed

**Pages with actual content: ~20 of ~29**
**Pages still //TODO or empty: ~9 of ~29**

---

## Welcome / Getting Started

### Smart Infrastructure

**URL:** https://docs.evefrontier.com/welcome/smart-infrastructure

Smart Infrastructure is EVE Frontier's programmable sandbox built on Sui blockchain and the Move programming language. Smart Assemblies are player-built, programmable in-game structures anchored to specific locations that expose configurable interfaces for builders.

**Three Assembly Types:**
- **Smart Storage Unit** - Item storage and dispensing
- **Smart Turret** - Automated zone and asset defense
- **Smart Gate** - Transportation and access control

**Builder Capabilities:**
- Develop new game mechanics (trading, missions, rewards)
- Manage assets through locking, dispensing, and tokenization
- Establish player-driven economies with custom rulesets
- Automate reactions to in-game events
- Create composable systems leveraging other builders' work
- Integrate external dApps and tools

**Development Workflow:**
1. Write and test code locally
2. Package assembly logic as a Move module
3. Deploy on Sui
4. Share, upgrade, and collaborate

No Move expertise is required to begin; templates and guides simplify development.

---

### Constraints (PAGE REMOVED — content preserved here)

**URL:** https://docs.evefrontier.com/welcome/contstraints — **Now returns 404** (removed in March 2026 restructure as "not very helpful")

Key constraints preserved for reference:

**Blockchain and Smart Contract Limitations:**
- Every on-chain WRITE operation (deployment, transactions, storage) incurs gas costs
- Reading data off-chain via gRPC or indexers avoids fees
- Individual Move objects cannot exceed 250KB
- Maximum 32 fields per struct
- Single transactions can access up to 1,024 dynamic fields
- Published packages are permanently immutable initially; modifications require new versions through UpgradeCap mechanisms
- All on-chain systems require Move programming (differs substantially from prior EVM/Solidity support)

**Gameplay Constraints:**
- Smart Assemblies must respect game-enforced permissions (character ownership, access rights, proximity)

**Sui Protocol Config Reference:** https://docs.sui.io/concepts/transactions#limits-on-transactions-objects-and-data
**Sui Upgrade Documentation:** https://docs.sui.io/guides/developer/packages/upgrade#upgrade-requirements

---

### Sui and Move Fundamentals

**URL:** https://docs.evefrontier.com/welcome/sui-and-move-fundamentals

**Sui Blockchain:**
- High-performance Layer 1 blockchain for secure, scalable, low-latency digital asset ownership
- Optimized for real-time applications (games, social platforms)
- Object-centric architecture: every asset is a unique on-chain object with its own identity, ownership, and history
- Parallel transaction processing (not sequential)
- Low latency transaction finality

**Move Programming Language:**
- Smart contract language built for blockchain, integral to the Sui ecosystem
- Emphasizes security, resource management, and flexibility
- Resource-Oriented Programming: digital assets are protected first-class resources (prevents duplication/destruction)
- Modules and Scripts: reusable logic with interactive components
- Strong Typing: compile-time and runtime verification
- Upgradeable Architecture: modular design patterns

**Integration with EVE Frontier:**
- In-game items represented as distinct Sui objects
- Ownership protections combined with programmable shared object rules
- On-chain game logic through Move contracts

**External Resources Referenced:**
- Sui Documentation: https://docs.sui.io/
- Move by Example Guide
- Sui Developer Getting Started Guide
- Sui SDKs and Developer Tools

---

### Wallets and Identity

**URL:** https://docs.evefrontier.com/welcome/wallets-and-identity

**EVE Vault** is the unified wallet and identity system, available as both a web application and Chrome extension.

**Key Features:**
- Stores Sui-based assets (currencies, NFTs, game items)
- Establishes digital identity for authentication
- Single sign-on across connected services

**Authentication:** Uses zkLogin, a zero-knowledge protocol integrated into Sui:
- Wallet access via EVE Frontier SSO account (no seed phrases)
- Proves account ownership without revealing blockchain address

**Usage Contexts:**
- **In-game:** Links character, assets, and progression to blockchain
- **External:** Authenticates with external dApps, marketplaces, community tools

**Setup:**
1. Download Chrome extension from GitHub releases
2. Establish wallet via SSO login
3. Grant dApp and client permissions
4. Begin transacting

**Download:** https://github.com/evefrontier/evevault/releases (latest: v0.0.6)

---

## Tools

**Note:** The Tools section was reorganized in March 2026. `/tools/environment-setup` and `/tools/gas-faucet` have been removed. The tools section now covers: Interfacing with the World, efctl (community tool), dApp kit, and Debugging Tools.

### Environment Setup (Archived — page removed, content preserved here)

The environment setup page at `/tools/environment-setup` now returns 404. Setup instructions are now primarily in the builder-scaffold README. Key info preserved:

**Docker Method (Recommended - fastest):**
```bash
git clone https://github.com/evefrontier/builder-scaffold.git
cd builder-scaffold/docker
```
Provides a pre-configured Sui localnet and development environment with single entrypoint.

**Manual Setup (any OS):**
```bash
# Install suiup
curl -sSfL https://raw.githubusercontent.com/MystenLabs/suiup/main/install.sh | sh
suiup install sui@testnet

# Node.js/PNPM
nvm install 24  # or brew install node@24
npm install -g pnpm
```

### Community Tools

**efctl** — Community-built CLI that automates the full builder-scaffold setup (environment up, world contracts deployment, smart gate deployment, teardown) in a single command. URL: https://docs.evefrontier.com/tools/efctl, Source: https://frontier.scetrov.live/links/efctl/

**Scetrov's Killboard API** — Community killboard API by Scetrov (REAP tribe), delivered via Cloudflare CDN. Potential supplementary data source for killmail intel. Same author as `Scetrov/evefrontier_datasets` (pre-built SQLite datasets). Cache/freshness tradeoff noted (CDN caching vs real-time events).

### Community Notes (Builder Chat, March 10-11 2026)

- Storage unit interaction range: **5km** (confirmed in-game constraint for base building)
- Turret extensions are **read-only** (devInspect only); gate extensions can write to chain
- Three turret types confirmed split in Cycle 5

---

## Smart Contracts

### Introduction to Smart Contracts

**URL:** https://docs.evefrontier.com/smart-contracts/introduction-to-smart-contracts

Smart contracts in EVE Frontier are blockchain-based programs that enforce persistent rules, manage assets, automate actions, and run shared logic. Written in Move, deployed on Sui.

**In-Game Assets as Move Objects:**
Characters, storage units, gates, turrets all exist as Move objects on-chain with unique identifiers, ownership rules, and typed fields. Same inputs always produce same outputs (deterministic).

**Access Control Mechanisms:**

| Mechanism | Description |
|-----------|-------------|
| **Function Visibility** | `public`, `public(package)`, `public(entry)` restrict who can invoke |
| **Capability-Based Access** | Permission objects like `OwnerCap` or `AdminACL` grant fine-grained transferable rights |
| **Typed Witness Pattern** | Function restrictions based on witness types; authorized player packages interact with world functions |
| **Publisher Objects** | One-time witnesses proving package authorship |
| **Transaction Context** | `TxContext` provides sender addresses and epoch data |

**Key Move Patterns:**

1. **Capability Pattern** - Objects granting specific rights to permissioned actions
2. **Hot Potato** - Single-use objects consumed within one transaction, enforcing atomic action sequences
3. **Shared Objects** - Most Frontier objects are shared, enabling concurrent read/write with built-in versioning

---

### EVE Frontier World Explainer

**URL:** https://docs.evefrontier.com/smart-contracts/eve-frontier-world-explainer

The world operates as Move smart contracts on Sui, emphasizing "composition over inheritance" through layered, modular building blocks.

**Three-Layer Architecture:**

**Layer 1: Primitives**
- Small, focused modules implementing core game physics
- Source files: `location.move`, `inventory.move`, `fuel.move`, `status.move`, `energy.move`
- Use `public(package)` visibility (no direct player access)
- Prevent circular dependencies

**Layer 2: Assemblies**
- Player-deployable structures: Storage Units, Gates, Turrets
- Operate as Sui shared objects
- Orchestrate primitives and enforce "digital physics" rules
- Enable concurrent multi-user access

**Layer 3: Extensions**
- Custom player-built contracts
- Extend assembly functionality through typed witness authentication patterns
- Dynamic registration without redeploying base systems

**Security Tiers:**
1. AdminACL operations (server-sponsored)
2. Owner operations (requiring ownership certificates)
3. Extension operations (type-based witness verification)

**Privacy:**
- Locations stored as cryptographic hashes (not coordinates)
- Proximity verification uses game-server signatures currently
- Future zero-knowledge proof implementations planned

**GitHub:** https://github.com/evefrontier/world-contracts

---

### Interfacing with the EVE Frontier World

**URL:** https://docs.evefrontier.com/smart-contracts/interfacing-with-the-eve-frontier-world

**Write Operations (State Mutations):**

Uses Sui TypeScript SDK (alternatives: Rust, community Go SDKs).

Example - Borrowing an OwnerCap and calling assembly online:
```typescript
const [ownerCap] = tx.moveCall({
  target: `${config.packageId}::character::borrow_owner_cap`,
  typeArguments: [`${config.packageId}::assembly::Assembly`],
  arguments: [tx.object(characterId), tx.object(ownerCapId)],
});
```

**Sponsored Transactions:** For operations requiring server-side validation (e.g., proximity checks), the player signs the intent and an authorized sponsor pays gas and submits.

**Read Operations:**

| Method | Description |
|--------|-------------|
| **SuiClient** | Main entry point for read operations; queries objects, events, transactions |
| **GraphQL** | Sui's GraphQL RPC queries objects by type, owner, or filters. Testnet IDE: `graphql.testnet.sui.io/graphql` |
| **gRPC** | Sui's preferred read path for higher throughput and streaming checkpoints |
| **Event Querying** | `suix_queryEvents` filterable by module, type, or sender |

**World Events:** JumpEvent, inventory updates, deployment changes

**TypeScript Examples:** https://github.com/evefrontier/builder-scaffold (ts-scripts directory)

---

### Object Model

**URL:** https://docs.evefrontier.com/smart-contracts/object-model

Deterministic mapping system connecting in-game resources to blockchain objects on Sui. Every game asset exists in both environments simultaneously.

**Item Identification:**
- `item_id`: Unique in-game identifier
- `type_id`: Item category identifier (fuel, assembly, etc.)
- Singleton items: uniquely identified by `item_id + tenant`
- Non-singleton items: use `type_id + tenant`
- Tenant parameter: segregates different server instances (production, testnet)

**Deterministic ID Derivation:**
On-chain object IDs are derived deterministically from in-game identifiers using Sui's derived objects, creating reliable 1:1 correspondence.

```move
// TenantItemId structure:
// - item_id: u64
// - tenant: String

// ObjectRegistry generates all object IDs uniformly
let character_uid = derived_object::claim(registry.borrow_registry_id(), character_key);
```

Characters, assemblies, and network nodes use Sui's shared object model, allowing administrators and owners to modify objects simultaneously.

**Source Files:**
- `object_registry.move`
- `in_game_id.move`

---

### Ownership Model

**URL:** https://docs.evefrontier.com/smart-contracts/ownership-model

Capability-based access control using transferable `OwnerCap` objects.

**Access Hierarchy:**
- `GovernorCap` - Deployer-level authority, manages sponsor additions/removals
- `AdminACL` - Shared object tracking authorized sponsors; functions verify sponsors via transaction context
- `OwnerCap<T>` - Type-specific "keycard" enabling mutation of designated objects

**Character as Keychain:**
```
User Wallet -> Character (shared object) -> Multiple OwnerCaps
```

When Smart Assemblies are created, their corresponding OwnerCaps transfer directly to the character. Wallet access to the character grants access to all contained capabilities.

**Borrow-Use-Return Pattern (Three-Step Transaction Flow):**
1. **Borrow** the OwnerCap from character using Sui's Receiving pattern
2. **Use** it for the intended operation
3. **Return** it via `ReturnOwnerCapReceipt` (enforced "hot potato")

The receipt ensures caps cannot be accidentally dropped; explicit transfer or return is mandatory.

```move
// Access control assertion
assert!(character.character_address == ctx.sender(), ESenderCannotAccessCharacter);
```

**Benefits:**
- Centralized capability management
- Fine-grained per-object authorization
- Delegatable without moving underlying assemblies
- Composable within programmable transactions

**Source Files:**
- `access_control.move`: https://github.com/evefrontier/world-contracts/blob/main/contracts/world/sources/access/access_control.move
- `character.move`: https://github.com/evefrontier/world-contracts/blob/main/contracts/world/sources/character/character.move

---

## Smart Assemblies

### Introduction to Modding Smart Assemblies

**URL:** https://docs.evefrontier.com/smart-assemblies/introduction

**Prerequisites for Customization (Sequential):**
1. **Character Creation** - Establish an on-chain identity for ownership
2. **Network Node** - Anchor one at a Lagrange point as power infrastructure
3. **Fuel and Activation** - Deposit fuel and bring the node online for energy generation
4. **Assembly Anchoring** - Create a smart assembly that auto-connects to the network node
5. **Assembly Activation** - Reserve energy and make the assembly operational

**Local Development:** The `builder-scaffold` GitHub repository allows simulating all prerequisite steps and writing custom logic without on-chain deployment.

**Programmable Assembly Types:**
- **Smart Gate** - Custom rules for space travel (toll gates, access lists)
- **Smart Storage Unit** - Custom rules for item deposits/withdrawals (vending machines, trade hubs)
- **Smart Turret** - Custom targeting logic

---

### Smart Character

**URL:** https://docs.evefrontier.com/smart-assemblies/smart-character

The Smart Character is the player's on-chain identity and controller of all created assemblies.

**Character Creation:** Game servers (admin accounts) establish characters using deterministic object IDs derived from in-game character IDs. Each character links to a specific tribe and the player's wallet address.

**Keychain Functionality:** The Character object operates as a "keychain" maintaining OwnerCap tokens for all player-owned assets (network nodes, gates, storage units). Follows the borrow-use-return pattern.

**Access Control:**
```move
public fun borrow_owner_cap<T: key>(
    character: &mut Character,
    owner_cap_ticket: Receiving<OwnerCap<T>>,
    ctx: &TxContext,
): (OwnerCap<T>, ReturnOwnerCapReceipt)
```
Only the wallet address stored in `character_address` can access OwnerCaps:
```move
assert!(character.character_address == ctx.sender(), ESenderCannotAccessCharacter);
```

**Character Discovery Flow:**
1. Query wallet-owned objects of type `PlayerProfile`
2. Extract `character_id` from the PlayerProfile
3. Fetch the corresponding `Character` shared object using that ID

PlayerProfile is created by the game server and transferred to the player's wallet. It contains only the `character_id`.

**Source:** `character.move` in the world-contracts repository

---

### Network Node

**URL:** https://docs.evefrontier.com/smart-assemblies/network-node

The Network Node is the base's power infrastructure, burning fuel to generate energy for all connected smart assemblies.

**Fuel System:**
- Consumption formula: `actualConsumptionRate = burnRateInMs * (fuelEfficiency / 100)`
- Higher efficiency (10-100% configurable range) means fuel lasts longer
- Fuel lifecycle: deposit -> activation/burning -> cessation (preserves remaining time) -> depletion triggers offline

**Energy Management:**
- Fixed energy output measured in GJ when operational
- Assemblies use a reservation model: reserve energy when online, release when offline
- Energy requirements per assembly type configured via `assembly_type_id -> energy required (GJ)` mapping
- Example: 100 GJ available, two 50 GJ storage units consume all capacity

**Assembly Integration:**
- Assemblies connect automatically upon anchoring
- If node depletes fuel, ALL connected assemblies forced offline simultaneously

**Atomic Operations (Hot Potato Mechanisms):**
- `OfflineAssemblies` - Managing network disconnections
- `UpdateEnergySources` - Processing new connections
- `HandleOrphanedAssemblies` - Handling unanchoring scenarios

**Source Files:** `network_node.move`, `fuel.move`, `energy.move`

---

### Storage Unit

**URL:** https://docs.evefrontier.com/smart-assemblies/storage-unit

Programmable, on-chain storage structure for managing items with custom owner-defined rules.

**Two Inventory Types:**

| Type | Description |
|------|-------------|
| **Primary Inventory** | Controlled by storage unit owner via OwnerCap; main storage for owner items |
| **Ephemeral Inventories** | Temporary, per-character inventories for non-owners; reduced capacity; generated dynamically; keyed by character OwnerCap IDs |

**Item Bridging Operations:**
- `game_item_to_chain_inventory` - Mints on-chain representations (deposit to chain)
- `chain_item_to_game_inventory` - Burns on-chain items, requires proximity verification (withdraw to game)

**Owner Operations:**
Direct deposit/withdrawal via public functions requiring proximity proof from the server and character verification. Implemented via Programmable Transaction Blocks.

**Extension System:**
Uses the typed witness pattern (same as Gate). Custom contracts gain deposit/withdrawal capabilities by passing their unique `Auth` witness type.

**Vending Machine Example:** Custom logic validates payments and inventory before executing withdrawal operations.

**Energy:** Follows standard assembly energy protocols (Network Node connection required, online/offline).

**Source:** https://github.com/evefrontier/world-contracts/blob/main/contracts/world/sources/assemblies/storage_unit.move

### Storage Unit Build Guide

**URL:** https://docs.evefrontier.com/smart-assemblies/storage-unit/build

Uses the typed witness pattern (same as Gate/Turret). Define a witness struct, implement business logic, deploy and authorize.

**API Functions:**

| Function | Description |
|----------|-------------|
| `authorize_extension<Auth: drop>(storage_unit, owner_cap)` | Register extension on a storage unit |
| `deposit_item<Auth: drop>(storage_unit, character, item, auth, ctx)` | Extension deposits item to character's ephemeral inventory |
| `withdraw_item<Auth: drop>(storage_unit, character, auth, type_id, quantity, ctx) -> Item` | Extension withdraws item from character's ephemeral inventory |
| `deposit_to_owned<Auth: drop>(storage_unit, character, item, auth, ctx)` | Async delivery — deposit to character's owned inventory (no interaction required) |
| `deposit_by_owner<T: key>(storage_unit, item, character, owner_cap, ctx)` | Owner deposits to primary inventory |
| `withdraw_by_owner<T: key>(storage_unit, character, owner_cap, type_id, quantity, ctx) -> Item` | Owner withdraws from primary inventory |

**Use Cases:** Vending machines (payment-gated withdrawal), trade hubs, guild hangars with async delivery, reward distribution.

**Source:** `storage_unit.move`, `inventory.move` in world-contracts

---

### Turret

**URL:** https://docs.evefrontier.com/smart-assemblies/turret

Turrets anchor to grid bases and automatically engage targets within proximity range. Powered by network nodes.

**TargetCandidate Struct Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `item_id` | u64 | Unique target identifier |
| `type_id` | u64 | Target classification |
| `group_id` | u64 | Ship class category (0 for NPCs) |
| `character_id` | u32 | Pilot identifier (0 for NPCs) |
| `character_tribe` | u32 | Pilot faction (0 for NPCs) |
| `hp_ratio` | u64 | Structure HP percentage (0-100) |
| `shield_ratio` | u64 | Shield percentage (0-100) |
| `armor_ratio` | u64 | Armor percentage (0-100) |
| `is_aggressor` | bool | Currently attacking |
| `priority_weight` | u64 | Overridable default weight |
| `behaviour_change` | BehaviourChangeReason | Trigger reason |

**ReturnTargetPriorityList:** `{ target_item_id: u64, priority_weight: u64 }`

**Default Targeting Logic:**
- Excludes same-tribe non-aggressors and targets no longer attacking
- Prioritizes active attackers (heavy weighting)
- Proximity-based entries weighted lighter if from different tribes or flagged as aggressors
- Highest weight selected; ties broken by list order

**Behavior Change Triggers:**
- `ENTERED` — Target within proximity range
- `STARTED_ATTACK` — Target engaged base or grid entity
- `STOPPED_ATTACK` — Target ceased offensive action
- Higher-priority triggers supersede lower ones (STARTED_ATTACK overrides ENTERED)

**Ship Classes & Turret Specialization:**

| Ship Class | Group ID | | Turret Type | Type ID | Effective vs. |
|------------|----------|---|-------------|---------|---------------|
| Shuttle | 31 | | Autocannon | 92402 | Shuttle, Corvette |
| Corvette | 237 | | Plasma | 92403 | Frigate, Destroyer |
| Frigate | 25 | | Howitzer | 92484 | Cruiser, Combat Battlecruiser |
| Destroyer | 420 | | | | |
| Cruiser | 26 | | | | |
| Combat Battlecruiser | 419 | | | | |

### Turret Build Guide

**URL:** https://docs.evefrontier.com/smart-assemblies/turret/build

**Extension Entry Point (must match exactly):**
```move
public fun get_target_priority_list(
    turret: &Turret,
    owner_character: &Character,
    target_candidate_list: vector<u8>,
    receipt: OnlineReceipt,
): vector<u8>
```

**Key API Functions:**
- `authorize_extension<Auth: drop>(turret, owner_cap)` — Register extension
- `verify_online(turret) -> OnlineReceipt` — Verify turret is online
- `turret::unpack_candidate_list(data)` — Deserialize BCS target list
- `turret::new_return_target_priority_list(target_id, weight)` — Construct result
- `turret::destroy_online_receipt<Auth>(receipt, auth)` — Consume hot potato

**Data Format:** Game serializes targets as BCS `vector<TargetCandidate>`, expects BCS `vector<ReturnTargetPriorityList>` in return.

**Deployment:**
1. Define witness struct (`public struct TurretAuth has drop {}`)
2. Implement matching function signature
3. Publish package (`sui client publish --build-env testnet`)
4. Authorize via `turret::authorize_extension<TurretAuth>` using OwnerCap
5. Game automatically resolves package ID and invokes extension

**Reference:** `extension_examples/turret.move` in world-contracts

---

### Gate

**URL:** https://docs.evefrontier.com/smart-assemblies/gate

Gates facilitate spatial travel between locations. Two linked gates create transport routes with programmable access control.

**Access Control Models:**
- **Unrestricted (default):** No extension configured = anyone can jump
- **Permit-Based:** Custom Move contracts require JumpPermit with character ID, route hash, and expiration timestamp

**Linking Requirements:**
1. Same character ownership
2. Both gates online
3. Minimum 20km separation (verified via server-signed distance proof)

**Technical API (Typed Witness Pattern):**
- `authorize_extension<Auth>` - Registers custom contract as gate extension
- `issue_jump_permit<Auth>` - Creates permits for authorized jumps
- `jump_with_permit` - Validates permits and executes jumps

**Important:** The `route_hash` is direction-agnostic; a permit issued for Gate A -> Gate B also works for Gate B -> Gate A.

**Source:** `gate.move` in the world-contracts repository

### Gate Build Guide (COMPLETE)

**URL:** https://docs.evefrontier.com/smart-assemblies/gate/build

This is the most complete build guide on the site.

**Prerequisites:**
- Sui CLI, Node.js, and pnpm installed
- Cloned builder-scaffold repository with configured environment variables
- Deployed world contracts and test resources

**Scaffold Structure (`move-contracts/smart_gate/`):**

| Module | Purpose |
|--------|---------|
| `config.move` | Defines `XAuth` (witness type), `ExtensionConfig` (shared config object), `AdminCap` (admin control). Stores extension rules via dynamic fields. |
| `tribe_permit.move` | Permit issuance restricted to characters belonging to a configured tribe. Validates tribal membership and calls `gate::issue_jump_permit<XAuth>`. |
| `corpse_gate_bounty.move` | Advanced: combines storage unit interactions with permit generation (deposit bounty items to receive jump permits). |

**Build and Deploy Steps:**

1. **Build and Publish:**
   ```bash
   sui client publish --build-env testnet
   ```
   For local networks, include world package path via pubfile parameter. Capture package ID and ExtensionConfig object ID for `.env`.

2. **Configure Rules:**
   ```bash
   pnpm configure-rules
   ```
   Applies tribe and expiry parameters to ExtensionConfig by calling `tribe_permit::set_tribe_config`. Editable in `ts-scripts/smart_gate/configure-rules.ts`.

3. **Authorize Extension:**
   ```bash
   pnpm authorise-gate
   ```
   Registers witness type on target gates, transitioning from default (open) to permit-based access. Borrows gate's OwnerCap, calls `gate::authorize_extension<XAuth>`, returns capability.

4. **Issue Permits:**
   ```bash
   pnpm issue-tribe-jump-permit
   ```
   Mints JumpPermit objects owned by player characters after tribal verification.

5. **Use Permits:**
   ```bash
   pnpm jump-with-permit
   ```
   Consumes permits during gate traversal, emitting JumpEvent on success.

**Custom Extension Template — Toll Gate:**
```move
module custom::toll_gate;

public struct TollGateAuth has drop {}

public fun buy_pass<T>(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // Custom validation logic here
    gate::issue_jump_permit(
        source_gate, destination_gate, character,
        TollGateAuth {},
        clock.timestamp_ms() + 3600_000,
        ctx,
    );
}
```

**Other Examples in builder-scaffold:**
- `tribe_permit.move` — Tribal membership check
- `corpse_gate_bounty.move` — Deposit bounty items for jump permits

**Custom Extension Pattern:**
1. Define a witness struct: `public struct MyAuth has drop {}`
2. Write enforcement logic calling `gate::issue_jump_permit<MyAuth>`
3. Publish and authorize via `gate::authorize_extension<MyAuth>`

**Toll Gate Example:** Payment verification before permit issuance with customizable expiration:
```move
clock.timestamp_ms() + 3600_000  // 1-hour duration
```

**Alternative Extension Ideas:**
- Allowlist-based access (stored character approval lists)
- Bounty gates (item deposit requirements)
- Token-gated mechanics

---

## dApps

### dApps Quick Start
**URL:** https://docs.evefrontier.com/dapps/dapps-quick-start
**Status:** //TODO

### Connecting from an External Browser
**URL:** https://docs.evefrontier.com/dapps/connecting-from-an-external-browser
**Status:** //TODO

### Customizing External dApps
**URL:** https://docs.evefrontier.com/dapps/customizing-external-dapps
**Status:** //TODO

### Connecting In-Game
**URL:** https://docs.evefrontier.com/dapps/connecting-in-game
**Status:** //TODO

---

## dApp Kit SDK

**URL:** https://docs.evefrontier.com/dapp-kit-sdk/dapp-kit
**Full SDK Docs:** https://sui-docs.evefrontier.com
**Package:** `@evefrontier/dapp-kit`

A React SDK for building EVE Frontier dApps on Sui with integrated wallet connectivity and smart object management.

**Key Features:**
- Wallet integration with EVE Vault and Sui wallets
- GraphQL-powered smart object data retrieval
- Gas-free transactions via EVE Frontier backend infrastructure (sponsored transactions)
- Automatic data refresh mechanisms
- Comprehensive TypeScript type definitions

**Installation:** Requires the primary package plus React Query peer dependencies.

**Setup:** Wrap applications with `EveFrontierProvider`, specify assembly identifiers via env vars or URL parameters.

**Core Hooks:**

| Hook | Purpose |
|------|---------|
| `useConnection()` | Manages wallet state and authentication |
| `useSmartObject()` | Retrieves assembly data with continuous polling |
| `useSponsoredTransaction()` | Executes zero-gas transactions |
| `useNotification()` | Displays user messages |
| dAppKit functions | Transaction signing via Mysten's dapp-kit-react |

**Transaction Types:**
- **Sponsored:** Gas-free actions (bring online/offline, unit editing, gate linking)
- **Standard:** dAppKit sign/execute for custom contract interactions

**Supported Assembly Types:**
SmartStorageUnit, SmartTurret, SmartGate, NetworkNode, Manufacturing, Refinery

**GraphQL Query Functions (pre-built, import from `@evefrontier/dapp-kit/graphql`):**

| Function | Signature | Purpose |
|----------|-----------|---------|
| `getWalletCharacters` | `(wallet: string) → GetWalletCharactersResponse` | Get all characters owned by a wallet |
| `getCharacterAndOwnedObjects` | `(wallet: string) → GetCharacterAndOwnedObjectsResponse` | Characters + all owned objects |
| `getAssemblyWithOwner` | `(assemblyId: string) → { moveObject, assemblyOwner: CharacterInfo, energySource, destinationGate }` | Assembly + owner info in one call |
| `getObjectByAddress` | `(address: string) → GetObjectByAddressResponse` | Raw BCS object data by address |
| `getObjectWithJson` | `(objectId: string) → GetObjectWithJsonResponse` | Object with JSON-decoded content |
| `getObjectWithDynamicFields` | `(objectId: string) → GetObjectResponse` | Object + all dynamic fields (inventory, config) |
| `getOwnedObjectsByType` | `(owner: string, objectType?: string) → GetOwnedObjectsByTypeResponse` | Filter owned objects by Move type |
| `getOwnedObjectsByPackage` | `(owner: string, packageId?: string) → GetOwnedObjectsByPackageResponse` | Filter owned objects by package |
| `getObjectsByType` | `(type: string) → GetObjectsByTypeResponse` | All objects of a Move type |
| `getSingletonObjectByType` | `(type: string) → GetSingletonObjectByTypeResponse` | Single object by type (e.g., config) |
| `executeGraphQLQuery` | `(query: string, variables?: Record) → GraphQLResponse` | Execute custom GraphQL queries |

**Key Types:**

```typescript
interface CharacterInfo {
  id: string;           // Sui object ID
  address: string;      // Wallet address
  name: string;         // Character name
  tribeId: number;      // Tribe ID
  characterId: number;  // In-game character ID
  _raw?: RawCharacterData;
}

interface DetailedAssemblyResponse extends SmartAssemblyResponse {
  description: string;
  dappURL: string;
}

interface SmartAssemblyResponse {
  id: string;
  item_id: number;
  type: Assemblies;       // enum: SmartStorageUnit, SmartTurret, SmartGate, etc.
  name: string;
  state: State;           // enum: online/offline/etc.
  character?: SmartCharacterResponse;
  solarSystem?: SolarSystem;
  isParentNodeOnline?: boolean;
  energySourceId?: string;
  energyUsage: number;
  typeId: number;
  typeDetails?: DatahubGameInfo;
  _raw?: MoveObjectData;
}
```

**Utility Functions (import from `@evefrontier/dapp-kit/utils`):**
- `transformToAssembly(objectId, moveObject, options?) → AssemblyType | null` — Raw Move data → typed assembly
- `transformToCharacter(characterInfo) → DetailedSmartCharacterResponse` — CharacterInfo → full character
- `parseCharacterFromJson(json: unknown) → CharacterInfo | null` — Parse raw JSON → CharacterInfo
- `getAdjustedBurnRate()` — Calculate fuel burn rate
- `getEnergyConfig()` / `getFuelEfficiencyConfig()` — Read energy/fuel configs
- `getEveWorldPackageId()` — Get world package ID for current tenant
- `getCharacterOwnerCapType()` / `getCharacterPlayerProfileType()` — Get Move type strings
- `abbreviateAddress()`, `formatDuration()`, `formatM3()`, `getTxUrl()`, `getDappUrl()` — Display helpers

**Subpath Imports:**
- `@evefrontier/dapp-kit/graphql` — GraphQL client and pre-built queries
- `@evefrontier/dapp-kit/types` — Type definitions only
- `@evefrontier/dapp-kit/utils` — Parsing and utilities
- `@evefrontier/dapp-kit/hooks` — React hooks only
- `@evefrontier/dapp-kit/providers` — Provider components only
- `@evefrontier/dapp-kit/config` — Configuration

---

## EVE Vault

### Introduction to EVE Vault

**URL:** https://docs.evefrontier.com/eve-vault/introduction-to-eve-vault

EVE Vault is the inventory and wallet management platform operating on Sui blockchain with zkLogin authentication and Sui Wallet Standard compliance.

**Features:**
- Asset protection for Sui-based holdings (tokens, NFTs, game items)
- Seedless authentication via Google, Apple, Twitch, or other OAuth providers
- FusionAuth OAuth integration for character/identity linking
- Browser extension plus web interface
- Controlled dApp access mechanisms

**Currency Systems:**
- **LUX** - Handles most in-game transactions and commercial activities
- **EVE Token** - Utility token for ecosystem participation, modding, and developer rewards

**Capabilities:**
- Manage LUX and EVE Token holdings
- Oversee player-created currencies
- Custom currencies including alliance tokens and specialized mission rewards

**GitHub:** https://github.com/evefrontier/evevault

### Wallet Game Setup
**URL:** https://docs.evefrontier.com/eve-vault/wallet-game-setup
**Status:** //TODO

### Browser Extension (NEW — previously TODO)

**URL:** https://docs.evefrontier.com/eve-vault/browser-extension

Now has complete documentation:

**Download:** v0.0.6 from GitHub releases (zip file)

**Installation (Chrome):**
1. Download and unzip the extension
2. Navigate to `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" and select the unzipped folder

**Sign-In Workflow:**
1. Create a 6-digit PIN
2. Click Log In
3. Enter Utopia server credentials (email/password)
4. Access the wallet dashboard

**Dashboard:** Wallet management and transaction capabilities.

**GitHub:** https://github.com/evefrontier/evevault

---

## Troubleshooting

- **Builder:** https://docs.evefrontier.com/troubleshooting/builder — //TODO
- **Player:** https://docs.evefrontier.com/troubleshooting/player — //TODO
- **Wallet:** https://docs.evefrontier.com/troubleshooting/wallet — //TODO
- **Sandbox Access:** https://docs.evefrontier.com/troubleshooting/sandbox-access — Utopia sandbox setup, slash commands (`/moveme`, `/giveitem`), common test item IDs. See Game Reference for full details.

---

## Contributing

### Documentation Status

**URL:** https://docs.evefrontier.com/contributing/a-work-in-progress

The documentation is undergoing significant changes as EVE Frontier transitions to Sui blockchain. The site is being comprehensively rewritten. //TODO markers throughout indicate pages still being actively worked on.

### How to Contribute

**URL:** https://docs.evefrontier.com/contributing/contributing

**Accepted Contributions:**
- Fixing typos and broken links
- Clarifying confusing steps
- Adding examples and visual aids
- Updating documentation for behavior changes
- Documenting troubleshooting information

**Workflow:**
1. Navigate to the page needing improvement
2. Click "Edit on GitHub" button
3. Click pencil icon to edit (GitHub forks if needed)
4. Write clear commit message, create new branch
5. Submit PR with title, description, scope, and verification details
6. Address review comments
7. Await maintainer approval

**PR Standards:**
- Keep changes focused on one topic
- State prerequisites early, use concrete values and examples
- Provide copy-pasteable code
- Maintain consistency with existing documentation style
- Never commit sensitive data (API keys, credentials)

---

## Key GitHub Repositories

| Repository | Purpose | Latest |
|------------|---------|--------|
| `evefrontier/world-contracts` | Core Move smart contracts for the EVE Frontier world | v0.0.16 (Mar 6) |
| `evefrontier/builder-scaffold` | Development environment, examples, and TypeScript scripts for building extensions | Active (Mar 4) |
| `evefrontier/builder-documentation` | Documentation website (docs.evefrontier.com) | Active (Mar 7) |
| `evefrontier/evevault` | EVE Vault wallet Chrome extension and web app | v0.0.6 (Mar 13) |
| `evefrontier/eve-frontier-proximity-zk-poc` | ZK proof system for location/distance verification | PoC (Dec 2025) |

---

## Architecture Summary

```
                    EVE Frontier Architecture
                    ========================

    [Game Client] <---> [Game Server (Admin)]
         |                      |
         |              [Sponsored Txns]
         |                      |
         v                      v
    [EVE Vault] ---------> [Sui Blockchain]
    (zkLogin)               |
                            v
                   [World Smart Contracts]
                   /        |          \
            [Primitives] [Assemblies] [Extensions]
            location.move  gate.move   (Player-built)
            inventory.move storage.move
            fuel.move      turret.move
            status.move    network_node.move
            energy.move    character.move
```

**Data Flow:**
- Write: Player -> EVE Vault -> Sui TypeScript SDK -> Sui Blockchain
- Read: SuiClient / GraphQL / gRPC -> Sui Blockchain
- Sponsored: Player signs intent -> Admin sponsor pays gas -> Sui Blockchain
- Events: JumpEvent, inventory updates, deployments -> queryable via suix_queryEvents

**Extension Pattern:**
1. Developer writes Move contract with witness type (e.g., `MyAuth`)
2. Contract published to Sui
3. Extension authorized on target assembly via `authorize_extension<MyAuth>`
4. Extension logic issues permits/controls via typed witness pattern

---

## EVM to Sui Migration Notes

The documentation explicitly notes this is a migration from EVM (Solidity/Ethereum) to Sui (Move):
- All on-chain systems now require Move programming
- This differs substantially from prior EVM support
- Established blockchain patterns (from Ethereum/Solidity) may not translate directly
- The documentation is being rewritten specifically for this transition
- No explicit migration guide exists yet, but the "Constraints" page acknowledges the paradigm shift

---

## Quick Reference: Key Technical Details

**Blockchain:** Sui (Testnet currently)
**Smart Contract Language:** Move
**Object Size Limit:** 250KB per Move object
**Struct Field Limit:** 32 fields
**Dynamic Field Access Limit:** 1,024 per transaction
**Energy Unit:** GJ (Gigajoules)
**Gate Minimum Distance:** 20km between linked gates
**Authentication:** zkLogin (zero-knowledge, seedless)
**Currencies:** LUX (in-game), EVE Token (utility/ecosystem)
**Wallet Standard:** Sui Wallet Standard
**Development Tools:** Sui CLI (via suiup), Node.js, pnpm, Docker (optional)
**GraphQL Testnet IDE:** graphql.testnet.sui.io/graphql
**SDK Package:** @evefrontier/dapp-kit (React, v0.1.2)
**Hackathon:** March 11–31, 2026 — $80K prizes — https://deepsurge.xyz/evefrontier2026
