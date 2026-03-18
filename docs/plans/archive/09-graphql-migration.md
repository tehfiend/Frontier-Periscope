# Plan 09: Migrate from JSON-RPC to Sui GraphQL

**Status:** COMPLETE -- all phases implemented, moving to archive
**Created:** 2026-03-16
**Last reviewed:** 2026-03-17 (Pass 4 -- post-implementation verification)
**Completed:** 2026-03-17

## Completion Summary

All 7 steps have been implemented. Zero `SuiJsonRpcClient` or `@mysten/sui/jsonRpc` imports remain in source code. Every package and app now uses `SuiGraphQLClient` with custom GraphQL queries for operations not in the unified API.

**Step 1 (sui-client):** DONE -- `packages/sui-client/src/client.ts` uses `SuiGraphQLClient` + `GRAPHQL_URLS` map. `events.ts` uses `client.query()` with custom GraphQL.
**Step 2 (graphql-queries):** DONE -- `packages/chain-shared/src/graphql-queries.ts` created with all 7 query helpers: `getObjectJson`, `listDynamicFieldsGql`, `listCoinsGql`, `queryEventsGql`, `getDynamicFieldJson`, `queryTransactionsByAddress`, `queryTransactionsByObject`, `getCoinSupply`.
**Step 3 (chain-shared):** DONE -- All 8 files migrated: governance.ts, ssu-market.ts, treasury.ts, permissions.ts, bounty.ts, lease.ts, gate-toll.ts, token-factory.ts.
**Step 4 (periscope chain):** DONE -- client.ts, queries.ts, inventory.ts, manifest.ts all use GraphQL client + shared helpers.
**Step 5 (periscope hooks/views):** DONE -- useSuiClient.ts casts to `SuiGraphQLClient`, useSponsoredTransaction.ts uses `executeTransaction()`, useRadar.ts uses polling via `queryEventsGql()`, Wallet.tsx uses `listBalances()`/`getCoinMetadata()`, Deployables.tsx imports `SuiGraphQLClient`.
**Step 6 (DAppKit providers):** DONE -- WalletProvider.tsx (periscope), App.tsx (ssu-market-dapp), App.tsx (permissions-dapp) all use `SuiGraphQLClient` in `createClient`.
**Step 7 (gas-station + other apps):** DONE -- sponsor.ts uses `SuiGraphQLClient` + custom GraphQL balance query. ssu-market-dapp hooks all use GraphQL. permissions-dapp fully migrated.

**Additional app (ssu-dapp):** Not in original plan scope (created after plan was written), but also uses `SuiGraphQLClient` throughout.

### Known Issue

`apps/ssu-market-dapp/src/hooks/useInventory.ts` has stale response shape references from an incomplete migration:
- Line 35: `ssuObj.inventory` should be `ssuObj.json?.inventory` (getObjectJson returns `{ objectId, json, type }`)
- Line 52: `page.data` should be `page.entries` (listDynamicFieldsGql returns `{ entries, hasNextPage, cursor }`)
- Line 54: `df.name.type`/`df.name.value` should be `df.nameType`/`String(df.nameJson)` (DynamicFieldEntry shape)
- Line 70: `page.nextCursor` should be `page.cursor`

This bug means SSU inventory display in the ssu-market-dapp is likely broken at runtime. File a follow-up fix.

## Context

Our codebase uses `SuiJsonRpcClient` (from `@mysten/sui/jsonRpc`) for all blockchain reads, with v1-style method names (`getObject`, `getOwnedObjects`, `queryEvents`, etc.).

Sui's JSON-RPC endpoint is **deprecated as of July 2026**. The `@mysten/sui` v2 SDK provides `SuiGraphQLClient` (from `@mysten/sui/graphql`) which implements the same `TransportMethods` interface as `SuiJsonRpcClient`, plus supports custom queries via `gql.tada` for type-safe operations.

GraphQL endpoint: `https://graphql.testnet.sui.io/graphql`

## Goals

1. Replace `SuiJsonRpcClient` with `SuiGraphQLClient` across all packages
2. Migrate from v1 JSON-RPC method names to v2 unified `TransportMethods` API
3. Replace `queryEvents()` and `queryTransactionBlocks()` (JSON-RPC only) with GraphQL queries
4. Replace `getTotalSupply()` and `getCoins()` (JSON-RPC only) with v2 unified equivalents
5. Eliminate the existing raw `fetch()` GraphQL call in `lookupCharacterByItemId`
6. Keep code simple — use `include: { json: true }` for object content (not BCS decoding)

## Architecture

### Client Hierarchy (v2 SDK) — Verified

