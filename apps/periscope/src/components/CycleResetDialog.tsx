import { db } from "@/db";
import { CYCLE_BOUND_TABLES } from "@/lib/constants";
import { resetForNewCycle } from "@/lib/cycleReset";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useState } from "react";

interface CycleResetDialogProps {
	onClose: () => void;
}

export function CycleResetDialog({ onClose }: CycleResetDialogProps) {
	const [archive, setArchive] = useState(true);
	const [isRunning, setIsRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Live row counts for the CLEAR partition (skips any name absent from the live schema).
	const counts = useLiveQuery(async () => {
		const live = new Set(db.tables.map((t) => t.name));
		const entries: { name: string; count: number }[] = [];
		for (const name of CYCLE_BOUND_TABLES) {
			if (!live.has(name)) continue;
			entries.push({ name, count: await db.table(name).count() });
		}
		return entries;
	}, []);

	const totalRows = counts?.reduce((sum, e) => sum + e.count, 0) ?? 0;

	async function handleReset() {
		setIsRunning(true);
		setError(null);
		try {
			// Attended/manual path: a gesture-driven download is an acceptable best-effort archive.
			await resetForNewCycle({ archive, unattended: false });
			window.location.reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setIsRunning(false);
		}
	}

	// Dismissal (backdrop click, Escape, X) is a no-op while a reset is in flight -- a clear is
	// running and tearing down the dialog mid-operation would hide its progress/errors.
	function handleDismiss() {
		if (isRunning) return;
		onClose();
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			onClick={handleDismiss}
			onKeyDown={(e) => {
				if (e.key === "Escape") handleDismiss();
			}}
		>
			<div
				className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={() => {}}
			>
				{/* Header */}
				<div className="mb-5 flex items-center justify-between">
					<h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
						<AlertTriangle size={18} className="text-red-500" />
						Reset for new cycle
					</h2>
					<button
						type="button"
						onClick={handleDismiss}
						className="text-zinc-500 hover:text-zinc-300"
					>
						<X size={18} />
					</button>
				</div>

				<div className="space-y-4">
					<p className="text-sm text-zinc-400">
						EVE Frontier re-mints every on-chain object with new ids each cycle. This archives then
						clears cycle-bound data and keeps your preferences and static map data.
					</p>

					{/* Clear summary */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
						<p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-400">
							Will clear -- {totalRows.toLocaleString()} rows
						</p>
						<div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto text-xs">
							{counts?.map((e) => (
								<div key={e.name} className="flex items-center justify-between gap-2">
									<span className="truncate text-zinc-400">{e.name}</span>
									<span className="shrink-0 text-zinc-500">{e.count.toLocaleString()}</span>
								</div>
							))}
						</div>
					</div>

					{/* Keep summary */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
						<span className="font-medium text-zinc-400">Kept:</span> preferences, currencies, notes,
						and static reference data (solar systems, regions, jumps, celestials, game types).
					</div>

					{/* Archive toggle */}
					<label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
						<input
							type="checkbox"
							checked={archive}
							onChange={(e) => setArchive(e.target.checked)}
							className="mt-0.5"
						/>
						<span>
							Archive before clearing
							<span className="mt-0.5 block text-xs text-zinc-500">
								Writes a recoverable JSON file to your configured backup directory if set, otherwise
								downloads it. Re-import via Backup &amp; Restore.
							</span>
						</span>
					</label>

					{error && (
						<div className="flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-xs text-red-300">
							<AlertTriangle size={14} className="shrink-0" />
							<span>{error}</span>
						</div>
					)}

					{/* Actions */}
					<div className="flex gap-3">
						<button
							type="button"
							onClick={handleDismiss}
							disabled={isRunning}
							className="flex-1 rounded-lg border border-zinc-700 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleReset}
							disabled={isRunning}
							className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isRunning ? <Loader2 size={14} className="animate-spin" /> : null}
							{isRunning ? "Resetting..." : "Reset for new cycle"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
