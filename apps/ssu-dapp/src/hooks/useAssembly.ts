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
	status: string;
	isOnline: boolean;
	ownerCapId: string;
	energySourceId: string | null;
	extensionType: string | null;
	metadata: AssemblyMetadata | null;
	/** Raw JSON fields for inventory parsing */
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

	// GraphQL returns enum variants as objects with the variant name as key
	if ("Online" in s || "online" in s) {
		return { label: "Online", isOnline: true };
	}
	if ("Offline" in s || "offline" in s) {
		return { label: "Offline", isOnline: false };
	}

	// Fallback: check for string representation
	const str = String(status);
	if (str.toLowerCase().includes("online")) {
		return { label: "Online", isOnline: true };
	}

	return { label: "Offline", isOnline: false };
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

/** Parse Option<ID> field — returns the inner ID string or null */
function parseOptionId(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	const inner = v.Some ?? v.some ?? v.vec;
	if (Array.isArray(inner)) return inner.length > 0 ? String(inner[0]) : null;
	if (inner) return String(inner);
	return null;
}

/** Parse Option<TypeName> — returns the type string or null */
function parseExtension(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
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

			return {
				objectId,
				typeId: Number(json.type_id ?? 0),
				status: label,
				isOnline,
				ownerCapId: String(json.owner_cap_id ?? ""),
				energySourceId: parseOptionId(json.energy_source_id),
				extensionType: parseExtension(json.extension),
				metadata: parseMetadata(json.metadata),
				rawJson: json,
			};
		},
		enabled: !!objectId,
		staleTime: 15_000,
		refetchInterval: 30_000,
	});
}