```
BaseClient (abstract)  — packages/sui-client/src/client.ts
  has abstract core: CoreClient

CoreClient (abstract, extends BaseClient, implements TransportMethods)
  — node_modules/@mysten/sui/src/client/core.ts
  sets core = this

SuiGraphQLClient (extends BaseClient, implements TransportMethods)
  — node_modules/@mysten/sui/src/graphql/client.ts
  has core: GraphQLCoreClient  (extends CoreClient)
  has query() method for custom GraphQL

SuiJsonRpcClient (extends BaseClient, implements TransportMethods)
  — node_modules/@mysten/sui/src/jsonRpc/client.ts
  has core: JsonRpcCoreClient  (extends CoreClient)
  has JSON-RPC-only methods: queryEvents, queryTransactionBlocks,
    getDynamicFieldObject, getCoins, getTotalSupply, etc.
```

### DAppKit Compatibility — CONFIRMED

`@mysten/dapp-kit-core` expects `ClientWithCoreApi`:
```typescript
// node_modules/@mysten/sui/src/client/core.ts
export type ClientWithCoreApi = ClientWithExtensions<{ core: CoreClient }>;
```

`SuiGraphQLClient` satisfies this because it has `core: GraphQLCoreClient` where `GraphQLCoreClient extends CoreClient`. **Verified in source** — `SuiGraphQLClient` can be used directly as the `createClient` return value in `createDAppKit()`.

The `useSuiClient()` shim currently casts `useCurrentClient()` to `SuiJsonRpcClient`. After migration, it should cast to `SuiGraphQLClient`, or we can stop casting entirely and use the unified API via the `ClientWithCoreApi` type.

## Breaking Changes: v1 JSON-RPC Methods -> v2 Unified API

### Method Renames

| v1 (SuiJsonRpcClient) | v2 Unified (TransportMethods) | Notes |
|------------------------|-------------------------------|-------|
| `getObject({ id, options })` | `getObject({ objectId, include })` | Returns `{ object: {...} }`. **v2 has singular getObject!** |
| `multiGetObjects({ ids, options })` | `getObjects({ objectIds, include })` | Returns `{ objects: [...] }` |
| `getOwnedObjects({ owner, filter, options })` | `listOwnedObjects({ owner, type, include, limit, cursor })` | `filter: { StructType }` becomes top-level `type` param |
| `getDynamicFields({ parentId, cursor, limit })` | `listDynamicFields({ parentId, limit, cursor })` | Returns `{ dynamicFields: [...], cursor, hasNextPage }` |
| `getDynamicFieldObject({ parentId, name })` | `getDynamicField({ parentId, name: { type, bcs } })` | Returns BCS value -- see Dynamic Field Strategy |
| `getAllBalances({ owner })` | `listBalances({ owner })` | Returns `{ balances: [...] }` with different field names |
| `getBalance({ owner, coinType })` | `getBalance({ owner, coinType })` | Returns `{ balance: {...} }` — field names differ |
| `getCoinMetadata({ coinType })` | `getCoinMetadata({ coinType })` | Returns `{ coinMetadata: {...} }` |
| `getCoins({ owner, coinType, cursor, limit })` | `listCoins({ owner, coinType, cursor, limit })` | Returns `{ objects: [...], cursor, hasNextPage }` |
| `executeTransactionBlock({ transactionBlock, signature })` | `executeTransaction({ transaction, signatures, include })` | Returns `TransactionResult` union |
| `queryEvents(query, cursor, limit)` | **Not in unified API** — custom GraphQL | See Event Query Strategy |
| `queryTransactionBlocks(filter, opts)` | **Not in unified API** — custom GraphQL | See Step 2 |
| `getTotalSupply({ coinType })` | **Not in unified API** — custom GraphQL `coinMetadata { supply }` | See token-factory notes |

### Response Shape Changes

**Object queries (v2 `getObject` / `getObjects`):**
```typescript
// v1 (current)
const result = await client.getObject({ id, options: { showContent: true } });
const fields = result.data?.content?.fields as Record<string, unknown>;
const type = result.data?.content?.type;
const owner = result.data?.owner;

// v2 unified — getObject (singular)
const { object: obj } = await client.getObject({ objectId: id, include: { json: true } });
// obj.objectId, obj.version, obj.digest, obj.type, obj.owner
const fields = obj.json; // Record<string, unknown> | null

// v2 unified — getObjects (batch)
const { objects } = await client.getObjects({ objectIds: ids, include: { json: true } });
// objects[i] is SuiClientTypes.Object | ObjectError
```

**Owner shape change:**
```typescript
// v1: owner is { AddressOwner: string } | { ObjectOwner: string } | { Shared: {...} }
// v2: owner is { $kind: "AddressOwner", AddressOwner: string } | { $kind: "ObjectOwner", ... } | ...
```

