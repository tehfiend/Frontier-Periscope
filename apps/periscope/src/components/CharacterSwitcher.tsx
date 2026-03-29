import { useState, useRef, useEffect, useMemo } from "react";
import { useActiveCharacter } from "@/hooks/useActiveCharacter";
import { useActiveTenant } from "@/hooks/useOwnedAssemblies";
import { useAppStore } from "@/stores/appStore";
import { db } from "@/db";
import { AddCharacterDialog } from "./AddCharacterDialog";
import { TENANTS, type TenantId } from "@/chain/config";
import { ChevronDown, Users, User, Link2, Gamepad2, Wallet, PenLine, Plus, Trash2, ArrowLeftRight } from "lucide-react";
import type { CharacterRecord, CharacterSource } from "@/db/types";

function SourceIcon({ source }: { source?: CharacterSource }) {
	switch (source) {
		case "log":
			return <span title="From game logs"><Gamepad2 size={10} className="text-zinc-600" /></span>;
		case "wallet":
			return <span title="From wallet"><Wallet size={10} className="text-zinc-600" /></span>;
		case "manual":
			return <span title="Manual entry"><PenLine size={10} className="text-zinc-600" /></span>;
		default:
			return null;
	}
}

const TENANT_IDS = Object.keys(TENANTS) as TenantId[];

function CharacterEntry({
	char,
	isActive,
	onClick,
	onDelete,
	onChangeServer,
}: {
	char: CharacterRecord;
	isActive: boolean;
	onClick: () => void;
	onDelete: () => void;
	onChangeServer: (newTenant: TenantId) => void;
}) {
	const otherTenants = TENANT_IDS.filter((t) => t !== char.tenant);

	return (
		<div
			className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-zinc-800 ${
				isActive ? "text-cyan-400" : "text-zinc-300"
			}`}
		>
			<button type="button" onClick={onClick} className="flex flex-1 items-center gap-2 min-w-0">
				<User size={14} className="shrink-0" />
				<div className="flex flex-1 flex-col items-start gap-0 truncate">
					<span className="truncate leading-tight">{char.characterName}</span>
					<span className="truncate text-[10px] leading-tight text-zinc-600">
						{char.tribe
							? char.tribe
							: char.tribeId
								? `Tribe #${char.tribeId}`
								: char.tenant ?? ""}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					<SourceIcon source={char.source} />
					{char.isActive && (
						<span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Online" />
					)}
					<span title={char.suiAddress ? `Linked: ${char.suiAddress.slice(0, 10)}...` : "Not linked"}>
						{char.suiAddress ? (
							<Link2 size={12} className="text-cyan-500" />
						) : (
							<Link2 size={12} className="text-zinc-700" />
						)}
					</span>
				</div>
			</button>
			{otherTenants.length === 1 && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onChangeServer(otherTenants[0]);
					}}
					className="shrink-0 rounded p-1 text-zinc-700 transition-colors hover:bg-zinc-700 hover:text-amber-400"
					title={`Move to ${TENANTS[otherTenants[0]].name}`}
				>
					<ArrowLeftRight size={12} />
				</button>
			)}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onDelete();
				}}
				className="shrink-0 rounded p-1 text-zinc-700 transition-colors hover:bg-zinc-700 hover:text-red-400"
				title="Remove character"
			>
				<Trash2 size={12} />
			</button>
		</div>
	);
}

export function CharacterSwitcher() {
	const [open, setOpen] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const { activeCharacterId, activeCharacter, allCharacters } = useActiveCharacter();
	const tenant = useActiveTenant();
	const setActiveCharacterId = useAppStore((s) => s.setActiveCharacterId);
	const collapsed = useAppStore((s) => s.sidebarCollapsed);

	// Only show characters belonging to the active server
	const filteredCharacters = useMemo(
		() => allCharacters.filter((c) => c.tenant === tenant),
		[allCharacters, tenant],
	);

	// Reset selection only if the character was deleted (not found in any tenant).
	// Don't reset based on tenant filtering -- tenant setting may still be loading.
	useEffect(() => {
		if (activeCharacterId === "all") return;
		if (allCharacters.length === 0) return;
		const exists = allCharacters.some((c) => c.id === activeCharacterId);
		if (!exists) {
			setActiveCharacterId("all");
		}
	}, [activeCharacterId, allCharacters, setActiveCharacterId]);

	// Close dropdown on outside click
	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	const displayName =
		activeCharacterId === "all"
			? "All Characters"
			: activeCharacter?.characterName ?? "Unknown";

	const subtitle =
		activeCharacterId === "all"
			? filteredCharacters.length > 0
				? `${filteredCharacters.length} character${filteredCharacters.length !== 1 ? "s" : ""}`
				: undefined
			: activeCharacter?.tribe ?? activeCharacter?.tenant ?? undefined;

	return (
		<>
			<div ref={ref} className="relative px-2 py-2">
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
				>
					{activeCharacterId === "all" ? (
						<Users size={14} className="shrink-0 text-cyan-500" />
					) : (
						<User size={14} className="shrink-0 text-cyan-500" />
					)}
					{!collapsed && (
						<>
							<div className="flex flex-1 flex-col items-start truncate">
								<span className="truncate leading-tight">{displayName}</span>
								{subtitle && (
									<span className="truncate text-[10px] leading-tight text-zinc-600">
										{subtitle}
									</span>
								)}
							</div>
							<ChevronDown
								size={14}
								className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
							/>
						</>
					)}
				</button>

				{open && (
					<div className="absolute left-2 right-2 top-full z-50 mt-1 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
						{filteredCharacters.length > 0 && (
							<>
								<button
									type="button"
									onClick={() => {
										setActiveCharacterId("all");
										setOpen(false);
									}}
									className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-zinc-800 ${
										activeCharacterId === "all" ? "text-cyan-400" : "text-zinc-300"
									}`}
								>
									<Users size={14} />
									<span className="flex-1 text-left">All Characters</span>
									<span className="text-xs text-zinc-600">{filteredCharacters.length}</span>
								</button>
								<div className="my-1 border-t border-zinc-800" />
								{filteredCharacters.map((char) => (
									<CharacterEntry
										key={char.id}
										char={char}
										isActive={activeCharacterId === char.id}
										onClick={() => {
											setActiveCharacterId(char.id);
											setOpen(false);
										}}
										onChangeServer={async (newTenant) => {
											await db.characters.update(char.id, {
												tenant: newTenant,
												updatedAt: new Date().toISOString(),
											});
										}}
										onDelete={async () => {
											if (!confirm(`Remove "${char.characterName}"?`)) return;
											await db.characters.update(char.id, {
												_deleted: true,
												updatedAt: new Date().toISOString(),
											});
											if (activeCharacterId === char.id) {
												setActiveCharacterId("all");
											}
										}}
									/>
								))}
								<div className="my-1 border-t border-zinc-800" />
							</>
						)}
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								setDialogOpen(true);
							}}
							className="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-cyan-400"
						>
							<Plus size={14} />
							<span>Add Character</span>
						</button>
					</div>
				)}
			</div>

			<AddCharacterDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
		</>
	);
}
