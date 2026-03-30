// Parse EVE Frontier game log files into structured events

export interface ParsedLogHeader {
	characterName: string;
	sessionStarted: string; // "YYYY.MM.DD HH:MM:SS"
}

export type ParsedEvent = {
	timestamp: string;
	raw: string;
} & (
	| { type: "mining"; ore: string; amount: number }
	| {
			type: "combat_dealt";
			target: string;
			damage: number;
			weapon: string;
			hitQuality: string;
	  }
	| { type: "combat_received"; target: string; damage: number; hitQuality: string }
	| { type: "miss_dealt"; target: string; weapon: string }
	| { type: "miss_received"; target: string }
	| { type: "structure_departed"; structureName: string; systemName: string }
	| { type: "gate_offline"; systemName: string }
	| { type: "build_fail"; message: string }
	| { type: "dismantle"; message: string }
	| { type: "notify"; message: string }
	| { type: "info"; message: string }
	| { type: "hint"; message: string }
	| { type: "question"; message: string }
	| { type: "system_change"; systemName: string }
	| { type: "chat"; speaker: string; channel: string; message: string; systemName?: string }
);

const ENTRY_RE = /^\[ (\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}) \] \((\w+)\) (.+)/;
const DAMAGE_DEALT_RE =
	/<color=0xff00ffff><b>(\d+)<\/b>.*?<font size=10>to<\/font>.*?<b><color=0xffffffff>(.*?)<\/b>.*? - (.*?) - (\w[\w ]*)/;
const DAMAGE_RECV_RE =
	/<color=0xffcc0000><b>(\d+)<\/b>.*?<font size=10>from<\/font>.*?<b><color=0xffffffff>(.*?)<\/b>.*? - (\w[\w ]*)/;
const MISS_DEALT_RE = /^Your (.+?) misses (.+?) completely/;
const MISS_RECV_RE = /^(.+?) misses you completely/;
const MINING_RE = /<color=0xffaaaa00>(\d+)<.*?<color=0xffffffff><font size=12>(.+?)<color/;

// Structure-related patterns
const STRUCTURE_DEPARTED_RE = /^(.+?) has just left (.+?) as of/;
const GATE_OFFLINE_RE = /^(.+?) Traffic Control is currently offline/;
const BUILD_FAIL_RE =
	/insufficient resources to build this Assembly|Failed to build job|must be located at an L-Point|There is already something in that location/i;
const DISMANTLE_RE = /dismantle the structure|Dismantling this facility/i;

const HEADER_LISTENER_RE = /^\s+Listener:\s+(.+)/;
const HEADER_SESSION_RE = /^\s+Session Started:\s+(.+)/;

function eveTimestampToISO(eveTs: string): string {
	// "2026.03.11 19:06:52" → "2026-03-11T19:06:52Z"
	return `${eveTs.replace(/\./g, "-").replace(" ", "T")}Z`;
}

function stripMarkup(msg: string): string {
	return msg.replace(/<[^>]+>/g, "").trim();
}

export function parseHeader(text: string): ParsedLogHeader | null {
	const normalized = text.replace(/\r\n/g, "\n");
	let characterName = "";
	let sessionStarted = "";

	for (const line of normalized.split("\n")) {
		const listenerMatch = line.match(HEADER_LISTENER_RE);
		if (listenerMatch) {
			characterName = listenerMatch[1].trim();
		}
		const sessionMatch = line.match(HEADER_SESSION_RE);
		if (sessionMatch) {
			sessionStarted = sessionMatch[1].trim();
		}
	}

	if (!characterName || !sessionStarted) return null;
	return { characterName, sessionStarted };
}

