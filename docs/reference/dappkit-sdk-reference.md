# EVE Frontier DappKit SDK Reference

**Source:** https://sui-docs.evefrontier.com (TypeDoc-generated API reference)
**Package:** `@evefrontier/dapp-kit` v0.1.5
**Install:** `pnpm add @evefrontier/dapp-kit`
**Peer deps:** `@tanstack/react-query`, `react`
**License:** MIT
**Last reviewed:** 2026-03-16

## Subpath Imports

| Import Path | Content |
|---|---|
| `@evefrontier/dapp-kit` | Providers, hooks, types, utilities (default) |
| `@evefrontier/dapp-kit/graphql` | GraphQL client and queries |
| `@evefrontier/dapp-kit/types` | Type definitions only |
| `@evefrontier/dapp-kit/utils` | Utilities |
| `@evefrontier/dapp-kit/hooks` | Hooks only |
| `@evefrontier/dapp-kit/providers` | Providers only |
| `@evefrontier/dapp-kit/config` | DApp kit setup |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_EVE_WORLD_PACKAGE_ID` | Yes | World contracts package ID |
| `VITE_OBJECT_ID` | No | Fallback assembly Sui object ID (when no URL params) |

URL query params: `?itemId=<game_item_id>&tenant=<stillness|utopia|...>`

---

## Providers

### EveFrontierProvider

Wraps app with all necessary providers in order:
1. `QueryClientProvider` — React Query
2. `DAppKitProvider` — Sui blockchain client
3. `VaultProvider` — EVE Vault wallet
4. `SmartObjectProvider` — GraphQL-based assembly data with polling
5. `NotificationProvider` — Transaction/message notifications

```tsx
<EveFrontierProvider queryClient={queryClient}>
  <App />
</EveFrontierProvider>
```

**Source:** `providers/EveFrontierProvider.tsx:21`

---

## Hooks

### useConnection

```ts
useConnection(): VaultContextType
```

Returns:
- `currentAccount: WalletAccount | null`
- `walletAddress: string | undefined`
- `isConnected: boolean`
- `hasEveVault: boolean` — whether EVE Vault wallet is detected
- `handleConnect(): void`
- `handleDisconnect(): void`

**Source:** `hooks/useConnection.ts:53`

### useSmartObject

```ts
useSmartObject(): SmartObjectContextType
```

Returns reactive assembly data from Sui GraphQL Indexer with auto-polling (10s). Assembly ID resolved from URL `?itemId=&tenant=` or `VITE_OBJECT_ID` env var.

Returns:
- `tenant: string`
- `assembly: AssemblyType<Assemblies> | null`
- `assemblyOwner: DetailedSmartCharacterResponse | null`
- `loading: boolean`
- `error: string | null`
- `refetch(): Promise<void>`

**Source:** `hooks/useSmartObject.ts:58`

### useNotification

```ts
useNotification(): NotificationContextType
```

Returns:
- `notify({ type: Severity, message?: string, txHash?: string }): void`
- `notification: NotificationState` — `{ isOpen, message, severity, txHash, handleClose }`
- `handleClose(): void`

**Source:** `hooks/useNotification.ts:74`

### useSponsoredTransaction

```ts
useSponsoredTransaction(options?: UseSponsoredTransactionMutationOptions):
  UseMutationResult<SponsoredTransactionOutput, UseSponsoredTransactionError, SponsoredTransactionArgs>
