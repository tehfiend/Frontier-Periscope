import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2, Users, Building2, ShieldOff } from "lucide-react";
import type { PermissionGroup, GroupMember } from "@/db/types";

interface GroupCardProps {
	group: PermissionGroup;
	members: GroupMember[];
	usedByCount?: number;
	onEdit?: () => void;
	onDelete?: () => void;
	/** Called when user clicks "Mark Hostile" on a member */
	onMarkHostile?: (member: GroupMember) => void;
}

export function GroupCard({ group, members, usedByCount, onEdit, onDelete, onMarkHostile }: GroupCardProps) {
	const [expanded, setExpanded] = useState(false);
	const charCount = members.filter((m) => m.kind === "character").length;
	const tribeCount = members.filter((m) => m.kind === "tribe").length;

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
			{/* Header */}
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center justify-between p-4 text-left"
			>
				<div className="flex items-center gap-3">
					{expanded ? (
						<ChevronDown size={14} className="text-zinc-600" />
					) : (
						<ChevronRight size={14} className="text-zinc-600" />
					)}
					<span
						className="h-3 w-3 rounded-full"
						style={{ backgroundColor: group.color }}
					/>
					<div>
						<span className="text-sm font-medium text-zinc-200">
							{group.name}
						</span>
						{group.isBuiltin && (
							<span className="ml-2 text-xs text-zinc-600">(built-in)</span>
						)}
						<p className="text-xs text-zinc-500">
							{charCount} character{charCount !== 1 ? "s" : ""}
							{" · "}
							{tribeCount} tribe{tribeCount !== 1 ? "s" : ""}
						</p>
					</div>
				</div>

				{!group.isBuiltin && (
					<div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
						{onEdit && (
							<button
								type="button"
								onClick={onEdit}
								className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
							>
								<Pencil size={14} />
							</button>
						)}
						{onDelete && (
							<button
								type="button"
								onClick={onDelete}
								className="rounded p-1.5 text-zinc-500 hover:bg-red-900/30 hover:text-red-400"
							>
								<Trash2 size={14} />
							</button>
						)}
					</div>
				)}
			</button>

			{/* Expanded member list */}
			{expanded && members.length > 0 && (
				<div className="border-t border-zinc-800/50 px-4 py-3">
					<div className="space-y-1.5">
						{members.map((member) => (
							<div key={member.id} className="group/member flex items-center gap-2 text-xs text-zinc-400">
								{member.kind === "character" ? (
									<>
										<Users size={12} className="text-zinc-600" />
										<span className="text-zinc-300">
											{member.characterName ?? "Unknown"}
										</span>
										{member.characterId && (
											<span className="text-zinc-600">#{member.characterId}</span>
										)}
										{member.suiAddress && (
											<span className="font-mono text-zinc-600">
												{member.suiAddress.slice(0, 8)}...
											</span>
										)}
									</>
								) : (
									<>
										<Building2 size={12} className="text-zinc-600" />
										<span className="text-zinc-300">
											{member.tribeName ?? "Tribe"}
										</span>
										{member.tribeId && (
											<span className="text-zinc-600">#{member.tribeId}</span>
										)}
									</>
								)}
								{onMarkHostile && !group.isBuiltin && (
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											onMarkHostile(member);
										}}
										className="ml-auto hidden items-center gap-1 rounded px-1.5 py-0.5 text-red-500/70 transition-colors hover:bg-red-900/30 hover:text-red-400 group-hover/member:flex"
										title="Revoke permissions and add to KOS"
									>
										<ShieldOff size={11} />
										<span>Mark Hostile</span>
									</button>
								)}
							</div>
						))}
					</div>
					{usedByCount !== undefined && usedByCount > 0 && (
						<p className="mt-2 text-xs text-zinc-600">
							Used by {usedByCount} polic{usedByCount === 1 ? "y" : "ies"}
						</p>
					)}
				</div>
			)}

			{expanded && members.length === 0 && !group.isBuiltin && (
				<div className="border-t border-zinc-800/50 px-4 py-3 text-xs text-zinc-600">
					No members. Click Edit to add characters or tribes.
				</div>
			)}

			{expanded && group.id === "__self__" && (
				<div className="border-t border-zinc-800/50 px-4 py-3 text-xs text-zinc-500">
					Auto-populated from your characters in Settings
				</div>
			)}

			{expanded && group.id === "__everyone__" && (
				<div className="border-t border-zinc-800/50 px-4 py-3 text-xs text-zinc-500">
					Special group: allowlist+everyone = no restriction, denylist+everyone = block all
				</div>
			)}
		</div>
	);
}
