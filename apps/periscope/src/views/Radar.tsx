import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { useRadar } from "@/hooks/useRadar";
import {
	Plus,
	Trash2,
	Bell,
	BellOff,
	Volume2,
	VolumeX,
	Wifi,
	WifiOff,
	Check,
	X,
	MapPin,
	Users,
	User,
} from "lucide-react";
import type { RadarEvent } from "@/db/types";

const KIND_ICONS = {
	system: MapPin,
	character: User,
	tribe: Users,
} as const;

const KIND_COLORS = {
	system: "text-blue-400",
	character: "text-orange-400",
	tribe: "text-purple-400",
} as const;

const EVENT_COLORS: Record<string, string> = {
	killmail: "text-red-400",
	fuel: "text-amber-400",
	status_change: "text-green-400",
	assembly_created: "text-cyan-400",
	jump: "text-blue-400",
	inventory: "text-yellow-400",
};

export function Radar() {
	const {
		watches,
		connected,
		addWatch,
		removeWatch,
		toggleAlert,
		clearEvents,
		acknowledgeAll,
	} = useRadar();

	const events = useLiveQuery(
		() => db.radarEvents.orderBy("timestamp").reverse().limit(200).toArray(),
	) ?? [];

	const unacknowledgedCount = events.filter((e) => !e.acknowledged).length;

	const [showAddForm, setShowAddForm] = useState(false);
	const [addKind, setAddKind] = useState<"system" | "character" | "tribe">("system");
	const [addTargetId, setAddTargetId] = useState("");
	const [addLabel, setAddLabel] = useState("");

	// System name lookup for event display
	const systems = useLiveQuery(() => db.solarSystems.toArray());
	const systemMap = useMemo(() => {
		const map: Record<number, string> = {};
		for (const s of systems ?? []) {
			if (s.name) map[s.id] = s.name;
		}
		return map;
	}, [systems]);

	function handleAdd() {
		if (!addTargetId.trim()) return;
		const label = addLabel.trim() || (addKind === "system"
			? (systemMap[Number(addTargetId)] ?? `System ${addTargetId}`)
			: `${addKind} ${addTargetId}`);
		addWatch(addKind, addTargetId.trim(), label);
		setAddTargetId("");
		setAddLabel("");
		setShowAddForm(false);
	}

	return (
		<div className="p-6">
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div className="flex items-center gap-3">
					<img src="/radar.svg" alt="" className="h-7 w-7" style={{ filter: "invert(73%) sepia(65%) saturate(500%) hue-rotate(140deg) brightness(95%)" }} />
					<div>
						<h1 className="text-2xl font-bold text-zinc-100">Radar</h1>
						<p className="text-sm text-zinc-500">
							{watches.length} watch{watches.length !== 1 ? "es" : ""} &middot;{" "}
							{unacknowledgedCount} new event{unacknowledgedCount !== 1 ? "s" : ""}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<div className={`flex items-center gap-1.5 text-xs ${connected ? "text-green-400" : "text-zinc-600"}`}>
						{connected ? <Wifi size={14} /> : <WifiOff size={14} />}
						{connected ? "Live" : "Disconnected"}
					</div>
					{unacknowledgedCount > 0 && (
						<button
							type="button"
							onClick={acknowledgeAll}
							className="flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						>
							<Check size={12} /> Mark All Read
						</button>
					)}
					<button
						type="button"
						onClick={() => setShowAddForm(!showAddForm)}
						className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
					>
						<Plus size={14} /> Add Watch
					</button>
				</div>
			</div>

			{/* Add Watch Form */}
			{showAddForm && (
				<div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
					<h3 className="mb-3 text-sm font-medium text-zinc-300">New Watch</h3>
					<div className="flex flex-wrap gap-3">
						<select
							value={addKind}
							onChange={(e) => setAddKind(e.target.value as typeof addKind)}
							className="rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 focus:border-cyan-600 focus:outline-none"
						>
							<option value="system">System</option>
							<option value="character">Character</option>
							<option value="tribe">Tribe</option>
						</select>
						<input
							type="text"
							value={addTargetId}
							onChange={(e) => setAddTargetId(e.target.value)}
							placeholder={addKind === "system" ? "System ID (e.g. 30013502)" : addKind === "character" ? "Character ID" : "Tribe ID"}
							className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
						/>
						<input
							type="text"
							value={addLabel}
							onChange={(e) => setAddLabel(e.target.value)}
							placeholder="Label (optional)"
							className="w-40 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
						/>
						<button
							type="button"
							onClick={handleAdd}
							disabled={!addTargetId.trim()}
							className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
						>
							Add
						</button>
						<button
							type="button"
							onClick={() => setShowAddForm(false)}
							className="rounded px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* Watch List */}
			{watches.length > 0 && (
				<div className="mb-6">
					<h2 className="mb-3 text-sm font-medium text-zinc-400">Active Watches</h2>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{watches.map((watch) => {
							const Icon = KIND_ICONS[watch.kind];
							const color = KIND_COLORS[watch.kind];
							const watchEvents = events.filter((e) => e.watchId === watch.id);
							const unack = watchEvents.filter((e) => !e.acknowledged).length;
							return (
								<div key={watch.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<Icon size={14} className={color} />
											<span className="text-sm font-medium text-zinc-200">{watch.label}</span>
											{unack > 0 && (
												<span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
													{unack}
												</span>
											)}
										</div>
										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() => toggleAlert(watch.id, "alertEnabled")}
												className={`rounded p-1 ${watch.alertEnabled ? "text-cyan-400" : "text-zinc-600"} hover:bg-zinc-800`}
												title={watch.alertEnabled ? "Alerts on" : "Alerts off"}
											>
												{watch.alertEnabled ? <Bell size={12} /> : <BellOff size={12} />}
											</button>
											<button
												type="button"
												onClick={() => toggleAlert(watch.id, "alertSound")}
												className={`rounded p-1 ${watch.alertSound ? "text-amber-400" : "text-zinc-600"} hover:bg-zinc-800`}
												title={watch.alertSound ? "Sound on" : "Sound off"}
											>
												{watch.alertSound ? <Volume2 size={12} /> : <VolumeX size={12} />}
											</button>
											<button
												type="button"
												onClick={() => removeWatch(watch.id)}
												className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
												title="Remove watch"
											>
												<Trash2 size={12} />
											</button>
										</div>
									</div>
									<div className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
										<span className="capitalize">{watch.kind}</span>
										<span className="font-mono">{watch.targetId}</span>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Event Log */}
			<div>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-sm font-medium text-zinc-400">
						Event Log ({events.length})
					</h2>
					{events.length > 0 && (
						<button
							type="button"
							onClick={() => clearEvents()}
							className="flex items-center gap-1 text-xs text-zinc-600 hover:text-red-400"
						>
							<Trash2 size={12} /> Clear All
						</button>
					)}
				</div>

				{events.length === 0 ? (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
						<p className="text-sm text-zinc-500">
							{watches.length === 0
								? "Add a watch to start monitoring activity."
								: "No events detected yet. Events will appear here in real-time."}
						</p>
					</div>
				) : (
					<div className="space-y-1">
						{events.map((event) => (
							<EventRow key={event.id} event={event} watches={watches} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function EventRow({ event, watches }: { event: RadarEvent; watches: Array<{ id: string; label: string; kind: string }> }) {
	const [expanded, setExpanded] = useState(false);
	const watch = watches.find((w) => w.id === event.watchId);
	const color = EVENT_COLORS[event.kind] ?? "text-zinc-400";

	return (
		<div
			className={`rounded border px-3 py-2 transition-colors ${
				event.acknowledged
					? "border-zinc-800/50 bg-zinc-900/30"
					: "border-zinc-700 bg-zinc-900/60"
			}`}
		>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-3 text-left"
			>
				{!event.acknowledged && (
					<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
				)}
				<span className="shrink-0 text-xs text-zinc-600">
					{new Date(event.timestamp).toLocaleTimeString()}
				</span>
				<span className={`shrink-0 rounded px-1.5 py-0.5 text-xs capitalize ${color} bg-zinc-800`}>
					{event.kind.replace("_", " ")}
				</span>
				<span className="flex-1 truncate text-sm text-zinc-300">
					{event.summary}
				</span>
				{watch && (
					<span className="shrink-0 text-xs text-zinc-600">
						{watch.label}
					</span>
				)}
			</button>
			{expanded && event.details && (
				<pre className="mt-2 max-h-40 overflow-auto rounded bg-zinc-800/50 p-2 font-mono text-xs text-zinc-500">
					{JSON.stringify(JSON.parse(event.details), null, 2)}
				</pre>
			)}
		</div>
	);
}
