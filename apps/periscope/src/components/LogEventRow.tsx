import type { LogEvent } from "@/db/types";
import { fmtTime } from "@/lib/format";

export const EVENT_COLORS: Record<string, string> = {
	mining: "text-amber-400",
	combat_dealt: "text-cyan-400",
	combat_received: "text-red-400",
	miss_dealt: "text-zinc-500",
	miss_received: "text-zinc-500",
	notify: "text-zinc-400",
	info: "text-zinc-500",
	hint: "text-zinc-600",
	question: "text-yellow-400",
	structure_departed: "text-orange-400",
	gate_offline: "text-rose-400",
	build_fail: "text-red-500",
	dismantle: "text-orange-300",
	system_change: "text-indigo-400",
	chat: "text-emerald-400",
	// Cycle 6 capture (plan 37)
	self_destruct: "text-red-400",
	aggression_lock: "text-red-400",
	warp_blocked: "text-red-400",
	target_out_of_range: "text-red-400",
	sightline_obscured: "text-red-400",
	mining_interrupted: "text-amber-400",
	module_failed: "text-orange-400",
	disruption: "text-orange-400",
	warning: "text-orange-400",
	placement_fail: "text-zinc-400",
	fleet_invite: "text-blue-400",
	conversation_invite: "text-blue-400",
	cancel_construction: "text-yellow-400",
	none: "text-zinc-500",
};

export const EVENT_LABELS: Record<string, string> = {
	mining: "MINE",
	combat_dealt: "HIT",
	combat_received: "DMG",
	miss_dealt: "MISS",
	miss_received: "MISS",
	notify: "SYS",
	info: "INFO",
	hint: "HINT",
	question: "???",
	structure_departed: "LEFT",
	gate_offline: "GATE",
	build_fail: "FAIL",
	dismantle: "DISM",
	system_change: "JUMP",
	chat: "CHAT",
	// Cycle 6 capture (plan 37)
	self_destruct: "SDEST",
	aggression_lock: "AGGRO",
	warp_blocked: "TACKLE",
	target_out_of_range: "RANGE",
	sightline_obscured: "SIGHT",
	mining_interrupted: "MRANGE",
	module_failed: "MODULE",
	disruption: "DISRPT",
	warning: "WARN",
	placement_fail: "PLACE",
	fleet_invite: "FLEET",
	conversation_invite: "CONVO",
	cancel_construction: "CANCEL",
	none: "MISC",
};

export function LogEventRow({ event }: { event: LogEvent }) {
	const color = EVENT_COLORS[event.type] ?? "text-zinc-500";
	const label = EVENT_LABELS[event.type] ?? event.type;
	const time = fmtTime(event.timestamp);

	let detail: string;
	switch (event.type) {
		case "mining":
			detail = `${event.amount} ${event.ore}`;
			break;
		case "combat_dealt":
			detail = `${event.damage} -> ${event.target} (${event.weapon}, ${event.hitQuality})`;
			break;
		case "combat_received":
			detail = `${event.damage} <- ${event.target} (${event.hitQuality})`;
			break;
		case "miss_dealt":
			detail = `-> ${event.target} (${event.weapon})`;
			break;
		case "miss_received":
			detail = `<- ${event.target}`;
			break;
		case "structure_departed":
			detail = `${event.structureName} left ${event.systemName}`;
			break;
		case "gate_offline":
			detail = `${event.systemName} Traffic Control offline`;
			break;
		case "build_fail":
		case "dismantle":
			detail = event.message ?? "";
			break;
		case "system_change":
			detail = `-> ${event.systemName}`;
			break;
		case "chat":
			detail = `[${event.channel}] ${event.speaker}: ${event.message}`;
			break;
		default:
			detail = event.message ?? "";
	}

	return (
		<div className="flex items-center gap-2 rounded px-2 py-0.5 text-xs hover:bg-zinc-800/50">
			<span className="shrink-0 font-mono text-zinc-600">{time}</span>
			<span className={`w-10 shrink-0 font-mono font-bold ${color}`}>{label}</span>
			<span className="truncate text-zinc-300">{detail}</span>
		</div>
	);
}
