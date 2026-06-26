# Wallet Auto-Connect Pattern

Every wallet-dependent action in Periscope follows the **inline auto-connect pattern**: clicking an action button triggers wallet connection on the fly (preferring Eve Vault), then immediately executes the transaction. The user never sees a separate connect button or disabled state.

## The Pattern

```typescript
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";

const account = useCurrentAccount();
const { signAndExecuteTransaction: signAndExecute, connectWallet } = useDAppKit();
const wallets = useWallets();

async function handleAction() {
  // 1. Resolve sender -- auto-connect if needed
  let senderAddress = account?.address;
  if (!senderAddress) {
    const eveVault = wallets.find(
      (w) => w.name === "Eve Vault" || w.name.includes("Eve Frontier"),
    );
    const wallet = eveVault || wallets[0];
    if (!wallet) return;
    const result = await connectWallet({ wallet });
    senderAddress = result.accounts[0]?.address;
    if (!senderAddress) return;
  }

  // 2. Build transaction using senderAddress
  const tx = buildMyTransaction({ senderAddress, ... });

  // 3. Sign and execute
  const txResult = await signAndExecute({ transaction: tx });
}
```

## Rules

1. **Always show the action button** -- never replace it with a `ConnectWalletButton`
2. **Never gate UI on wallet state** -- no `{account ? <button> : <ConnectWalletButton />}` ternaries
3. **Never disable on wallet state** -- no `disabled={!account}` on action buttons
4. **Never hide forms** -- no `if (!account) return <fallback>` gates
5. **One click = connect + execute** -- wallet connects transparently as part of the action
6. **Prefer Eve Vault** -- look for "Eve Vault" or "Eve Frontier" first, fall back to `wallets[0]`

## Hooks That Accept senderAddress

When a hook (like `useExtensionRevoke`) builds and signs transactions internally, it should accept an optional `senderAddress` parameter so the caller can pass the address obtained from auto-connect:

```typescript
async function revoke(params: {
  // ... other params
  senderAddress?: string;
}) {
  const sender = params.senderAddress ?? account?.address;
  if (!sender) throw new Error("Wallet not connected");
  // ...
}
```

This avoids a race condition where `connectWallet` has completed but the hook's own `useCurrentAccount()` hasn't re-rendered yet.

## Anti-Patterns

```typescript
// BAD: Replaces action with connect button
{account ? <button onClick={handleMint}>Mint</button> : <ConnectWalletButton />}

// BAD: Silently fails when disconnected
async function handleMint() {
  if (!account) return;
  // ...
}

// BAD: Disables button when disconnected
<button disabled={!account} onClick={handleMint}>Mint</button>

// BAD: Hides entire form
if (!account) return <div>Connect wallet first</div>;
```

## Imports

```typescript
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
```

- `useCurrentAccount()` -- current connected account (may be null)
- `useDAppKit()` -- destructure `signAndExecuteTransaction`, `connectWallet`
- `useWallets()` -- list of available wallet adapters for auto-connect
