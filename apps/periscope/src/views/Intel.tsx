import { useState, useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import {
	extractChatLinks,
	extractMentionedPlayers,
	classifyIntelSeverity,
	stripChatLinks,
} from "@/lib/chatLinkParser";
import {
	Radio,
	Search,
	X,
	AlertTriangle,
	Eye,
	Clock,
	Filter,
	Users,
	MapPin,
} from "lucide-react";
import type { ChatIntelEntry, LogEvent } from "@/db/types";

const SEVERITY_COLORS = {
	high: "border-red-900/50 bg-red-950/20",
	medium: "border-orange-900/50 bg-orange-950/20",
	low: "border-zinc-800 bg-zinc-900/50",
};

const SEVERITY_BADGES = {
	high: "bg-red-500/20 text-red-400",
	medium: "bg-orange-500/20 text-orange-400",
	low: "bg-zinc-700/50 text-zinc-400",
};

// Intel aging thresholds (minutes)
const STALE_MINUTES = 15;
const EXPIRED_MINUTES = 60;

type IntelAge = "active" | "stale" | "expired";

function getIntelAge(timestamp: string): IntelAge {
	const age = (Date.now() - new Date(timestamp).getTime()) / 60000;
	if (age < STALE_MINUTES) return "active";
	if (age < EXPIRED_MINUTES) return "stale";
	return "expired";
}

const AGE_STYLES: Record<IntelAge, { badge: string; opacity: string }> = {
	active: { badge: "bg-green-500/20 text-green-400", opacity: "opacity-100" },
	stale: { badge: "bg-yellow-500/20 text-yellow-400", opacity: "opacity-70" },
	expired: { badge: "bg-zinc-700/50 text-zinc-500", opacity: "opacity-40" },
};

export function Intel() {
	const intelEntries = useLiveQuery(() =>
		db.chatIntel.orderBy("createdAt").reverse().filter(notDeleted).limit(200).toArray(),
	);
	const chatEvents = useLiveQuery(() =>
		db.logEvents
			.where("type")
			.equals("chat")
			.reverse()
			.limit(500)
			.toArray(),
	);
	const totalIntel = useLiveQuery(() => db.chatIntel.filter(notDeleted).count()) ?? 0;
	const [searchQuery, setSearchQuery] = useState("");
	const [severityFilter, setSeverityFilter] = useState<"all" | "high" | "medium" | "low">("all");
	const [showExpired, setShowExpired] = useState(false);
	const [intelChannels, setIntelChannels] = useState<Set<string>>(new Set(["Local"]));

	// Process recent chat events for intel-worthy content
	const processedIntel = useMemo(() => {
		if (!chatEvents) return [];

		return chatEvents
			.filter((e) => {
				if (!e.channel || !e.message) return false;
				// Only process messages from designated intel channels
				if (!intelChannels.has(e.channel)) return false;
				// Skip system messages
				if (e.speaker === "Keeper") return false;
				return true;
			})
			.map((e) => {
				const links = extractChatLinks(e.message ?? "");
				const players = extractMentionedPlayers(e.message ?? "");
				const severity = classifyIntelSeverity(e.message ?? "");
				const cleanMessage = stripChatLinks(e.message ?? "");
				const age = getIntelAge(e.timestamp);

				return {
					event: e,
					links,
					players,
					severity,
					cleanMessage,
					age,
				};
			});
	}, [chatEvents, intelChannels]);

	// Get available channels from chat events
	const availableChannels = useMemo(() => {
		if (!chatEvents) return [];
		const channels = new Set<string>();
		for (const e of chatEvents) {
			if (e.channel) channels.add(e.channel);
		}
		return Array.from(channels).sort();
	}, [chatEvents]);

	const filtered = processedIntel.filter((item) => {
		if (!showExpired && item.age === "expired") return false;
		if (severityFilter !== "all" && item.severity !== severityFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			return (
				item.cleanMessage.toLowerCase().includes(q) ||
				item.event.speaker?.toLowerCase().includes(q) ||
				item.players.some((p) => p.name.toLowerCase().includes(q))
			);
		}
		return true;
	});

	const activeCount = processedIntel.filter((i) => i.age === "active").length;
	const staleCount = processedIntel.filter((i) => i.age === "stale").length;

	function toggleChannel(channel: string) {
		setIntelChannels((prev) => {
			const next = new Set(prev);
			if (next.has(channel)) {
				next.delete(channel);
			} else {
				next.add(channel);
			}
			return next;
		});
	}

	return (
		<div className="p-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<Radio size={24} className="text-cyan-500" />
						Intel Channel
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						{activeCount} active &middot; {staleCount} stale &middot; {totalIntel} stored
					</p>
				</div>
			</div>

			{/* Channel selector */}
			<div className="mt-4 flex items-center gap-2">
				<span className="text-xs text-zinc-500">Channels:</span>
				{availableChannels.map((ch) => (
					<button
						key={ch}
						type="button"
						onClick={() => toggleChannel(ch)}
						className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
							intelChannels.has(ch)
								? "bg-cyan-600/20 text-cyan-400"
								: "text-zinc-600 hover:text-zinc-400"
						}`}
					>
						{ch}
					</button>
				))}
				{availableChannels.length === 0 && (
					<span className="text-xs text-zinc-600">
						No chat data yet. Enable log monitoring in the Log Analyzer.
					</span>
				)}
			</div>

			{/* Filters */}
			<div className="mt-4 flex items-center gap-4">
				<div className="relative max-w-md flex-1">
					<Search size={14} className="absolute left-3 top-2.5 text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search intel..."
						className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-8 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-600 focus:outline-none"
					/>
					{searchQuery && (
						<button type="button" onClick={() => setSearchQuery("")} className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300">
							<X size={14} />
						</button>
					)}
				</div>

				<div className="flex gap-1">
					{(["all", "high", "medium", "low"] as const).map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => setSeverityFilter(s)}
							className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
								severityFilter === s
									? "bg-zinc-700 text-zinc-100"
									: "text-zinc-500 hover:text-zinc-300"
							}`}
						>
							{s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
						</button>
					))}
				</div>

				<label className="flex items-center gap-1.5 text-xs text-zinc-500">
					<input
						type="checkbox"
						checked={showExpired}
						onChange={(e) => setShowExpired(e.target.checked)}
						className="rounded border-zinc-700"
					/>
					Show expired
				</label>
			</div>

			{/* Intel Feed */}
			<div className="mt-6 space-y-2">
				{filtered.length > 0 ? (
					filtered.map((item, i) => (
						<IntelRow key={`${item.event.sessionId}-${item.event.timestamp}-${i}`} item={item} />
					))
				) : (
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
						<p className="text-sm text-zinc-500">
							{processedIntel.length === 0
								? "No chat intel yet. Enable log monitoring to start receiving intel from chat channels."
								: "No intel matches your filters."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function IntelRow({
	item,
}: {
	item: {
		event: LogEvent;
		links: ReturnType<typeof extractChatLinks>;
		players: ReturnType<typeof extractMentionedPlayers>;
		severity: "high" | "medium" | "low";
		cleanMessage: string;
		age: IntelAge;
	};
}) {
	const ageStyle = AGE_STYLES[item.age];
	const severityColor = SEVERITY_COLORS[item.severity];
	const severityBadge = SEVERITY_BADGES[item.severity];

	return (
		<div className={`rounded-lg border p-3 ${severityColor} ${ageStyle.opacity}`}>
			<div className="flex items-center gap-3">
				{/* Age badge */}
				<span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ageStyle.badge}`}>
					{item.age}
				</span>

				{/* Severity badge */}
				<span className={`rounded px-1.5 py-0.5 text-xs font-medium ${severityBadge}`}>
					{item.severity}
				</span>

				{/* Timestamp */}
				<span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
					<Clock size={10} />
					{new Date(item.event.timestamp).toLocaleTimeString()}
				</span>

				{/* Channel */}
				<span className="text-xs text-zinc-600">{item.event.channel}</span>

				{/* Reporter */}
				<span className="text-xs text-cyan-400">{item.event.speaker}</span>

				{/* Mentioned players */}
				{item.players.length > 0 && (
					<div className="flex items-center gap-1">
						<Users size={10} className="text-yellow-400" />
						{item.players.map((p) => (
							<span key={p.characterId} className="rounded bg-yellow-500/10 px-1 py-0.5 text-xs text-yellow-300">
								{p.name}
							</span>
						))}
					</div>
				)}

				{/* System */}
				{item.event.systemName && (
					<span className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
						<MapPin size={10} />
						{item.event.systemName}
					</span>
				)}
			</div>

			{/* Message */}
			<p className="mt-2 text-sm text-zinc-300">{item.cleanMessage}</p>
		</div>
	);
}
