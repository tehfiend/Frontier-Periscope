import { db } from "@/db";
import { fmtDateTime } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageSquare, Search } from "lucide-react";
import { useState } from "react";

// ── Component ───────────────────────────────────────────────────────────────

export function ChatTab() {
	const [channelFilter, setChannelFilter] = useState<string>("all");
	const [searchQuery, setSearchQuery] = useState("");

	// Get all chat events across all sessions
	const chatEvents = useLiveQuery(() =>
		db.logEvents.where("type").equals("chat").sortBy("timestamp"),
	);

	const allEvents = chatEvents ?? [];

	// Extract distinct channels
	const channels = [...new Set(allEvents.map((e) => e.channel).filter(Boolean))].sort();

	// Apply filters
	const filtered = allEvents.filter((e) => {
		if (channelFilter !== "all" && e.channel !== channelFilter) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			return (
				(e.message?.toLowerCase().includes(q) ?? false) ||
				(e.speaker?.toLowerCase().includes(q) ?? false)
			);
		}
		return true;
	});

	// Channel message counts
	const channelCounts = new Map<string, number>();
	for (const e of allEvents) {
		const ch = e.channel ?? "Unknown";
		channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1);
	}

	// Unique speakers
	const speakers = new Set(allEvents.map((e) => e.speaker).filter(Boolean));

	if (allEvents.length === 0) {
		return (
			<div className="space-y-4">
				<p className="py-8 text-center text-sm text-zinc-600">
					No chat data yet. Chat messages are parsed from the Chatlogs directory.
				</p>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-xs text-zinc-500">
					<p className="font-medium text-zinc-400">How chat tracking works:</p>
					<p className="mt-1">
						Make sure you selected the <span className="text-zinc-300">logs</span> parent folder
						(not just Gamelogs) so chat logs in the <span className="text-zinc-300">Chatlogs</span>{" "}
						subdirectory are accessible.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Summary cards */}
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Total Messages</p>
					<p className="text-xl font-bold text-emerald-400">{allEvents.length.toLocaleString()}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Channels</p>
					<p className="text-xl font-bold text-zinc-200">{channels.length}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Speakers</p>
					<p className="text-xl font-bold text-zinc-200">{speakers.size}</p>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<p className="text-xs text-zinc-500">Showing</p>
					<p className="text-xl font-bold text-zinc-200">{filtered.length.toLocaleString()}</p>
				</div>
			</div>

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<MessageSquare size={14} className="text-zinc-500" />
					<select
						value={channelFilter}
						onChange={(e) => setChannelFilter(e.target.value)}
						className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-300 outline-none focus:border-zinc-600"
					>
						<option value="all">All Channels</option>
						{channels.map((ch) => (
							<option key={ch} value={ch}>
								{ch} ({channelCounts.get(ch ?? "") ?? 0})
							</option>
						))}
					</select>
				</div>
				<div className="flex flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
					<Search size={14} className="text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search messages or speakers..."
						className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder:text-zinc-600"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="text-xs text-zinc-600 hover:text-zinc-400"
						>
							Clear
						</button>
					)}
				</div>
			</div>

			{/* Channel breakdown */}
			<div>
				<h3 className="mb-2 text-sm font-medium text-zinc-400">Channels</h3>
				<div className="flex flex-wrap gap-2">
					{[...channelCounts.entries()]
						.sort((a, b) => b[1] - a[1])
						.map(([ch, count]) => (
							<button
								key={ch}
								type="button"
								onClick={() => setChannelFilter(channelFilter === ch ? "all" : ch)}
								className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
									channelFilter === ch
										? "border-emerald-700 bg-emerald-900/30 text-emerald-300"
										: "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700"
								}`}
							>
								<span>{ch}</span>
								<span className="ml-1.5 font-mono text-zinc-500">{count}</span>
							</button>
						))}
				</div>
			</div>

			{/* Message list */}
			<div>
				<h3 className="mb-2 text-sm font-medium text-zinc-400">
					Messages ({filtered.length.toLocaleString()})
				</h3>
				<div className="max-h-[500px] space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
					{filtered.length === 0 && (
						<p className="py-8 text-center text-sm text-zinc-600">
							No messages match your filters.
						</p>
					)}
					{[...filtered]
						.reverse()
						.slice(0, 500)
						.map((e) => (
							<div
								key={e.id}
								className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800/50"
							>
								<span className="shrink-0 font-mono text-zinc-600">{fmtDateTime(e.timestamp)}</span>
								<span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-emerald-500/70">
									{e.channel}
								</span>
								{e.systemName && (
									<span className="shrink-0 font-mono text-indigo-400/70">{e.systemName}</span>
								)}
								<span className="shrink-0 font-medium text-zinc-300">{e.speaker}</span>
								<span className="text-zinc-400">{e.message}</span>
							</div>
						))}
					{filtered.length > 500 && (
						<p className="py-2 text-center text-xs text-zinc-600">
							Showing latest 500 of {filtered.length.toLocaleString()} messages. Use filters to
							narrow results.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
