/**
 * Sonar Event Handler Registry
 *
 * Maps chain event types to parsers that produce SonarEvent entries.
 * Each handler extracts relevant fields from the on-chain parsedJson,
 * applies ownership filters when needed, and returns zero or more
 * SonarEvent rows ready for DB insertion.
 */

import { ASSEMBLY_TYPE_IDS } from "@/chain/config";
import type { SonarEvent, SonarEventType } from "@/db/types";

// ── Context passed to every handler ─────────────────────────────────────────

export interface HandlerContext {
	/** Set of owned SSU object IDs */
	ssuObjectIds: Set<string>;
	/** Set of all owned structure object IDs (SSUs + gates + turrets + nodes) */
	ownedAssemblyIds: Set<string>;
	/** Set of owned Sui wallet addresses */
	ownedAddresses: Set<string>;
	/** Assembly objectId -> display label */
	assemblyNameMap: Map<string, string>;
	/** Item typeId (number) -> display name */
	typeNameMap: Map<number, string>;
	/** Character ID (string) -> display name */
	charNameMap: Map<string, string>;
	/** Character ID (string) -> tribe ID */
	charTribeMap: Map<string, number>;
}

// ── Handler interface ───────────────────────────────────────────────────────

export interface EventHandler {
	/** The SonarEventType to store for this event. */
	sonarType: SonarEventType;
	/**
	 * Filter/ownership mode:
	 * - "owned_assembly": filter by ownedAssemblyIds (inventory, fuel, status, etc.)
	 * - "owned_ssu": filter by ssuObjectIds only
	 * - "owned_address": filter by sender being an ownedAddress
	 * - "global": no ownership filter -- show all events
	 */
	filter: "owned_assembly" | "owned_ssu" | "owned_address" | "global";
	/** Parse the event and return zero or more sonar entries. */
	parse(
		event: { parsedJson: Record<string, unknown>; sender: string; timestampMs: string },
		ctx: HandlerContext,
	): Omit<SonarEvent, "id">[];
}

// ── Utility helpers ─────────────────────────────────────────────────────────

/** Extract an assembly/item ID from a nested TenantItemId or plain string. */
function extractId(val: unknown): string | undefined {
	if (!val) return undefined;
	if (typeof val === "string") return val;
	if (typeof val === "object" && val !== null) {
		const obj = val as Record<string, unknown>;
		return (obj.item_id as string) ?? undefined;
	}
	return undefined;
}

/** Build a base sonar entry from an event. */
function baseEntry(
	event: { timestampMs: string; sender: string },
	sonarType: SonarEventType,
): Omit<SonarEvent, "id"> {
	return {
		timestamp: new Date(Number(event.timestampMs)).toISOString(),
		source: "chain",
		eventType: sonarType,
		txDigest: `chain-${event.timestampMs}`,
		sender: event.sender,
	};
}

/** Resolve a character ID to a name from the context. */
function resolveCharName(
	charId: unknown,
	ctx: HandlerContext,
): { characterId?: string; characterName?: string } {
	const id = extractId(charId);
	if (!id) return {};
	return { characterId: id, characterName: ctx.charNameMap.get(id) };
}

/** Resolve assembly name from context. */
function resolveAssemblyName(
	assemblyId: string | undefined,
	ctx: HandlerContext,
): string | undefined {
	if (!assemblyId) return undefined;
	return ctx.assemblyNameMap.get(assemblyId);
}

/** Resolve type name from context. */
function resolveTypeName(typeId: number | undefined, ctx: HandlerContext): string | undefined {
	if (typeId == null || Number.isNaN(typeId)) return undefined;
	return ctx.typeNameMap.get(typeId);
}

// ── Tier 1 Handlers ─────────────────────────────────────────────────────────

