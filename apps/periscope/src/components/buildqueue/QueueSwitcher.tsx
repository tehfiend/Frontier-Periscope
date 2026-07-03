// Queue switcher -- plan 36 (industry-build-queue), Phase 6.
// Dropdown listing every saved queue (name + order count + relative updatedAt), with select-active,
// per-queue delete (confirm; falls back to the most-recent remaining queue when the active one is
// deleted), plus duplicate-current and new-queue actions. Rename + description editing stay inline
// in QueueHeader. All actions delegate to the buildQueueStore; the list is reactive (useBuildQueues
// in the parent already sorts by updatedAt desc).

import { formatRelativeMs } from "@/components/buildqueue/shared";
import type { BuildQueue } from "@/lib/buildQueueTypes";
import {
	clearQueue,
	createQueue,
	deleteQueue,
	duplicateQueue,
	setActiveQueue,
} from "@/stores/buildQueueStore";
import { Check, ChevronDown, Copy, Eraser, Layers, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface QueueSwitcherProps {
	queue: BuildQueue;
	queues: BuildQueue[];
}

export function QueueSwitcher({ queue, queues }: QueueSwitcherProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	// Close on outside click (matches CharacterSwitcher).
	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		}
		if (open) document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	async function handleNew() {
		setOpen(false);
		const created = await createQueue("New Build Queue");
		await setActiveQueue(created.id);
	}

	async function handleDuplicate() {
		setOpen(false);
		const copy = await duplicateQueue(queue.id);
		if (copy) await setActiveQueue(copy.id);
	}

	async function handleSelect(id: string) {
		setOpen(false);
		if (id !== queue.id) await setActiveQueue(id);
	}

	async function handleReset() {
		if (!confirm(`Reset "${queue.name}"? This clears every order and starts the queue over.`)) return;
		setOpen(false);
		await clearQueue(queue.id);
	}

	async function handleDelete(id: string, name: string) {
		if (!confirm(`Delete build queue "${name}"? This cannot be undone.`)) return;
		if (id === queue.id) {
			// Falling back to the most-recent remaining queue keeps a queue selected; if it was the
			// last one, clear the selection and let BuildQueue's auto-create seed a fresh queue.
			const next = queues.find((q) => q.id !== id);
			await deleteQueue(id);
			await setActiveQueue(next ? next.id : null);
		} else {
			await deleteQueue(id);
		}
	}

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-cyan-500/60"
				title="Switch build queue"
			>
				<Layers size={13} className="text-cyan-500" />
				<span className="max-w-[10rem] truncate">{queue.name}</span>
				<span className="text-zinc-600">({queues.length})</span>
				<ChevronDown
					size={13}
					className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
				/>
			</button>

			{open && (
				<div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
					<div className="max-h-72 overflow-y-auto">
						{queues.map((q) => {
							const isActive = q.id === queue.id;
							return (
								<div
									key={q.id}
									className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-800 ${
										isActive ? "text-cyan-400" : "text-zinc-300"
									}`}
								>
									<button
										type="button"
										onClick={() => handleSelect(q.id)}
										className="flex min-w-0 flex-1 items-center gap-2 text-left"
									>
										{isActive ? (
											<Check size={13} className="shrink-0" />
										) : (
											<span className="w-[13px] shrink-0" />
										)}
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate leading-tight">{q.name}</span>
											<span className="truncate text-[10px] leading-tight text-zinc-600">
												{q.batches.length} order{q.batches.length === 1 ? "" : "es"} ·{" "}
												{formatRelativeMs(q.updatedAt)}
											</span>
										</span>
									</button>
									<button
										type="button"
										onClick={() => handleDelete(q.id, q.name)}
										className="shrink-0 rounded p-1 text-zinc-700 hover:text-red-400"
										title="Delete queue"
										aria-label={`Delete ${q.name}`}
									>
										<Trash2 size={13} />
									</button>
								</div>
							);
						})}
					</div>

					<div className="my-1 border-t border-zinc-800" />

					<button
						type="button"
						onClick={handleReset}
						className="flex w-full items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-amber-300"
					>
						<Eraser size={13} />
						Reset current queue (clear all orders)
					</button>
					<button
						type="button"
						onClick={handleDuplicate}
						className="flex w-full items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-cyan-300"
					>
						<Copy size={13} />
						Duplicate current queue
					</button>
					<button
						type="button"
						onClick={handleNew}
						className="flex w-full items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-cyan-300"
					>
						<Plus size={13} />
						New queue
					</button>
				</div>
			)}
		</div>
	);
}
