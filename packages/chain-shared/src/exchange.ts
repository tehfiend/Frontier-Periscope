import { Transaction } from "@mysten/sui/transactions";

export interface CreatePairParams {
	packageId: string;
	coinTypeA: string;
	coinTypeB: string;
	feeBps: number;
	senderAddress: string;
}

export function buildCreatePair(params: CreatePairParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::create_pair`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [tx.pure.u64(params.feeBps)],
	});

	return tx;
}

export interface PlaceOrderParams {
	packageId: string;
	coinTypeA: string;
	coinTypeB: string;
	bookObjectId: string;
	coinObjectId: string;
	price: number;
	amount: number;
	senderAddress: string;
}

export function buildPlaceBid(params: PlaceOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::place_bid`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			tx.object(params.coinObjectId),
			tx.pure.u64(params.price),
			tx.pure.u64(params.amount),
		],
	});

	return tx;
}

export function buildPlaceAsk(params: PlaceOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::place_ask`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			tx.object(params.coinObjectId),
			tx.pure.u64(params.price),
			tx.pure.u64(params.amount),
		],
	});

	return tx;
}

export interface CancelOrderParams {
	packageId: string;
	coinTypeA: string;
	coinTypeB: string;
	bookObjectId: string;
	orderId: number;
	senderAddress: string;
}

export function buildCancelBid(params: CancelOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::cancel_bid`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			tx.pure.u64(params.orderId),
		],
	});

	return tx;
}

export function buildCancelAsk(params: CancelOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::exchange::cancel_ask`,
		typeArguments: [params.coinTypeA, params.coinTypeB],
		arguments: [
			tx.object(params.bookObjectId),
			tx.pure.u64(params.orderId),
		],
	});

	return tx;
}
