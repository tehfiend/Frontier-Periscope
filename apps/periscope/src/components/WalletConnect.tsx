import { useCurrentAccount, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { LogOut, Wallet } from "lucide-react";
import { CopyAddress } from "./CopyAddress";

/**
 * Wallet connection button mimicking the default EVE Frontier dApp pattern.
 * - Disconnected: shows a "Connect Wallet" button
 * - Connected: shows green dot + truncated address; click to disconnect
 */
export function WalletConnect() {
	const account = useCurrentAccount();
	const wallets = useWallets();
	const { connectWallet, disconnectWallet } = useDAppKit();

	function handleConnect() {
		const eveVault = wallets.find((w) => w.name === "Eve Vault" || w.name.includes("Eve Frontier"));
		const wallet = eveVault || wallets[0];
		if (wallet) {
			connectWallet({ wallet });
		}
	}

	if (!account) {
		return (
			<button
				type="button"
				onClick={handleConnect}
				className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-cyan-600 hover:bg-cyan-900/20 hover:text-cyan-400"
			>
				<Wallet size={14} className="shrink-0" />
				<span>Connect Wallet</span>
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={() => disconnectWallet()}
			className="group flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900"
			title="Click to disconnect"
		>
			<span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
			<CopyAddress
				address={account.address}
				sliceStart={6}
				sliceEnd={4}
				className="flex-1 truncate text-xs text-zinc-400"
			/>
			<LogOut
				size={12}
				className="shrink-0 text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100"
			/>
		</button>
	);
}

/**
 * Inline connect button for use inside page content (e.g. next to transaction buttons).
 * Compact variant — no border, just text + icon.
 */
export function ConnectWalletButton({ className = "" }: { className?: string }) {
	const account = useCurrentAccount();
	const wallets = useWallets();
	const { connectWallet } = useDAppKit();

	if (account) return null;

	function handleConnect() {
		const eveVault = wallets.find((w) => w.name === "Eve Vault" || w.name.includes("Eve Frontier"));
		const wallet = eveVault || wallets[0];
		if (wallet) {
			connectWallet({ wallet });
		}
	}

	return (
		<button
			type="button"
			onClick={handleConnect}
			className={`flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 ${className}`}
		>
			<Wallet size={12} />
			Connect Wallet
		</button>
	);
}
