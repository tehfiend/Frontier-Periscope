import { db } from "@/db";
import type { SonarEvent, SonarWatchItem } from "@/db/types";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

// ── CRUD Operations ──────────────────────────────────────────────────────────

/** Reactive hook returning all watchlist items. */
export function useSonarWatchlist() {
	return useLiveQuery(() => db.sonarWatchlist.toArray(), []) ?? [];
}

/** Add a new watch item to the watchlist. */
export async function addWatchItem(item: Omit<SonarWatchItem, "id" | "createdAt" | "updatedAt">) {
	const now = new Date().toISOString();
	await db.sonarWatchlist.add({
		...item,
		id: crypto.randomUUID(),
		createdAt: now,
		updatedAt: now,
	});
}

/** Remove a watch item by ID. */
export async function removeWatchItem(id: string) {
	await db.sonarWatchlist.delete(id);
}

/** Update a watch item by ID. */
export async function updateWatchItem(id: string, changes: Partial<SonarWatchItem>) {
	await db.sonarWatchlist.update(id, {
		...changes,
		updatedAt: new Date().toISOString(),
	});
}

// ── Derived Sets ─────────────────────────────────────────────────────────────

/** Reactive hook returning sets of watched character IDs, tribe IDs, and addresses. */
export function useWatchlistSets() {
	const items = useSonarWatchlist();
	return useMemo(() => {
		const watchedCharacterIds = new Set<string>();
		const watchedTribeIds = new Set<number>();
		const watchedAddresses = new Set<string>();
		for (const item of items) {
			if (item.characterId) watchedCharacterIds.add(item.characterId);
			if (item.tribeId) watchedTribeIds.add(item.tribeId);
			if (item.suiAddress) watchedAddresses.add(item.suiAddress);
		}
		return { watchedCharacterIds, watchedTribeIds, watchedAddresses };
	}, [items]);
}

// ── Watchlist Filter Hook ────────────────────────────────────────────────────

/** Hook providing watchlist match + owned-entity check for feed filtering. */
export function useWatchlistFilter() {
	const items = useSonarWatchlist();

	// Build lookup sets from watchlist
	const watchedCharacterIds = useMemo(() => {
		const set = new Set<string>();
		for (const item of items) {
			if (item.characterId) set.add(item.characterId);
		}
		return set;
	}, [items]);

	const watchedTribeIds = useMemo(() => {
		const set = new Set<number>();
		for (const item of items) {
			if (item.tribeId) set.add(item.tribeId);
		}
		return set;
	}, [items]);

	// Build a map for quick item lookup by characterId or tribeId
	const charToItem = useMemo(() => {
		const map = new Map<string, SonarWatchItem>();
		for (const item of items) {
			if (item.characterId) map.set(item.characterId, item);
		}
		return map;
	}, [items]);

	const tribeToItem = useMemo(() => {
		const map = new Map<number, SonarWatchItem>();
		for (const item of items) {
			if (item.kind === "tribe" && item.tribeId) map.set(item.tribeId, item);
		}
		return map;
	}, [items]);

	// Load owned data
	const ownedAddresses = useLiveQuery(async () => {
		const chars = await db.characters.filter((c) => !c._deleted).toArray();
		return new Set(chars.filter((c) => c.suiAddress).map((c) => c.suiAddress as string));
	}, []);

	const ownedAssemblyIds = useLiveQuery(async () => {
		if (!ownedAddresses) return new Set<string>();
		const deployables = await db.deployables
			.filter((d) => d.owner != null && ownedAddresses.has(d.owner as string))
			.toArray();
		return new Set(deployables.map((d) => d.objectId));
	}, [ownedAddresses]);

	const ownedCharacterIds = useLiveQuery(async () => {
		const chars = await db.characters.filter((c) => !c._deleted).toArray();
		return new Set(chars.filter((c) => c.characterId).map((c) => c.characterId as string));
	}, []);

	/** Check if an event matches a watchlist item. Returns the item or null. */
	function matchesWatchlist(event: SonarEvent): SonarWatchItem | null {
		if (event.characterId) {
			const item = charToItem.get(event.characterId);
			if (item) return item;
		}
		if (event.tribeId) {
			const item = tribeToItem.get(event.tribeId);
			if (item) return item;
		}
		return null;
	}

	/** Check if an event is from an owned entity. */
	function isOwnedEvent(event: SonarEvent): boolean {
		if (event.sender && ownedAddresses?.has(event.sender)) return true;
		if (event.assemblyId && ownedAssemblyIds?.has(event.assemblyId)) return true;
		if (event.characterId && ownedCharacterIds?.has(event.characterId)) return true;
		return false;
	}

	return {
		items,
		watchedCharacterIds,
		watchedTribeIds,
		matchesWatchlist,
		isOwnedEvent,
	};
}
