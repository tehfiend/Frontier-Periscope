# Sponsored Transactions (EVE Vault relayer)

How the official EVE Frontier dApp powers structures on/off, links smart gates, and updates
metadata -- and how Periscope reuses the same path. Derived from the production dApp bundle at
`https://dapps.evefrontier.com/` (`assets/index-*.js`).

## The key finding

The official dApp does **not** build these transactions client-side. There are no
`network_node::offline` / `destroy_offline_assemblies` moveCalls anywhere in its bundle. Instead it
hands a small high-level payload to a **custom wallet-standard feature** exposed by the EVE Vault
wallet, and the wallet + CCP's relayer compose, gas-sponsor, and sign the full PTB server-side.

```js
// dApp bundle (de-minified)
bringOffline = ({ assembly }) => sendSponsoredTransaction({ txAction: "offline", assembly })

// sendSponsoredTransaction resolves to a wallet feature:
getWalletFeature(wallet, "evefrontier:sponsoredTransaction").signSponsoredTransaction({
  txAction: "offline",              // or "online" | "update-metadata" | "link-smart-gate" | "unlink-smart-gate"
  assembly:  <item_id, integer>,    // the in-game item_id, NOT the Sui object id
  assemblyType: "network-nodes",    // storage-units | turrets | gates | network-nodes | assemblies
  tenant: "stillness",
})
```

## Why this matters

Powering a node off requires disconnecting its connected structures first. The on-chain drain
functions (`network_node::remove_assembly_id`, `disconnect_assembly`) are **Friend-visibility** --
callable only from inside the world package, never from a user-signed PTB. A hand-built Periscope
PTB therefore hit `NonEntryFunctionInvoked` / `EAssembliesConnected` and could not replicate the
in-game "one click powers everything off" behavior.

The relayer runs with the authority to make those internal calls (and pays the gas), which is why
the in-game / dApp flow "just turns them off" gaslessly. Reusing the wallet feature is the only way
to match it -- so Periscope's power toggle (`views/Deployables.tsx`, `handlePowerToggle`) calls
`signSponsoredTransaction` instead of building a PTB.

## Payload reference

| Field | Value |
|-------|-------|
| `txAction` | `online` \| `offline` \| `update-metadata` \| `link-smart-gate` \| `unlink-smart-gate` |
| `assembly` | in-game `item_id` parsed to a non-negative integer (Periscope: `Number.parseInt(row.itemId)`) |
| `assemblyType` | API string per type -- see map below |
| `tenant` | lowercase tenant name, e.g. `stillness` |

Assembly-type API strings (`Assemblies` enum -> `ASSEMBLY_TYPE_API_STRING` in the bundle):

| Assembly kind | API string |
|---------------|-----------|
| SmartStorageUnit | `storage-units` |
| SmartTurret | `turrets` |
| SmartGate | `gates` |
| NetworkNode | `network-nodes` |
| Assembly (generic) | `assemblies` |

## Accessing the feature in Periscope

The feature is a non-standard wallet-standard feature, so dapp-kit's typed hooks don't expose it.
Resolve it from the connected UiWallet handle with `getWalletFeature` from
`@wallet-standard/ui-features` (the same helper the dApp uses):

```ts
import { getWalletFeature } from "@wallet-standard/ui-features";

const eveVault = wallets.find((w) => w.name === "Eve Vault");
if (eveVault?.features.includes("evefrontier:sponsoredTransaction")) {
  const feature = getWalletFeature(eveVault, "evefrontier:sponsoredTransaction");
  await feature.signSponsoredTransaction({ txAction, assembly, assemblyType, tenant });
}
```

Notes:
- The feature exists **only** on EVE Vault, not on a generic Sui wallet.
- It uses the wallet's currently connected account; no account/chain arg is passed.
- The relayer resolves the on-chain object from `assembly` (item_id) + `tenant`.

## Other useful strings from the bundle

- World package (stillness): `0x8b8a46ed766fa1358ce7c5c51f6a164b13d627a63e45343f69ed0ba0446c1aa1`
- EVE coin (stillness): `0xac361aa5ceb726bd974f885c9dea9e55dc9bc98fa1f5731c5965a810707bf0b8::EVE::EVE`
- DataHub host (stillness): `world-api-stillness.live.pub.evefrontier.com` (`/v2/types/{id}` for type metadata)
