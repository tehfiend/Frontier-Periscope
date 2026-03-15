// ── EVE Frontier Chat Link Parser ───────────────────────────────────────────
// Parses in-game chat markup to extract structured intel data.
//
// Link format: <a href="showinfo:TYPE_ID//ENTITY_ID">DisplayName</a>
// Known type IDs:
//   1376 — Character (player)
//   Additional types TBD (items, systems, etc.)

export interface ChatLink {
	typeId: number;
	entityId: string;
	displayName: string;
	raw: string;
}

// Matches both quoted and unquoted href variants
const SHOWINFO_RE = /<a href=["']?showinfo:(\d+)\/\/(\d+)["']?>(.*?)<\/a>/gi;

/** Extract all showinfo links from a message string. */
export function extractChatLinks(message: string): ChatLink[] {
	const links: ChatLink[] = [];
	let match: RegExpExecArray | null;

	// Reset regex state
	SHOWINFO_RE.lastIndex = 0;

	while ((match = SHOWINFO_RE.exec(message)) !== null) {
		links.push({
			typeId: Number.parseInt(match[1], 10),
			entityId: match[2],
			displayName: match[3].replace(/<[^>]+>/g, "").trim(),
			raw: match[0],
		});
	}

	return links;
}

/** Check if a link is a character/player reference. */
export function isPlayerLink(link: ChatLink): boolean {
	return link.typeId === 1376;
}

/** Extract player names mentioned in a message via showinfo links. */
export function extractMentionedPlayers(message: string): { name: string; characterId: string }[] {
	return extractChatLinks(message)
		.filter(isPlayerLink)
		.map((link) => ({
			name: link.displayName,
			characterId: link.entityId,
		}));
}

/** Strip all link markup from a message, keeping display text. */
export function stripChatLinks(message: string): string {
	return message.replace(SHOWINFO_RE, "$3");
}

// ── Intel Classification ────────────────────────────────────────────────────

export type IntelSeverity = "low" | "medium" | "high";

/** Simple keyword-based intel severity classification. */
export function classifyIntelSeverity(message: string): IntelSeverity {
	const lower = message.toLowerCase();

	// High severity: combat, danger, urgent
	if (/\b(hostile|attack|kill|die|dead|danger|warning|alert|run|gtfo|hostile on gate)\b/.test(lower)) {
		return "high";
	}

	// Medium severity: sighting, movement, activity
	if (/\b(spotted|seen|jump|warp|entered|leaving|online|anchoring|fleet|gang|camping)\b/.test(lower)) {
		return "medium";
	}

	// Low severity: general intel
	return "low";
}