/** Inventory events: ItemDeposited, ItemWithdrawn, ItemMinted, ItemBurned */
function inventoryHandler(sonarType: SonarEventType): EventHandler {
	return {
		sonarType,
		filter: "owned_ssu",
		parse(event, ctx) {
			const p = event.parsedJson;
			const assemblyId = extractId(p.assembly_id) ?? extractId(p.assembly_key);
			if (!assemblyId || !ctx.ssuObjectIds.has(assemblyId)) return [];

			const typeId = Number(extractId(p.type_id) ?? p.type_id);
			const quantity = Number(p.quantity ?? 0);
			const char = resolveCharName(p.character_id ?? p.character_key, ctx);

			return [
				{
					...baseEntry(event, sonarType),
					...char,
					assemblyId,
					assemblyName: resolveAssemblyName(assemblyId, ctx),
					typeId: Number.isNaN(typeId) ? undefined : typeId,
					typeName: resolveTypeName(typeId, ctx),
					quantity,
				},
			];
		},
	};
}

const jumpHandler: EventHandler = {
	sonarType: "jump",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const char = resolveCharName(p.character_id, ctx);
		const sourceGateId = p.source_gate_id as string | undefined;
		const destGateId = p.destination_gate_id as string | undefined;
		const srcName = resolveAssemblyName(sourceGateId, ctx);
		const dstName = resolveAssemblyName(destGateId, ctx);
		const details = `${srcName ?? sourceGateId?.slice(0, 10) ?? "?"} -> ${dstName ?? destGateId?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "jump"),
				...char,
				assemblyId: sourceGateId,
				assemblyName: srcName,
				details,
			},
		];
	},
};

const killmailHandler: EventHandler = {
	sonarType: "killmail",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const killerId = extractId(p.killer_id);
		const victimId = extractId(p.victim_id);
		const killerName = killerId ? ctx.charNameMap.get(killerId) : undefined;
		const victimName = victimId ? ctx.charNameMap.get(victimId) : undefined;
		const lossType = Number(p.loss_type) === 2 ? "structure" : "ship";
		const details =
			`${killerName ?? killerId?.slice(0, 10) ?? "?"} killed ` +
			`${victimName ?? victimId?.slice(0, 10) ?? "?"} (${lossType})`;

		return [
			{
				...baseEntry(event, "killmail"),
				characterName: killerName,
				characterId: killerId,
				details,
			},
		];
	},
};

const statusChangedHandler: EventHandler = {
	sonarType: "status_changed",
	filter: "owned_assembly",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = extractId(p.assembly_id) ?? extractId(p.assembly_key);
		if (!assemblyId || !ctx.ownedAssemblyIds.has(assemblyId)) return [];

		const status = p.status as string | undefined;
		const action = p.action as string | undefined;
		const details = `${action ?? "?"} -> ${status ?? "?"}`;

		return [
			{
				...baseEntry(event, "status_changed"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				details,
			},
		];
	},
};

const itemDestroyedHandler: EventHandler = {
	sonarType: "item_destroyed",
	filter: "owned_ssu",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = extractId(p.assembly_id) ?? extractId(p.assembly_key);
		if (!assemblyId || !ctx.ssuObjectIds.has(assemblyId)) return [];

		const typeId = Number(extractId(p.type_id) ?? p.type_id);
		const quantity = Number(p.quantity ?? 0);

		return [
			{
				...baseEntry(event, "item_destroyed"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName: resolveTypeName(typeId, ctx),
				quantity,
				details: "Item destroyed",
			},
		];
	},
};

const bountyPostedHandler: EventHandler = {
	sonarType: "bounty_posted",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const targetId = String(p.target_character_id ?? "");
		const targetName = ctx.charNameMap.get(targetId);
		const reward = Number(p.reward_amount ?? 0);
		const details = `Bounty on ${targetName ?? targetId.slice(0, 10)} ` + `for ${reward} EVE`;

		return [
			{
				...baseEntry(event, "bounty_posted"),
				characterId: targetId || undefined,
				characterName: targetName,
				details,
			},
		];
	},
};

const ssuMarketBuyOrderFilledHandler: EventHandler = {
	sonarType: "ssu_market_buy_filled",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const ssuId = p.ssu_id as string | undefined;
		const typeId = Number(p.type_id ?? 0);
		const quantity = Number(p.quantity ?? 0);
		const totalPaid = Number(p.total_paid ?? 0);
		const seller = p.seller as string | undefined;
		const typeName = resolveTypeName(typeId, ctx);
		const details =
			`${quantity}x ${typeName ?? `type#${typeId}`} ` +
			`for ${totalPaid} EVE (seller: ${seller?.slice(0, 10) ?? "?"})`;

		return [
			{
				...baseEntry(event, "ssu_market_buy_filled"),
				assemblyId: ssuId,
				assemblyName: resolveAssemblyName(ssuId, ctx),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName,
				quantity,
				details,
			},
		];
	},
};

// ── Tier 2 Handlers ─────────────────────────────────────────────────────────

const fuelHandler: EventHandler = {
	sonarType: "fuel",
	filter: "owned_assembly",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = extractId(p.assembly_id) ?? extractId(p.assembly_key);
		if (!assemblyId || !ctx.ownedAssemblyIds.has(assemblyId)) return [];

		const oldQty = Number(p.old_quantity ?? 0);
		const newQty = Number(p.new_quantity ?? 0);
		const action = p.action as string | undefined;
		const typeId = Number(extractId(p.type_id) ?? p.type_id);
		const details = `Fuel ${action ?? "event"}: ${oldQty} -> ${newQty}`;

		return [
			{
				...baseEntry(event, "fuel"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName: resolveTypeName(typeId, ctx),
				details,
			},
		];
	},
};

const gateLinkedHandler: EventHandler = {
	sonarType: "gate_linked",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const srcId = p.source_gate_id as string | undefined;
		const dstId = p.destination_gate_id as string | undefined;
		const srcName = resolveAssemblyName(srcId, ctx);
		const dstName = resolveAssemblyName(dstId, ctx);
		const details =
			`${srcName ?? srcId?.slice(0, 10) ?? "?"} <-> ` +
			`${dstName ?? dstId?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "gate_linked"),
				assemblyId: srcId,
				assemblyName: srcName,
				details,
			},
		];
	},
};

