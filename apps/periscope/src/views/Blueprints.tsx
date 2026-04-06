import { useBlueprintData } from "@/hooks/useBlueprintData";
import type { Blueprint } from "@/lib/bomTypes";
import { ArrowRight, Clock, Minus, Package, Plus, Search, Wrench, X } from "lucide-react";
import { useMemo, useState } from "react";

export function Blueprints() {
	const { blueprintList, isLoading } = useBlueprintData();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedBp, setSelectedBp] = useState<Blueprint | null>(null);
	const [runs, setRuns] = useState(1);

	const filtered = useMemo(() => {
		if (!searchQuery) return blueprintList;
		const q = searchQuery.toLowerCase();
		return blueprintList.filter(
			(bp) =>
				bp.primaryTypeName.toLowerCase().includes(q) ||
				bp.inputs.some((i) => i.typeName.toLowerCase().includes(q)),
		);
	}, [blueprintList, searchQuery]);

	// Aggregate materials for the selected blueprint * runs
	const scaledMaterials = useMemo(() => {
		if (!selectedBp) return [];
		return selectedBp.inputs.map((input) => ({
			...input,
			quantity: input.quantity * runs,
		}));
	}, [selectedBp, runs]);

	const scaledOutputs = useMemo(() => {
		if (!selectedBp) return [];
		return selectedBp.outputs.map((output) => ({
			...output,
			quantity: output.quantity * runs,
		}));
	}, [selectedBp, runs]);

	const totalTime = selectedBp ? selectedBp.runTime * runs : 0;

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-zinc-500">Loading blueprint data...</p>
			</div>
		);
	}

	if (blueprintList.length === 0) {
		return (
			<div className="p-6">
				<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
					<Wrench size={24} className="text-violet-500" />
					Blueprint Calculator
				</h1>
				<div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
					<p className="text-sm text-zinc-500">
						Blueprint data not found. Run the extraction script to generate blueprints.json.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full">
			{/* Blueprint List */}
			<div className="flex w-80 shrink-0 flex-col border-r border-zinc-800">
				<div className="border-b border-zinc-800 px-4 py-3">
					<h1 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
						<Wrench size={16} className="text-violet-500" />
						Blueprints
						<span className="text-xs text-zinc-500">({blueprintList.length})</span>
					</h1>
				</div>

				{/* Search */}
				<div className="relative border-b border-zinc-800 px-3 py-2">
					<Search size={12} className="absolute left-5 top-4 text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search blueprints or materials..."
						className="w-full rounded border border-zinc-700 bg-zinc-900 py-1 pl-7 pr-7 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-violet-600 focus:outline-none"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="absolute right-5 top-4 text-zinc-500 hover:text-zinc-300"
						>
							<X size={12} />
						</button>
					)}
				</div>

				{/* List */}
				<div className="flex-1 overflow-y-auto">
					{filtered.map((bp) => (
						<button
							key={bp.blueprintID}
							type="button"
							onClick={() => {
								setSelectedBp(bp);
								setRuns(1);
							}}
							className={`flex w-full flex-col border-b border-zinc-800/50 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/50 ${
								selectedBp?.blueprintID === bp.blueprintID ? "bg-zinc-800/70" : ""
							}`}
						>
							<span className="text-sm font-medium text-zinc-200 line-clamp-1">
								{bp.primaryTypeName}
							</span>
							<div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
								<Clock size={10} />
								<span>{bp.runTimeFormatted}</span>
								<span className="text-zinc-700">·</span>
								<span>{bp.inputs.length} materials</span>
							</div>
						</button>
					))}
					{filtered.length === 0 && (
						<div className="p-4 text-center text-xs text-zinc-600">No blueprints match</div>
					)}
				</div>
			</div>

			{/* Detail Panel */}
			<div className="flex-1 overflow-y-auto">
				{selectedBp ? (
					<div className="p-6">
						{/* Header */}
						<h2 className="text-xl font-bold text-zinc-100">{selectedBp.primaryTypeName}</h2>
						<div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
							<span className="flex items-center gap-1">
								<Clock size={14} />
								{selectedBp.runTimeFormatted} per run
							</span>
							<span>Blueprint #{selectedBp.blueprintID}</span>
						</div>

						{/* Run multiplier */}
						<div className="mt-6 flex items-center gap-4">
							<span className="text-sm text-zinc-400">Runs:</span>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => setRuns(Math.max(1, runs - 1))}
									className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-zinc-200"
								>
									<Minus size={14} />
								</button>
								<input
									type="number"
									value={runs}
									onChange={(e) => setRuns(Math.max(1, Number.parseInt(e.target.value) || 1))}
									min={1}
									className="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-center text-sm text-zinc-100 focus:border-violet-600 focus:outline-none"
								/>
								<button
									type="button"
									onClick={() => setRuns(runs + 1)}
									className="rounded border border-zinc-700 p-1 text-zinc-400 hover:text-zinc-200"
								>
									<Plus size={14} />
								</button>
							</div>
							{runs > 1 && (
								<div className="flex items-center gap-2 text-xs text-zinc-500">
									<span className="flex items-center gap-1">
										<Clock size={12} />
										Total: {formatTime(totalTime)}
									</span>
								</div>
							)}
						</div>

						{/* Materials */}
						<div className="mt-6">
							<h3 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
								<Package size={14} className="text-orange-400" />
								Required Materials
							</h3>
							<div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b border-zinc-800 text-xs text-zinc-500">
											<th className="px-4 py-2 text-left">Material</th>
											<th className="px-4 py-2 text-right">Per Run</th>
											{runs > 1 && <th className="px-4 py-2 text-right">Total ({runs}x)</th>}
										</tr>
									</thead>
									<tbody>
										{scaledMaterials.map((mat) => (
											<tr
												key={mat.typeID}
												className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
											>
												<td className="px-4 py-2 text-zinc-200">{mat.typeName}</td>
												<td className="px-4 py-2 text-right font-mono text-zinc-400">
													{selectedBp.inputs
														.find((i) => i.typeID === mat.typeID)
														?.quantity.toLocaleString()}
												</td>
												{runs > 1 && (
													<td className="px-4 py-2 text-right font-mono text-violet-300">
														{mat.quantity.toLocaleString()}
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>

						{/* Outputs */}
						<div className="mt-6">
							<h3 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
								<ArrowRight size={14} className="text-green-400" />
								Outputs
							</h3>
							<div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
								<table className="w-full text-sm">
									<thead>
										<tr className="border-b border-zinc-800 text-xs text-zinc-500">
											<th className="px-4 py-2 text-left">Product</th>
											<th className="px-4 py-2 text-right">Per Run</th>
											{runs > 1 && <th className="px-4 py-2 text-right">Total ({runs}x)</th>}
										</tr>
									</thead>
									<tbody>
										{scaledOutputs.map((out) => (
											<tr key={out.typeID} className="border-b border-zinc-800/50">
												<td className="px-4 py-2 font-medium text-green-300">{out.typeName}</td>
												<td className="px-4 py-2 text-right font-mono text-zinc-400">
													{selectedBp.outputs
														.find((o) => o.typeID === out.typeID)
														?.quantity.toLocaleString()}
												</td>
												{runs > 1 && (
													<td className="px-4 py-2 text-right font-mono text-green-300">
														{out.quantity.toLocaleString()}
													</td>
												)}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					</div>
				) : (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<Wrench size={48} className="mx-auto mb-3 text-zinc-800" />
							<p className="text-sm text-zinc-500">Select a blueprint to calculate materials</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	const parts = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	if (s > 0) parts.push(`${s}s`);
	return parts.join(" ") || "0s";
}
