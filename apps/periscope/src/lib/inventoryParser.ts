/**
 * Parse the EVE Frontier *inventory* clipboard paste into resolved type quantities.
 *
 * The inventory window copies tab-delimited rows:
 *
 *     name <TAB> qty <TAB> group <TAB> [size] <TAB> totalVolume (m3)
 *
 * The `size` column is empty for most rows, and `totalVolume` is the *total* volume
 * (qty x unit volume), e.g. "Tritanium\t1000\tMineral\t\t10 m3".
 *
 * Unlike `parseItemList` (which silently drops names it cannot match), this parser
 * routes every unmatched item row into the `unresolved` bucket so nothing is lost.
 * It reuses `buildNameLookup` from `fittingParser` for the primary name -> typeId
 * resolution and adds a volume cross-check (totalVolume / qty vs `GameType.volume`)
 * to disambiguate names shared by more than one type.
 *
 * Volume parsing assumes US-style formatting (comma = thousands separator,
 * period = decimal point).
 */
import { buildNameLookup } from "./fittingParser";

/** Minimal type info needed for resolution; `GameType` satisfies this structurally. */
export interface InventoryTypeInfo {
	id: number;
	name: string;
	/** Per-unit volume in m3 (from `GameType.volume`); used to disambiguate name collisions. */
	volume: number;
}

export interface ParsedInventoryItem {
	typeId: number;
	qty: number;
}

export interface ParsedInventoryUnresolved {
	name: string;
	qty: number;
	/** Per-unit volume in m3 (totalVolume / qty) when derivable from the paste. */
	vol?: number;
}

export interface ParsedInventory {
	items: ParsedInventoryItem[];
	unresolved: ParsedInventoryUnresolved[];
}

/** Strip thousands separators / units and read an integer quantity. */
function parseQty(s: string | undefined): number {
	if (!s) return 0;
	const digits = s.replace(/[^\d]/g, "");
	return digits ? Number.parseInt(digits, 10) : 0;
}

/** Read a decimal volume from a cell like "1,610.4 m3" (US formatting). */
function parseVolume(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const cleaned = s.replace(/m³|m3/gi, "").replace(/,/g, "").trim();
	const match = cleaned.match(/-?\d+(?:\.\d+)?/);
	if (!match) return undefined;
	const v = Number.parseFloat(match[0]);
	return Number.isFinite(v) ? v : undefined;
}

/** Find the volume token in the trailing words of a whitespace-collapsed row. */
function scanTailVolume(words: string[]): number | undefined {
	// Prefer a token carrying the m3 unit (or the number just before a bare "m3").
	for (let i = 0; i < words.length; i++) {
		if (/m³|m3/i.test(words[i])) {
			const here = parseVolume(words[i]);
			if (here != null) return here;
			const prev = parseVolume(words[i - 1]);
			if (prev != null) return prev;
		}
	}
	// Otherwise fall back to the last numeric token.
	for (let i = words.length - 1; i >= 0; i--) {
		const v = parseVolume(words[i]);
		if (v != null) return v;
	}
	return undefined;
}

/**
 * Parse an EVE Frontier inventory paste.
 *
 * @param text  Raw clipboard text (tab-delimited rows; whitespace rows tolerated).
 * @param types Candidate types to resolve against (typically `db.gameTypes`).
 */
