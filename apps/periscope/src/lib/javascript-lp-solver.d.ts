declare module "javascript-lp-solver" {
	export interface Model {
		optimize: string;
		opType: "min" | "max";
		constraints: Record<string, { min?: number; max?: number; equal?: number }>;
		variables: Record<string, Record<string, number>>;
		ints?: Record<string, number>;
		options?: { timeout?: number; tolerance?: number };
	}

	interface Solution {
		feasible: boolean;
		result: number;
		[key: string]: number | boolean;
	}

	interface Solver {
		Solve(model: Model): Solution;
	}

	const solver: Solver;
	export default solver;
}