const marketSellListingPostedHandler: EventHandler = {
	sonarType: "market_sell_posted",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const typeId = Number(p.type_id ?? 0);
		const quantity = Number(p.quantity ?? 0);
		const price = Number(p.price_per_unit ?? 0);
		const seller = p.seller as string | undefined;
		const details =
			`Sell listing: ${quantity}x ${resolveTypeName(typeId, ctx) ?? `type#${typeId}`} ` +
			`@ ${price}/ea by ${seller?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "market_sell_posted"),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName: resolveTypeName(typeId, ctx),
				quantity,
				details,
			},
		];
	},
};

const marketBuyOrderPostedHandler: EventHandler = {
	sonarType: "market_buy_posted",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const typeId = Number(p.type_id ?? 0);
		const quantity = Number(p.quantity ?? 0);
		const price = Number(p.price_per_unit ?? 0);
		const buyer = p.buyer as string | undefined;
		const details =
			`Buy order: ${quantity}x ${resolveTypeName(typeId, ctx) ?? `type#${typeId}`} ` +
			`@ ${price}/ea by ${buyer?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "market_buy_posted"),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName: resolveTypeName(typeId, ctx),
				quantity,
				details,
			},
		];
	},
};

const marketBuyOrderFilledHandler: EventHandler = {
	sonarType: "market_buy_filled",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const typeId = Number(p.type_id ?? 0);
		const quantity = Number(p.quantity ?? 0);
		const totalPaid = Number(p.total_paid ?? 0);
		const seller = p.seller as string | undefined;
		const buyer = p.buyer as string | undefined;
		const details =
			`Buy order filled: ${quantity}x ` +
			`${resolveTypeName(typeId, ctx) ?? `type#${typeId}`} for ${totalPaid} ` +
			`(seller: ${seller?.slice(0, 10) ?? "?"}, buyer: ${buyer?.slice(0, 10) ?? "?"})`;

		return [
			{
				...baseEntry(event, "market_buy_filled"),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName: resolveTypeName(typeId, ctx),
				quantity,
				details,
			},
		];
	},
};

