import {
	type UiWallet,
	type UiWalletAccount,
	useCurrentAccount,
	useDAppKit,
	useWallets,
} from "@mysten/dapp-kit-react";
import { ExternalLink, LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { CopyAddress } from "./CopyAddress";

const EVE_VAULT_URL = "https://github.com/evefrontier/evevault/releases";

export function findEveVault(wallets: ReturnType<typeof useWallets>) {
	return (
		wallets.find((w) => w.name === "Eve Vault") ??
		wallets.find((w) => w.name.toLowerCase().includes("eve"))
	);
}

type ConnectFn = (args: { wallet: UiWallet }) => Promise<{ accounts: readonly UiWalletAccount[] }>;

/**
 * Interactive connect to EVE Vault. EVE Vault always shows its unlock (PIN) + approval windows on a
 * `connect()` call -- it ignores the wallet-standard `silent` flag -- so there is no way to suppress
 * that window from the dApp side on a genuine connect. The official EVE Frontier dApp uses this exact
 * same call and shows the same window on first connect; it avoids showing it on every reload by
 * relying on dapp-kit's passive `autoConnect` (which restores the session from local storage without
 * ever calling the wallet). So this is only hit for the first connect of a fresh session.
 */
export async function connectEveVault(connectWallet: ConnectFn, eveVault: UiWallet): Promise<void> {
	await connectWallet({ wallet: eveVault });
}

/**
 * Wallet connection button mimicking the default EVE Frontier dApp pattern.
 * - Disconnected: shows a "Connect EVE Vault" button
 * - No wallet: shows install prompt for EVE Vault
 * - Connected: shows green dot + truncated address; click to disconnect
 */
export function WalletConnect() {
	const account = useCurrentAccount();
	const wallets = useWallets();
	const { connectWallet, disconnectWallet } = useDAppKit();
	const [showInstallPrompt, setShowInstallPrompt] = useState(false);
	const [connecting, setConnecting] = useState(false);

	async function handleConnect() {
		const eveVault = findEveVault(wallets);
		if (!eveVault) {
			setShowInstallPrompt(true);
			return;
		}
		setConnecting(true);
		try {
			await connectEveVault(connectWallet, eveVault);
		} catch {
			// User dismissed the EVE Vault prompt -- stay disconnected, let them retry.
		} finally {
			setConnecting(false);
		}
	}

	if (!account) {
		return (
			<div className="flex w-full flex-col gap-1.5">
				<button
					type="button"
					onClick={handleConnect}
					disabled={connecting}
					className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-cyan-600 hover:bg-cyan-900/20 hover:text-cyan-400 disabled:opacity-60"
				>
					<Wallet size={14} className="shrink-0" />
					<span>{connecting ? "Connecting..." : "Connect EVE Vault"}</span>
				</button>
				{showInstallPrompt && (
					<div className="rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
						<p className="mb-1.5">
							No Sui wallet detected. Install EVE Vault to connect:
						</p>
						<a
							href={EVE_VAULT_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-cyan-400 underline hover:text-cyan-300"
						>
							Download EVE Vault
							<ExternalLink size={10} />
						</a>
					</div>
				)}
			</div>
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
	const [showInstall, setShowInstall] = useState(false);
	const [connecting, setConnecting] = useState(false);

	if (account) return null;

	async function handleConnect() {
		const eveVault = findEveVault(wallets);
		if (!eveVault) {
			setShowInstall(true);
			return;
		}
		setConnecting(true);
		try {
			await connectEveVault(connectWallet, eveVault);
		} catch {
			// User dismissed the EVE Vault prompt -- stay disconnected, let them retry.
		} finally {
			setConnecting(false);
		}
	}

	return (
		<div className="flex flex-col gap-1">
			<button
				type="button"
				onClick={handleConnect}
				disabled={connecting}
				className={`flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-60 ${className}`}
			>
				<Wallet size={12} />
				{connecting ? "Connecting..." : "Connect EVE Vault"}
			</button>
			{showInstall && (
				<a
					href={EVE_VAULT_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1 text-xs text-amber-300 hover:text-cyan-300"
				>
					No wallet found -- install EVE Vault
					<ExternalLink size={10} />
				</a>
			)}
		</div>
	);
}
