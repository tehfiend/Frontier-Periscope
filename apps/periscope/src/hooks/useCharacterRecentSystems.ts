import { db } from "@/db";
import type { SolarSystem } from "@/db/types";
import { useCharacterSessionIds } from "@/hooks/useCharacterSessionIds";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

export interface RecentSystem {
	systemId: number;
	name: string;
	/** ISO timestamp of the most recent visit. */
	lastVisited: string;
}

/**
 * Solar systems the active character (or all characters, when "All" is selected) has been seen in,
 * most recent first, deduped by system.
 *
 * Mirrors the Sonar Travel tab's proven data path exactly: `system_change` log events scoped to the
 * active character via its log sessions. Each event carries a `systemName` string, resolved to a
 * systemId through `systems` (the name -> id map). Systems whose name can't be resolved -- e.g.
 * old-cycle systems no longer in the current static data -- are skipped. Returns [] when there's no
 * travel history.
 */
export function useCharacterRecentSystems(systems: SolarSystem[], limit = 8): RecentSystem[] {
	// null = "All Characters" (don't filter by session); otherwise the active character's sessions.
	const sessionIds = useCharacterSessionIds();

	const events = useLiveQuery(
		() =>
			db.logEvents
				.where("type")
				.equals("system_change")
				.filter((e) => !sessionIds || sessionIds.has(e.sessionId))
				.sortBy("timestamp"),
		[sessionIds],
	);

	return useMemo(() => {
		if (!events || events.length === 0) return [];
		const nameToId = new Map<string, number>();
		for (const s of systems) {
			if (s.name) nameToId.set(s.name.toLowerCase(), s.id);
		}
		// Most recent visit timestamp per resolvable system.
		const latest = new Map<number, string>();
		for (const e of events) {
			if (!e.systemName) continue;
			const id = nameToId.get(e.systemName.toLowerCase());
			if (id == null) continue;
			const prev = latest.get(id);
			if (!prev || e.timestamp > prev) latest.set(id, e.timestamp);
		}
		return [...latest.entries()]
			.map(([systemId, lastVisited]) => ({
				systemId,
				name: systems.find((s) => s.id === systemId)?.name ?? `#${systemId}`,
				lastVisited,
			}))
			.sort((a, b) => b.lastVisited.localeCompare(a.lastVisited))
			.slice(0, limit);
	}, [events, systems, limit]);
}
