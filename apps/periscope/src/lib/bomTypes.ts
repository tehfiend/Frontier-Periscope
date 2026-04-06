// ── Blueprint types (extracted from Blueprints.tsx) ─────────────────────────

export interface BlueprintInput {
	typeID: number;
	typeName: string;
	quantity: number;
}

export interface Blueprint {
	blueprintID: number;
	primaryTypeID: number;
	primaryTypeName: string;
	runTime: number;
	runTimeFormatted: string;
	inputs: BlueprintInput[];
	outputs: BlueprintInput[];
}

export interface BlueprintData {
	blueprints: Record<string, Blueprint>;
	materialIndex?: Record<string, string[]>;
}

// ── BOM types ───────────────────────────────────────────────────────────────

/** BOM order list item */
export interface BomOrderItem {
	typeId: number;
	typeName: string;
	quantity: number;
}

/** Recipe override (user chose a non-default recipe for an intermediate) */
export interface RecipeOverride {
	typeId: number;
	blueprintId: number;
}

/** Stock entry (from SSU inventory or manual input) */
export interface StockEntry {
	typeId: number;
	quantity: number;
	source: "ssu" | "manual";
	assemblyId?: string;
}

/** Resolved BOM line item */
export interface BomLineItem {
	typeId: number;
	typeName: string;
	quantity: number;
	volume: number;
	volumeMissing: boolean;
	tier: "raw" | "intermediate" | "final";
	blueprintId?: number;
	stockQty: number;
	stillNeed: number;
}

/** Surplus co-product (produced in excess of BOM consumption) */
export interface BomSurplus {
	typeId: number;
	typeName: string;
	quantity: number;
	volume: number;
}