const marketBuyOrderCancelledHandler: EventHandler = {
	sonarType: "market_buy_cancelled",
	filter: "global",
	parse(event, _ctx) {
		const p = event.parsedJson;
		const typeId = Number(p.type_id ?? 0);
		const buyer = p.buyer as string | undefined;
		const refund = Number(p.refund_amount ?? 0);
		const details = `Buy order cancelled by ${buyer?.slice(0, 10) ?? "?"}${refund ? ` (refund: ${refund})` : ""}`;

		return [
			{
				...baseEntry(event, "market_buy_cancelled"),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				details,
			},
		];
	},
};

const tollCollectedHandler: EventHandler = {
	sonarType: "toll_collected",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const gateId = p.gate_id as string | undefined;
		const amount = Number(p.amount ?? 0);
		const payer = p.payer as string | undefined;
		const payerName = payer ? ctx.charNameMap.get(payer) : undefined;
		const details =
			`Toll ${amount} EVE from ${payerName ?? payer?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "toll_collected"),
				assemblyId: gateId,
				assemblyName: resolveAssemblyName(gateId, ctx),
				details,
			},
		];
	},
};

const accessGrantedHandler: EventHandler = {
	sonarType: "access_granted",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const gateId = p.gate_id as string | undefined;
		const charId = String(p.character_id ?? "");
		const charName = ctx.charNameMap.get(charId);
		const tollPaid = Number(p.toll_paid ?? 0);
		const details =
			`Access to ${charName ?? charId.slice(0, 10) ?? "?"}` +
			`${tollPaid ? ` (toll: ${tollPaid} EVE)` : ""}`;

		return [
			{
				...baseEntry(event, "access_granted"),
				assemblyId: gateId,
				assemblyName: resolveAssemblyName(gateId, ctx),
				characterId: charId || undefined,
				characterName: charName,
				details,
			},
		];
	},
};

// ── Tier 3 Handlers ─────────────────────────────────────────────────────────

function structureCreatedHandler(sonarType: SonarEventType): EventHandler {
	return {
		sonarType,
		filter: "global",
		parse(event, ctx) {
			const p = event.parsedJson;
			// Different event structs use different field names
			const assemblyId =
				(p.assembly_id as string) ??
				(p.gate_id as string) ??
				(p.storage_unit_id as string) ??
				(p.turret_id as string) ??
				(p.network_node_id as string);
			const typeId = Number(p.type_id ?? 0);
			const structName = ASSEMBLY_TYPE_IDS[typeId] ?? `type#${typeId}`;
			const details = `New ${structName} deployed`;

			return [
				{
					...baseEntry(event, sonarType),
					assemblyId,
					assemblyName: resolveAssemblyName(assemblyId, ctx),
					typeId: Number.isNaN(typeId) ? undefined : typeId,
					typeName: structName,
					details,
				},
			];
		},
	};
}

const metadataChangedHandler: EventHandler = {
	sonarType: "metadata_changed",
	filter: "owned_assembly",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = extractId(p.assembly_id) ?? extractId(p.assembly_key);
		if (!assemblyId || !ctx.ownedAssemblyIds.has(assemblyId)) return [];

		const name = p.name as string | undefined;
		const details = name ? `Metadata: "${name}"` : "Metadata updated";

		return [
			{
				...baseEntry(event, "metadata_changed"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				details,
			},
		];
	},
};

const locationRevealedHandler: EventHandler = {
	sonarType: "location_revealed",
	filter: "global",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = p.assembly_id as string | undefined;
		const solarSystem = Number(p.solarsystem ?? 0);
		const typeId = Number(p.type_id ?? 0);
		const structName = ASSEMBLY_TYPE_IDS[typeId] ?? `type#${typeId}`;
		const details = `${structName} revealed in system ${solarSystem}`;

		return [
			{
				...baseEntry(event, "location_revealed"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				details,
			},
		];
	},
};