**Owned objects (`listOwnedObjects`):**
```typescript
// v1 (current)
const result = await client.getOwnedObjects({
  owner, filter: { StructType: type }, options: { showContent: true },
  limit: 50, cursor,
});
for (const item of result.data) { /* item.data.objectId, item.data.content.fields */ }
const hasMore = result.hasNextPage;
const nextCursor = result.nextCursor;

// v2 unified
const result = await client.listOwnedObjects({
  owner, type, include: { json: true }, limit: 50, cursor,
});
for (const obj of result.objects) { /* obj.objectId, obj.json */ }
const hasMore = result.hasNextPage;
const nextCursor = result.cursor; // renamed from nextCursor
```

**Dynamic fields (`listDynamicFields`):**
```typescript
// v1 (current)
const page = await client.getDynamicFields({ parentId, cursor, limit: 50 });
// page.data: [{ name, objectType, objectId, ... }]
// page.hasNextPage, page.nextCursor

// v2 unified
const page = await client.listDynamicFields({ parentId, cursor, limit: 50 });
// page.dynamicFields: [{ $kind, fieldId, type, name: { type, bcs }, valueType, childId }]
// page.hasNextPage, page.cursor
```

> **Note:** `listDynamicFields` entries have `name.bcs` (Uint8Array) instead of `name.value` (string).
> To get the JSON value of a dynamic field, use a custom GraphQL query (see Dynamic Field Strategy).

**Balances:**
```typescript
// v1
const balances = await client.getAllBalances({ owner });
// balances: [{ coinType, totalBalance, coinObjectCount }]

// v2 unified
const result = await client.listBalances({ owner });
// result.balances: [{ coinType, balance, coinBalance, addressBalance }]
// "totalBalance" -> "balance", no coinObjectCount
```

**Transaction execution:**
```typescript
// v1
const result = await client.executeTransactionBlock({
  transactionBlock: bytes, signature: [userSig, sponsorSig],
});
// result.digest

// v2 unified
const result = await client.executeTransaction({
  transaction: bytes, signatures: [userSig, sponsorSig],
});
// result.$kind === 'Transaction' ? result.Transaction.digest : throw
```

## Scope: Files to Migrate

### Verified File Inventory

| Package | Files | Call Sites | Complexity |
|---------|-------|------------|------------|
| `packages/sui-client` | 2 | 3 | Low — client factory + event poller |
| `packages/chain-shared` | 8 | ~20 | High — dynamic fields, events, TX queries |
| `apps/gas-station` | 1 | 2 | Low — balance check (no executeTransaction in sponsor.ts) |
| `apps/periscope` | 7 | ~25 | High — chain layer + hooks + views |
| `apps/ssu-market-dapp` | 4 | 6 | Medium — client instantiation + market queries |
| `apps/permissions-dapp` | 2 | 2 | Low — client instantiation only |

### Files with `SuiJsonRpcClient` imports (verified via grep)

**packages/sui-client:**
- `src/client.ts` — `SuiJsonRpcClient`, `getJsonRpcFullnodeUrl`
- `src/events.ts` — `SuiJsonRpcClient`, `SuiEvent`, `queryEvents()`

**packages/chain-shared:**
- `src/governance.ts` — `SuiJsonRpcClient`, `EventId`, `getObject`, `queryTransactionBlocks`, `queryEvents`
- `src/ssu-market.ts` — `SuiJsonRpcClient`, `EventId`, `getObject`, `getDynamicFieldObject`, `getDynamicFields`, `queryEvents`
- `src/treasury.ts` — `SuiJsonRpcClient`, `getObject`
- `src/permissions.ts` — `SuiJsonRpcClient`, `getObject`, `getDynamicFieldObject`
- `src/bounty.ts` — `SuiJsonRpcClient`, `getDynamicFieldObject`
- `src/lease.ts` — `SuiJsonRpcClient`, `getDynamicFieldObject`
- `src/gate-toll.ts` — `SuiJsonRpcClient`, `getDynamicFieldObject`
- `src/token-factory.ts` — `SuiJsonRpcClient`, `getTotalSupply`, `getCoins`

**apps/periscope:**
- `src/chain/client.ts` — uses `createSuiClient()`, `getOwnedObjects`, `getObject`, `multiGetObjects`, `queryEvents`, raw `fetch()` GraphQL
- `src/chain/queries.ts` — `SuiJsonRpcClient`, `getOwnedObjects`, `getObject`
- `src/chain/inventory.ts` — `SuiJsonRpcClient`, `getDynamicFields`, `getObject`
- `src/chain/manifest.ts` — `SuiJsonRpcClient`, `getObject`, `multiGetObjects`, `queryTransactionBlocks`, `getOwnedObjects`, `queryEvents`
- `src/hooks/useSuiClient.ts` — casts to `SuiJsonRpcClient`
- `src/hooks/useSponsoredTransaction.ts` — `executeTransactionBlock`
- `src/hooks/useRadar.ts` — `SuiEvent` import, `(client as any).subscribeEvent`
- `src/views/Deployables.tsx` — imports `SuiJsonRpcClient` type alias
- `src/views/Wallet.tsx` — `getAllBalances`, `getCoinMetadata`
- `src/components/WalletProvider.tsx` — `SuiJsonRpcClient`, `getJsonRpcFullnodeUrl`, `createDAppKit`

