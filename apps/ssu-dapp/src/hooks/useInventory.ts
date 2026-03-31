import { getTenant, getWorldPackageId } from "@/lib/constants";
import { resolveItemNames } from "@/lib/items";
import { bcs } from "@mysten/sui/bcs";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { blake2b } from "@noble/hashes/blake2.js";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSuiClient } from "./useSuiClient";

/** A single item entry from an inventory's VecMap */
export interface InventoryItem {
	tenant: string;
	typeId: number;
	itemId: number;
	volume: number;
	quantity: number;
	name: string;
}

/** Parsed inventory with capacity info */
export interface InventoryData {
	maxCapacity: number;
	usedCapacity: number;
	items: InventoryItem[];
}

/** Slot type classification for an inventory */
export type SlotType = "owner" | "open" | "player";

/** A labeled inventory with slot type and optional character name */
export interface LabeledInventory extends InventoryData {
	key: string;
	slotType: SlotType;
	label: string;
	characterName?: string;
	/** Character object ID for player slots (resolved from OwnerCap owner) */
	characterObjectId?: string;
}

/** All inventories from a StorageUnit */
export interface SsuInventories {
	/** All labeled inventories (owner + open + player slots) */
	slots: LabeledInventory[];
	/** Convenience accessor for the owner inventory */
	ownerInventory: InventoryData;
}

// ── GraphQL query for dynamic fields with content ───────────────────────────

const LIST_INVENTORY_FIELDS = `
	query($parentId: SuiAddress!, $first: Int) {
		object(address: $parentId) {
			dynamicFields(first: $first) {
				nodes {
					name { json type { repr } }
					value {
						... on MoveObject {
							address
							contents { json type { repr } }
						}
						... on MoveValue {
							json
							type { repr }
						}
					}
				}
			}
		}
	}
`;

interface DfNode {
	name: { json: unknown; type: { repr: string } };
	value?: {
		address?: string;
		contents?: {
			json: Record<string, unknown>;
			type: { repr: string };
		};
		json?: Record<string, unknown>;
		type?: { repr: string };
	};
}

interface DfResponse {
	object: {
		dynamicFields: {
			nodes: DfNode[];
		};
	} | null;
}

// ── OwnerCap -> Character object ID resolution ─────────────────────────────

const GET_OWNER_OF_CAP = `
	query($id: SuiAddress!) {
		object(address: $id) {
			owner {
				... on ObjectOwner {
					address { address }
				}
				... on AddressOwner {
					address { address }
				}
			}
		}
	}
`;

interface CapOwnerResponse {
	object: {
		owner: {
			address?: { address: string };
		};
	} | null;
}

const MAX_CACHE_SIZE = 500;
const charIdCache = new Map<string, string>();
const charIdInflight = new Map<string, Promise<string | null>>();

/**
 * Resolve an OwnerCap<Character> key to its Character object ID.
 * The OwnerCap<Character> is owned by (sent to) the Character object,
 * so its Sui-level owner IS the Character object ID.
 */
async function resolveCharacterObjectId(
	client: SuiGraphQLClient,
	ownerCapKey: string,
): Promise<string | null> {
	const cached = charIdCache.get(ownerCapKey);
	if (cached) return cached;

	const inflight = charIdInflight.get(ownerCapKey);
	if (inflight) return inflight;

	const promise = (async (): Promise<string | null> => {
		try {
			const r: { data?: CapOwnerResponse | null } = await client.query({
				query: GET_OWNER_OF_CAP,
				variables: { id: ownerCapKey },
			});

			const charId = r.data?.object?.owner?.address?.address;
			if (charId) {
				charIdCache.set(ownerCapKey, charId);
				evictIfNeeded(charIdCache);
				return charId;
			}
			return null;
		} catch {
			return null;
		} finally {
			charIdInflight.delete(ownerCapKey);
		}
	})();

	charIdInflight.set(ownerCapKey, promise);
	return promise;
}

// ── Character name resolution via OwnerCap -> Character -> metadata ─────────

