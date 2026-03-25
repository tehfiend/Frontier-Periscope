import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { getObjectJson, listDynamicFieldsGql } from "@tehfrontier/chain-shared";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InventoryItem {
	typeId: number;
	quantity: number;
}

export type InventoryKind = "owner" | "extension";

export interface AssemblyInventory {
	assemblyId: string;
	assemblyType: string;
	inventoryId: string;
	items: InventoryItem[];
	maxCapacity: number;
	usedCapacity: number;
	kind: InventoryKind;
	label: string;
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
				// MoveObject variant
				address?: string;
				contents?: {
					json: Record<string, unknown>;
					type: { repr: string };
				};
				// MoveValue variant
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

		const result = await client.query<DfResponse>({
			query,
			variables: { parentId: assemblyId, first: 50 },
		});

		const nodes = result.data?.object?.dynamicFields?.nodes ?? [];

		for (const node of nodes) {
			// Handle both MoveObject (contents.type) and MoveValue (type) variants
			const dfTypeRepr =
				node.value?.contents?.type?.repr ?? node.value?.type?.repr ?? "";
			if (!dfTypeRepr.includes("::inventory::Inventory")) continue;

			const dfAddress = node.value?.address ?? String(node.name?.json ?? "");

			// Determine inventory kind from the dynamic field key type
			const keyTypeRepr = node.name?.type?.repr ?? "";
			// Owner inventories are keyed by "address" or "sui::object::ID"
			// Extension inventories are keyed by phantom auth types (e.g. MarketAuth)
			const kind: InventoryKind =
				keyTypeRepr === "address" || keyTypeRepr.includes("::object::ID")
					? "owner"
					: "extension";
			// Extract a short label from the key type
			const label =
				kind === "owner"
					? "Owner"
					: keyTypeRepr.split("::").pop() ?? "Extension";

			try {
				// MoveObject: json is in contents.json; MoveValue: json is directly on value
				const invJson = node.value?.contents?.json ?? node.value?.json;
				if (!invJson) continue;

				const inv = invJson as Record<string, unknown>;

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
					kind,
					label,
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
