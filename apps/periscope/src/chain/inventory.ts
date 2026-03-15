import type { SuiClient } from "@mysten/sui/client";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InventoryItem {
	typeId: number;
	quantity: number;
}

export interface AssemblyInventory {
	assemblyId: string;
	assemblyType: string;
	inventoryId: string;
	items: InventoryItem[];
	maxCapacity: number;
	usedCapacity: number;
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch all inventory contents for a storage unit.
 * Storage units have inventory dynamic fields keyed by OwnerCap IDs.
 */
export async function fetchAssemblyInventory(
	client: SuiClient,
	assemblyId: string,
	assemblyType: string,
): Promise<AssemblyInventory[]> {
	const inventories: AssemblyInventory[] = [];

	try {
		// Get dynamic fields on the assembly
		const dfs = await client.getDynamicFields({ parentId: assemblyId, limit: 50 });

		for (const df of dfs.data) {
			const dfType = df.objectType ?? "";
			if (!dfType.includes("::inventory::Inventory")) continue;

			try {
				const obj = await client.getObject({
					id: df.objectId,
					options: { showContent: true },
				});

				const content = obj.data?.content;
				const fields = (content && "fields" in content ? content.fields : undefined) as Record<string, unknown> | undefined;
				const value = fields?.value as Record<string, unknown> | undefined;
				const invFields = (value?.fields ?? value) as Record<string, unknown> | undefined;

				if (!invFields) continue;

				const itemsMap = invFields.items as { fields?: { contents?: Array<{ fields: { key: string; value: unknown } }> } } | undefined;
				const contents = itemsMap?.fields?.contents ?? [];

				const items: InventoryItem[] = contents.map((entry) => {
					const key = Number(entry.fields.key);
					const val = entry.fields.value as { fields?: { quantity?: string } } | undefined;
					const quantity = Number(val?.fields?.quantity ?? 0);
					return { typeId: key, quantity };
				});

				const maxCapacity = Number(invFields.max_capacity ?? 0);
				const usedCapacity = Number(invFields.used_capacity ?? 0);

				inventories.push({
					assemblyId,
					assemblyType,
					inventoryId: df.objectId,
					items,
					maxCapacity,
					usedCapacity,
				});
			} catch {
				// Skip unreadable inventories
			}
		}
	} catch {
		// Assembly may not have dynamic fields
	}

	return inventories;
}