const FIND_CHAR_BY_CAP = `
	query($type: String!, $cursor: String) {
		objects(filter: { type: $type }, first: 50, after: $cursor) {
			nodes {
				asMoveObject {
					contents {
						json
					}
				}
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

interface CharQueryResponse {
	objects: {
		nodes: Array<{
			asMoveObject?: {
				contents?: {
					json: Record<string, unknown>;
				};
			};
		}>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

const charNameCache = new Map<string, string>();
const charNameInflight = new Map<string, Promise<string | null>>();

/** Evict oldest entries when a cache exceeds MAX_CACHE_SIZE */
function evictIfNeeded(cache: Map<string, string>) {
	if (cache.size <= MAX_CACHE_SIZE) return;
	const excess = cache.size - MAX_CACHE_SIZE;
	const iter = cache.keys();
	for (let i = 0; i < excess; i++) {
		const key = iter.next().value;
		if (key) cache.delete(key);
	}
}

async function resolveCharacterName(
	client: SuiGraphQLClient,
	ownerCapId: string,
): Promise<string | null> {
	const cached = charNameCache.get(ownerCapId);
	if (cached) return cached;

	const inflight = charNameInflight.get(ownerCapId);
	if (inflight) return inflight;

	const promise = (async (): Promise<string | null> => {
		try {
			const worldPkg = getWorldPackageId(getTenant());
			const charType = `${worldPkg}::character::Character`;

			let cursor: string | null = null;
			for (let page = 0; page < 20; page++) {
				const r: { data?: CharQueryResponse | null } = await client.query({
					query: FIND_CHAR_BY_CAP,
					variables: { type: charType, cursor },
				});

				for (const node of r.data?.objects?.nodes ?? []) {
					const json = node.asMoveObject?.contents?.json;
					if (!json) continue;
					const capId = String(json.owner_cap_id ?? "");
					const meta = json.metadata as Record<string, unknown> | undefined;
					const name = String(meta?.name ?? "");
					if (name && capId) {
						charNameCache.set(capId, name);
						evictIfNeeded(charNameCache);
					}
					if (capId === ownerCapId && name) {
						return name;
					}
				}

				const pi: { hasNextPage: boolean; endCursor: string | null } | undefined =
					r.data?.objects?.pageInfo;
				if (!pi?.hasNextPage) break;
				cursor = pi.endCursor;
			}

			return null;
		} catch {
			return null;
		} finally {
			charNameInflight.delete(ownerCapId);
		}
	})();

	charNameInflight.set(ownerCapId, promise);
	return promise;
}

/**
 * Compute the open inventory key for a given SSU object ID.
 * Key = blake2b256(bcs::to_bytes(ssu_id) + b"open_inventory"), then format as 0x-prefixed hex.
 */
function computeOpenInventoryKey(ssuObjectId: string): string {
	const addressBytes = bcs.Address.serialize(ssuObjectId).toBytes();
	const suffix = new TextEncoder().encode("open_inventory");
	const combined = new Uint8Array(addressBytes.length + suffix.length);
	combined.set(addressBytes, 0);
	combined.set(suffix, addressBytes.length);
	const hasher = blake2b.create({ dkLen: 32 });
	hasher.update(combined);
	const hash = hasher.digest();
	const bytes = new Uint8Array(hash);
	return `0x${Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;
}

/**
 * Parse an Inventory struct from its GraphQL JSON representation.
 *
 * Inventory has { max_capacity, used_capacity, items: VecMap<u64, ItemEntry> }.
 * VecMap is serialized as { contents: [ { key, value } ] } in GraphQL JSON.
 * ItemEntry has { tenant, type_id, item_id, volume, quantity }.
 */
