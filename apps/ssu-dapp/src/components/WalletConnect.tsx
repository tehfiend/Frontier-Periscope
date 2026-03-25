import { getItemId } from "@/lib/constants";
import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { useEffect, useRef, useState } from "react";
import { CopyAddress } from "./CopyAddress";

const EVE_VAULT_NAME = "Eve Vault";

/** True when opened from the in-game browser (itemId param present in URL). */
const isInGame = !!getItemId();

function findEveVault(wallets: ReturnType<typeof useWallets>) {
	return (
		wallets.find((w) => w.name === EVE_VAULT_NAME) ??
		wallets.find((w) => w.name.toLowerCase().includes("eve"))
	);
}

/**
 * EVE Vault connect button. No modal, direct connect via useDAppKit().
 * Auto-connects when running in the in-game browser.
 * Shows abbreviated address when connected.
 */
export function WalletConnect() {
	const account = useCurrentAccount();
	const wallets = useWallets();
	const dAppKit = useDAppKit();
	const [connecting, setConnecting] = useState(false);
	const autoConnectAttempted = useRef(false);

	// Auto-connect when running in-game and wallet is available
	useEffect(() => {
		if (!isInGame || account || autoConnectAttempted.current) return;
		const eveVault = findEveVault(wallets);
		if (!eveVault) return;
		autoConnectAttempted.current = true;
		dAppKit.connectWallet({ wallet: eveVault }).catch(() => {});
	}, [wallets, account, dAppKit]);

	async function handleConnect() {
		const eveVault = findEveVault(wallets);
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
			if (key.startsWith("dapp-kit") || key.startsWith("slush") || key.startsWith("@mysten")) {
				localStorage.removeItem(key);
			}
		}
		for (const key of Object.keys(sessionStorage)) {
			if (key.startsWith("dapp-kit") || key.startsWith("slush") || key.startsWith("@mysten")) {
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
