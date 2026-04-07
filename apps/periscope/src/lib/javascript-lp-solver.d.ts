declare module "javascript-lp-solver" {
	interface Model {
		optimize: string;
		opType: "min" | "max";
		constraints: Record<string, { min?: number; max?: number; equal?: number }>;
		variables: Record<string, Record<string, number>>;
		ints?: Record<string, number>;
	}

	interface Solution {
		feasible: boolean;
		result: number;
		[key: string]: number | boolean;
	}

	export function Solve(model: Model): Solution;
}
