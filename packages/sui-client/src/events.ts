import type { SuiClient, SuiEvent } from "@mysten/sui/client";

export interface EventPollerOptions {
	client: SuiClient;
	packageId: string;
	module?: string;
	eventType?: string;
	cursor?: string | null;
	onEvents: (events: SuiEvent[], nextCursor: string | null) => Promise<void>;
}

export async function pollEvents(options: EventPollerOptions): Promise<string | null> {
	const { client, packageId, module, eventType, cursor, onEvents } = options;

	const moveEventType = [packageId, module, eventType].filter(Boolean).join("::");

	const result = await client.queryEvents({
		query: { MoveEventType: moveEventType },
		cursor: cursor ? { txDigest: cursor, eventSeq: "0" } : undefined,
		limit: 50,
		order: "ascending",
	});

	if (result.data.length > 0) {
		const nextCursor = result.nextCursor?.txDigest ?? null;
		await onEvents(result.data, nextCursor);
		return nextCursor;
	}

	return cursor ?? null;
}