export function parseEntries(text: string): ParsedEvent[] {
	const normalized = text.replace(/\r\n/g, "\n");
	const events: ParsedEvent[] = [];

	for (const line of normalized.split("\n")) {
		const match = line.match(ENTRY_RE);
		if (!match) continue;

		const [, eveTimestamp, type, message] = match;
		const timestamp = eveTimestampToISO(eveTimestamp);
		const raw = line;

		switch (type) {
			case "mining": {
				const m = message.match(MINING_RE);
				if (m) {
					events.push({
						timestamp,
						raw,
						type: "mining",
						ore: m[2],
						amount: Number.parseInt(m[1], 10),
					});
				}
				break;
			}
			case "combat": {
				const dealt = message.match(DAMAGE_DEALT_RE);
				if (dealt) {
					events.push({
						timestamp,
						raw,
						type: "combat_dealt",
						target: dealt[2],
						damage: Number.parseInt(dealt[1], 10),
						weapon: dealt[3],
						hitQuality: dealt[4],
					});
					break;
				}
				const recv = message.match(DAMAGE_RECV_RE);
				if (recv) {
					events.push({
						timestamp,
						raw,
						type: "combat_received",
						target: recv[2],
						damage: Number.parseInt(recv[1], 10),
						hitQuality: recv[3],
					});
					break;
				}
				const missDealt = message.match(MISS_DEALT_RE);
				if (missDealt) {
					events.push({
						timestamp,
						raw,
						type: "miss_dealt",
						target: missDealt[2],
						weapon: missDealt[1],
					});
					break;
				}
				const missRecv = message.match(MISS_RECV_RE);
				if (missRecv) {
					events.push({
						timestamp,
						raw,
						type: "miss_received",
						target: missRecv[1],
					});
					break;
				}
				break;
			}
			case "notify": {
				const stripped = stripMarkup(message);
				const departed = stripped.match(STRUCTURE_DEPARTED_RE);
				if (departed) {
					events.push({
						timestamp,
						raw,
						type: "structure_departed",
						structureName: departed[1],
						systemName: departed[2],
					});
					break;
				}
				const gateOff = stripped.match(GATE_OFFLINE_RE);
				if (gateOff) {
					events.push({ timestamp, raw, type: "gate_offline", systemName: gateOff[1] });
					break;
				}
				if (BUILD_FAIL_RE.test(stripped)) {
					events.push({ timestamp, raw, type: "build_fail", message: stripped });
					break;
				}
				events.push({ timestamp, raw, type: "notify", message: stripped });
				break;
			}
			case "info":
				events.push({ timestamp, raw, type: "info", message: stripMarkup(message) });
				break;
			case "hint": {
				const stripped = stripMarkup(message);
				if (BUILD_FAIL_RE.test(stripped)) {
					events.push({ timestamp, raw, type: "build_fail", message: stripped });
					break;
				}
				events.push({ timestamp, raw, type: "hint", message: stripped });
				break;
			}
			case "question": {
				const stripped = stripMarkup(message);
				if (DISMANTLE_RE.test(stripped)) {
					events.push({ timestamp, raw, type: "dismantle", message: stripped });
					break;
				}
				events.push({ timestamp, raw, type: "question", message: stripped });
				break;
			}
		}
	}

	return events;
}

export function parseLogFilename(
	name: string,
): { date: string; time: string; characterId?: string } | null {
	const match = name.match(/^(\d{8})_(\d{6})(?:_(\d+))?\.txt$/);
	if (!match) return null;
	return { date: match[1], time: match[2], characterId: match[3] };
}

// ── Chat Log Parsing (UTF-16LE) ─────────────────────────────────────────────

const CHAT_ENTRY_RE = /^\[ (\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}) \] (.+?) > (.+)/;
const SYSTEM_CHANGE_RE = /^Channel changed to Local : (.+)$/;

export function decodeChatLog(buffer: ArrayBuffer): string {
	const text = new TextDecoder("utf-16le").decode(buffer);
	// Game client prepends a BOM (U+FEFF) to every line — strip all of them
	return text.replace(/\ufeff/g, "");
}

export function parseChatEntries(text: string, channel: string): ParsedEvent[] {
	const normalized = text.replace(/\r\n/g, "\n");
	const events: ParsedEvent[] = [];
	let currentSystem: string | undefined;

	for (const line of normalized.split("\n")) {
		const match = line.match(CHAT_ENTRY_RE);
		if (!match) continue;

		const [, eveTimestamp, speaker, message] = match;
		const trimmedSpeaker = speaker.trim();
		const trimmedMessage = message.trim();
		const timestamp = eveTimestampToISO(eveTimestamp);

		// Keeper system messages
		if (trimmedSpeaker === "Keeper") {
			const sysMatch = trimmedMessage.match(SYSTEM_CHANGE_RE);
			if (sysMatch) {
				currentSystem = sysMatch[1].trim();
				events.push({
					timestamp,
					raw: line,
					type: "system_change",
					systemName: currentSystem,
				});
			}
			// Skip other Keeper messages (connect/reconnect) from chat
			continue;
		}

		// Regular chat message
		events.push({
			timestamp,
			raw: line,
			type: "chat",
			speaker: trimmedSpeaker,
			channel,
			message: trimmedMessage,
			systemName: currentSystem,
		});
	}

	return events;
}

// Chat log filename: "Local_YYYYMMDD_HHMMSS_CharacterID.txt"
export function parseChatLogFilename(
	name: string,
): { channel: string; date: string; time: string; characterId?: string } | null {
	const match = name.match(/^(.+?)_(\d{8})_(\d{6})(?:_(\d+))?\.txt$/);
	if (!match) return null;
	return { channel: match[1], date: match[2], time: match[3], characterId: match[4] };
}
