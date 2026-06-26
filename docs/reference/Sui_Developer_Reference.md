# Sui Blockchain Developer Reference

Quick-reference guide for reading from and writing to the Sui blockchain using the `@mysten/sui` TypeScript SDK. Written for the TehFrontier project targeting EVE Frontier Cycle 5 on Sui testnet.

---

## Table of Contents

- [SDK Setup](#sdk-setup)
- [Client Types](#client-types)
- [Network Endpoints](#network-endpoints)
- [Reading Data](#reading-data)
  - [Objects](#reading-objects)
  - [Owned Objects](#reading-owned-objects)
  - [Dynamic Fields](#reading-dynamic-fields)
  - [Events](#querying-events)
  - [Transactions](#querying-transactions)
  - [Coins & Balances](#coins--balances)
- [Writing Data](#writing-data)
  - [Transaction Building](#transaction-building)
  - [Move Calls](#move-calls)
  - [Object Arguments](#object-arguments)
  - [Pure Value Arguments](#pure-value-arguments)
  - [Coin Transfers](#coin-transfers)
  - [PTBs (Programmable Transaction Blocks)](#ptbs-programmable-transaction-blocks)
  - [Signing & Executing](#signing--executing)
  - [Gas Management](#gas-management)
  - [Dry Run / Simulation](#dry-run--simulation)
  - [Reading Results](#reading-transaction-results)
  - [Sponsored Transactions](#sponsored-transactions)
- [Key Management](#key-management)
- [Faucet](#faucet)
- [Real-Time Subscriptions](#real-time-subscriptions)
- [Pagination](#pagination)
- [GraphQL API](#graphql-api)
- [Sui Object Model](#sui-object-model)
- [Move Events](#move-events)
- [Sui CLI Cheatsheet](#sui-cli-cheatsheet)
- [Explorer URLs](#explorer-urls)
- [EVE Frontier World Contracts](#eve-frontier-world-contracts)
- [Our @tehfrontier/sui-client Package](#our-tehfrontiersui-client-package)
- [Migration Notes](#migration-notes)
- [Rate Limits](#rate-limits)

---

## SDK Setup

```bash
pnpm add @mysten/sui
```

**Current monorepo version:** `@mysten/sui: ^1.21.1` (in `packages/sui-client`). Latest is **2.5.0** — consider upgrading.

**Key import paths:**

```typescript
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';       // JSON-RPC client
import { SuiGrpcClient } from '@mysten/sui/grpc';                     // gRPC client (recommended)
import { SuiGraphQLClient } from '@mysten/sui/graphql';               // GraphQL client
import { graphql } from '@mysten/sui/graphql/schemas/latest';          // Typed GQL queries
import { Transaction } from '@mysten/sui/transactions';                // Transaction building
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';         // Key management
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet'; // Faucet
import { MIST_PER_SUI } from '@mysten/sui/utils';                     // 1 SUI = 1e9 MIST
import { bcs } from '@mysten/sui/bcs';                                 // BCS serialization
```

---

## Client Types

Three client implementations available. All share similar high-level methods.

### SuiClient (JSON-RPC) — DEPRECATED, still works until July 2026

```typescript
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const client = new SuiClient({ url: getFullnodeUrl('testnet') });
```

This is what our `@tehfrontier/sui-client` currently uses.

### SuiGrpcClient — RECOMMENDED replacement

```typescript
import { SuiGrpcClient } from '@mysten/sui/grpc';

const client = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});
```

Exposes additional low-level service clients: `ledgerService`, `stateService`, `transactionExecutionService`, `subscriptionService`, `movePackageService`. Uses Protocol Buffers (faster, smaller payloads than JSON-RPC). Supports `read_mask` / `FieldMask` for fetching only needed fields (up to 94% response size reduction).

### SuiGraphQLClient — for complex queries

```typescript
import { SuiGraphQLClient } from '@mysten/sui/graphql';

const gqlClient = new SuiGraphQLClient({
  url: 'https://graphql.testnet.sui.io/graphql',
  network: 'testnet',
});
```

---

## Network Endpoints

### Full Node RPC (JSON-RPC & gRPC)

| Network | URL | Use |
|---------|-----|-----|
| **Testnet** | `https://fullnode.testnet.sui.io:443` | EVE Frontier Cycle 5 |
| Mainnet | `https://fullnode.mainnet.sui.io:443` | Production |
| Devnet | `https://fullnode.devnet.sui.io:443` | Bleeding edge |
| Localnet | `http://127.0.0.1:9000` | Local development |

### GraphQL

| Network | URL |
|---------|-----|
| Testnet | `https://graphql.testnet.sui.io/graphql` |
| Mainnet | `https://graphql.mainnet.sui.io/graphql` |
| Devnet | `https://graphql.devnet.sui.io/graphql` |

### Faucet

| Network | URL |
|---------|-----|
| **Testnet** | `https://faucet.testnet.sui.io` |
| Devnet | `https://faucet.devnet.sui.io` |
| Web UI | `https://faucet.sui.io` |

Use `getFullnodeUrl('testnet')` to get URLs programmatically.

---

## Reading Data

### Reading Objects

```typescript
// Single object by ID
const result = await client.getObject({
  id: '0xabc123...',
  options: {
    showContent: true,       // Move struct fields (parsed JSON)
    showType: true,          // Full type string e.g. "0x2::coin::Coin<0x2::sui::SUI>"
    showOwner: true,         // Ownership info
    showDisplay: true,       // Display metadata (name, image, etc.)
    showBcs: true,           // BCS-encoded raw data
    showPreviousTransaction: true,
    showStorageRebate: true,
  },
});

// Access fields
result.data?.objectId;
result.data?.type;           // e.g. "0xPKG::assembly::Assembly"
result.data?.content;        // { dataType: 'moveObject', fields: { ... } }
result.data?.owner;          // { AddressOwner: '0x...' } or { Shared: { ... } }
```

```typescript
// Batch fetch (up to 50 per call)
const results = await client.multiGetObjects({
  ids: ['0xabc...', '0xdef...'],
  options: { showContent: true, showType: true },
});
```

### Reading Owned Objects

```typescript
const owned = await client.getOwnedObjects({
  owner: '0xPlayerAddress...',
  filter: {
    StructType: '0xPKG::assembly::Assembly', // filter by Move type
  },
  options: { showContent: true, showType: true, showOwner: true },
  cursor: undefined,  // for pagination
  limit: 50,
});

owned.data;         // array of objects
owned.hasNextPage;  // boolean
owned.nextCursor;   // pass to next call
```

**Available filters:**

```typescript
filter: { StructType: '0xPKG::module::Type' }      // by Move type
filter: { Package: '0xPackageId' }                   // by package
filter: { MoveModule: { package: '0xPkg', module: 'gate' } }  // by module
filter: { MatchAll: [{ StructType: '...' }, ...] }   // AND
filter: { MatchAny: [{ StructType: '...' }, ...] }   // OR
filter: { MatchNone: [{ StructType: '...' }] }       // NOT
```

### Reading Dynamic Fields

Dynamic fields = key-value storage on objects. This is how EVE Frontier stores inventory items, fuel data, etc. on assemblies.

```typescript
// List all dynamic fields on a parent object
const fields = await client.getDynamicFields({
  parentId: '0xParentObjectId',
  cursor: undefined,
  limit: 50,
});

for (const field of fields.data) {
  console.log(field.name);       // { type: string, value: any }
  console.log(field.objectId);   // ID of the field object
  console.log(field.type);       // 'DynamicField' or 'DynamicObject'
}

// Get a specific dynamic field by key
const field = await client.getDynamicFieldObject({
  parentId: '0xParentObjectId',
  name: {
    type: 'u64',        // Move type of the key
    value: '12345',     // key value
  },
});
```

**Reading a Move Table (common pattern):**

```typescript
async function readTable(client: SuiClient, tableId: string) {
  let cursor = null;
  const entries = [];

  do {
    const page = await client.getDynamicFields({ parentId: tableId, cursor });
    for (const field of page.data) {
      const obj = await client.getObject({
        id: field.objectId,
        options: { showContent: true },
      });
      if (obj.data?.content?.dataType === 'moveObject') {
        entries.push(obj.data.content.fields);
      }
    }
    cursor = page.nextCursor;
  } while (page.hasNextPage);

  return entries;
}
```

### Querying Events

```typescript
// By Move event type (most useful for EVE Frontier)
const events = await client.queryEvents({
  query: { MoveEventType: '0xPKG::fuel::FuelEvent' },
  limit: 50,
  order: 'descending',
  cursor: undefined,
});

// By sender address
query: { Sender: '0xAddress...' }

// By Move module (all events from a module)
query: { MoveModule: { package: '0xPKG', module: 'gate' } }

// By transaction digest
query: { Transaction: 'digest_string' }

// By time range (milliseconds)
query: { TimeRange: { startTime: '1700000000000', endTime: '1700100000000' } }

// Combine filters
query: { All: [filter1, filter2] }    // AND
query: { Any: [filter1, filter2] }    // OR
```

**Event object structure:**

```typescript
interface SuiEvent {
  id: { txDigest: string; eventSeq: string };
  packageId: string;
  transactionModule: string;
  sender: string;
  type: string;                        // "0xPKG::module::EventName"
  parsedJson: Record<string, any>;     // parsed event data
  bcs: string;
  timestampMs: string;
}
```

### Querying Transactions

```typescript
const txs = await client.queryTransactionBlocks({
  filter: { FromAddress: '0xAddress...' },
  options: {
    showInput: true,
    showEffects: true,
    showEvents: true,
    showObjectChanges: true,
    showBalanceChanges: true,
  },
  limit: 10,
  order: 'descending',
});

// Other filters
filter: { ToAddress: '0x...' }
filter: { InputObject: '0xObjectId' }
filter: { ChangedObject: '0xObjectId' }
filter: { MoveFunction: { package: '0xPkg', module: 'mod', function: 'fn' } }
```

```typescript
// Single transaction by digest
const tx = await client.getTransactionBlock({
  digest: '9XFneskU8tW7UxQf7tE5qFRfcN4FadtC2Z3HAZkgeETd',
  options: { showEffects: true, showEvents: true, showObjectChanges: true },
});
```

### Coins & Balances

```typescript
import { MIST_PER_SUI } from '@mysten/sui/utils';

// Total balance for one coin type (defaults to SUI)
const balance = await client.getBalance({
  owner: '0xAddress...',
  coinType: '0x2::sui::SUI',  // optional
});
console.log('SUI:', Number(balance.totalBalance) / Number(MIST_PER_SUI));

// All coin type balances
const all = await client.getAllBalances({ owner: '0xAddress...' });

// List individual coin objects (paginated)
const coins = await client.getCoins({
  owner: '0xAddress...',
  coinType: '0x2::sui::SUI',
  limit: 50,
});
// coins.data[i].coinObjectId, coins.data[i].balance
```

---

## Writing Data

### Transaction Building

Every transaction in Sui is a **Programmable Transaction Block (PTB)** — an atomic batch of up to 1,024 operations.

```typescript
import { Transaction } from '@mysten/sui/transactions';

const tx = new Transaction();
// ... add commands ...
const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
});
```

**Available commands:**

| Command | Purpose |
|---------|---------|
| `tx.moveCall({ target, arguments, typeArguments })` | Call a Move function |
| `tx.splitCoins(coin, amounts[])` | Split a coin into new coins |
| `tx.mergeCoins(destination, sources[])` | Merge coins |
| `tx.transferObjects(objects[], address)` | Transfer objects to an address |
| `tx.makeMoveVec({ type?, elements })` | Create a vector for Move calls |
| `tx.publish(modules, dependencies)` | Publish a Move package |
| `tx.upgrade(...)` | Upgrade a package |

### Move Calls

```typescript
// Basic move call
tx.moveCall({
  target: `${PACKAGE_ID}::module_name::function_name`,
  arguments: [
    tx.object('0xObjectId'),        // object reference
    tx.pure.u64(100),               // primitive value
    tx.pure.string('hello'),        // string
    tx.pure.address('0xRecipient'), // address
  ],
});

// With type arguments (generics)
tx.moveCall({
  target: `${PACKAGE_ID}::gate::authorize_extension`,
  typeArguments: ['0xBuilderPkg::my_gate::MyGateAuth'],
  arguments: [tx.object(gateId), tx.object(ownerCapId)],
});

// Capture return values
const [item] = tx.moveCall({
  target: `${PKG}::shop::purchase`,
  arguments: [tx.object(shopId), paymentCoin],
});
tx.transferObjects([item], tx.pure.address(myAddress));

// Multiple return values
const [a, b] = tx.moveCall({ target: '...', arguments: [...] });
```

The `target` format is always: `packageId::moduleName::functionName`

### Object Arguments

```typescript
// Simple — SDK auto-resolves version/digest/ownership
tx.object('0xObjectId');

// Built-in system objects
tx.object.system();    // 0x5 (SuiSystemState)
tx.object.clock();     // 0x6 (Clock)
tx.object.random();    // 0x8 (Random)
tx.object.denyList();  // 0x403 (DenyList)

// Option wrapping
tx.object.option({ type: '0xPkg::mod::Thing', value: '0x456' });   // Some
tx.object.option({ type: '0xPkg::mod::Thing', value: null });      // None
```

For offline transaction building, use fully resolved references:

```typescript
import { Inputs } from '@mysten/sui/transactions';

// Owned or immutable object
tx.object(Inputs.ObjectRef({ objectId: '0x...', version: '123', digest: 'abc...' }));

// Shared object (mutable=true for &mut T, false for &T)
tx.object(Inputs.SharedObjectRef({
  objectId: '0x...',
  initialSharedVersion: '1',
  mutable: true,
}));

// Receiving object (object owned by another object)
tx.object(Inputs.ReceivingRef({ objectId: '0x...', version: '123', digest: 'abc...' }));
```

### Pure Value Arguments

```typescript
tx.pure.u8(1);
tx.pure.u16(100);
tx.pure.u32(1000);
tx.pure.u64(100n);               // bigint or number
tx.pure.u128(100n);
tx.pure.u256(100n);
tx.pure.bool(true);
tx.pure.string('hello');
tx.pure.address('0x...');
tx.pure.id('0x...');             // object ID

// Vectors and Options
tx.pure.vector('u8', [1, 2, 3]);
tx.pure.option('u8', 1);         // Some(1)
tx.pure.option('u8', null);      // None

// BCS for complex types
import { bcs } from '@mysten/sui/bcs';
tx.pure(bcs.Address.serialize('0x123'));
tx.pure(bcs.vector(bcs.Address).serialize(['0x123', '0x456']));
```

**Breaking change in v1.0:** The old `tx.pure('0x123')` and `tx.pure(123)` no longer work. Must use typed methods.

### Coin Transfers

```typescript
// Transfer SUI (1 SUI = 1,000,000,000 MIST)
const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000_000)]);
tx.transferObjects([coin], tx.pure.address('0xRecipient'));

// Multiple transfers in one PTB
const amounts = [1_000_000_000, 2_000_000_000];
const coins = tx.splitCoins(tx.gas, amounts.map(a => tx.pure.u64(a)));
tx.transferObjects([coins[0]], tx.pure.address('0xAlice'));
tx.transferObjects([coins[1]], tx.pure.address('0xBob'));

// Transfer entire gas coin
tx.transferObjects([tx.gas], tx.pure.address('0xRecipient'));
```

Using `coinWithBalance` intent (simplifies coin selection):

```typescript
import { coinWithBalance, Transaction } from '@mysten/sui/transactions';

const tx = new Transaction();
tx.setSender(keypair.toSuiAddress());
tx.transferObjects(
  [coinWithBalance({ balance: 1_000_000_000 })],
  tx.pure.address(recipient),
);
```

### PTBs (Programmable Transaction Blocks)

Chain multiple operations atomically — if any fails, ALL revert:

```typescript
const tx = new Transaction();

// Step 1: Split gas
const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(1000)]);

// Step 2: Use result in a Move call
const [item] = tx.moveCall({
  target: `${MARKETPLACE_PKG}::marketplace::buy`,
  arguments: [tx.object(marketplaceId), paymentCoin],
});

// Step 3: Transfer the result
tx.transferObjects([item], tx.pure.address(myAddress));

// All 3 steps execute atomically
```

- Up to **1,024 unique operations** per PTB
- Results from earlier commands can be used as inputs to later commands
- All created objects must be consumed (transferred, destroyed, or used)

### Signing & Executing

```typescript
// Most common: sign and execute in one call
const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: {
    showEffects: true,
    showEvents: true,
    showObjectChanges: true,
    showBalanceChanges: true,
  },
});

// Wait for indexer to catch up (for subsequent reads)
await client.waitForTransaction({ digest: result.digest });
```

Separate sign + execute (for wallets, multi-sig, sponsored):

```typescript
// Build → Sign → Execute
const bytes = await tx.build({ client });
const { signature } = await keypair.signTransaction(bytes);
const result = await client.executeTransactionBlock({
  transactionBlock: bytes,
  signature,
});
```

### Gas Management

**Automatic (default):** SDK auto-selects gas coins, gas price, and gas budget via dry-run.

```typescript
// Manual overrides (optional)
tx.setGasPrice(1000);
tx.setGasBudget(50_000_000);     // in MIST
tx.setGasPayment([{ objectId: '0x...', version: '123', digest: 'abc...' }]);
```

`tx.gas` references the gas coin and can be used in transactions:

```typescript
const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(100)]);  // split from gas
tx.mergeCoins(tx.gas, [tx.object(otherCoinId)]);            // merge into gas
```

### Dry Run / Simulation

```typescript
// Full dry run (requires building first)
const bytes = await tx.build({ client });
const dryRunResult = await client.dryRunTransactionBlock({ transactionBlock: bytes });
dryRunResult.effects.status;        // { status: 'success' } or failure
dryRunResult.effects.gasUsed;
dryRunResult.events;
dryRunResult.objectChanges;

// Dev inspect (no signature needed — great for debugging)
const devResult = await client.devInspectTransactionBlock({
  transactionBlock: tx,
  sender: '0xAddress',
});
```

### Reading Transaction Results

```typescript
const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showEffects: true, showEvents: true, showObjectChanges: true, showBalanceChanges: true },
});

result.digest;                              // transaction hash
result.effects?.status.status;              // 'success' or 'failure'
result.effects?.gasUsed;                    // { computationCost, storageCost, storageRebate, ... }
result.effects?.created;                    // [{ reference: { objectId, version, digest }, owner }]
result.effects?.mutated;                    // mutated objects
result.effects?.deleted;                    // deleted objects
result.events;                              // emitted Move events
result.objectChanges;                       // [{ type: 'created'|'mutated'|..., objectId, objectType }]
result.balanceChanges;                      // [{ owner, coinType, amount }]
```

### Sponsored Transactions

```typescript
// 1. User builds transaction kind only
const tx = new Transaction();
// ... add commands ...
const kindBytes = await tx.build({ client, onlyTransactionKind: true });

// 2. Sponsor adds gas info
const sponsoredTx = Transaction.fromKind(kindBytes);
sponsoredTx.setSender(userAddress);
sponsoredTx.setGasOwner(sponsorAddress);
sponsoredTx.setGasPayment(sponsorCoins);
const sponsoredBytes = await sponsoredTx.build({ client });

// 3. Both sign
const { signature: userSig } = await userKeypair.signTransaction(sponsoredBytes);
const { signature: sponsorSig } = await sponsorKeypair.signTransaction(sponsoredBytes);

// 4. Execute with dual signatures
await client.executeTransactionBlock({
  transactionBlock: sponsoredBytes,
  signature: [userSig, sponsorSig],
});
```

---

## Key Management

### Creating Keypairs

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';

// Generate random
const keypair = new Ed25519Keypair();

// From mnemonic (default path: m/44'/784'/0'/0'/0')
const keypair = Ed25519Keypair.deriveKeypair('word1 word2 ... word12');

// Custom derivation path (multi-account)
const keypair = Ed25519Keypair.deriveKeypair(mnemonic, "m/44'/784'/1'/0'/0'");
// Secp256k1 uses purpose 54: m/54'/784'/0'/0'/0'

// From secret key (bech32)
const keypair = Ed25519Keypair.fromSecretKey('suiprivkey1qz...');

// From raw hex bytes
import { fromHex } from '@mysten/sui/utils';
const keypair = Ed25519Keypair.fromSecretKey(fromHex('0xabcdef...'));
```

### Using Keypairs

```typescript
const address = keypair.toSuiAddress();          // '0x...'
const secretKey = keypair.getSecretKey();         // 'suiprivkey1...'

// Sign a personal message
const message = new TextEncoder().encode('hello');
const { signature } = await keypair.signPersonalMessage(message);

// Verify
const isValid = await keypair.getPublicKey().verifyPersonalMessage(message, signature);
```

### Detect key scheme from encoded key

```typescript
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
const { scheme, secretKey } = decodeSuiPrivateKey('suiprivkey1...');
// scheme: 'ED25519' | 'Secp256k1' | 'Secp256r1'
```

---

## Faucet

### SDK Method (Recommended)

```typescript
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';

await requestSuiFromFaucetV2({
  host: getFaucetHost('testnet'),
  recipient: '0xYourAddress',
});
```

### Direct HTTP API

```
POST https://faucet.testnet.sui.io/v2/gas
Content-Type: application/json

{ "FixedAmountRequest": { "recipient": "0xYourAddress" } }
```

### CLI

```bash
sui client faucet
```

Rate limits apply — wait between requests if rate-limited.

---

## Real-Time Subscriptions

### WebSocket (DEPRECATED — deactivated July 2026)

```typescript
// Subscribe to events
const unsubscribe = await client.subscribeEvent({
  filter: { MoveEventType: '0xPKG::gate::JumpEvent' },
  onMessage(event) {
    console.log(event.parsedJson);
  },
});
await unsubscribe(); // cleanup

// Subscribe to transactions
const unsub = await client.subscribeTransaction({
  filter: { FromAddress: '0xAddress...' },
  onMessage(effects) { console.log(effects); },
});

// Custom WebSocket config
import { SuiHTTPTransport } from '@mysten/sui/client';
const client = new SuiClient({
  transport: new SuiHTTPTransport({
    url: 'https://fullnode.testnet.sui.io:443',
    websocket: {
      reconnectTimeout: 1000,
      url: 'wss://fullnode.testnet.sui.io:443',
    },
  }),
});
```

### gRPC Streaming (future-proof)

`SuiGrpcClient.subscriptionService.SubscribeCheckpoint` streams live checkpoint updates. Checkpoints arrive in order without gaps, enabling resume from last processed checkpoint.

### Recommended Approach for Now

Use **polling with `queryEvents`** at a regular interval (5-30s). Our `@tehfrontier/sui-client` already has a `pollEvents()` helper for this pattern.

---

## Pagination

All paginated SDK methods return the same shape:

```typescript
interface PaginatedResponse<T> {
  data: T[];
  hasNextPage: boolean;
  nextCursor: string | null;
}
```

**Generic pagination helper:**

```typescript
async function fetchAllPages<T>(
  fetchFn: (cursor?: string) => Promise<{
    data: T[];
    hasNextPage: boolean;
    nextCursor: string | null;
  }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;

  do {
    const page = await fetchFn(cursor);
    all.push(...page.data);
    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
  } while (true);

  return all;
}

// Usage
const allObjects = await fetchAllPages((cursor) =>
  client.getOwnedObjects({
    owner: '0xAddress',
    cursor,
    limit: 50,
    options: { showType: true },
  }),
);
```

**Paginated methods:** `getOwnedObjects`, `getCoins`, `getAllCoins`, `queryEvents`, `queryTransactionBlocks`, `getDynamicFields`, `getCheckpoints`

---

## GraphQL API

**Status:** GA (Feb-Mar 2026). JSON-RPC deprecated, **fully deactivated July 2026**.

```typescript
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { graphql } from '@mysten/sui/graphql/schemas/latest';

const gqlClient = new SuiGraphQLClient({
  url: 'https://graphql.testnet.sui.io/graphql',
  network: 'testnet',
});

// Type-safe query using gql.tada
const GetBalanceQuery = graphql(`
  query GetBalance($address: SuiAddress!) {
    address(address: $address) {
      balance { totalBalance }
      defaultSuinsName
    }
  }
`);

const result = await gqlClient.query({
  query: GetBalanceQuery,
  variables: { address: '0xYourAddress' },
});
```

**Service limits:** 175KB request payload (transactions), 5KB (queries), 74s timeout, 50 items per page default, 200 max multi-get.

---

## Sui Object Model

### Ownership Types

| Type | Who Can Use | Consensus? | Gas Cost | Example |
|------|-------------|------------|----------|---------|
| **Address-Owned** | Only the owner | No (fastest) | Lowest | OwnerCap, Coins |
| **Shared** | Anyone | Yes (sequenced) | Higher | EVE Assemblies, Gates, SSUs |
| **Immutable** | Anyone (read-only) | No | Lowest | Published packages |
| **Object-Owned** | Parent object's module | Via parent | — | OwnerCap owned by Character |

**Key implications:**
- All EVE Frontier assemblies (Assembly, Gate, StorageUnit, Turret, NetworkNode) are **shared objects** — readable by anyone via `getObject()`
- `OwnerCap<T>` objects are **object-owned** — sent to the player's `Character` object
- Shared objects require consensus, making them slightly slower and more expensive to write to
- Address-owned objects skip consensus entirely (single-writer optimization)

### Dynamic Fields vs Dynamic Object Fields

| | `dynamic_field` (df) | `dynamic_object_field` (ofield) |
|---|---|---|
| Value type | Any with `store` | Must be an object (`key + store`) |
| Accessible by ID? | No (wrapped) | Yes (remains queryable) |
| Use case | Config values, small data | Child objects you want to query directly |

Both are queried the same way from TypeScript: `getDynamicFields()` / `getDynamicFieldObject()`.

---

## Move Events

### Defining (in Move)

```move
// Events must have copy + drop (NOT key or store)
public struct MyEvent has copy, drop {
    player: address,
    amount: u64,
}
```

### Emitting (in Move)

```move
use sui::event;
event::emit(MyEvent { player: ctx.sender(), amount: 100 });
```

### Querying (from TypeScript)

See [Querying Events](#querying-events) above. Key filters for EVE Frontier:

```typescript
// All fuel changes
query: { MoveEventType: `${WORLD_PKG}::fuel::FuelEvent` }

// All gate jumps
query: { MoveEventType: `${WORLD_PKG}::gate::JumpEvent` }

// All killmails
query: { MoveEventType: `${WORLD_PKG}::killmail::KillmailCreatedEvent` }

// All status changes (online/offline/anchored)
query: { MoveEventType: `${WORLD_PKG}::status::StatusChangedEvent` }

// All events from a specific module
query: { MoveModule: { package: WORLD_PKG, module: 'gate' } }
```

---

## Sui CLI Cheatsheet

### Setup

```bash
# Install
curl -fsSL https://sui.io/install.sh | bash

# Network
sui client active-env
sui client envs
sui client new-env --rpc https://fullnode.testnet.sui.io:443 --alias testnet
sui client switch --env testnet

# Keys
sui client active-address
sui client addresses
sui client new-address ed25519
sui client new-address ed25519 MY_ALIAS
sui keytool generate ed25519
sui keytool import "mnemonic words..." ed25519

# Faucet
sui client faucet
sui client gas                    # show gas coins
```

### Querying

```bash
sui client object 0xObjectId               # view object
sui client object 0xObjectId --json        # as JSON
sui client objects                          # list owned objects
sui client objects 0xAddress               # list for address
```

### Move Development

```bash
sui move new my_project
sui move build
sui move build --path ./contracts/world
sui move test
sui move test --trace
```

### Transactions

```bash
# Call a function
sui client call --package 0xPKG --module assembly --function online \
  --args 0xAssembly 0xNode 0xConfig 0xCap

# PTB syntax
sui client ptb --move-call 0xPKG::assembly::online @0xAssembly @0xNode @0xConfig @0xCap

# With type args
sui client ptb --move-call "0xPKG::gate::authorize_extension<0xBUILDER::my_gate::Auth>" @0xGate @0xCap

# Publish
sui client ptb \
  --move-call sui::tx_context::sender --assign sender \
  --publish "." --assign upgrade_cap \
  --transfer-objects "[upgrade_cap]" sender

# Dry run
sui client ptb --move-call 0xPKG::m::f args --dry-run

# Transfer SUI
sui client pay-sui --input-coins 0xCoinId --recipients 0xAddr --amounts 100000000
```

---

## Explorer URLs

### Suiscan (Primary)

| Resource | URL |
|----------|-----|
| **Testnet** | `https://suiscan.xyz/testnet/` |
| Object | `https://suiscan.xyz/testnet/object/{objectId}` |
| Package | `https://suiscan.xyz/testnet/object/{packageId}` |
| Transaction | `https://suiscan.xyz/testnet/tx/{digest}` |
| Account | `https://suiscan.xyz/testnet/account/{address}` |

### SuiVision (Alternative)

| Resource | URL |
|----------|-----|
| **Testnet** | `https://testnet.suivision.xyz/` |
| Object | `https://testnet.suivision.xyz/object/{objectId}` |
| Package | `https://testnet.suivision.xyz/package/{packageId}` |
| Transaction | `https://testnet.suivision.xyz/txblock/{digest}` |
| Account | `https://testnet.suivision.xyz/account/{address}` |

---

## EVE Frontier World Contracts

Repository: `https://github.com/evefrontier/world-contracts` (v0.0.17, MIT, Sui testnet-v1.66.2)

### Contract Structure

```
contracts/world/sources/
  world.move                          # GovernorCap, init
  access/
    access_control.move               # AdminACL, OwnerCap<T>, ServerAddressRegistry
  assemblies/
    assembly.move                     # Assembly struct & lifecycle
    gate.move                         # Gate, linking, jumping, JumpPermit
    storage_unit.move                 # StorageUnit, inventory ops
    turret.move                       # Turret, targeting, extensions
  character/
    character.move                    # Character, PlayerProfile
  crypto/
    sig_verify.move                   # Ed25519 signature verification
  killmail/
    killmail.move                     # Killmail, LossType enum
  network_node/
    network_node.move                 # NetworkNode (power), fuel, energy
  primitives/
    energy.move                       # EnergyConfig, EnergySource
    fuel.move                         # Fuel, FuelConfig, burn mechanics
    in_game_id.move                   # TenantItemId (tenant + item_id)
    inventory.move                    # Inventory, ItemEntry, Item
    location.move                     # Location, LocationProof, proximity
    metadata.move                     # Metadata (name, description, url)
    status.move                       # AssemblyStatus, Status enum, Action enum
  registry/
    killmail_registry.move            # KillmailRegistry
    object_registry.move              # ObjectRegistry (deterministic IDs)
```

### Key Structs

**Assembly** (Shared Object)
```move
public struct Assembly has key {
    id: UID,
    key: TenantItemId,            // { item_id: u64, tenant: String }
    owner_cap_id: ID,
    type_id: u64,                 // assembly type identifier
    status: AssemblyStatus,       // { status: Status (NULL|OFFLINE|ONLINE) }
    location: Location,           // { location_hash: vector<u8> } — Poseidon2 hash, NOT coords
    energy_source_id: Option<ID>, // NetworkNode providing energy
    metadata: Option<Metadata>,   // { assembly_id, name, description, url }
}
```

**Gate** (extends Assembly concept)
```move
public struct Gate has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    linked_gate_id: Option<ID>,    // destination gate
    status: AssemblyStatus,
    location: Location,
    energy_source_id: Option<ID>,
    metadata: Option<Metadata>,
    extension: Option<TypeName>,   // custom extension contract type
}
```

**StorageUnit**
```move
public struct StorageUnit has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    status: AssemblyStatus,
    location: Location,
    inventory_keys: vector<ID>,   // references to inventory objects
    energy_source_id: Option<ID>,
    metadata: Option<Metadata>,
    extension: Option<TypeName>,
}
```

**Turret**
```move
public struct Turret has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    status: AssemblyStatus,
    location: Location,
    energy_source_id: Option<ID>,
    metadata: Option<Metadata>,
    extension: Option<TypeName>,
}
```

**NetworkNode** (power source, contains Fuel)
```move
public struct NetworkNode has key {
    id: UID,
    key: TenantItemId,
    owner_cap_id: ID,
    type_id: u64,
    status: AssemblyStatus,
    location: Location,
    fuel: Fuel,                         // embedded fuel tracking
    energy_source: EnergySource,        // energy production capacity
    metadata: Option<Metadata>,
    connected_assembly_ids: vector<ID>, // assemblies powered by this node
}
```

**Fuel** (stored inside NetworkNode)
```move
public struct Fuel has store {
    max_capacity: u64,
    burn_rate_in_ms: u64,
    type_id: Option<u64>,
    unit_volume: Option<u64>,
    quantity: u64,
    is_burning: bool,
    previous_cycle_elapsed_time: u64,
    burn_start_time: u64,
    last_updated: u64,
}
```

**Character**
```move
public struct Character has key {
    id: UID,
    key: TenantItemId,
    tribe_id: u32,
    character_address: address,
    metadata: Option<Metadata>,
    owner_cap_id: ID,
}
```

**Killmail**
```move
public struct Killmail has key {
    id: UID,
    key: TenantItemId,
    killer_id: TenantItemId,
    victim_id: TenantItemId,
    reported_by_character_id: TenantItemId,
    kill_timestamp: u64,
    loss_type: LossType,           // SHIP | STRUCTURE
    solar_system_id: TenantItemId,
}
```

**Item**
```move
public struct Item has key, store {
    id: UID,
    parent_id: ID,
    tenant: String,
    type_id: u64,
    item_id: u64,
    volume: u64,
    quantity: u32,
    location: Location,
}
```

**EVE Token:** Total supply 10 billion, 9 decimals. Initial deployer allocation: 10 million.

### Key Events

| Event | Module | Key Fields |
|-------|--------|------------|
| `AssemblyCreatedEvent` | assembly | assembly_id, assembly_key, owner_cap_id, type_id |
| `StatusChangedEvent` | status | assembly_id, status, action (ANCHORED/ONLINE/OFFLINE/UNANCHORED) |
| `FuelEvent` | fuel | assembly_id, type_id, old_quantity, new_quantity, is_burning, action (DEPOSITED/WITHDRAWN/BURNING_STARTED/BURNING_STOPPED/BURNING_UPDATED/DELETED) |
| `GateCreatedEvent` | gate | assembly_id, type_id, location_hash, status |
| `GateLinkedEvent` | gate | source_gate_id, destination_gate_id |
| `GateUnlinkedEvent` | gate | source_gate_id, destination_gate_id |
| `JumpEvent` | gate | source_gate_id, destination_gate_id, character_id |
| `StorageUnitCreatedEvent` | storage_unit | storage_unit_id, max_capacity, location_hash |
| `TurretCreatedEvent` | turret | turret_id, type_id |
| `NetworkNodeCreatedEvent` | network_node | network_node_id, fuel_max_capacity, fuel_burn_rate_in_ms, max_energy_production |
| `CharacterCreatedEvent` | character | character_id, tribe_id, character_address |
| `KillmailCreatedEvent` | killmail | killer_id, victim_id, loss_type, kill_timestamp, solar_system_id |
| `ItemMintedEvent` | inventory | assembly_id, character_id, item_id, type_id, quantity |
| `ItemDepositedEvent` | inventory | assembly_id, character_id, item_id, type_id, quantity |
| `ItemWithdrawnEvent` | inventory | assembly_id, character_id, item_id, type_id, quantity |
| `MetadataChangedEvent` | metadata | assembly_id, name, description, url |
| `EnergyReservedEvent` | energy | energy_source_id, assembly_type_id, energy_reserved |
| `EnergyReleasedEvent` | energy | energy_source_id, assembly_type_id, energy_released |
| `OwnerCapCreatedEvent` | access | owner_cap_id, authorized_object_id |
| `OwnerCapTransferred` | access | owner_cap_id, previous_owner, owner |

### Extension Pattern (Builder Mods)

EVE Frontier uses typed-witness authorization for builder extensions:

```move
// 1. Builder deploys their own auth witness type
module my_package::my_gate;
public struct MyGateAuth has drop {}

// 2. Authorize extension on a Gate
gate::authorize_extension<MyGateAuth>(gate, owner_cap);

// 3. Issue JumpPermit (for gate extensions)
gate::issue_jump_permit<MyGateAuth>(source_gate, dest_gate, character, MyGateAuth {}, expires_at, ctx);

// 4. For turrets: destroy OnlineReceipt hot potato
turret::destroy_online_receipt(receipt, MyTurretAuth {});
```

**Extension write capability (confirmed March 11 builder chat):**
- **Gates:** Extensions can write to chain (issue permits, modify state)
- **Turrets:** Extensions are **read-only** — game server runs `devInspect` (read-only call). Custom turret logic can filter/prioritize targets but cannot modify on-chain state.
- Turret priority list updates emit events: `turret.move#L288-L305`
- Turret extension example: `world-contracts/contracts/extension_examples/sources/turret.move`

### Access Control

- `GovernorCap` — top-level governance (deployer holds)
- `AdminACL` — shared object with authorized sponsor addresses (game servers)
- `OwnerCap<T>` — phantom-typed ownership proof, object-owned by Character
  - Borrowed via `character::borrow_owner_cap()` with `Receiving<OwnerCap<T>>`
  - Must be returned via `character::return_owner_cap()`
- `ServerAddressRegistry` — tracks authorized game server addresses

### Package IDs

**Not hardcoded.** Uses environment variables:
- `WORLD_PACKAGE_ID` — populated after deployment
- `BUILDER_PACKAGE_ID` — your extension package
- `EXTENSION_CONFIG_ID` — populated after deployment

**Action:** Discover actual package IDs on Cycle 5 launch day (March 11) via EVE Frontier Discord, builder-scaffold README, or scanning Suiscan.

---

## EVE Frontier DappKit & Builder Tools

*Source: Hackathon Tutorial 2 & 3 transcripts (March 11, 2026)*

### Key URLs

| Resource | URL |
|----------|-----|
| Builder docs | https://docs.evefrontier.com (also `docs.eafrontier.com`) |
| DappKit React SDK docs | https://sui-docs.evefrontier.com |
| EVE Vault GitHub | https://github.com/evefrontier/evevault |
| Builder scaffold repo | https://github.com/evefrontier/builder-scaffold |
| Suiscan (transaction explorer) | https://suiscan.xyz/testnet |

### EVE Vault (Wallet)

- **Version:** v0.03 for Utopia
- **No longer requires 12-word mnemonic** — uses ZK login (FusionAuth OAuth + Enoki)
- **Setup:** Create 6-digit PIN → Log in with Utopia server email/password
- **Chrome extension:** Load unpacked via `chrome://extensions/` Developer Mode
- **Displays:** Sui address, transaction approval prompts

### @evefrontier/dapp-kit (React SDK)

```typescript
// Provider (wrap app in main.tsx)
import { EFrontierProvider } from '@evefrontier/dapp-kit';

// Query assembly data (hooks)
import { useSmartObject } from '@evefrontier/dapp-kit';
const { assembly, character, loading, error } = useSmartObject();
// Under the hood: GraphQL query by Sui object ID → parsed assembly structure

// Mysten DappKit for transactions (separate package)
import { useDappKit } from '@mysten/dapp-kit/react';
import { useCurrentAccount } from '@mysten/dapp-kit/react';
```

**Assembly object ID — two methods:**
1. **Direct:** Pass Sui object ID via `VITE_OBJECT_ID` env var
2. **Reactive:** URL query params `?tenant=<TENANT>&itemId=<ITEM_ID>` — DappKit derives the Sui object ID from these (matches `TenantItemId` struct in world contracts)

**Environment variables (Vite dApp):**
```bash
VITE_EVE_WORLD_PACKAGE_ID=<deployed_world_package_id>
VITE_GRAPHQL_ENDPOINT=<testnet_graphql_url>   # indexed Sui data
VITE_OBJECT_ID=<assembly_sui_object_id>       # optional, can use query params instead
```

### Transaction Pattern (dApp)

```typescript
// Build transaction (same Move calls as CLI scripts)
const tx = new Transaction();
tx.moveCall({
  target: `${WORLD_PACKAGE_ID}::gate::authorize_extension`,
  arguments: [tx.object(gateId), tx.object(ownerCapId), tx.pure.address(characterId)],
  typeArguments: [`${BUILDER_PACKAGE_ID}::my_module::MyWitnessType`],
});

// Sign & execute via DappKit (ZK login requires explicit sender)
const { signAndExecuteTransaction } = useDappKit();
const currentAccount = useCurrentAccount();
const result = await signAndExecuteTransaction({
  transaction: tx,
  sender: currentAccount.address,  // REQUIRED for ZK login
});
console.log(result.transactionDigest);  // verify on Suiscan
```

### Builder Scaffold Structure

```
builder-scaffold/
├── dapps/                          # React dApp template
│   ├── src/
│   │   ├── main.tsx                # EFrontierProvider wrapper
│   │   ├── App.tsx                 # Connect wallet button
│   │   ├── assemblyinfo.tsx        # Assembly display + action buttons
│   │   └── functions/              # Transaction builders
│   │       └── authorizegate.ts    # Example: authorize gate from dApp
│   └── .env.sample
├── move-contracts/                 # Custom contract examples
│   └── smart-gate/
│       ├── tribe_gate.move         # Tribe-restricted jump permits
│       ├── bounty_gate.move        # Bounty-gated access
│       └── toll_gate.move          # Toll payment for jump
├── ts-scripts/                     # CLI scripts (template for dApp functions)
│   ├── configure-rules.ts          # Set permit expiry, allowed tribes
│   ├── authorize-gate.ts           # Authorize witness on gate
│   ├── authorize-storage-unit.ts   # Same pattern for storage
│   ├── issue-tribe-jump-permit.ts  # Issue jump permit (simulates game)
│   └── collect-cops-bounty.ts      # Dual-assembly example (gate + storage)
├── test-resources.json             # Item IDs for test assembly creation
└── end-to-end-builder-flow-docker.md
```

### Docker Dev Flow

```bash
# Start container with 3 funded accounts (admin, playerA, playerB)
docker run ...  # Addresses persist across restarts

# Deploy world contracts to local node
git clone https://github.com/evefrontier/world-contracts
pnpm install && pnpm deploy:localnet

# Create test resources (character, network node, fuel, SSUs, gates)
pnpm create:test-resources  # Uses test-resources.json item IDs

# Deploy custom contract (local requires published dependency file)
sui client publish --published-dependency <path_to_published.toml>
```

**Note:** Local chain is ephemeral (resets on container restart). For testnet, use same steps with `deploy:testnet` and real gas.

### World Contracts Docker Image

Published on every release at the world-contracts repo. Can be used instead of cloning:
- Deploy world
- Configure (admin addresses, fuel efficiencies, energy requirements)
- Create test resources

---

## Our @tehfrontier/sui-client Package

**Location:** `packages/sui-client/`
**Version:** 0.0.1 (ES module)
**Dependency:** `@mysten/sui: ^1.21.1`

### What's Built

**`src/client.ts`** — Client factory with caching:

```typescript
import { createSuiClient } from '@tehfrontier/sui-client';

const client = createSuiClient('testnet');        // named network
const client = createSuiClient('https://...');    // custom URL
const client = createSuiClient();                 // SUI_RPC_URL env var, or testnet
```

- Returns cached `SuiClient` instance for the same URL
- Supports: mainnet, testnet, devnet, localnet, custom URLs
- Falls back to `process.env.SUI_RPC_URL`, then testnet

**`src/events.ts`** — Event polling helper:

```typescript
import { pollEvents } from '@tehfrontier/sui-client';

const nextCursor = await pollEvents({
  client,
  packageId: WORLD_PACKAGE_ID,
  module: 'fuel',
  eventType: 'FuelEvent',
  cursor: lastCursor,
  onEvents: async (events, nextCursor) => {
    for (const event of events) {
      console.log(event.parsedJson);
    }
  },
});
```

- Builds qualified `MoveEventType` from packageId + module + eventType
- 50 events per query, ascending order
- Returns next cursor for continuous polling

### Not Yet Used

Neither `apps/web` nor `apps/api` currently depend on this package. It's intended for the new `apps/periscope` app (Frontier Periscope).

### Upgrade Consideration

Current `@mysten/sui: ^1.21.1` → latest is **2.5.0**. The SuiClient API is stable across this range but upgrading gives access to `SuiGrpcClient` and `SuiGraphQLClient` imports.

---

## Migration Notes

### SDK v1.0 Renames (important if reading older tutorials)

| Old (pre-1.0) | New (1.0+) |
|---|---|
| `TransactionBlock` | `Transaction` |
| `signAndExecuteTransactionBlock()` | `signAndExecuteTransaction()` |
| `waitForTransactionBlock()` | `waitForTransaction()` |
| `tx.pure('0x123')` | `tx.pure.address('0x123')` |
| `tx.pure(123, 'u64')` | `tx.pure.u64(123)` |
| `tx.serialize()` | `tx.toJSON()` (async) |
| `new TransactionBlock(old)` | `Transaction.from(old)` |
| `tx.blockData` | `tx.getData()` |
| `makeMoveVec({ objects })` | `makeMoveVec({ elements })` |

### API Deprecation Timeline

| Date | Milestone |
|------|-----------|
| Sep 2025 | GraphQL beta; gRPC GA; JSON-RPC deprecated |
| Feb-Mar 2026 | GraphQL GA (NOW) |
| **Jul 2026** | **JSON-RPC fully deactivated** |

Our `@tehfrontier/sui-client` uses `SuiClient` (JSON-RPC) — works until July 2026. Plan migration to `SuiGrpcClient` after the hackathon.

---

## Rate Limits

**Public Mysten Labs endpoints** (`fullnode.<NETWORK>.sui.io`):
- **100 requests per 30 seconds**
- Not suitable for production / high-traffic apps

**For production / heavy usage:**
- Dedicated RPC providers: Shinami, BlockEden, Ankr, QuickNode
- Run your own full node
- Rotate multiple providers

For the hackathon, the public testnet endpoint is sufficient. Frontier Periscope's polling intervals (5-30s) stay well within limits.

---

## Common Transaction Errors

| Error | Cause | Fix |
|---|---|---|
| `InsufficientGas` | Gas budget too low | Increase budget or let SDK auto-calculate |
| `MoveAbort(module, code)` | Move function aborted | Check abort code against contract error constants |
| `InsufficientCoinBalance` | Not enough coins | Check balance first, use faucet on testnet |
| `ObjectNotFound` | Object doesn't exist | Verify objectId with `getObject()` |
| `ObjectVersionUnavailableForConsumption` | Stale object version | Re-fetch object for current version |
| `SharedObjectOperationNotAllowed` | Tried to transfer/freeze shared object | Shared objects can only be re-shared or deleted |

```typescript
try {
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  if (result.effects?.status.status === 'failure') {
    console.error('On-chain failure:', result.effects.status.error);
  }
} catch (err) {
  console.error('Submission failed:', err.message);
}
```

---

## Quick Start: End-to-End Example

```typescript
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';

// 1. Setup
const client = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = new Ed25519Keypair();
const myAddress = keypair.toSuiAddress();
console.log('Address:', myAddress);

// 2. Fund account
await requestSuiFromFaucetV2({
  host: getFaucetHost('testnet'),
  recipient: myAddress,
});

// 3. Check balance
const balance = await client.getBalance({ owner: myAddress });
console.log('Balance (MIST):', balance.totalBalance);

// 4. Transfer SUI
const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(500_000_000)]); // 0.5 SUI
tx.transferObjects([coin], tx.pure.address('0xRecipientAddress'));

const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showEffects: true, showEvents: true, showBalanceChanges: true },
});

console.log('Digest:', result.digest);
console.log('Status:', result.effects?.status.status);

// 5. Wait for indexer, then verify
await client.waitForTransaction({ digest: result.digest });
const newBalance = await client.getBalance({ owner: myAddress });
console.log('New balance:', newBalance.totalBalance);

// 6. Read an EVE Frontier assembly (once we have the package ID)
// const assembly = await client.getObject({
//   id: '0xAssemblyObjectId',
//   options: { showContent: true, showType: true },
// });
// console.log(assembly.data?.content);

// 7. Query EVE Frontier events
// const events = await client.queryEvents({
//   query: { MoveEventType: `${WORLD_PKG}::fuel::FuelEvent` },
//   limit: 10,
//   order: 'descending',
// });
// for (const e of events.data) console.log(e.parsedJson);
```