export function parseInventoryPaste(text: string, types: InventoryTypeInfo[]): ParsedInventory {
	const lookup = buildNameLookup(types);

	// Collision map: lowercase name -> candidate types, only for names shared by >1 type.
	const grouped = new Map<string, InventoryTypeInfo[]>();
	for (const t of types) {
		const key = t.name.toLowerCase();
		const arr = grouped.get(key);
		if (arr) arr.push(t);
		else grouped.set(key, [t]);
	}
	const collisions = new Map<string, InventoryTypeInfo[]>();
	for (const [key, arr] of grouped) {
		if (arr.length > 1) collisions.set(key, arr);
	}

	const items = new Map<number, number>();
	const unresolved = new Map<string, ParsedInventoryUnresolved>();

	function pickByVolume(
		cands: InventoryTypeInfo[],
		totalVol: number | undefined,
		qty: number,
	): InventoryTypeInfo | undefined {
		// Disambiguate only when the paste gives a usable per-unit volume; otherwise return undefined so
		// the caller routes the ambiguous name to the unresolved bucket rather than guessing a typeId.
		if (totalVol == null || qty <= 0) return undefined;
		const unit = totalVol / qty;
		const ranked = cands
			.map((c) => ({ c, diff: Math.abs(c.volume - unit) }))
			.sort((a, b) => a.diff - b.diff);
		const best = ranked[0];
		if (!best) return undefined;
		// The closest candidate must sit within a relative tolerance of the observed unit volume...
		const tol = Math.max(0.05 * Math.max(best.c.volume, unit), 1e-6);
		if (best.diff > tol) return undefined;
		// ...and be clearly closer than the runner-up, else it is an ambiguous tie -> unresolved.
		const second = ranked[1];
		if (second && second.diff - best.diff <= tol) return undefined;
		return best.c;
	}

	function record(rawName: string, qty: number, totalVol: number | undefined): void {
		const name = rawName.trim();
		if (!name || qty <= 0) return;
		const key = name.toLowerCase();

		const ambiguous = collisions.get(key);
		// An un-disambiguable collision yields undefined here -> falls through to the unresolved bucket.
		const typeId = ambiguous ? pickByVolume(ambiguous, totalVol, qty)?.id : lookup.get(key)?.id;

		if (typeId != null) {
			items.set(typeId, (items.get(typeId) ?? 0) + qty);
			return;
		}

		const unit = totalVol != null && qty > 0 ? totalVol / qty : undefined;
		const existing = unresolved.get(key);
		if (existing) {
			existing.qty += qty;
			if (existing.vol == null && unit != null) existing.vol = unit;
		} else {
			unresolved.set(key, { name, qty, vol: unit });
		}
	}

	function parseWhitespaceRow(line: string): void {
		// Fitting quantity suffix: "ItemName xN".
		const fittingQty = line.match(/^(.+?)\s+x(\d+)$/i);
		if (fittingQty) {
			record(fittingQty[1].trim(), Number.parseInt(fittingQty[2], 10), undefined);
			return;
		}
		// Entire line is a known name (fitting single item, qty 1).
		if (lookup.has(line.toLowerCase())) {
			record(line, 1, undefined);
			return;
		}
		const words = line.split(/\s+/);
		// Greedy: longest known-name prefix followed by an integer quantity.
		for (let i = words.length - 1; i >= 1; i--) {
			const candidate = words.slice(0, i).join(" ");
			const qty = parseQty(words[i]);
			if (qty > 0 && lookup.has(candidate.toLowerCase())) {
				record(candidate, qty, scanTailVolume(words.slice(i + 1)));
				return;
			}
		}
		// Fallback: first bare-integer token is the quantity, preceding words the name.
		for (let i = 1; i < words.length; i++) {
			if (/^[\d,]+$/.test(words[i])) {
				const qty = parseQty(words[i]);
				if (qty > 0) {
					record(words.slice(0, i).join(" "), qty, scanTailVolume(words.slice(i + 1)));
					return;
				}
			}
		}
		// No quantity found: treat the whole line as a name with qty 1 (-> unresolved).
		record(line, 1, undefined);
	}

	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		// Skip fitting headers like "[Ship, Name]".
		if (/^\[.*]$/.test(line)) continue;

		if (raw.includes("\t")) {
			const cols = raw.split("\t");
			const name = cols[0]?.trim() ?? "";
			const qty = parseQty(cols[1]);
			// Total volume = rightmost numeric column after the quantity column.
			let totalVol: number | undefined;
			for (let i = cols.length - 1; i >= 2; i--) {
				const v = parseVolume(cols[i]);
				if (v != null) {
					totalVol = v;
					break;
				}
			}
			record(name, qty, totalVol);
			continue;
		}

		parseWhitespaceRow(line);
	}

	return {
		items: [...items.entries()].map(([typeId, qty]) => ({ typeId, qty })),
		unresolved: [...unresolved.values()],
	};
}
