import { useQuery } from "@tanstack/react-query";
import { getObjectJson } from "@tehfrontier/chain-shared";
import { useSuiClient } from "./useSuiClient";

/** Parsed metadata from the SSU object */
export interface AssemblyMetadata {
	name: string;
	description: string;
	url: string;
}

/** Parsed SSU assembly data */
export interface AssemblyData {
	objectId: string;
	typeId: number;
	itemId: string | null;
	status: string;
	isOnline: boolean;
	ownerCapId: string;
	energySourceId: string | null;
	extensionType: string | null;
	metadata: AssemblyMetadata | null;
	/** Dynamic field keys for inventories */
	inventoryKeys: string[];
	/** Raw JSON fields */
	rawJson: Record<string, unknown>;
}

/**
 * Parse the assembly status from GraphQL JSON.
 * AssemblyStatus is an enum with variants: { Online: true } or { Offline: true }
 */
function parseStatus(status: unknown): { label: string; isOnline: boolean } {
	if (!status || typeof status !== "object") {
		return { label: "Unknown", isOnline: false };
	}

	const s = status as Record<string, unknown>;

	// On-chain format: { status: { "@variant": "ONLINE" } }
	const inner = s.status as Record<string, unknown> | undefined;
	if (inner && typeof inner === "object") {
		const variant = String(inner["@variant"] ?? inner.variant ?? "").toLowerCase();
		if (variant === "online") return { label: "Online", isOnline: true };
		if (variant === "offline") return { label: "Offline", isOnline: false };
	}

	// Direct enum: { "@variant": "ONLINE" }
	const directVariant = String(s["@variant"] ?? s.variant ?? "").toLowerCase();
	if (directVariant === "online") return { label: "Online", isOnline: true };
	if (directVariant === "offline") return { label: "Offline", isOnline: false };

	return { label: "Unknown", isOnline: false };
}

/** Parse metadata from the JSON fields */
function parseMetadata(metadata: unknown): AssemblyMetadata | null {
	if (!metadata || typeof metadata !== "object") return null;

	const m = metadata as Record<string, unknown>;

	// Handle Option<Metadata> — could be wrapped in { Some: { ... } } or direct fields
	const inner = (m.Some ?? m.some ?? m.fields ?? m) as Record<string, unknown>;
	if (!inner || typeof inner !== "object") return null;

	return {
		name: String(inner.name ?? ""),
		description: String(inner.description ?? ""),
		url: String(inner.url ?? ""),
	};
}

/** Parse Option<ID> field — returns the inner ID string or null.
 *  Sui GraphQL JSON may represent this as: a plain string, an array, or { Some/vec: ... }. */
function parseOptionId(value: unknown): string | null {
	if (!value) return null;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
	if (typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	const inner = v.Some ?? v.some ?? v.vec;
	if (inner != null) return parseOptionId(inner);
	return null;
}

/** Parse Option<TypeName> — returns the type string or null.
 *  GraphQL JSON represents TypeName as { name: "pkg::module::Type" }. */
function parseExtension(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	// Direct TypeName: { name: "pkg::module::Type" }
	if (typeof v.name === "string") return v.name;
	// Option wrapper: { Some: ... } or { vec: [...] }
	const inner = v.Some ?? v.some ?? v.vec;
	if (Array.isArray(inner)) return inner.length > 0 ? String(inner[0]) : null;
	if (inner && typeof inner === "object") {
		const t = inner as Record<string, unknown>;
		return String(t.name ?? t.module_name ?? inner);
	}
	if (inner) return String(inner);
	return null;
}

/**
 * Fetch a StorageUnit object and parse its fields.
 * Uses getObjectJson from chain-shared (GraphQL-based).
 */
export function useAssembly(objectId: string | null) {
	const client = useSuiClient();

	return useQuery({
		queryKey: ["assembly", objectId],
		queryFn: async (): Promise<AssemblyData | null> => {
			if (!objectId) return null;

			const result = await getObjectJson(client, objectId);
			if (!result.json) return null;

			const json = result.json;
			const { label, isOnline } = parseStatus(json.status);

			// Extract inventory_keys — array of dynamic field key IDs
			const inventoryKeys: string[] = [];
			if (Array.isArray(json.inventory_keys)) {
				for (const k of json.inventory_keys) {
					if (typeof k === "string") inventoryKeys.push(k);
				}
			}

			// Extract item_id from TenantItemId if present
			const itemId = json.item_id ? String(json.item_id) : null;

			return {
				objectId,
				typeId: Number(json.type_id ?? 0),
				itemId,
				status: label,
				isOnline,
				ownerCapId: String(json.owner_cap_id ?? ""),
				energySourceId: parseOptionId(json.energy_source_id),
				extensionType: parseExtension(json.extension),
				metadata: parseMetadata(json.metadata),
				inventoryKeys,
				rawJson: json,
			};
		},
		enabled: !!objectId,
		staleTime: 15_000,
		refetchInterval: 30_000,
	});
}
