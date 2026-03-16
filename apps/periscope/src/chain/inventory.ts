import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { getObjectJson, listDynamicFieldsGql } from "@tehfrontier/chain-shared";

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
 *
 * With GraphQL, dynamic field listing returns name/type info but not the full
 * child object content. We use listDynamicFieldsGql to enumerate, then
 * getObjectJson on each inventory field to get contents.
 */
export async function fetchAssemblyInventory(
	client: SuiGraphQLClient,
	assemblyId: string,
	assemblyType: string,
): Promise<AssemblyInventory[]> {
	const inventories: AssemblyInventory[] = [];

	try {
		// Get dynamic fields on the assembly
		const dfs = await listDynamicFieldsGql(client, assemblyId, { limit: 50 });

		// For each dynamic field that looks like an inventory, we need to fetch
		// the object and parse it. Since listDynamicFieldsGql only returns name info,
		// we use a custom GraphQL query to get the full object at each dynamic field.
		// We'll use the parent object's dynamic field query to get inventory data.

		// Use a custom GraphQL query to list dynamic fields with their child object content
		const query = `
			query($parentId: SuiAddress!, $first: Int) {
				object(address: $parentId) {
					dynamicFields(first: $first) {
						nodes {
							name { json type { repr } }
							value {
								... on MoveObject {
									address
									asMoveObject {
										contents { json type { repr } }
									}
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
				asMoveObject?: {
					contents?: {
						json: Record<string, unknown>;
						type: { repr: string };
					};
				};
			};
		}

		interface DfResponse {
			object: {
				dynamicFields: {
					nodes: DfNode[];
				};
			} | null;
		}

		const result = await client.query<DfResponse>({
			query,
			variables: { parentId: assemblyId, first: 50 },
		});

		const nodes = result.data?.object?.dynamicFields?.nodes ?? [];

		for (const node of nodes) {
			const dfTypeRepr = node.value?.asMoveObject?.contents?.type?.repr ?? "";
			if (!dfTypeRepr.includes("::inventory::Inventory")) continue;

			const dfAddress = node.value?.address;
			if (!dfAddress) continue;

			try {
				const invJson = node.value?.asMoveObject?.contents?.json;
				if (!invJson) continue;

				// With GraphQL JSON, the value field is the inventory struct directly
				// (no wrapping in { fields: {} })
				const invFields = (invJson as Record<string, unknown>).value as
					| Record<string, unknown>
					| undefined;
				const inv = invFields ?? (invJson as Record<string, unknown>);

				const itemsMap = inv.items as
					| { contents?: Array<{ key: string; value: unknown }> }
					| undefined;
				const contents = itemsMap?.contents ?? [];

				const items: InventoryItem[] = contents.map((entry) => {
					const key = Number(entry.key);
					const val = entry.value as { quantity?: string } | undefined;
					const quantity = Number(val?.quantity ?? 0);
					return { typeId: key, quantity };
				});

				const maxCapacity = Number(inv.max_capacity ?? 0);
				const usedCapacity = Number(inv.used_capacity ?? 0);

				inventories.push({
					assemblyId,
					assemblyType,
					inventoryId: dfAddress,
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
