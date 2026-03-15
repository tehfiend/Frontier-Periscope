import { CheckCircle2, AlertCircle, Loader2, FileEdit, FilePlus2 } from "lucide-react";
import type { SyncStatus } from "@/db/types";

const syncConfig: Record<SyncStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
	draft: { label: "Draft", color: "text-zinc-500 bg-zinc-500/10", icon: FilePlus2 },
	dirty: { label: "Dirty", color: "text-amber-400 bg-amber-500/10", icon: FileEdit },
	syncing: { label: "Syncing", color: "text-cyan-400 bg-cyan-500/10", icon: Loader2 },
	synced: { label: "Synced", color: "text-green-400 bg-green-500/10", icon: CheckCircle2 },
	error: { label: "Error", color: "text-red-400 bg-red-500/10", icon: AlertCircle },
};

interface SyncBadgeProps {
	status: SyncStatus;
	lastSyncedAt?: string;
}

export function SyncBadge({ status, lastSyncedAt }: SyncBadgeProps) {
	const config = syncConfig[status];
	const Icon = config.icon;

	return (
		<span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${config.color}`}>
			<Icon size={12} className={status === "syncing" ? "animate-spin" : ""} />
			{config.label}
			{status === "synced" && lastSyncedAt && (
				<span className="text-zinc-600">
					{formatRelativeTime(lastSyncedAt)}
				</span>
			)}
		</span>
	);
}

function formatRelativeTime(isoDate: string): string {
	const diff = Date.now() - new Date(isoDate).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}
