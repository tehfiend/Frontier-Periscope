import {
	useCurrentAccount,
	useConnectWallet,
	useDisconnectWallet,
	useWallets,
} from "@mysten/dapp-kit";
import { LogOut, Wallet } from "lucide-react";

function truncateAddress(address: string): string {
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Connect button that auto-selects EVE Vault (skips the wallet picker).
 * Falls back to showing wallet name if EVE Vault isn't found.
 */
export function ConnectWalletButton({ className }: { className?: string }) {
	const { mutate: connect, isPending } = useConnectWallet();
	const wallets = useWallets();

	function handleConnect() {
		const eveVault = wallets.find((w) => w.name === "EVE Vault");
		const wallet = eveVault ?? wallets[0];
		if (wallet) {
			connect({ wallet });
		}
	}

	return (
		<button
			type="button"
			onClick={handleConnect}
			disabled={isPending || wallets.length === 0}
			className={
				className ??
				"rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
			}
		>
			{isPending ? "Connecting..." : "Connect Wallet"}
		</button>
	);
}

export function WalletConnect() {
	const account = useCurrentAccount();
	const { mutate: disconnect } = useDisconnectWallet();

	if (!account) {
		return <ConnectWalletButton />;
	}

	return (
		<div className="flex items-center gap-2">
			<div className="flex items-center gap-1.5 rounded-lg bg-zinc-800/50 px-3 py-1.5">
				<Wallet size={14} className="text-cyan-500" />
				<span className="font-mono text-xs text-zinc-300">
					{truncateAddress(account.address)}
				</span>
			</div>
			<button
				type="button"
				onClick={() => disconnect()}
				className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
				title="Disconnect wallet"
			>
				<LogOut size={14} />
			</button>
		</div>
	);
}