```

Gas-sponsored transactions via EVE Frontier backend. Wallet must support `evefrontier:sponsoredTransaction` feature (currently only EVE Vault).

**Input (SponsoredTransactionArgs):**
- `txAction: SponsoredTransactionActions` — e.g., `BRING_ONLINE`, `BRING_OFFLINE`
- `assembly: AssemblyType<Assemblies>` — full assembly object (id and assemblyType derived)
- `chain: string` — e.g., `"sui:testnet"`
- `tenant?: string` — defaults from URL or `"stillness"`
- `account?: string` — defaults to connected wallet
- `metadata?: { name?, description?, url? }`

**Output (SponsoredTransactionOutput):**
- `digest: string`
- `effects?: string` (BCS encoded)
- `rawEffects?: number[]`

**Returns:** React Query mutation: `mutate()`, `mutateAsync()`, `isPending`, `isError`, `error`, `data`

**Throws:** `WalletNotConnectedError`, `WalletNoAccountSelectedError`, `WalletSponsoredTransactionNotSupportedError`

```tsx
const { mutateAsync: sendTx, isPending } = useSponsoredTransaction();
await sendTx({
  txAction: SponsoredTransactionActions.BRING_ONLINE,
  assembly,
  chain: "sui:testnet",
});
```

**Source:** `hooks/useSponsoredTransaction.ts:275`

---

## Enums

### Assemblies

```ts
enum Assemblies {
  SmartStorageUnit = "SmartStorageUnit",
  SmartTurret = "SmartTurret",
  SmartGate = "SmartGate",
  NetworkNode = "NetworkNode",
  Manufacturing = "Manufacturing",
  Refinery = "Refinery",
  Assembly = "Assembly",
}
```

### State

```ts
enum State {
  NULL = "NULL",
  UNANCHORED = "UNANCHORED",
  ANCHORED = "anchored",
  ONLINE = "online",
  DESTROYED = "destroyed",
}
```

### SponsoredTransactionActions

```ts
enum SponsoredTransactionActions {
  BRING_ONLINE = "online",
  BRING_OFFLINE = "offline",
  EDIT_UNIT = "edit-unit",           // deprecated → use UPDATE_METADATA
  UPDATE_METADATA = "update-metadata",
  LINK_SMART_GATE = "link-smart-gate",
  UNLINK_SMART_GATE = "unlink-smart-gate",
}
```

### TYPEIDS (Known Type IDs)

```ts
enum TYPEIDS {
  LENS = 77518,
  TRANSACTION_CHIP = 79193,
  COMMON_ORE = 77800,
  METAL_RICH_ORE = 77810,
  SMART_STORAGE_UNIT = 77917,
  PROTOCOL_DEPOT = 85249,
  GATEKEEPER = 83907,
  SALT = 83839,
  NETWORK_NODE = 88092,
  PORTABLE_REFINERY = 87161,
  PORTABLE_PRINTER = 87162,
  PORTABLE_STORAGE = 87566,
  REFUGE = 87160,
}
```

### SupportedWallets

```ts
enum SupportedWallets {
  EVE_VAULT = "Eve Vault",
  EVE_FRONTIER_CLIENT_WALLET = "EVE Frontier Client Wallet",
}
```

### Other Enums

- `ActionTypes` — `UNANCHOR`, `ANCHOR`, `BRING_ONLINE`, `BRING_OFFLINE`, `DESTROY`
- `Severity` — `Error`, `Warning`, `Info`, `Success`
- `QueryParams` — `ITEM_ID = "itemId"`, `TENANT = "tenant"`

---

## Key Interfaces

### AssemblyType<T> (Conditional)

Maps assembly enum to properties + module-specific data:

| Assembly | Extra Module |
|---|---|
| SmartStorageUnit | `{ storage: StorageModule }` |
| SmartTurret | `{ turret: TurretModule }` |
| SmartGate | `{ gate: GateModule }` |
| NetworkNode | `{ networkNode: NetworkNodeModule }` |
| Refinery | `{ refinery: RefineryModule }` |
| Manufacturing | `{ manufacturing: ManufacturingModule }` |
| Assembly | (base only) |

### AssemblyProperties<T> (extends DetailedAssemblyResponse)

- `id: string`, `item_id: number`, `type: Assemblies`, `name: string`, `state: State`
- `energyUsage: number`, `typeId: number`, `description: string`, `dappURL: string`
- Optional: `typeDetails: DatahubGameInfo`, `character`, `solarSystem`, `isParentNodeOnline`, `energySourceId`
- `_raw?: MoveObjectData`, `_options?: TransformOptions`

### StorageModule

```ts
{
  mainInventory: { capacity: string, usedCapacity: string, items: InventoryItem[] },
  ephemeralInventories: EphemeralInventory[]
}
```

### GateModule

```ts
{ destinationId: string | undefined, destinationGate: RawSuiObjectData | null }
```

### NetworkNodeModule

```ts
{
  fuel: FuelResponse,
  energyProduction: number, energyMaxCapacity: number, totalReservedEnergy: number,
  linkedAssemblies: SmartAssemblyResponse[]
}
```

### CharacterInfo

```ts
{ id: string, address: string, name: string, tribeId: number, characterId: number, _raw?: RawCharacterData }
```

### DetailedSmartCharacterResponse

```ts
{ address: string, name: string, id: string, tribeId: number, smartAssemblies: Assemblies[], portrait: string }
```

### RawSuiObjectData

Raw Sui object data from EVE Frontier package:
```ts
{
  id: string, type_id: string, extension: unknown,
  inventory_keys?: string[], linked_gate_id?: string, energy_source_id?: string,
  key?: { item_id: string, tenant: string },
  location?: { location_hash: string, structure_id: string },
  metadata?: { assembly_id: string, description: string, name: string, url: string },
  owner_cap_id?: string,
  status?: { status: { variant: string } },
  fuel?: { max_capacity, burn_rate_in_ms, type_id, unit_volume, quantity, is_burning, ... },
  energy_source?: { max_energy_production, current_energy_production, total_reserved_energy },
  connected_assembly_ids?: string[]
}
```

### RawCharacterData

```ts
{
  id: `0x${string}`,
  key: { item_id: string, tenant: string },
  tribe_id: number,
  character_address: `0x${string}`,
  metadata: { assembly_id: string, name: string, description: string, url: string },
  owner_cap_id: `0x${string}`
}
```

### DatahubGameInfo

```ts
{
  id: number, name: string, description: string,
  mass: number, radius: number, volume: number, portionSize: number,
  groupName: string, groupId: number, categoryName: string, categoryId: number, iconUrl: string
}
```

### InventoryItem

```ts
{ id: string, item_id: string, location: { location_hash: string }, quantity: number, tenant: string, type_id: number, name: string }
```

### EphemeralInventory

```ts
{ ownerId: string, ownerName: string, storageCapacity: bigint, usedCapacity: bigint, ephemeralInventoryItems: InventoryItem[] }
```

---

## GraphQL Client Functions

### Core

```ts
executeGraphQLQuery<T>(query: string, variables: Record<string, unknown>): Promise<GraphQLResponse<T>>
```

### Object Fetching

| Function | Returns | Use Case |
|---|---|---|
| `getObjectByAddress(address)` | BCS contents | Low-level object fetch |
| `getObjectWithJson(address)` | JSON contents | **Most common** — fields as JS objects |
| `getObjectWithDynamicFields(objectId)` | JSON + dynamic fields | Full object with extensions |
| `getAssemblyWithOwner(assemblyId)` | moveObject + assemblyOwner + energySource + destinationGate | **Primary assembly loader** |

### Ownership Traversal

| Function | Returns | Use Case |
|---|---|---|
| `getObjectOwnerAndOwnedObjectsByType(addr, type?)` | BCS | Traverse ownership chains |
| `getObjectOwnerAndOwnedObjectsWithJson(addr, type?)` | JSON | Same, decoded |
| `getOwnedObjectsByType(owner, type?)` | Addresses only | Lightweight owned object lookup |
| `getOwnedObjectsByPackage(owner, packageId)` | Full data + dynamic fields | Package-filtered ownership |

### Character & Config

| Function | Returns | Use Case |
|---|---|---|
| `getWalletCharacters(wallet)` | Most recent character | Wallet → character resolution |
| `getCharacterAndOwnedObjects(wallet)` | Characters + owned objects | Full wallet context |
| `getSingletonObjectByType(type)` | Address | Global/singleton lookup |
| `getObjectsByType(type, options?)` | Paginated objects | Bulk type queries (50/page) |

---

## GraphQL Queries (Named)

| Query | Variables | Description |
|---|---|---|
| `GET_OBJECT_BY_ADDRESS` | `$address: SuiAddress` | Object with BCS contents |
| `GET_OBJECT_WITH_JSON` | `$address: SuiAddress` | Object with JSON + BCS contents |
| `GET_OBJECT_WITH_DYNAMIC_FIELDS` | `$objectId: SuiAddress` | Object + dynamic fields in JSON |
| `GET_OBJECT_OWNER_AND_OWNED_OBJECTS_BY_TYPE` | `$object, $owned_object_type` | Owner chain (BCS) |
| `GET_OBJECT_OWNER_AND_OWNED_OBJECTS_WITH_JSON` | `$object, $owned_object_type` | Owner chain (JSON) |
| `GET_OWNED_OBJECTS_BY_TYPE` | `$owner, $object_type` | Addresses only |
| `GET_OWNED_OBJECTS_BY_PACKAGE` | `$owner, $packageId` | Full data filtered by package |
| `GET_WALLET_CHARACTERS` | `$owner, $characterPlayerProfileType` | Character via PlayerProfile `extract(path: "character_id")` |
| `GET_SINGLETON_OBJECT_BY_TYPE` | `$object_type` | First object of type |
| `GET_SINGLETON_CONFIG_OBJECT_BY_TYPE` | `$object_type, $table_name` | Config with table dynamic fields |
| `GET_OBJECTS_BY_TYPE` | `$object_type, $first, $after` | Paginated (default 50) |

---

## Transform Functions

```ts
transformToAssembly(objectId: string, moveObject: MoveObjectData, options?: TransformOptions): Promise<AssemblyType | null>
transformToCharacter(characterInfo: CharacterInfo): DetailedSmartCharacterResponse
parseCharacterFromJson(json: unknown): CharacterInfo | null
```

---

## Utility Functions

### Config & Type Helpers

```ts
getEveWorldPackageId(): string                    // from VITE_EVE_WORLD_PACKAGE_ID (throws if not set)
getSuiGraphqlEndpoint(env?: string): string        // defaults to testnet
getCharacterOwnerCapType(): string                 // fully qualified Move type string
getCharacterPlayerProfileType(): string
getObjectRegistryType(): string
getEnergyConfigType(): string
getFuelEfficiencyConfigType(): string
getAssemblyType(typeRepr: string): Assemblies      // Move type tag → enum
getAssemblyTypeApiString(type: Assemblies): string // for sponsored tx backend
```

### Object Resolution

```ts
getRegistryAddress(): Promise<string>              // AssemblyRegistry singleton address (cached)
getObjectId(itemId: string, tenant: string): Promise<string>  // game item ID → Sui object ID
```

### Energy & Fuel

```ts
getEnergyConfig(): Promise<Record<number, number>>           // type_id → energy usage (cached)
getFuelEfficiencyConfig(): Promise<Record<number, number>>   // type_id → efficiency (cached)
getEnergyUsageForType(typeId: number): Promise<number>       // 0 if not found
getFuelEfficiencyForType(typeId: number): Promise<number>    // 0 if not found
getAdjustedBurnRate(rawBurnTimeMs: number, efficiencyPercent: number | null | undefined): AdjustedBurnRate
// AdjustedBurnRate = { burnTimePerUnitMs: number, unitsPerHour: number }
```

### Datahub

```ts
getDatahubGameInfo(typeId: number): Promise<DatahubGameInfo>  // display name, icon, physical props
```

### Character Helpers

```ts
parseCharacterFromJson(json: unknown): CharacterInfo | null
getCharacterOwnedObjects(address: string): Promise<Record<string, unknown>[] | undefined>
getCharacterOwnedObjectsJson(data): Record<string, unknown>[] | undefined
```

### Parsing

```ts
parseStatus(statusVariant: string | undefined): State
parseErrorFromMessage(errorMessage: string): { code: number, name: string, patterns: string[] }
assertAssemblyType(assembly, assemblyType): assembly is AssemblyType  // type guard
```

### Display & Formatting

```ts
abbreviateAddress(string?, precision=5, expanded=false): string  // "0x123...cdef"
isOwner(assembly, account?): boolean
getTxUrl(suiChain, txHash): string                               // Suiscan URL
getDappUrl(assembly): string                                     // ensures https://
formatM3(quantity: string | bigint): number                      // 10^18 → m3
formatDuration(seconds: number): string                          // "01d 01h 01m 01s"
```

### Wallet Feature Detection

```ts
walletSupportsSponsoredTransaction(wallet): boolean
hasSponsoredTransactionFeature(features): boolean  // type guard
getSponsoredTransactionFeature(wallet): SponsoredTransactionMethod | undefined
```

---

## Constants

| Name | Value | Description |
|---|---|---|
| `EVEFRONTIER_SPONSORED_TRANSACTION` | `"evefrontier:sponsoredTransaction"` | Wallet feature ID |
| `DEFAULT_GRAPHQL_NETWORK` | `"testnet"` | Default network |
| `DEFAULT_TENANT` | `"stillness"` | Default tenant |
| `SUI_GRAPHQL_NETWORKS` | `["testnet", "devnet", "mainnet"]` | Supported networks |
| `POLLING_INTERVAL` | `10000` | 10 seconds |
| `STORAGE_KEYS.CONNECTED` | `"eve-dapp-connected"` | localStorage key |
| `ONE_M3` | `1000000000000000000` | 10^18 (wei→m3 conversion) |

---

## Error Classes

| Class | Message |
|---|---|
| `WalletSponsoredTransactionNotSupportedError` | "Connected wallet doesn't support EVE Frontier sponsored transactions" |
| `WalletNotConnectedError` | Attempting sponsored TX without connected wallet |
| `WalletNoAccountSelectedError` | No account selected in connected wallet |

---

## Key Architecture Notes

1. **GraphQL-first** — All chain queries use Sui GraphQL (not JSON-RPC). The SDK wraps GraphQL queries with typed helpers.

2. **Assembly resolution flow:**
   - URL `?itemId=&tenant=` → `getObjectId()` derives Sui object ID via ObjectRegistry
   - `getAssemblyWithOwner()` fetches assembly + owner_cap → character
   - `transformToAssembly()` normalizes into `AssemblyType<T>`
   - `SmartObjectProvider` polls every 10s

3. **Sponsored TX flow:**
   - User connects EVE Vault via `useConnection`
   - `useSponsoredTransaction` calls wallet's `signSponsoredTransaction` method
   - EVE Vault sends to EVE Frontier backend (gas sponsorship service)
   - Backend co-signs and submits
   - Returns `{ digest, effects, rawEffects }`

4. **Volume units:** Items use 10^18 "wei-like" units. `ONE_M3 = 10^18`. Use `formatM3()` to convert.

5. **Status field structure:** `status.status.variant` (e.g., `"ONLINE"`) — nested enum in raw data, flattened by `parseStatus()`.
