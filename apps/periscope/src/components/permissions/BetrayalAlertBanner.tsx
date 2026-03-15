import { useState } from "react";
import {
	AlertTriangle,
	ShieldAlert,
	ShieldOff,
	X,
	ChevronDown,
	ChevronRight,
	Skull,
	UserX,
} from "lucide-react";
import type { BetrayalAlert, PermissionGroup } from "@/db/types";

interface BetrayalAlertBannerProps {
	alerts: BetrayalAlert[];
	groups: PermissionGroup[];
	onRevokeAndBlacklist: (alert: BetrayalAlert) => void;
	onDismiss: (alertId: string) => void;
	onDismissAll: () => void;
}

export function BetrayalAlertBanner({
	alerts,
	groups,
	onRevokeAndBlacklist,
	onDismiss,
	onDismissAll,
}: BetrayalAlertBannerProps) {
	const [expanded, setExpanded] = useState(true);

	if (alerts.length === 0) return null;

	function groupName(id: string): string {
		return groups.find((g) => g.id === id)?.name ?? id;
	}

	function attackerLabel(alert: BetrayalAlert): string {
		if (alert.attackerName) return alert.attackerName;
		if (alert.attackerAddress) return `${alert.attackerAddress.slice(0, 10)}...`;
		if (alert.attackerCharacterId) return `Character #${alert.attackerCharacterId}`;
		if (alert.attackerTribeId) return `Tribe #${alert.attackerTribeId}`;
		return "Unknown";
	}

	return (
		<div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30">
			{/* Header */}
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center justify-between p-3"
			>
				<div className="flex items-center gap-2">
					<ShieldAlert size={16} className="text-red-400" />
					<span className="text-sm font-medium text-red-300">
						{alerts.length} Betrayal Alert{alerts.length !== 1 ? "s" : ""}
					</span>
					{expanded ? (
						<ChevronDown size={14} className="text-red-500/60" />
					) : (
						<ChevronRight size={14} className="text-red-500/60" />
					)}
				</div>
				{alerts.length > 1 && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onDismissAll();
						}}
						className="text-xs text-zinc-500 hover:text-zinc-400"
					>
						Dismiss all
					</button>
				)}
			</button>

			{/* Alert list */}
			{expanded && (
				<div className="border-t border-red-900/40 px-3 pb-3">
					{alerts.map((alert) => (
						<div
							key={alert.id}
							className="mt-2 flex items-start justify-between gap-3 rounded-md bg-red-950/40 p-3"
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<Skull size={14} className="shrink-0 text-red-400" />
									<span className="truncate text-sm font-medium text-red-200">
										{attackerLabel(alert)}
									</span>
									<span className="text-xs text-red-500/80">
										{alert.source === "killmail" ? "killed your structure" : "manually reported"}
									</span>
								</div>

								{alert.foundInGroups.length > 0 && (
									<p className="mt-1 text-xs text-red-400/70">
										Found in: {alert.foundInGroups.map(groupName).join(", ")}
									</p>
								)}

								<p className="mt-0.5 text-xs text-zinc-600">
									{new Date(alert.createdAt).toLocaleString()}
								</p>
							</div>

							<div className="flex shrink-0 items-center gap-1.5">
								<button
									type="button"
									onClick={() => onRevokeAndBlacklist(alert)}
									className="flex items-center gap-1.5 rounded-md bg-red-900/50 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-800/60 hover:text-red-100"
									title="Remove from all friendly groups, add to KOS, mark policies dirty"
								>
									<ShieldOff size={12} />
									Revoke & Blacklist
								</button>

								<button
									type="button"
									onClick={() => onDismiss(alert.id)}
									className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
									title="Dismiss alert"
								>
									<X size={14} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── Manual Report Dialog ────────────────────────────────────────────────────

interface ReportBetrayalDialogProps {
	open: boolean;
	onClose: () => void;
	onReport: (params: {
		characterId?: number;
		characterName?: string;
		suiAddress?: string;
		tribeId?: number;
	}) => void;
}

export function ReportBetrayalDialog({ open, onClose, onReport }: ReportBetrayalDialogProps) {
	const [kind, setKind] = useState<"character" | "tribe">("character");
	const [name, setName] = useState("");
	const [idInput, setIdInput] = useState("");

	if (!open) return null;

	function handleSubmit() {
		if (kind === "character") {
			const isAddress = idInput.startsWith("0x");
			onReport({
				characterName: name || undefined,
				characterId: !isAddress && idInput ? Number(idInput) : undefined,
				suiAddress: isAddress ? idInput : undefined,
			});
		} else {
			onReport({
				tribeId: idInput ? Number(idInput) : undefined,
			});
		}
		setName("");
		setIdInput("");
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
			<div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-xl">
				<div className="mb-4 flex items-center gap-2">
					<UserX size={18} className="text-red-400" />
					<h3 className="text-base font-semibold text-zinc-200">Report Hostile</h3>
				</div>

				{/* Kind toggle */}
				<div className="mb-3 flex gap-1 rounded-md bg-zinc-800 p-0.5">
					{(["character", "tribe"] as const).map((k) => (
						<button
							key={k}
							type="button"
							onClick={() => setKind(k)}
							className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
								kind === k
									? "bg-zinc-700 text-zinc-200"
									: "text-zinc-500 hover:text-zinc-400"
							}`}
						>
							{k === "character" ? "Character" : "Tribe"}
						</button>
					))}
				</div>

				{kind === "character" && (
					<>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Character name"
							className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none"
						/>
						<input
							type="text"
							value={idInput}
							onChange={(e) => setIdInput(e.target.value)}
							placeholder="Character ID or 0x... address"
							className="mb-4 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none"
						/>
					</>
				)}

				{kind === "tribe" && (
					<input
						type="text"
						value={idInput}
						onChange={(e) => setIdInput(e.target.value)}
						placeholder="Tribe ID"
						className="mb-4 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none"
					/>
				)}

				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						disabled={!idInput && !name}
						className="flex items-center gap-1.5 rounded-md bg-red-900/60 px-4 py-1.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-800/70 disabled:opacity-50"
					>
						<AlertTriangle size={14} />
						Report & Create Alert
					</button>
				</div>
			</div>
		</div>
	);
}
