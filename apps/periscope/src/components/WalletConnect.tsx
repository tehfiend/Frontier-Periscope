import { useCurrentAccount } from "@mysten/dapp-kit-react";

function truncateAddress(address: string): string {
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Minimal wallet connection status indicator.
 * Shows a green dot + truncated address when connected,
 * or a gray dot + "Not connected" when disconnected.
 * No button — auto-connect handles connection via EVE Vault.
 */
export function WalletConnect() {
	const account = useCurrentAccount();

	if (!account) {
		return (
			<div className="flex items-center gap-1.5">
				<span className="h-2 w-2 rounded-full bg-zinc-600" />
				<span className="text-xs text-zinc-500">Not connected</span>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1.5">
			<span className="h-2 w-2 rounded-full bg-green-500" />
			<span className="font-mono text-xs text-zinc-400">
				{truncateAddress(account.address)}
			</span>
		</div>
	);
}
