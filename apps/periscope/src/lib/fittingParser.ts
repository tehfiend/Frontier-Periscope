/**
 * Parse items pasted from the EVE Frontier client.
 *
 * Supports two formats:
 *
 * 1. Ship fitting (copied from fitting window):
 *      [ShipType, ShipName]
 *      ItemName
 *      ItemName xQuantity
 *
 * 2. Inventory (copied from inventory window):
 *      ItemName Qty CategoryInfo Volume
 *      e.g. "Synthetic Mining Lens 1 Asteroid Mining Crystal Small   2 m3"
 *
 * Returns deduplicated items with aggregated quantities.
 * Items not found in the lookup are silently skipped.
 */
export interface ParsedItem {
	typeId: number;
	typeName: string;
	quantity: number;
}

export function parseItemList(
	text: string,
	nameLookup: Map<string, { id: number; name: string }>,
): ParsedItem[] {
	const lines = text.split(/\r?\n/);
	const totals = new Map<number, ParsedItem>();

	function addItem(name: string, qty: number) {
		const entry = nameLookup.get(name.toLowerCase());
		if (!entry) return;
		const existing = totals.get(entry.id);
		if (existing) {
			existing.quantity += qty;
		} else {
			totals.set(entry.id, { typeId: entry.id, typeName: entry.name, quantity: qty });
		}
	}

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;

		// Fitting header: [ShipType, ShipName]
		const headerMatch = line.match(/^\[(.+?)(?:,.*)?]$/);
		if (headerMatch) {
			addItem(headerMatch[1].trim(), 1);
			continue;
		}

		// Fitting item with quantity suffix: "ItemName xN"
		const fittingQtyMatch = line.match(/^(.+?)\s+x(\d+)$/);
		if (fittingQtyMatch) {
			addItem(fittingQtyMatch[1].trim(), Number.parseInt(fittingQtyMatch[2], 10));
			continue;
		}

		// Exact match: entire line is an item name (fitting format, qty 1)
		if (nameLookup.has(line.toLowerCase())) {
			addItem(line, 1);
			continue;
		}

		// Inventory format: greedy longest-name match from the start of the line.
		// After the matched name, the next token should be a bare number (quantity).
		const words = line.split(/\s+/);
		let matched = false;
		for (let i = words.length - 1; i >= 1; i--) {
			const candidate = words.slice(0, i).join(" ");
			const nextWord = words[i];
			const qty = Number.parseInt(nextWord, 10);
			if (!Number.isNaN(qty) && qty > 0 && nameLookup.has(candidate.toLowerCase())) {
				addItem(candidate, qty);
				matched = true;
				break;
			}
		}
		if (matched) continue;

		// Last resort: try progressively shorter prefixes as name with qty=1
		for (let i = words.length - 1; i >= 1; i--) {
			const candidate = words.slice(0, i).join(" ");
			if (nameLookup.has(candidate.toLowerCase())) {
				addItem(candidate, 1);
				matched = true;
				break;
			}
		}
	}

	return [...totals.values()];
}

/** Build a case-insensitive name -> {id, name} lookup from a type list. */
export function buildNameLookup(
	types: Array<{ id: number; name: string }>,
): Map<string, { id: number; name: string }> {
	const map = new Map<string, { id: number; name: string }>();
	for (const t of types) {
		map.set(t.name.toLowerCase(), t);
	}
	return map;
}
