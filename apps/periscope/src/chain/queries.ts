import type { SuiClient } from "@mysten/sui/client";
import { type TenantId, moveType } from "./config";

// ── Types ───────────────────────────────────────────────────────────────────

export interface OwnedAssembly {
	objectId: string;
	type: "turret" | "gate" | "storage_unit" | "network_node";
	typeId: number;
	status: string;
	extensionType?: string;
	ownerCapId?: string;
}

export interface CharacterInfo {
	characterObjectId: string;
	playerProfileId?: string;
	name?: string;
	characterItemId?: string;
	tribeId?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractFields(content: unknown): Record<string, unknown> {
	const c = content as { fields?: Record<string, unknown> };
	return c?.fields ?? {};
}

/**
 * Extract assembly status from on-chain fields.
 * Handles both old format { current: "online" } and new format { status: { variant: "ONLINE" } }.
 */
function extractStatus(statusObj: unknown): string {
	const fields = extractFields(statusObj);
	// New format: status.status.variant (e.g., { status: { variant: "ONLINE" } })
	const innerStatus = fields.status as { variant?: string } | undefined;
	if (innerStatus?.variant) return innerStatus.variant.toLowerCase();
	// Old format: status.current
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
	client: SuiClient,
	address: string,
	type: string,
): Promise<Array<{ objectId: string; type: string; content: unknown }>> {
	const results: Array<{ objectId: string; type: string; content: unknown }> = [];
	let cursor: string | null | undefined;

	do {
		const page = await client.getOwnedObjects({
			owner: address,
			filter: { StructType: type },
			options: { showContent: true, showType: true },
			cursor,
		});

		for (const item of page.data) {
			if (item.data) {
				results.push({
					objectId: item.data.objectId,
					type: item.data.type ?? "",
					content: item.data.content,
				});
			}
		}

		cursor = page.hasNextPage ? page.nextCursor : null;
	} while (cursor);

	return results;
}

/**
 * Discover character and assemblies for a connected wallet.
 */
export async function discoverCharacterAndAssemblies(
	client: SuiClient,
	walletAddress: string,
	tenant: TenantId,
): Promise<{ character: CharacterInfo | null; assemblies: OwnedAssembly[] }> {
	// Find PlayerProfile owned by wallet
	const profileType = moveType(tenant, "character", "PlayerProfile");
	const profiles = await getOwnedObjectsByType(client, walletAddress, profileType);

	let character: CharacterInfo | null = null;

	if (profiles.length > 0) {
		const profileFields = extractFields(profiles[0].content);
		const characterId = profileFields.character_id as string | undefined;

		if (characterId) {
			// Fetch Character object (shared) to get name, tribe, and OwnerCaps
			try {
				const charObj = await client.getObject({
					id: characterId,
					options: { showContent: true },
				});
				const charFields = extractFields(charObj.data?.content);
				const metadataFields = extractFields(charFields.metadata);
				const keyFields = extractFields(charFields.key);
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
			const capFields = extractFields(cap.content);
			const assemblyId = capFields.authorized_object_id as string | undefined;

			if (assemblyId) {
				try {
					const assemblyObj = await client.getObject({
						id: assemblyId,
						options: { showContent: true, showType: true },
					});
					const assemblyFields = extractFields(assemblyObj.data?.content);
					assemblies.push({
						objectId: assemblyId,
						type: at.kind,
						typeId: Number(assemblyFields.type_id) || 0,
						status: extractStatus(assemblyFields.status),
						extensionType: assemblyFields.extension
							? String(assemblyFields.extension)
							: undefined,
						ownerCapId: cap.objectId,
					});
				} catch {
					assemblies.push({
						objectId: assemblyId,
						type: at.kind,
						typeId: 0,
						status: "unknown",
						ownerCapId: cap.objectId,
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
				const page = await client.getOwnedObjects({
					owner: character.characterObjectId,
					options: { showType: true, showContent: true },
					cursor,
				});

				for (const item of page.data) {
					const itemType = item.data?.type ?? "";
					if (!itemType.includes("OwnerCap")) continue;

					const assemblyKind = parseAssemblyType(itemType);
					if (!assemblyKind) continue;

					const capFields = extractFields(item.data?.content);
					const assemblyId = capFields.authorized_object_id as string | undefined;
					if (!assemblyId) continue;

					// Skip if already discovered via wallet ownership
					if (assemblies.find((a) => a.objectId === assemblyId)) continue;

					try {
						const assemblyObj = await client.getObject({
							id: assemblyId,
							options: { showContent: true, showType: true },
						});
						const assemblyFields = extractFields(assemblyObj.data?.content);

						assemblies.push({
							objectId: assemblyId,
							type: assemblyKind,
							typeId: Number(assemblyFields.type_id) || 0,
							status: extractStatus(assemblyFields.status),
							extensionType: assemblyFields.extension
								? String(assemblyFields.extension)
								: undefined,
							ownerCapId: item.data!.objectId,
						});
					} catch {
						assemblies.push({
							objectId: assemblyId,
							type: assemblyKind,
							typeId: 0,
							status: "unknown",
							ownerCapId: item.data!.objectId,
						});
					}
				}

				cursor = page.hasNextPage ? page.nextCursor : null;
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
	client: SuiClient,
	assemblyId: string,
): Promise<string | null> {
	try {
		const obj = await client.getObject({
			id: assemblyId,
			options: { showContent: true },
		});
		const fields = extractFields(obj.data?.content);
		if (fields.extension) {
			return String(fields.extension);
		}
		return null;
	} catch {
		return null;
	}
}
