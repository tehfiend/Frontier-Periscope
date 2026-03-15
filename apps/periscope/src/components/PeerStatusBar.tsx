// Compact status bar showing connected peers — hidden when no peers configured

import { Link } from "@tanstack/react-router";
import { useSyncStore } from "@/stores/syncStore";
import { Wifi } from "lucide-react";

const STATUS_DOT: Record<string, string> = {
	connected: "bg-green-400",
	syncing: "bg-yellow-400",
	connecting: "bg-yellow-400 animate-pulse",
	disconnected: "bg-zinc-600",
	error: "bg-red-500",
};

export function PeerStatusBar() {
	const peers = useSyncStore((s) => s.peers);

	if (peers.size === 0) return null;

	const connected = [...peers.values()].filter((p) => p.status === "connected").length;
	const total = peers.size;

	return (
		<Link
			to="/peers"
			className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
		>
			<Wifi size={12} className={connected > 0 ? "text-green-400" : "text-zinc-600"} />
			<div className="flex items-center gap-1">
				{[...peers.values()].map((peer) => (
					<span
						key={peer.instanceId}
						className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[peer.status] ?? STATUS_DOT.disconnected}`}
						title={`${peer.name}: ${peer.status}`}
					/>
				))}
			</div>
			<span>
				{connected}/{total} peers
			</span>
		</Link>
	);
}