**apps/ssu-market-dapp:**
- `src/App.tsx` — `SuiJsonRpcClient`, `getJsonRpcFullnodeUrl`, `createDAppKit`
- `src/hooks/useMarketConfig.ts` — `SuiJsonRpcClient`, `getJsonRpcFullnodeUrl`
- `src/hooks/useMarketListings.ts` — `SuiJsonRpcClient`, `getJsonRpcFullnodeUrl`
- `src/hooks/useInventory.ts` — `SuiJsonRpcClient`, `getJsonRpcFullnodeUrl`, `getObject`, `getDynamicFields`, `getDynamicFieldObject`

**apps/permissions-dapp:**
- `src/App.tsx` — `SuiJsonRpcClient`, `getJsonRpcFullnodeUrl`, `createDAppKit`
- `src/hooks/useSuiClient.ts` — casts to `SuiJsonRpcClient`

**apps/gas-station:**
- `src/sponsor.ts` — `SuiJsonRpcClient`, `getBalance`

### Already Using GraphQL (1 site)
- `apps/periscope/src/chain/client.ts:lookupCharacterByItemId()` — raw `fetch()` to GraphQL endpoint

## Implementation Steps

### Step 1: Update `packages/sui-client` — Client Factory

**Files:** `packages/sui-client/src/client.ts`, `packages/sui-client/src/events.ts`

**client.ts changes:**
1. Replace `SuiJsonRpcClient` import with `SuiGraphQLClient` from `@mysten/sui/graphql`
2. Remove `getJsonRpcFullnodeUrl` import
3. Update `RPC_URLS` map to GraphQL endpoints (no SDK helper exists):
   - testnet: `https://graphql.testnet.sui.io/graphql`
   - mainnet: `https://graphql.mainnet.sui.io/graphql`
   - devnet: `https://graphql.devnet.sui.io/graphql`
   - localnet: `http://localhost:9125/graphql` (default GraphQL port)
4. Update constructor: `new SuiGraphQLClient({ url, network })`
5. Update return type from `SuiJsonRpcClient` to `SuiGraphQLClient`

**events.ts changes:**
1. Replace `SuiJsonRpcClient` and `SuiEvent` imports
2. `queryEvents()` does not exist on `SuiGraphQLClient` — replace with custom GraphQL query via `client.query()`
3. Change cursor type from `EventId` (`{ txDigest, eventSeq }`) to `string | null` (GraphQL endCursor)
4. The `pollEvents` interface already uses `cursor?: string | null` — update internal implementation only