const jumpPermitIssuedHandler: EventHandler = {
	sonarType: "jump_permit_issued",
	filter: "owned_assembly",
	parse(event, ctx) {
		const p = event.parsedJson;
		const srcId = p.source_gate_id as string | undefined;
		if (!srcId || !ctx.ownedAssemblyIds.has(srcId)) return [];

		const dstId = p.destination_gate_id as string | undefined;
		const char = resolveCharName(p.character_id, ctx);
		const srcName = resolveAssemblyName(srcId, ctx);
		const dstName = resolveAssemblyName(dstId, ctx);
		const details =
			`Permit: ${char.characterName ?? char.characterId?.slice(0, 10) ?? "?"} ` +
			`via ${srcName ?? srcId?.slice(0, 10) ?? "?"} -> ${dstName ?? dstId?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "jump_permit_issued"),
				...char,
				assemblyId: srcId,
				assemblyName: srcName,
				details,
			},
		];
	},
};

function energyHandler(sonarType: SonarEventType): EventHandler {
	return {
		sonarType,
		filter: "owned_address",
		parse(event, ctx) {
			const p = event.parsedJson;
			const energySourceId = p.energy_source_id as string | undefined;
			// Energy events reference an energy source, not directly an assembly.
			// We show these if the sender is an owned address.
			if (!ctx.ownedAddresses.has(event.sender)) return [];

			const details = `Energy ${sonarType.replace("energy_", "")}`;

			return [
				{
					...baseEntry(event, sonarType),
					assemblyId: energySourceId,
					details,
				},
			];
		},
	};
}

// ── Extension Authorization Handlers ─────────────────────────────────────────

function extensionHandler(sonarType: SonarEventType): EventHandler {
	return {
		sonarType,
		filter: "owned_assembly",
		parse(event, ctx) {
			const p = event.parsedJson;
			const assemblyId = extractId(p.assembly_id) ?? extractId(p.assembly_key);
			if (!assemblyId || !ctx.ownedAssemblyIds.has(assemblyId)) return [];

			const rawExtType = p.extension_type;
			const extensionType = typeof rawExtType === "string" ? rawExtType : undefined;
			const action = sonarType.replace("extension_", "");
			const extLabel = extensionType
				? extensionType.split("::").slice(-1)[0]
				: "unknown";
			const details = `Extension ${action}: ${extLabel}`;

			return [
				{
					...baseEntry(event, sonarType),
					assemblyId,
					assemblyName: resolveAssemblyName(assemblyId, ctx),
					details,
				},
			];
		},
	};
}

const bountyClaimedHandler: EventHandler = {
	sonarType: "bounty_claimed",
	filter: "global",
	parse(event, _ctx) {
		const p = event.parsedJson;
		const hunter = p.hunter as string | undefined;
		const reward = Number(p.reward_amount ?? 0);
		const details = `Bounty claimed by ${hunter?.slice(0, 10) ?? "?"} for ${reward} EVE`;

		return [
			{
				...baseEntry(event, "bounty_claimed"),
				details,
			},
		];
	},
};

const bountyCancelledHandler: EventHandler = {
	sonarType: "bounty_cancelled",
	filter: "global",
	parse(event, _ctx) {
		const p = event.parsedJson;
		const bountyId = String(p.bounty_id ?? "");
		const details = `Bounty #${bountyId} cancelled`;

		return [
			{
				...baseEntry(event, "bounty_cancelled"),
				details,
			},
		];
	},
};