function parseInventory(inv: unknown): InventoryData {
	const empty: InventoryData = { maxCapacity: 0, usedCapacity: 0, items: [] };
	if (!inv || typeof inv !== "object") return empty;

	const i = inv as Record<string, unknown>;
	const maxCapacity = Number(i.max_capacity ?? 0);
	const usedCapacity = Number(i.used_capacity ?? 0);

	// Parse VecMap -- GraphQL JSON serializes it as { contents: [{ key, value }] }
	const itemsField = i.items as Record<string, unknown> | undefined;
	if (!itemsField) return { maxCapacity, usedCapacity, items: [] };

	let entries: Array<Record<string, unknown>> = [];

	if (Array.isArray(itemsField)) {
		entries = itemsField as Array<Record<string, unknown>>;
	} else if (typeof itemsField === "object" && "contents" in itemsField) {
		const contents = (itemsField as Record<string, unknown>).contents;
		if (Array.isArray(contents)) {
			entries = contents as Array<Record<string, unknown>>;
		}
	}

	const items: InventoryItem[] = entries.map((entry) => {
		const value = (entry.value ?? entry) as Record<string, unknown>;
		return {
			tenant: String(value.tenant ?? ""),
			typeId: Number(value.type_id ?? entry.key ?? 0),
			itemId: Number(value.item_id ?? 0),
			volume: Number(value.volume ?? 0),
			quantity: Number(value.quantity ?? 0),
			name: "", // resolved after
		};
	});

	return { maxCapacity, usedCapacity, items };
}

/**
 * Normalize an inventory key ID for comparison.
 * GraphQL may return IDs with or without 0x prefix, leading zeros, etc.
 */
export function normalizeId(id: string): string {
	const hex = id.replace(/^0x/i, "").toLowerCase();
	return `0x${hex.padStart(64, "0")}`;
}

/**
 * Fetch all inventories from a StorageUnit via dynamic fields and classify each slot.
 *
 * Inventories are dynamic fields on the SSU keyed by IDs in the `inventory_keys` vector.
 * Classification:
 *   - key == storage_unit.owner_cap_id -> "owner" (SSU owner + extension)
 *   - key == blake2b256(bcs(ssu_id) + "open_inventory") -> "open" (extension-only internal)
 *   - anything else -> "player" (per-player inventory, key = player's OwnerCap ID)
 */
