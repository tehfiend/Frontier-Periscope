import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useSonarStore } from "@/stores/sonarStore";
import type { SonarEvent, SonarChannelStatus } from "@/db/types";
import {
	Navigation,
	Package,
	Radio,
	ArrowDownToLine,
	ArrowUpFromLine,
} from "lucide-react";

// ── Status Dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: SonarChannelStatus }) {
	const color =
		status === "active"
			? "bg-green-500"
			: status === "error"
				? "bg-red-500"
				: "bg-zinc-600";
	return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

// ── Location Card ────────────────────────────────────────────────────────────

interface LocationEntry {
	characterName: string;
	systemName: string;
	timestamp: string;
}

function LocationCard({ locations }: { locations: LocationEntry[] }) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="mb-3 flex items-center gap-2">
				<Navigation size={16} className="text-cyan-400" />
				<h2 className="text-sm font-semibold text-zinc-200">Character Locations</h2>
			</div>
			{locations.length === 0 ? (
				<p className="text-sm text-zinc-600">
					No location data. Enable Log Sonar and ensure log files are accessible.
				</p>
			) : (
				<div className="space-y-2">
					{locations.map((loc) => (
						<div
							key={loc.characterName}
							className="flex items-center justify-between rounded-md bg-zinc-800/50 px-3 py-2"
						>
							<div>
								<span className="text-sm font-medium text-zinc-200">
									{loc.characterName}
								</span>
								<span className="ml-2 text-sm text-cyan-400">
									{loc.systemName}
								</span>
							</div>
							<span className="text-xs text-zinc-600">
								{formatRelative(loc.timestamp)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── SSU Activity Summary ─────────────────────────────────────────────────────

interface SsuActivityEntry {
	assemblyId: string;
	assemblyName: string;
	deposits: number;
	withdrawals: number;
	lastActivity: string;
}

function SsuActivityCard({ activities }: { activities: SsuActivityEntry[] }) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="mb-3 flex items-center gap-2">
				<Package size={16} className="text-blue-400" />
				<h2 className="text-sm font-semibold text-zinc-200">SSU Activity</h2>
			</div>
			{activities.length === 0 ? (
				<p className="text-sm text-zinc-600">
					No SSU activity detected. Enable Chain Sonar to monitor inventory events.
				</p>
			) : (
				<div className="overflow-x-auto rounded-md border border-zinc-800">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-zinc-800 bg-zinc-900/80">
								<th className="px-3 py-2 text-left text-xs font-medium text-zinc-400">
									SSU
								</th>
								<th className="px-3 py-2 text-right text-xs font-medium text-zinc-400">
									Deposits
								</th>
								<th className="px-3 py-2 text-right text-xs font-medium text-zinc-400">
									Withdrawals
								</th>
								<th className="px-3 py-2 text-right text-xs font-medium text-zinc-400">
									Last Activity
								</th>
							</tr>
						</thead>
						<tbody>
							{activities.map((a) => (
								<tr
									key={a.assemblyId}
									className="border-b border-zinc-800/30 hover:bg-zinc-800/30"
								>
									<td className="px-3 py-2 text-zinc-300">
										{a.assemblyName ||
											`${a.assemblyId.slice(0, 10)}...`}
									</td>
									<td className="px-3 py-2 text-right">
										{a.deposits > 0 ? (
											<span className="inline-flex items-center gap-1 text-emerald-400">
												<ArrowDownToLine size={12} />
												{a.deposits}
											</span>
										) : (
											<span className="text-zinc-600">0</span>
										)}
									</td>
									<td className="px-3 py-2 text-right">
										{a.withdrawals > 0 ? (
											<span className="inline-flex items-center gap-1 text-amber-400">
												<ArrowUpFromLine size={12} />
												{a.withdrawals}
											</span>
										) : (
											<span className="text-zinc-600">0</span>
										)}
									</td>
									<td className="px-3 py-2 text-right text-xs text-zinc-500">
										{formatRelative(a.lastActivity)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

// ── Channel Status Card ──────────────────────────────────────────────────────

function ChannelStatusCard() {
	const localEnabled = useSonarStore((s) => s.localEnabled);
	const chainEnabled = useSonarStore((s) => s.chainEnabled);
	const localStatus = useSonarStore((s) => s.localStatus);
	const chainStatus = useSonarStore((s) => s.chainStatus);
	const setLocalEnabled = useSonarStore((s) => s.setLocalEnabled);
	const setChainEnabled = useSonarStore((s) => s.setChainEnabled);

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="mb-3 flex items-center gap-2">
				<Radio size={16} className="text-zinc-400" />
				<h2 className="text-sm font-semibold text-zinc-200">Channel Status</h2>
			</div>
			<div className="space-y-2">
				<ChannelRow
					label="Log Sonar"
					description="Game & chat log file monitoring"
					enabled={localEnabled}
					status={localStatus}
					onToggle={() => setLocalEnabled(!localEnabled)}
				/>
				<ChannelRow
					label="Chain Sonar"
					description="On-chain SSU inventory events"
					enabled={chainEnabled}
					status={chainStatus}
					onToggle={() => setChainEnabled(!chainEnabled)}
				/>
			</div>
		</div>
	);
}

function ChannelRow({
	label,
	description,
	enabled,
	status,
	onToggle,
}: {
	label: string;
	description: string;
	enabled: boolean;
	status: SonarChannelStatus;
	onToggle: () => void;
}) {
	return (
		<div className="flex items-center justify-between rounded-md bg-zinc-800/50 px-3 py-2">
			<div className="flex items-center gap-3">
				<StatusDot status={enabled ? status : "off"} />
				<div>
					<div className="text-sm font-medium text-zinc-200">{label}</div>
					<div className="text-xs text-zinc-500">{description}</div>
				</div>
			</div>
			<button
				type="button"
				onClick={onToggle}
				className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
					enabled
						? "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
						: "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
				}`}
			>
				{enabled ? "On" : "Off"}
			</button>
		</div>
	);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(isoTimestamp: string): string {
	const diff = Date.now() - new Date(isoTimestamp).getTime();
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Main View ────────────────────────────────────────────────────────────────

export function Bridge() {
	// Sonar hooks now run at Layout level -- no need to call them here

	// Query sonar events for dashboard derivations
	const allEvents = useLiveQuery(
		() => db.sonarEvents.orderBy("timestamp").reverse().limit(5000).toArray(),
		[],
	);

	// Derive character locations from latest system_change per character
	const locations = useMemo<LocationEntry[]>(() => {
		if (!allEvents) return [];
		const latest = new Map<string, SonarEvent>();
		// Events are sorted newest first, so first occurrence per character wins
		for (const e of allEvents) {
			if (
				e.eventType === "system_change" &&
				e.characterName &&
				e.systemName &&
				!latest.has(e.characterName)
			) {
				latest.set(e.characterName, e);
			}
		}
		return Array.from(latest.values()).map((e) => ({
			characterName: e.characterName as string,
			systemName: e.systemName as string,
			timestamp: e.timestamp,
		}));
	}, [allEvents]);

	// Derive SSU activity summary from chain events
	const ssuActivities = useMemo<SsuActivityEntry[]>(() => {
		if (!allEvents) return [];
		const map = new Map<
			string,
			{ assemblyName: string; deposits: number; withdrawals: number; lastActivity: string }
		>();

		for (const e of allEvents) {
			if (e.source !== "chain" || !e.assemblyId) continue;

			const existing = map.get(e.assemblyId) ?? {
				assemblyName: e.assemblyName ?? "",
				deposits: 0,
				withdrawals: 0,
				lastActivity: e.timestamp,
			};

			if (
				e.eventType === "item_deposited" ||
				e.eventType === "item_minted"
			) {
				existing.deposits += 1;
			} else if (
				e.eventType === "item_withdrawn" ||
				e.eventType === "item_burned"
			) {
				existing.withdrawals += 1;
			}

			// Keep track of latest assembly name
			if (e.assemblyName) existing.assemblyName = e.assemblyName;

			// Track latest timestamp
			if (e.timestamp > existing.lastActivity) {
				existing.lastActivity = e.timestamp;
			}

			map.set(e.assemblyId, existing);
		}

		return Array.from(map.entries())
			.map(([assemblyId, data]) => ({
				assemblyId,
				...data,
			}))
			.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
	}, [allEvents]);

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			{/* Header */}
			<div className="flex items-center gap-3">
				<Navigation size={20} className="text-cyan-400" />
				<h1 className="text-lg font-semibold text-zinc-100">Bridge</h1>
			</div>

			{/* Dashboard Grid */}
			<div className="grid gap-4 lg:grid-cols-2">
				<LocationCard locations={locations} />
				<ChannelStatusCard />
			</div>

			<SsuActivityCard activities={ssuActivities} />
		</div>
	);
}
