import type { SuiGraphQLClient } from "@mysten/sui/graphql";

/** Shape returned by the GraphQL events query, mapped to match the old SuiEvent fields. */
export interface GraphQLEvent {
	sender: string;
	type: string;
	parsedJson: Record<string, unknown>;
	timestampMs: string;
}

export interface EventPollerOptions {
	client: SuiGraphQLClient;
	packageId: string;
	module?: string;
	eventType?: string;
	cursor?: string | null;
	onEvents: (events: GraphQLEvent[], nextCursor: string | null) => Promise<void>;
}

const QUERY_EVENTS = `
	query($type: String!, $first: Int, $after: String) {
		events(filter: { eventType: $type }, first: $first, after: $after) {
			nodes {
				sendingModule { package { address } module }
				sender { address }
				contents { json type { repr } }
				timestamp
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

interface GqlEventNode {
	sender: { address: string };
	contents: { json: Record<string, unknown>; type: { repr: string } };
	timestamp: string;
}

interface GqlEventsResponse {
	events: {
		nodes: GqlEventNode[];
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

function mapEvent(node: GqlEventNode): GraphQLEvent {
	return {
		sender: node.sender.address,
		type: node.contents.type.repr,
		parsedJson: node.contents.json,
		timestampMs: String(new Date(node.timestamp).getTime()),
	};
}

export async function pollEvents(options: EventPollerOptions): Promise<string | null> {
	const { client, packageId, module, eventType, cursor, onEvents } = options;

	const moveEventType = [packageId, module, eventType].filter(Boolean).join("::");

	const result = await client.query<GqlEventsResponse, { type: string; first: number; after: string | null }>({
		query: QUERY_EVENTS,
		variables: {
			type: moveEventType,
			first: 50,
			after: cursor ?? null,
		},
	});

	const events = result.data?.events;
	if (!events) return cursor ?? null;

	if (events.nodes.length > 0) {
		const mapped = events.nodes.map(mapEvent);
		const nextCursor = events.pageInfo.endCursor ?? null;
		await onEvents(mapped, nextCursor);
		return nextCursor;
	}

	return cursor ?? null;
}
