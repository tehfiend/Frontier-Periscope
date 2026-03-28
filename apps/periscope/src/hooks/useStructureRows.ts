import { type TenantId, getTemplate } from "@/chain/config";
import { db, notDeleted } from "@/db";
import type { StructureExtensionConfig } from "@/db/types";
import type { StructureRow } from "@/views/Deployables";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

/**
 * Hook that produces a deduplicated, optionally filtered array of StructureRows
 * from deployables + assemblies tables.
 *
 * When `showAll` is true, all non-deleted structures are returned.
 * When `showAll` is false (default), only structures matching at least one of
 * these criteria are included:
 *   - Owned: owner matches one of the active character addresses
 *   - Sonar-targeted: objectId appears as assemblyId in sonarEvents
 *   - Registry: owner (resolved via manifestCharacters) has standings entries
 *     in subscribed registries
 */
export function useStructureRows({
	activeAddresses,
	tenant,
	showAll,
}: {
	activeAddresses: string[];
	tenant: string;
	showAll: boolean;
}) {
	// ── DB Queries ─────────────────────────────────────────────────────────
	const deployables = useLiveQuery(() => db.deployables.filter(notDeleted).toArray(), []);
	const assemblies = useLiveQuery(() => db.assemblies.filter(notDeleted).toArray(), []);
	const players = useLiveQuery(() => db.players.filter(notDeleted).toArray(), []);
	const extensions = useLiveQuery(() => db.extensions.filter(notDeleted).toArray(), []);
	const structureExtensionConfigs = useLiveQuery(() => db.structureExtensionConfigs.toArray(), []);
	const manifestChars = useLiveQuery(() => db.manifestCharacters.toArray(), []) ?? [];

	// Sonar assembly IDs (all time) -- for the "sonar-targeted" filter
	const sonarAssemblyIds = useLiveQuery(async () => {
		const events = await db.sonarEvents.toArray();
		const ids = new Set<string>();
		for (const e of events) {
			if (e.assemblyId) ids.add(e.assemblyId);
		}
		return ids;
	}, []);

	// Subscribed registries + standings for the "registry" filter
	const subscribedRegistries = useLiveQuery(() => db.subscribedRegistries.toArray(), []);
	const registryStandings = useLiveQuery(() => db.registryStandings.toArray(), []);

	// ── Owner Name Lookup ──────────────────────────────────────────────────
	const ownerNames = useMemo(() => {
		const map = new Map<string, string>();
		for (const mc of manifestChars) {
			if (mc.name && mc.suiAddress) map.set(mc.suiAddress, mc.name);
		}
		for (const p of players ?? []) {
			map.set(p.address, p.name);
		}
		return map;
	}, [players, manifestChars]);

	// ── Extension Lookup ───────────────────────────────────────────────────
	const extensionByAssembly = useMemo(() => {
		// Build a lookup for published turret package IDs from extension configs
		const configByAssembly = new Map<string, StructureExtensionConfig>();
		for (const cfg of structureExtensionConfigs ?? []) {
			configByAssembly.set(cfg.assemblyId, cfg);
		}

		const map = new Map<string, string>();
		for (const ext of extensions ?? []) {
			const tmpl = getTemplate(ext.templateId);
			if (!tmpl) continue;
			const pkgId = tmpl.packageIds[tenant as TenantId];
			if (pkgId) {
				map.set(ext.assemblyId, `${pkgId}::${tmpl.witnessType}`);
			} else {
				// Turret template has empty packageIds -- check for user-published package
				const cfg = configByAssembly.get(ext.assemblyId);
				if (cfg?.publishedPackageId) {
					map.set(ext.assemblyId, `${cfg.publishedPackageId}::${tmpl.witnessType}`);
				}
			}
		}
		return map;
	}, [extensions, structureExtensionConfigs, tenant]);

	// ── Build addresses set for ownership checks ──────────────────────────
	const addressSet = useMemo(() => new Set(activeAddresses), [activeAddresses]);

	// ── Registry-matched addresses ────────────────────────────────────────
	// Build a set of Sui addresses that appear in any subscribed registry
	const registryMatchedAddresses = useMemo(() => {
		const matched = new Set<string>();
		if (!subscribedRegistries?.length || !registryStandings?.length) return matched;

		const subscribedIds = new Set(subscribedRegistries.map((r) => r.id));

		// Collect characterIds and tribeIds from registry standings
		const matchedCharIds = new Set<number>();
		const matchedTribeIds = new Set<number>();
		for (const rs of registryStandings) {
			if (!subscribedIds.has(rs.registryId)) continue;
			if (rs.kind === "character" && rs.characterId != null) {
				matchedCharIds.add(rs.characterId);
			}
			if (rs.kind === "tribe" && rs.tribeId != null) {
				matchedTribeIds.add(rs.tribeId);
			}
		}

		// Resolve addresses from manifest characters
		// characterItemId is stored as a decimal string from chain sync; convert to number for
		// registry standing lookup. NaN from invalid values safely fails the Set.has() check.
		for (const mc of manifestChars) {
			const charItemId = Number(mc.characterItemId);
			if (
				(!Number.isNaN(charItemId) && matchedCharIds.has(charItemId)) ||
				(mc.tribeId && matchedTribeIds.has(mc.tribeId))
			) {
				if (mc.suiAddress) matched.add(mc.suiAddress);
			}
		}

		return matched;
	}, [subscribedRegistries, registryStandings, manifestChars]);

	// ── Merge + Filter Rows ────────────────────────────────────────────────
	const data: StructureRow[] = useMemo(() => {
		const seenObjectIds = new Set<string>();
		const rows: StructureRow[] = [];

		// Owned deployables first
		for (const d of deployables ?? []) {
			seenObjectIds.add(d.objectId);
			const isMine = d.owner ? addressSet.has(d.owner) : false;

			rows.push({
				id: d.id,
				objectId: d.objectId,
				ownership: isMine ? "mine" : "watched",
				assemblyType: d.assemblyType,
				status: d.status,
				label: d.label || d.assemblyType,
				owner: d.owner ?? activeAddresses[0] ?? "",
				ownerName: d.owner ? ownerNames.get(d.owner) : undefined,
				systemId: d.systemId,
				lPoint: d.lPoint,
				fuelLevel: d.fuelLevel,
				fuelExpiresAt: d.fuelExpiresAt,
				notes: d.notes,
				tags: d.tags,
				source: "deployables",
				itemId: d.itemId,
				dappUrl: d.dappUrl,
				ownerCapId: d.ownerCapId,
				assemblyModule: d.assemblyModule,
				characterObjectId: d.characterObjectId,
				parentId: d.parentId,
				extensionType: extensionByAssembly.get(d.objectId) ?? d.extensionType,
				updatedAt: d.updatedAt,
			});
		}

		// Assemblies (skip duplicates)
		for (const a of assemblies ?? []) {
			if (seenObjectIds.has(a.objectId)) continue;
			seenObjectIds.add(a.objectId);

			const isMine = addressSet.has(a.owner);

			rows.push({
				id: a.id,
				objectId: a.objectId,
				ownership: isMine ? "mine" : "watched",
				assemblyType: a.assemblyType,
				status: a.status,
				label: a.label || a.assemblyType,
				owner: a.owner,
				ownerName: ownerNames.get(a.owner),
				systemId: a.systemId,
				lPoint: a.lPoint,
				notes: a.notes,
				tags: a.tags,
				source: "assemblies",
				parentId: a.parentId,
				extensionType: extensionByAssembly.get(a.objectId) ?? a.extensionType,
				updatedAt: a.updatedAt,
			});
		}

		// When showAll, return everything
		if (showAll) return rows;

		// Filter: owned OR sonar-targeted OR registry-matched
		return rows.filter((row) => {
			// Owned
			if (addressSet.has(row.owner)) return true;
			// Sonar-targeted
			if (sonarAssemblyIds?.has(row.objectId)) return true;
			// Registry-matched owner
			if (registryMatchedAddresses.has(row.owner)) return true;
			return false;
		});
	}, [
		deployables,
		assemblies,
		activeAddresses,
		addressSet,
		ownerNames,
		extensionByAssembly,
		showAll,
		sonarAssemblyIds,
		registryMatchedAddresses,
	]);

	return { data, ownerNames };
}
