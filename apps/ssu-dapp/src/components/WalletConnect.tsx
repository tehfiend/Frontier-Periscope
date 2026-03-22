import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";

const EVE_VAULT_NAME = "Eve Vault";

/**
 * EVE Vault connect button. No modal, direct connect via useDAppKit().
 * Shows abbreviated address when connected.
 */
export function WalletConnect() {
	const account = useCurrentAccount();
	const wallets = useWallets();
	const dAppKit = useDAppKit();
	const [connecting, setConnecting] = useState(false);

	async function handleConnect() {
		const eveVault =
			wallets.find((w) => w.name === EVE_VAULT_NAME) ??
			wallets.find((w) => w.name.toLowerCase().includes("eve"));
		if (!eveVault) return;

		setConnecting(true);
		try {
			await dAppKit.connectWallet({ wallet: eveVault });
		} finally {
			setConnecting(false);
		}
	}

	async function handleDisconnect() {
		try {
			await dAppKit.disconnectWallet();
		} catch {
			// Ignore disconnect errors
		}
		// Clear dapp-kit cached wallet state to prevent auto-reconnect
		for (const key of Object.keys(localStorage)) {
			if (key.includes("dapp-kit") || key.includes("wallet") || key.includes("slush")) {
				localStorage.removeItem(key);
			}
		}
		for (const key of Object.keys(sessionStorage)) {
			if (key.includes("dapp-kit") || key.includes("wallet") || key.includes("slush")) {
				sessionStorage.removeItem(key);
			}
		}
		window.location.reload();
	}

	if (account) {
		return (
			<div className="flex items-center gap-2">
				<span className="h-2 w-2 rounded-full bg-emerald-500" />
				<CopyAddress
					address={account.address}
					sliceStart={6}
					sliceEnd={4}
					className="text-xs text-zinc-400"
				/>
				<button
					type="button"
					onClick={handleDisconnect}
					className="rounded px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
				>
					Disconnect
				</button>
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={handleConnect}
			disabled={connecting}
			className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
		>
			{connecting ? "Connecting..." : "Connect Wallet"}
		</button>
	);
}
