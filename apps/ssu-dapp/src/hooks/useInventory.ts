import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveItemNames } from "@/lib/items";

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

/** All three inventories from a StorageUnit */
export interface SsuInventories {
	extensionInventory: InventoryData;
	ownerInventory: InventoryData;
	openInventory: InventoryData;
}

/**
 * Parse an Inventory struct from the SSU JSON.
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

	// Parse VecMap — GraphQL JSON serializes it as { contents: [{ key, value }] }
	const itemsField = i.items as Record<string, unknown> | undefined;
	if (!itemsField) return { maxCapacity, usedCapacity, items: [] };

	let entries: Array<Record<string, unknown>> = [];

	if (Array.isArray(itemsField)) {
		// Direct array of entries
		entries = itemsField as Array<Record<string, unknown>>;
	} else if (typeof itemsField === "object" && "contents" in itemsField) {
		// VecMap { contents: [...] }
		const contents = (itemsField as Record<string, unknown>).contents;
		if (Array.isArray(contents)) {
			entries = contents as Array<Record<string, unknown>>;
		}
	}

	const items: InventoryItem[] = entries.map((entry) => {
		// VecMap entries have { key, value } where value is the ItemEntry
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
 * Parse all three inventories from SSU raw JSON and resolve item names.
 * Inventory items are stored inline as VecMap — no dynamic field enumeration needed.
 */
export function useInventory(rawJson: Record<string, unknown> | null | undefined) {
	const parsedInventories = useMemo<SsuInventories | null>(() => {
		if (!rawJson) return null;

		return {
			extensionInventory: parseInventory(rawJson.inventory),
			ownerInventory: parseInventory(rawJson.owner_inventory),
			openInventory: parseInventory(rawJson.open_inventory),
		};
	}, [rawJson]);

	// Collect all unique typeIds across all inventories for name resolution
	const allTypeIds = useMemo(() => {
		if (!parsedInventories) return [];
		const ids = new Set<number>();
		for (const inv of [
			parsedInventories.extensionInventory,
			parsedInventories.ownerInventory,
			parsedInventories.openInventory,
		]) {
			for (const item of inv.items) {
				ids.add(item.typeId);
			}
		}
		return Array.from(ids);
	}, [parsedInventories]);

	// Resolve item names
	const namesQuery = useQuery({
		queryKey: ["itemNames", allTypeIds.sort().join(",")],
		queryFn: () => resolveItemNames(allTypeIds),
		enabled: allTypeIds.length > 0,
		staleTime: 5 * 60_000, // names rarely change
	});

	// Merge names into inventory items
	const inventories = useMemo<SsuInventories | null>(() => {
		if (!parsedInventories) return null;
		const nameMap = namesQuery.data ?? new Map<number, string>();

		function applyNames(inv: InventoryData): InventoryData {
			return {
				...inv,
				items: inv.items.map((item) => ({
					...item,
					name: nameMap.get(item.typeId) ?? `Item #${item.typeId}`,
				})),
			};
		}

		return {
			extensionInventory: applyNames(parsedInventories.extensionInventory),
			ownerInventory: applyNames(parsedInventories.ownerInventory),
			openInventory: applyNames(parsedInventories.openInventory),
		};
	}, [parsedInventories, namesQuery.data]);

	return {
		data: inventories,
		isLoading: namesQuery.isLoading && allTypeIds.length > 0,
	};
}