export function useInventory(
	ssuObjectId: string | null | undefined,
	rawJson: Record<string, unknown> | null | undefined,
) {
	const client = useSuiClient();

	// Extract owner_cap_id from the SSU JSON for classification
	const ownerCapId = rawJson ? String(rawJson.owner_cap_id ?? "") : "";
	const openKey = ssuObjectId ? computeOpenInventoryKey(ssuObjectId) : "";

	// Fetch inventory dynamic fields from the SSU
	const inventoryQuery = useQuery({
		queryKey: ["ssu-inventories", ssuObjectId],
		queryFn: async (): Promise<LabeledInventory[]> => {
			if (!ssuObjectId) return [];

			const result = await client.query<DfResponse>({
				query: LIST_INVENTORY_FIELDS,
				variables: { parentId: ssuObjectId, first: 50 },
			});

			const nodes = result.data?.object?.dynamicFields?.nodes ?? [];
			const slots: LabeledInventory[] = [];
			let playerIndex = 0;

			for (const node of nodes) {
				// Only process inventory dynamic fields
				const dfTypeRepr = node.value?.contents?.type?.repr ?? node.value?.type?.repr ?? "";
				if (!dfTypeRepr.includes("::inventory::Inventory")) continue;

				const invJson = node.value?.contents?.json ?? node.value?.json;
				if (!invJson) continue;

				const invData = parseInventory(invJson);

				// The key is the dynamic field name (an ID)
				const keyRaw = String(
					typeof node.name.json === "object" && node.name.json !== null
						? ((node.name.json as Record<string, unknown>).id ??
								(node.name.json as Record<string, unknown>).bytes ??
								JSON.stringify(node.name.json))
						: (node.name.json ?? ""),
				);
				const key = normalizeId(keyRaw);

				// Classify the slot
				let slotType: SlotType;
				let label: string;

				if (ownerCapId && normalizeId(ownerCapId) === key) {
					slotType = "owner";
					label = "Owner Inventory";
				} else if (openKey && normalizeId(openKey) === key) {
					slotType = "open";
					label = "Escrow";
				} else {
					slotType = "player";
					playerIndex++;
					label = `Player ${playerIndex} (${keyRaw.slice(0, 8)}...${keyRaw.slice(-4)})`;
				}

				slots.push({
					...invData,
					key,
					slotType,
					label,
				});
			}

			// Sort: owner first, then open, then player slots
			const order: Record<SlotType, number> = { owner: 0, open: 1, player: 2 };
			slots.sort((a, b) => order[a.slotType] - order[b.slotType]);

			return slots;
		},
		enabled: !!ssuObjectId,
		staleTime: 15_000,
		refetchInterval: 30_000,
	});

	const rawSlots = inventoryQuery.data ?? [];

	// Resolve character names for player inventory slots
	const playerKeys = useMemo(
		() => rawSlots.filter((s) => s.slotType === "player").map((s) => s.key),
		[rawSlots],
	);

	const characterNamesQuery = useQuery({
		queryKey: ["character-names", playerKeys.join(",")],
		queryFn: async (): Promise<Map<string, string>> => {
			const nameMap = new Map<string, string>();
			await Promise.all(
				playerKeys.map(async (ownerCapKey) => {
					const name = await resolveCharacterName(client, ownerCapKey);
					if (name) nameMap.set(ownerCapKey, name);
				}),
			);
			return nameMap;
		},
		enabled: playerKeys.length > 0,
		staleTime: 5 * 60_000,
	});

	// Resolve Character object IDs for player inventory slots
	// (needed for admin -> player market transfers)
	const characterObjectIdsQuery = useQuery({
		queryKey: ["character-object-ids", playerKeys.join(",")],
		queryFn: async (): Promise<Map<string, string>> => {
			const idMap = new Map<string, string>();
			await Promise.all(
				playerKeys.map(async (ownerCapKey) => {
					const charId = await resolveCharacterObjectId(client, ownerCapKey);
					if (charId) idMap.set(ownerCapKey, charId);
				}),
			);
			return idMap;
		},
		enabled: playerKeys.length > 0,
		staleTime: 5 * 60_000,
	});

	// Collect all typeIds for name resolution
	const allTypeIds = useMemo(() => {
		const ids = new Set<number>();
		for (const slot of rawSlots) {
			for (const item of slot.items) {
				ids.add(item.typeId);
			}
		}
		return Array.from(ids);
	}, [rawSlots]);

	// Resolve item names
	const namesQuery = useQuery({
		queryKey: ["itemNames", allTypeIds.sort().join(",")],
		queryFn: () => resolveItemNames(allTypeIds),
		enabled: allTypeIds.length > 0,
		staleTime: 5 * 60_000,
	});

	// Merge item names, character names, and character object IDs into slots
	const inventories = useMemo<SsuInventories | null>(() => {
		if (rawSlots.length === 0 && !inventoryQuery.data) return null;

		const nameMap = namesQuery.data ?? new Map<number, string>();
		const charNameMap = characterNamesQuery.data ?? new Map<string, string>();
		const charIdMap = characterObjectIdsQuery.data ?? new Map<string, string>();

		const slots: LabeledInventory[] = rawSlots.map((slot) => {
			const items = slot.items.map((item) => ({
				...item,
				name: nameMap.get(item.typeId) ?? `Item #${item.typeId}`,
			}));

			let { label } = slot;
			let characterName: string | undefined;
			let characterObjectId: string | undefined;

			if (slot.slotType === "player") {
				characterName = charNameMap.get(slot.key);
				characterObjectId = charIdMap.get(slot.key);
				if (characterName) {
					label = `Player: ${characterName}`;
				}
			}

			return {
				...slot,
				items,
				label,
				characterName,
				characterObjectId,
			};
		});

		// Find the owner inventory for backward compatibility
		const ownerSlot = slots.find((s) => s.slotType === "owner");
		const emptyInventory: InventoryData = { maxCapacity: 0, usedCapacity: 0, items: [] };

		return {
			slots,
			ownerInventory: ownerSlot
				? {
						maxCapacity: ownerSlot.maxCapacity,
						usedCapacity: ownerSlot.usedCapacity,
						items: ownerSlot.items,
					}
				: emptyInventory,
		};
	}, [
		rawSlots,
		namesQuery.data,
		characterNamesQuery.data,
		characterObjectIdsQuery.data,
		inventoryQuery.data,
	]);

	return {
		data: inventories,
		isLoading: inventoryQuery.isLoading || (namesQuery.isLoading && allTypeIds.length > 0),
		refetch: inventoryQuery.refetch,
	};
}