const leaseCreatedHandler: EventHandler = {
	sonarType: "lease_created",
	filter: "owned_assembly",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = p.assembly_id as string | undefined;
		if (!assemblyId || !ctx.ownedAssemblyIds.has(assemblyId)) return [];

		const rate = Number(p.rate_per_day ?? 0);
		const tenant = p.tenant as string | undefined;
		const details = `Lease created: ${rate}/day to ${tenant?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "lease_created"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				details,
			},
		];
	},
};

const rentCollectedHandler: EventHandler = {
	sonarType: "rent_collected",
	filter: "owned_assembly",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = p.assembly_id as string | undefined;
		if (!assemblyId || !ctx.ownedAssemblyIds.has(assemblyId)) return [];

		const amount = Number(p.amount ?? 0);
		const remaining = Number(p.remaining_balance ?? 0);
		const details = `Rent collected: ${amount} (remaining: ${remaining})`;

		return [
			{
				...baseEntry(event, "rent_collected"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				details,
			},
		];
	},
};

const leaseCancelledHandler: EventHandler = {
	sonarType: "lease_cancelled",
	filter: "owned_assembly",
	parse(event, ctx) {
		const p = event.parsedJson;
		const assemblyId = p.assembly_id as string | undefined;
		if (!assemblyId || !ctx.ownedAssemblyIds.has(assemblyId)) return [];

		const refund = Number(p.refund_amount ?? 0);
		const details = `Lease cancelled (refund: ${refund})`;

		return [
			{
				...baseEntry(event, "lease_cancelled"),
				assemblyId,
				assemblyName: resolveAssemblyName(assemblyId, ctx),
				details,
			},
		];
	},
};

const ssuMarketTransferHandler: EventHandler = {
	sonarType: "ssu_market_transfer",
	filter: "owned_ssu",
	parse(event, ctx) {
		const p = event.parsedJson;
		const ssuId = p.ssu_id as string | undefined;
		if (!ssuId || !ctx.ssuObjectIds.has(ssuId)) return [];

		const typeId = Number(p.type_id ?? 0);
		const quantity = Number(p.quantity ?? 0);
		const from = p.from_slot as string | undefined;
		const to = p.to_slot as string | undefined;
		const details = `Transfer ${quantity}x type#${typeId} ` + `(${from ?? "?"} -> ${to ?? "?"})`;

		return [
			{
				...baseEntry(event, "ssu_market_transfer"),
				assemblyId: ssuId,
				assemblyName: resolveAssemblyName(ssuId, ctx),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName: resolveTypeName(typeId, ctx),
				quantity,
				details,
			},
		];
	},
};

const ssuMarketSellListingCancelledHandler: EventHandler = {
	sonarType: "ssu_market_sell_cancelled",
	filter: "owned_ssu",
	parse(event, ctx) {
		const p = event.parsedJson;
		const ssuId = p.ssu_id as string | undefined;
		if (!ssuId || !ctx.ssuObjectIds.has(ssuId)) return [];

		const typeId = Number(p.type_id ?? 0);
		const quantity = Number(p.quantity ?? 0);
		const listingId = String(p.listing_id ?? "");
		const details = `Sell listing #${listingId} cancelled (${quantity}x type#${typeId})`;

		return [
			{
				...baseEntry(event, "ssu_market_sell_cancelled"),
				assemblyId: ssuId,
				assemblyName: resolveAssemblyName(ssuId, ctx),
				typeId: Number.isNaN(typeId) ? undefined : typeId,
				typeName: resolveTypeName(typeId, ctx),
				quantity,
				details,
			},
		];
	},
};

const marketSellListingCancelledHandler: EventHandler = {
	sonarType: "market_sell_cancelled",
	filter: "global",
	parse(event, _ctx) {
		const p = event.parsedJson;
		const listingId = String(p.listing_id ?? "");
		const details = `Sell listing #${listingId} cancelled`;

		return [
			{
				...baseEntry(event, "market_sell_cancelled"),
				details,
			},
		];
	},
};

const exchangeOrderPlacedHandler: EventHandler = {
	sonarType: "exchange_order_placed",
	filter: "global",
	parse(event, _ctx) {
		const p = event.parsedJson;
		const isBid = p.is_bid as boolean;
		const price = Number(p.price ?? 0);
		const amount = Number(p.amount ?? 0);
		const owner = p.owner as string | undefined;
		const side = isBid ? "bid" : "ask";
		const details = `Exchange ${side}: ${amount} @ ${price} by ${owner?.slice(0, 10) ?? "?"}`;

		return [
			{
				...baseEntry(event, "exchange_order_placed"),
				details,
			},
		];
	},
};

const exchangeOrderCancelledHandler: EventHandler = {
	sonarType: "exchange_order_cancelled",
	filter: "global",
	parse(event, _ctx) {
		const p = event.parsedJson;
		const orderId = String(p.order_id ?? "");
		const details = `Exchange order #${orderId} cancelled`;

		return [
			{
				...baseEntry(event, "exchange_order_cancelled"),
				details,
			},
		];
	},
};



