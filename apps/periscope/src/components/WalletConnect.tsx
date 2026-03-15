import {
	ConnectButton,
	useCurrentAccount,
	useDisconnectWallet,
} from "@mysten/dapp-kit";
import { LogOut, Wallet } from "lucide-react";

function truncateAddress(address: string): string {
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletConnect() {
	const account = useCurrentAccount();
	const { mutate: disconnect } = useDisconnectWallet();
	// Auto-connect is handled by WalletProvider (autoConnect: true).
	// The ConnectButton below only shows when not connected, letting
	// the user explicitly choose to connect when they need to sign.

	if (!account) {
		return <ConnectButton className="!rounded-lg !bg-cyan-600 !px-3 !py-1.5 !text-xs !font-medium !text-white hover:!bg-cyan-500" />;
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