**GraphQL query for events (verified against schema):**
```typescript
const QUERY_EVENTS = `
  query($type: String!, $first: Int, $after: String) {
    events(filter: { type: $type }, first: $first, after: $after) {
      nodes {
        sender { address }
        contents { json type { repr } }
        timestamp
        sequenceNumber
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
```

> **Verified:** The GraphQL `EventFilter` input uses `type: String` (not `eventType` or `MoveEventType`). Per schema: "Events can be filtered by their type's package, package::module, or their fully qualified type name." Timestamps are ISO DateTime strings (not ms).

### Step 2: Create Shared GraphQL Query Helpers

**New file:** `packages/chain-shared/src/graphql-queries.ts`

Custom GraphQL queries for operations not in the unified `TransportMethods`:

```typescript
import { graphql } from "@mysten/sui/graphql/schema";
```

> **Verified:** `graphql` function is exported from `@mysten/sui/graphql/schema` via `initGraphQLTada()` with full introspection types. Queries written with this function get compile-time type checking.

**Required queries:**

1. **QueryEventsDocument** — replaces `queryEvents({ query: { MoveEventType } })`
   - Used by: governance.ts, ssu-market.ts, client.ts, manifest.ts, events.ts
   - Must return: `{ nodes: [{ contents.json, sender.address, timestamp }], pageInfo }`

2. **QueryTransactionsByAddressDocument** — replaces `queryTransactionBlocks({ filter: { FromAddress } })`
   - Used by: governance.ts `discoverOrgByCreator()`
   - GraphQL approach: `address(address: $addr) { transactions(filter: { ... }) { ... } }` or top-level `transactions(filter: { affectedAddress: $addr })`
   - **Schema note:** `TransactionFilter` has `affectedAddress` (sender, sponsor, or recipient), NOT `FromAddress`. For org discovery, use `address.transactions` which scopes to that address.
   - Must return: `{ nodes: [{ digest, effects.objectChanges, ... }], pageInfo }`

3. **QueryTransactionsByObjectDocument** — replaces `queryTransactionBlocks({ filter: { ChangedObject } })`
   - Used by: manifest.ts `fetchAndCacheCharacter()` (creation timestamp lookup)
   - GraphQL: `transactions(filter: { affectedObject: $objectId })` — **Schema note:** `affectedObject` covers created/read/modified/deleted/wrapped/unwrapped
   - Must return: `{ nodes: [{ ... timestamp info ... }], pageInfo }`

4. **GetCoinSupplyDocument** — replaces `getTotalSupply({ coinType })`
   - Used by: token-factory.ts `queryTokenSupply()`
   - GraphQL: `coinMetadata(coinType: $ct) { supply }` — **Schema verified:** `CoinMetadata.supply: BigInt` exists but is NOT included in the SDK's built-in `getCoinMetadata` query
   - Returns: `{ coinMetadata: { supply } }`

5. **GetDynamicFieldJsonDocument** — replaces `getDynamicFieldObject()` with JSON content
   - Used by: ssu-market.ts, bounty.ts, lease.ts, gate-toll.ts, permissions.ts, inventory.ts
   - Must return: `{ object.dynamicField.value.contents.json }`

**Wrapper functions** that provide the same interface as current calls:

```typescript
export async function queryEventsGql(
  client: SuiGraphQLClient,
  eventType: string,
  opts?: { cursor?: string | null; limit?: number; order?: "ascending" | "descending" },
): Promise<{
  data: Array<{ parsedJson: Record<string, unknown>; sender: string; timestampMs: string }>;
  hasNextPage: boolean;
  nextCursor: string | null;
}>

export async function getDynamicFieldJson(
  client: SuiGraphQLClient,
  parentId: string,
  name: { type: string; value: string },
): Promise<{ fields: Record<string, unknown> } | null>

export async function queryTransactionsByAddress(
  client: SuiGraphQLClient,
  address: string,
  opts?: { cursor?: string | null; limit?: number; order?: "ascending" | "descending" },
): Promise<{
  data: Array<{ digest: string; objectChanges: any[]; timestampMs: string }>;
  hasNextPage: boolean;
  nextCursor: string | null;
}>
```

> **BCS encoding for dynamic field names:** The `getDynamicFieldJson` wrapper must BCS-encode the `name.value` using the appropriate encoder for `name.type` (e.g., `bcs.u64().serialize(value)` for `u64`, `bcs.Address.serialize(value)` for `0x2::object::ID`). This is a helper function responsibility.

### Step 3: Migrate `packages/chain-shared` Query Functions

**Files:** All files with query functions that take `SuiJsonRpcClient` as parameter.

**Pattern for each file:**

1. Change parameter type: `client: SuiJsonRpcClient` -> `client: SuiGraphQLClient`
2. Change import: `from "@mysten/sui/jsonRpc"` -> `from "@mysten/sui/graphql"`
3. Replace v1 method calls with v2 unified or GraphQL query wrappers
4. Update response destructuring for v2 shapes

**Specific files:**

| File | v1 Methods Used | Migration Approach |
|------|----------------|-------------------|
| `governance.ts` | `getObject`, `queryTransactionBlocks`, `queryEvents`, `EventId` | `getObject` (v2 unified), `queryTransactionsByAddress` + `queryEventsGql` wrappers |
| `ssu-market.ts` | `getObject`, `getDynamicFieldObject`, `getDynamicFields`, `queryEvents`, `EventId` | `getObject` (v2), `getDynamicFieldJson` wrapper, `listDynamicFields` (v2), `queryEventsGql` wrapper |
| `treasury.ts` | `getObject` | `getObject` (v2 unified) — response shape change only |
| `permissions.ts` | `getObject`, `getDynamicFieldObject` | `getObject` (v2), `getDynamicFieldJson` wrapper |
| `bounty.ts` | `getDynamicFieldObject` | `getDynamicFieldJson` wrapper |
| `lease.ts` | `getDynamicFieldObject` | `getDynamicFieldJson` wrapper |
| `gate-toll.ts` | `getDynamicFieldObject` | `getDynamicFieldJson` wrapper |
| `token-factory.ts` | `getTotalSupply`, `getCoins` | See note below |

**token-factory.ts special case:**
- `getTotalSupply({ coinType })` — **No v2 unified equivalent on SuiGraphQLClient.** Options:
  - (a) The v2 unified `getCoinMetadata()` query does NOT include `supply` — it only returns id, decimals, name, symbol, description, iconUrl
  - (b) Custom GraphQL query: `coinMetadata(coinType: $ct) { supply }` — **Schema verified:** `CoinMetadata.supply: BigInt` field exists
  - (c) Read the TreasuryCap object directly with `getObject()` and extract `total_supply.value` from JSON
  - **Recommendation:** Option (b) — custom GraphQL query `GetCoinSupplyDocument` is simplest and most direct
- `getCoins({ owner, coinType, cursor, limit })` -> `listCoins({ owner, coinType, cursor, limit })`
  - Response change: `page.data[i].coinObjectId` -> `page.objects[i].objectId`, `page.data[i].balance` -> `page.objects[i].balance` (v2 `Coin` type has balance directly)
  - Pagination: `page.nextCursor` -> `page.cursor`, `page.hasNextPage` stays same

### Step 4: Migrate `apps/periscope` — Chain Layer

**Files:** `src/chain/client.ts`, `src/chain/queries.ts`, `src/chain/inventory.ts`, `src/chain/manifest.ts`

**client.ts changes:**
- `getOwnedObjectsByType()` — `getOwnedObjects()` -> `listOwnedObjects()`, response: `page.data[i].data` -> `page.objects[i]`
- `getObjectDetails()` — `getObject({ id, options })` -> `getObject({ objectId, include })`, response: wraps in `{ object }` not `{ data }`
- `multiGetObjects()` — `multiGetObjects({ ids, options })` -> `getObjects({ objectIds, include })`, response: returns `{ objects }` not array
- `queryEvents()` wrapper — replace with `queryEventsGql()` from chain-shared
- `getRecentKillmails()` — uses `queryEvents`, same migration
- `lookupCharacterByItemId()` — replace raw `fetch()` with `SuiGraphQLClient.query()`. The client is available from `getSuiClient()` which now returns `SuiGraphQLClient`.
- **SuiObjectData / SuiObjectResponse types** — These local type defs mirror the v1 shape. Update to match v2 shape or remove in favor of SDK types.

**queries.ts changes:**
- `getOwnedObjectsByType()` — same pattern as client.ts
- `discoverCharacterAndAssemblies()` — multiple `getObject` + `getOwnedObjects` -> v2 unified
  - `getObject({ id, options: { showContent: true } })` -> `getObject({ objectId, include: { json: true } })`
  - Response: `obj.data?.content?.fields` -> `obj.object?.json`
  - `page.data[i].data?.objectId` -> `page.objects[i].objectId`
  - `page.data[i].data?.type` -> `page.objects[i].type`
  - `page.data[i].data?.content` -> `page.objects[i].json`
  - `page.hasNextPage` stays same, `page.nextCursor` -> `page.cursor`
- `getAssemblyExtension()` — same getObject migration

**inventory.ts changes:**
- `getDynamicFields({ parentId })` -> `listDynamicFields({ parentId })`
  - Response: `dfs.data` -> `dfs.dynamicFields`, `df.objectType` may not exist (use `df.valueType` or `df.type`)
  - `df.objectId` -> `df.fieldId` or `df.childId`
- `getObject({ id, options })` -> `getObject({ objectId, include: { json: true } })`
  - Response: `obj.data?.content` -> `obj.object?.json`

**manifest.ts changes:**
- `getObject()` calls -> v2 unified `getObject()`
- `multiGetObjects({ ids })` -> `getObjects({ objectIds })`
  - Response: `objects[j].data?.content` -> `objects[j]` (already Object type), `.json` for fields
- `queryTransactionBlocks({ filter: { ChangedObject } })` -> `queryTransactionsByObject()` wrapper
- `getOwnedObjects()` -> `listOwnedObjects()`
- `queryEvents()` -> `queryEventsGql()`
- **Cursor format change:** `event.id` (EventId) is replaced by GraphQL string cursor. The current code stores cursors as `{ txDigest, eventSeq }` in IndexedDB settings. Must update the stored cursor format.

### Step 5: Migrate `apps/periscope` — Hooks & Views

**Hook changes (3 files need changes):**
- `useSuiClient.ts` — change cast from `SuiJsonRpcClient` to `SuiGraphQLClient`, update import
- `useSponsoredTransaction.ts` — `executeTransactionBlock({ transactionBlock, signature })` -> `executeTransaction({ transaction, signatures })`
  - Response: `result.digest` -> `result.Transaction.digest` (check `result.$kind === "Transaction"`)
- `useRadar.ts` — `subscribeEvent` is already broken (cast to `any`). Replace with polling via `queryEventsGql()`. Remove `SuiEvent` import from `@mysten/sui/jsonRpc`.

**View changes (2 files need changes):**
- `Wallet.tsx` — `getAllBalances({ owner })` -> `listBalances({ owner })`, response: `balances[i].totalBalance` -> `result.balances[i].balance`; `getCoinMetadata({ coinType })` -> same method name but response wraps in `{ coinMetadata }`: `meta?.decimals` -> `result.coinMetadata?.decimals`
- `Deployables.tsx` — remove type-only import of `SuiJsonRpcClient`, use `SuiGraphQLClient` or remove cast entirely

**Files NOT needing changes (verified):**
- `GovernanceDashboard.tsx`, `GovernanceTrade.tsx`, `GovernanceFinance.tsx`, `GovernanceTurrets.tsx`, `GovernanceClaims.tsx` — these use `useSuiClient()` + chain-shared functions. They don't directly call JSON-RPC methods. Once useSuiClient returns GraphQLClient and chain-shared accepts it, these work.
- `Assets.tsx` — no direct chain calls

### Step 6: Migrate DAppKit Provider Config

**Files:**
- `apps/periscope/src/components/WalletProvider.tsx`
- `apps/ssu-market-dapp/src/App.tsx`
- `apps/permissions-dapp/src/App.tsx`

**Change `createClient` callback:**
```typescript
// Before
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
createClient: (network) => new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl(network as "testnet"),
  network: network as "testnet",
}),

// After
import { SuiGraphQLClient } from "@mysten/sui/graphql";
createClient: (network) => new SuiGraphQLClient({
  url: `https://graphql.${network}.sui.io/graphql`,
  network: network as "testnet",
}),
```

**Risk:** LOW. `SuiGraphQLClient` extends `BaseClient` and has `core: GraphQLCoreClient` (which extends `CoreClient`), satisfying `ClientWithCoreApi`. Verified in SDK source.

### Step 7: Migrate `apps/gas-station` & Remaining Apps

**gas-station/src/sponsor.ts:**
- `SuiJsonRpcClient` -> `SuiGraphQLClient` (import + instantiation)
- `getBalance({ owner })` — same method name on v2 unified, but response changes: `balance.totalBalance` -> `result.balance.balance`
- **Note:** `sponsor.ts` does NOT call `executeTransactionBlock` — it only signs. The caller (periscope) executes.

**ssu-market-dapp (4 files):**
- `src/App.tsx` — DAppKit provider change (Step 6)
- `src/hooks/useMarketConfig.ts` — replace `SuiJsonRpcClient` instantiation with `SuiGraphQLClient`; `queryMarketConfig()` takes the client (chain-shared handles the rest after Step 3)
- `src/hooks/useMarketListings.ts` — same client swap; `queryAllListings()` handled by Step 3
- `src/hooks/useInventory.ts` — replace `SuiJsonRpcClient` + direct `getObject`, `getDynamicFields`, `getDynamicFieldObject` calls with v2 unified equivalents

**permissions-dapp (2 files):**
- `src/App.tsx` — DAppKit provider change (Step 6)
- `src/hooks/useSuiClient.ts` — change cast to `SuiGraphQLClient`

## Dynamic Field Strategy

The v2 unified `getDynamicField()` returns BCS-encoded values, not parsed JSON. Our code universally expects parsed JSON fields.

**Recommended approach: Custom GraphQL query wrapper (`getDynamicFieldJson`).**

```graphql
query GetDynamicFieldJson($parentId: SuiAddress!, $nameType: String!, $nameBcs: Base64!) {
  object(address: $parentId) {
    dynamicField(name: { type: $nameType, bcs: $nameBcs }) {
      value {
        ... on MoveObject {
          contents { json type { repr } }
        }
        ... on MoveValue {
          json type { repr }
        }
      }
    }
  }
}
```

**BCS encoding the name:**
- `u64` names: `bcs.u64().serialize(value).toBytes()` then `toBase64()`
- `0x2::object::ID` names: `bcs.Address.serialize(value).toBytes()` then `toBase64()`

**Files using `getDynamicFieldObject`:** ssu-market.ts (3 call sites), bounty.ts (1), lease.ts (1), gate-toll.ts (1), permissions.ts (1), ssu-market-dapp/useInventory.ts (1) = **8 call sites across 6 files**

## Event Query Strategy

`queryEvents()` does not exist in the v2 unified API. Use custom GraphQL via `client.query()`.

**Key differences from JSON-RPC (verified against GraphQL schema):**
- Cursor: GraphQL uses string-based `endCursor` (not `{ txDigest, eventSeq }`)
- Event fields: `parsedJson` becomes `contents.json`, `timestampMs` becomes `timestamp` (ISO DateTime string, not ms number)
- Sender: `event.sender` (string) becomes `event.sender.address`
- Type: `event.type` (string) becomes `event.contents.type.repr`
- Event filter: uses `filter: { type: $eventType }` (not `query: { MoveEventType }`)
- No `order` parameter in GraphQL events query (always ascending by checkpoint). For descending queries, use `last` + `before` instead of `first` + `after`
- Timestamp conversion: code currently uses `Number(event.timestampMs)` — must parse ISO DateTime instead: `new Date(event.timestamp).getTime()`

**Files using `queryEvents`:**
- `packages/sui-client/src/events.ts` — pollEvents() (1 call)
- `packages/chain-shared/src/governance.ts` — queryClaimEvents() (2 calls)
- `packages/chain-shared/src/ssu-market.ts` — discoverOrgMarket() (1 call)
- `apps/periscope/src/chain/client.ts` — queryEvents() wrapper (1 call)
- `apps/periscope/src/chain/manifest.ts` — discoverCharactersFromEvents() (1 call)

**Total: 6 call sites across 5 files**

**Stored cursor migration:** `manifest.ts` saves event cursors in IndexedDB as `{ txDigest, eventSeq }`. After migration, cursors will be strings. Add a migration check: if stored cursor is an object, discard it and re-sync from scratch.

## Risk Items

| Risk | Severity | Mitigation |
|------|----------|------------|
| ~~`SuiGraphQLClient` not compatible with DAppKit~~ | **RESOLVED** | Verified: `SuiGraphQLClient` has `core: GraphQLCoreClient extends CoreClient`, satisfies `ClientWithCoreApi` |
| `getTotalSupply` has no v2 unified equivalent | Medium | Custom GraphQL query `coinMetadata(coinType) { supply }` — schema verified, `supply: BigInt` field exists |
| GraphQL endpoint rate limits differ from JSON-RPC | Medium | Monitor in dev. Consider request batching. GraphQL supports multiple queries in one request |
| Dynamic field BCS encoding for name param | Medium | Create `bcsEncodeName(type, value)` helper. Types needed: `u64`, `0x2::object::ID` |
| Event cursor format change breaks stored cursors | Medium | Detect old `{ txDigest }` format, discard and re-sync |
| GraphQL event query lacks `order` param (ascending only) | Medium | For descending queries (manifest.ts incremental sync), may need to reverse results client-side or restructure sync logic |
| `include: { json: true }` JSON key names differ from `content.fields` | Medium | JSON uses snake_case field names directly (no wrapping). Test each struct type |
| `subscribeEvent` removal in useRadar.ts | Low | Already broken (cast to `any`). Replace with polling. Consider polling interval for UX |
| GraphQL endpoint availability / latency | Low | Can revert to JSON-RPC (still available until Jul 2026) |
| `gql.tada` type generation requires build step | Low | Start with string queries + manual types, add tada incrementally |

## Verification

1. `pnpm build` passes for all affected packages
2. `pnpm dev` — periscope loads, all views render data correctly
3. Wallet connects via EVE Vault (DAppKit + GraphQL client)
4. Governance: org discovery, tier management, claims all work
5. Trade: listings load, trades execute
6. Wallet view: balances display correctly with new field names
7. Event polling: killmail/radar events still detected (cursor format)
8. Gas station: turret build + sponsored TX works
9. SSU Market dapp: listings load, inventory displays
10. Permissions dapp: ACL editor loads, permissions configurable
11. Token factory: supply query works via TreasuryCap read
12. Dynamic fields: market listings, bounties, leases, tolls, ACLs all parse correctly

## Execution Order

1. **Step 1** (sui-client) — Foundation, must be first
2. **Step 2** (GraphQL query helpers) — Shared utilities needed by Steps 3-7
3. **Step 3** (chain-shared) — Library layer, blocks app migration
4. **Step 4** (periscope chain layer) — Largest change set
5. **Step 5** (periscope hooks/views) — Depends on Step 4
6. **Step 6** (DAppKit providers) — Can be done in parallel with Steps 4-5
7. **Step 7** (gas-station + other apps) — Independent, lowest risk

Steps 1-3 are the core migration (packages). Steps 4-7 are app-level changes.

**Worktree allocation:**
- Worktree A: Steps 1-3 (packages — `packages/sui-client`, `packages/chain-shared`)
- Worktree B: Steps 4-5 (periscope — `apps/periscope`)
- Worktree C: Steps 6-7 (other apps — `apps/gas-station`, `apps/ssu-market-dapp`, `apps/permissions-dapp`, plus DAppKit config in all 3 apps)

Steps 4-7 depend on Steps 1-3 completing first.

## Rollback

If GraphQL proves problematic:
- Revert `createSuiClient()` to use `SuiJsonRpcClient`
- Revert DAppKit `createClient` callbacks
- Revert all `SuiGraphQLClient` parameter types back to `SuiJsonRpcClient`
- JSON-RPC remains available until July 2026
- The v2 unified method names (`getObject`, `listOwnedObjects`, etc.) work on BOTH client types — only the non-unified methods (`queryEvents`, `getDynamicFieldObject`, `getTotalSupply`) differ

## Open Questions

None — all questions resolved during verification:
- DAppKit compatibility: CONFIRMED (SuiGraphQLClient satisfies ClientWithCoreApi)
- `getObject` (singular) exists in v2: CONFIRMED (CoreClient delegates to `getObjects`)
- `getTotalSupply` workaround: Custom GraphQL query `coinMetadata { supply }` — schema verified
- GraphQL event filter field name: CONFIRMED — `EventFilter.type: String` (not `eventType`)
- GraphQL transaction filter: CONFIRMED — `TransactionFilter.affectedAddress` / `affectedObject` (not `FromAddress` / `ChangedObject`)
- GraphQL timestamp format: CONFIRMED — ISO DateTime string (not milliseconds number)
