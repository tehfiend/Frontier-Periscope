import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import type { MarketListing, MarketInfo } from "./types";

function extractFields(content: unknown): Record<string, unknown> {
	const c = content as { fields?: Record<string, unknown> };
	return c?.fields ?? {};
}

export async function queryMarketConfig(
	client: SuiClient,
	configObjectId: string,
): Promise<MarketInfo | null> {
	try {
		const obj = await client.getObject({
			id: configObjectId,
			options: { showContent: true },
		});
		const fields = extractFields(obj.data?.content);
		return {
			objectId: configObjectId,
			admin: (fields.admin as string) ?? "",
			ssuId: (fields.ssu_id as string) ?? "",
		};
	} catch {
		return null;
	}
}

export async function queryListing(
	client: SuiClient,
	configObjectId: string,
	typeId: number,
): Promise<MarketListing | null> {
	try {
		const df = await client.getDynamicFieldObject({
			parentId: configObjectId,
			name: { type: "u64", value: String(typeId) },
		});
		if (!df.data?.content) return null;

		const fields = extractFields(df.data.content);
		return {
			typeId: Number(fields.type_id ?? typeId),
			pricePerUnit: Number(fields.price_per_unit ?? 0),
			available: (fields.available as boolean) ?? false,
		};
	} catch {
		return null;
	}
}

export interface CreateMarketParams {
	packageId: string;
	ssuId: string;
	senderAddress: string;
}

export function buildCreateMarket(params: CreateMarketParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::create_market`,
		arguments: [tx.pure.id(params.ssuId)],
	});

	return tx;
}

export interface SetListingParams {
	packageId: string;
	configObjectId: string;
	typeId: number;
	pricePerUnit: number;
	available: boolean;
	senderAddress: string;
}

export function buildSetListing(params: SetListingParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::ssu_market::set_listing`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.bool(params.available),
		],
	});

	return tx;
}

export interface BuyItemParams {
	packageId: string;
	configObjectId: string;
	coinType: string;
	paymentObjectId: string;
	typeId: number;
	quantity: number;
	senderAddress: string;
}

export function buildBuyItem(params: BuyItemParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	const [change] = tx.moveCall({
		target: `${params.packageId}::ssu_market::buy_item`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.configObjectId),
			tx.object(params.paymentObjectId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.quantity),
		],
	});

	// Transfer change back to sender
	tx.transferObjects([change], params.senderAddress);

	return tx;
}
