import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { getObjectJson } from "@tehfrontier/chain-shared";
import { type TenantId, moveType } from "./config";

// ── Types ───────────────────────────────────────────────────────────────────

export interface OwnedAssembly {
	objectId: string;
	type: "turret" | "gate" | "storage_unit" | "smart_storage_unit" | "network_node" | "protocol_depot";
	typeId: number;
	itemId?: string;
	status: string;
	extensionType?: string;
	dappUrl?: string;
	ownerCapId?: string;
	energySourceId?: string;
}

export interface CharacterInfo {
	characterObjectId: string;
	playerProfileId?: string;
	name?: string;
	characterItemId?: string;
	tribeId?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely cast unknown to a record — used for nested JSON objects from GraphQL.
 * GraphQL JSON does NOT wrap in { fields: {} } like JSON-RPC did.
 */
function asRecord(obj: unknown): Record<string, unknown> {
	if (obj && typeof obj === "object" && !Array.isArray(obj)) {
		return obj as Record<string, unknown>;
	}
	return {};
}

/**
 * Extract assembly status from on-chain JSON fields.
 * Handles both old format { current: "online" } and new format { status: { variant: "ONLINE" } }.
 * GraphQL JSON returns nested objects directly (no { fields } wrapping).
 */
function extractStatus(statusObj: unknown): string {
	const fields = asRecord(statusObj);
	// New format: { status: { "@variant": "ONLINE" } }
	const innerStatus = asRecord(fields.status);
	if (innerStatus["@variant"]) return String(innerStatus["@variant"]).toLowerCase();
	if (innerStatus.variant) return String(innerStatus.variant).toLowerCase();
	// Direct enum: { "@variant": "ONLINE" }
	if (fields["@variant"]) return String(fields["@variant"]).toLowerCase();
	if (fields.variant) return String(fields.variant).toLowerCase();
	// Old format: { current: "online" }
	if (fields.current) return String(fields.current);
	return "unknown";
}

function parseAssemblyType(typeStr: string): "turret" | "gate" | "storage_unit" | "network_node" | null {
	if (typeStr.includes("::turret::Turret")) return "turret";
	if (typeStr.includes("::gate::Gate")) return "gate";
	if (typeStr.includes("::storage_unit::StorageUnit")) return "storage_unit";
	if (typeStr.includes("::network_node::NetworkNode")) return "network_node";
	return null;
}

// ── Discovery Queries ───────────────────────────────────────────────────────

/**
 * Discover all OwnerCaps owned by a wallet address.
 * OwnerCap<T> objects are transferred to the Character (a shared object),
 * but during initial discovery we check wallet-owned objects first.
 */
export async function getOwnedObjectsByType(
	client: SuiGraphQLClient,
	address: string,
	type: string,
): Promise<Array<{ objectId: string; type: string; json: Record<string, unknown> | null }>> {
	const results: Array<{ objectId: string; type: string; json: Record<string, unknown> | null }> = [];
	let cursor: string | null | undefined;

	do {
		const page = await client.listOwnedObjects({
			owner: address,
			type,
			include: { json: true },
			cursor: cursor ?? undefined,
		});

		for (const obj of page.objects) {
			results.push({
				objectId: obj.objectId,
				type: obj.type ?? "",
				json: obj.json ?? null,
			});
		}

		cursor = page.hasNextPage ? page.cursor : null;
	} while (cursor);

	return results;
}

/**
 * Discover character and assemblies for a connected wallet.
 */
export async function discoverCharacterAndAssemblies(
	client: SuiGraphQLClient,
	walletAddress: string,
	tenant: TenantId,
): Promise<{ character: CharacterInfo | null; assemblies: OwnedAssembly[] }> {
	// Find PlayerProfile owned by wallet
	const profileType = moveType(tenant, "character", "PlayerProfile");
	const profiles = await getOwnedObjectsByType(client, walletAddress, profileType);

	let character: CharacterInfo | null = null;

	if (profiles.length > 0) {
		const profileFields = profiles[0].json ?? {};
		const characterId = profileFields.character_id as string | undefined;

		if (characterId) {
			// Fetch Character object (shared) to get name, tribe, and OwnerCaps
			try {
				const charResult = await getObjectJson(client, characterId);
				const charFields = charResult.json ?? {};
				const metadataFields = asRecord(charFields.metadata);
				const keyFields = asRecord(charFields.key);
				character = {
					characterObjectId: characterId,
					playerProfileId: profiles[0].objectId,
					name: (metadataFields.name as string | undefined) ?? (charFields.name as string | undefined),
					characterItemId: keyFields.item_id ? String(keyFields.item_id) : undefined,
					tribeId: charFields.tribe_id != null ? Number(charFields.tribe_id) : undefined,
				};
			} catch {
				character = {
					characterObjectId: characterId,
					playerProfileId: profiles[0].objectId,
				};
			}
		}
	}

	// Find assemblies: look for OwnerCap objects owned by the wallet
	// (OwnerCaps may be on the wallet or inside the Character keychain)
	const assemblies: OwnedAssembly[] = [];

	// Check for each assembly type's OwnerCap
	const assemblyTypes = [
		{ kind: "turret" as const, module: "turret", type: "Turret" },
		{ kind: "gate" as const, module: "gate", type: "Gate" },
		{ kind: "storage_unit" as const, module: "storage_unit", type: "StorageUnit" },
		{ kind: "network_node" as const, module: "network_node", type: "NetworkNode" },
	];

	for (const at of assemblyTypes) {
		// Try both module names: "access" (Utopia) and "access_control" (Stillness)
		const capTypeAccess = `${moveType(tenant, "access", "OwnerCap")}<${moveType(tenant, at.module, at.type)}>`;
		const capTypeAccessControl = `${moveType(tenant, "access_control", "OwnerCap")}<${moveType(tenant, at.module, at.type)}>`;
		const capsAccess = await getOwnedObjectsByType(client, walletAddress, capTypeAccess);
		const capsControl = await getOwnedObjectsByType(client, walletAddress, capTypeAccessControl);
		const caps = [...capsAccess, ...capsControl];

		for (const cap of caps) {
			const capFields = cap.json ?? {};
			const assemblyId = capFields.authorized_object_id as string | undefined;

			if (assemblyId) {
				try {
					const assemblyResult = await getObjectJson(client, assemblyId);
					const assemblyFields = assemblyResult.json ?? {};
					const keyObj = assemblyFields.key as Record<string, unknown> | undefined;
					const metaObj = assemblyFields.metadata as Record<string, unknown> | undefined;
					assemblies.push({
						objectId: assemblyId,
						type: at.kind,
						typeId: Number(assemblyFields.type_id) || 0,
						itemId: keyObj?.item_id ? String(keyObj.item_id) : undefined,
						status: extractStatus(assemblyFields.status),
						extensionType: assemblyFields.extension
							? String(assemblyFields.extension)
							: undefined,
						dappUrl: metaObj?.url ? String(metaObj.url) : undefined,
						ownerCapId: cap.objectId,
						energySourceId: assemblyFields.energy_source_id
							? String(assemblyFields.energy_source_id)
							: undefined,
					});
				} catch {
					assemblies.push({
						objectId: assemblyId,
						type: at.kind,
						typeId: 0,
						status: "unknown",
						ownerCapId: cap.objectId,
						energySourceId: undefined,
					});
				}
			}
		}
	}

	// If character exists, look for OwnerCaps owned by the Character object.
	// On Utopia (and potentially other tenants), OwnerCaps are transferred to the
	// Character's address rather than stored as dynamic fields.
	if (character) {
		try {
			let cursor: string | null | undefined;
			do {
				const page = await client.listOwnedObjects({
					owner: character.characterObjectId,
					include: { json: true },
					cursor: cursor ?? undefined,
				});

				for (const obj of page.objects) {
					const itemType = obj.type ?? "";
					if (!itemType.includes("OwnerCap")) continue;

					const assemblyKind = parseAssemblyType(itemType);
					if (!assemblyKind) continue;

					const capFields = obj.json ?? {};
					const assemblyId = capFields.authorized_object_id as string | undefined;
					if (!assemblyId) continue;

					// Skip if already discovered via wallet ownership
					if (assemblies.find((a) => a.objectId === assemblyId)) continue;

					try {
						const assemblyResult = await getObjectJson(client, assemblyId);
						const assemblyFields = assemblyResult.json ?? {};
						const keyObj2 = assemblyFields.key as Record<string, unknown> | undefined;
						const metaObj2 = assemblyFields.metadata as Record<string, unknown> | undefined;

						assemblies.push({
							objectId: assemblyId,
							type: assemblyKind,
							typeId: Number(assemblyFields.type_id) || 0,
							itemId: keyObj2?.item_id ? String(keyObj2.item_id) : undefined,
							status: extractStatus(assemblyFields.status),
							extensionType: assemblyFields.extension
								? String(assemblyFields.extension)
								: undefined,
							dappUrl: metaObj2?.url ? String(metaObj2.url) : undefined,
							ownerCapId: obj.objectId,
							energySourceId: assemblyFields.energy_source_id
								? String(assemblyFields.energy_source_id)
								: undefined,
						});
					} catch {
						assemblies.push({
							objectId: assemblyId,
							type: assemblyKind,
							typeId: 0,
							status: "unknown",
							ownerCapId: obj.objectId,
							energySourceId: undefined,
						});
					}
				}

				cursor = page.hasNextPage ? page.cursor : null;
			} while (cursor);
		} catch {
			// Character may not have owned objects
		}
	}

	return { character, assemblies };
}

/**
 * Check what extension is authorized on an assembly.
 */
export async function getAssemblyExtension(
	client: SuiGraphQLClient,
	assemblyId: string,
): Promise<string | null> {
	try {
		const result = await getObjectJson(client, assemblyId);
		const fields = result.json ?? {};
		if (fields.extension) {
			return String(fields.extension);
		}
		return null;
	} catch {
		return null;
	}
}