// ── Registry: maps event key -> handler ─────────────────────────────────────

/**
 * Maps event keys (matching getEventTypes + getExtensionEventTypes keys)
 * to their EventHandler implementations.
 */
export const EVENT_HANDLER_REGISTRY: Record<string, EventHandler> = {
	// ── Inventory ───────────────────────────────────────────────────────
	ItemDeposited: inventoryHandler("item_deposited"),
	ItemWithdrawn: inventoryHandler("item_withdrawn"),
	ItemMinted: inventoryHandler("item_minted"),
	ItemBurned: inventoryHandler("item_burned"),
	ItemDestroyed: itemDestroyedHandler,

	// ── Combat / intel ──────────────────────────────────────────────────
	KillmailCreated: killmailHandler,
	BountyPosted: bountyPostedHandler,
	BountyClaimed: bountyClaimedHandler,
	BountyCancelled: bountyCancelledHandler,

	// ── Navigation ──────────────────────────────────────────────────────
	JumpEvent: jumpHandler,
	GateLinked: gateLinkedHandler,
	JumpPermitIssued: jumpPermitIssuedHandler,

	// ── Fuel / energy ───────────────────────────────────────────────────
	FuelEvent: fuelHandler,
	StartEnergyProduction: energyHandler("energy_start"),
	StopEnergyProduction: energyHandler("energy_stop"),
	EnergyReserved: energyHandler("energy_reserved"),
	EnergyReleased: energyHandler("energy_released"),

	// ── Status / metadata ───────────────────────────────────────────────
	StatusChanged: statusChangedHandler,
	MetadataChanged: metadataChangedHandler,
	LocationRevealed: locationRevealedHandler,

	// ── Structure creation ──────────────────────────────────────────────
	AssemblyCreated: structureCreatedHandler("assembly_created"),
	GateCreated: structureCreatedHandler("gate_created"),
	StorageUnitCreated: structureCreatedHandler("storage_unit_created"),
	TurretCreated: structureCreatedHandler("turret_created"),
	NetworkNodeCreated: structureCreatedHandler("network_node_created"),

	// ── Extension authorization ─────────────────────────────────────────
	GateExtensionAuthorized: extensionHandler("extension_authorized"),
	GateExtensionRemoved: extensionHandler("extension_removed"),
	GateExtensionRevoked: extensionHandler("extension_revoked"),
	StorageUnitExtensionAuthorized: extensionHandler("extension_authorized"),
	StorageUnitExtensionRemoved: extensionHandler("extension_removed"),
	StorageUnitExtensionRevoked: extensionHandler("extension_revoked"),
	TurretExtensionRevoked: extensionHandler("extension_revoked"),

	// ── SSU Market (extension) ──────────────────────────────────────────
	SsuMarketBuyOrderFilled: ssuMarketBuyOrderFilledHandler,
	SsuMarketTransfer: ssuMarketTransferHandler,
	SsuMarketSellListingCancelled: ssuMarketSellListingCancelledHandler,

	// ── Gate extensions ─────────────────────────────────────────────────
	UnifiedTollCollected: tollCollectedHandler,
	UnifiedAccessGranted: accessGrantedHandler,
	TollCollected: tollCollectedHandler,

	// ── Market (token market) ───────────────────────────────────────────
	MarketSellListingPosted: marketSellListingPostedHandler,
	MarketBuyOrderPosted: marketBuyOrderPostedHandler,
	MarketBuyOrderFilled: marketBuyOrderFilledHandler,
	MarketBuyOrderCancelled: marketBuyOrderCancelledHandler,
	MarketSellListingCancelled: marketSellListingCancelledHandler,

	// ── Lease ───────────────────────────────────────────────────────────
	LeaseCreated: leaseCreatedHandler,
	RentCollected: rentCollectedHandler,
	LeaseCancelled: leaseCancelledHandler,

	// ── Exchange ────────────────────────────────────────────────────────
	ExchangeOrderPlaced: exchangeOrderPlacedHandler,
	ExchangeOrderCancelled: exchangeOrderCancelledHandler,
};
