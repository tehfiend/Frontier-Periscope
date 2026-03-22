import { CopyAddress } from "@/components/CopyAddress";
import type { GroupMember, MemberKind, PermissionGroup } from "@/db/types";
import { Building2, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MemberInput } from "./MemberInput";

const COLOR_OPTIONS = [
	{ label: "Cyan", value: "#22d3ee" },
	{ label: "Green", value: "#4ade80" },
	{ label: "Red", value: "#f87171" },
	{ label: "Amber", value: "#fbbf24" },
	{ label: "Purple", value: "#a78bfa" },
	{ label: "Blue", value: "#60a5fa" },
	{ label: "Pink", value: "#f472b6" },
	{ label: "Orange", value: "#fb923c" },
];

interface GroupEditorProps {
	group?: PermissionGroup;
	members: GroupMember[];
	onSave: (data: { name: string; color: string; description?: string }) => void;
	onAddMember: (data: {
		kind: MemberKind;
		characterName?: string;
		characterId?: number;
		suiAddress?: string;
		tribeId?: number;
		tribeName?: string;
	}) => void;
	onRemoveMember: (memberId: string) => void;
	onClose: () => void;
}

export function GroupEditor({
	group,
	members,
	onSave,
	onAddMember,
	onRemoveMember,
	onClose,
}: GroupEditorProps) {
	const [name, setName] = useState(group?.name ?? "");
	const [color, setColor] = useState(group?.color ?? COLOR_OPTIONS[0].value);
	const [description, setDescription] = useState(group?.description ?? "");

	useEffect(() => {
		if (group) {
			setName(group.name);
			setColor(group.color);
			setDescription(group.description ?? "");
		}
	}, [group]);

	function handleSave() {
		if (!name.trim()) return;
		onSave({ name: name.trim(), color, description: description.trim() || undefined });
	}

	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
			<div
				className="h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-zinc-100">
						{group ? `Edit Group: ${group.name}` : "Create Group"}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
					>
						<X size={20} />
					</button>
				</div>

				{/* Name */}
				<div className="mb-4">
					<label className="mb-1 block text-xs text-zinc-500">Name</label>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="e.g., Allies, KOS, Blues"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>

				{/* Color */}
				<div className="mb-4">
					<label className="mb-1 block text-xs text-zinc-500">Color</label>
					<div className="flex gap-2">
						{COLOR_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								type="button"
								onClick={() => setColor(opt.value)}
								className={`h-7 w-7 rounded-full border-2 transition-all ${
									color === opt.value
										? "border-white scale-110"
										: "border-transparent hover:border-zinc-600"
								}`}
								style={{ backgroundColor: opt.value }}
								title={opt.label}
							/>
						))}
					</div>
				</div>

				{/* Description */}
				<div className="mb-6">
					<label className="mb-1 block text-xs text-zinc-500">Description (optional)</label>
					<input
						type="text"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Notes about this group"
						className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
					/>
				</div>

				{/* Save button */}
				<button
					type="button"
					onClick={handleSave}
					disabled={!name.trim()}
					className="mb-6 w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{group ? "Save Changes" : "Create Group"}
				</button>

				{/* Members section (only for existing groups) */}
				{group && (
					<>
						<h3 className="mb-3 text-sm font-medium text-zinc-400">Members ({members.length})</h3>

						{members.length > 0 && (
							<div className="mb-4 space-y-1.5">
								{members.map((member) => (
									<div
										key={member.id}
										className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/30 px-3 py-2"
									>
										<div className="flex items-center gap-2 text-xs">
											{member.kind === "character" ? (
												<>
													<Users size={12} className="text-zinc-500" />
													<span className="text-zinc-200">{member.characterName ?? "Unknown"}</span>
													{member.characterId && (
														<span className="text-zinc-600">#{member.characterId}</span>
													)}
													{member.suiAddress && (
														<CopyAddress
															address={member.suiAddress}
															sliceStart={8}
															sliceEnd={0}
															className="text-zinc-600"
														/>
													)}
												</>
											) : (
												<>
													<Building2 size={12} className="text-zinc-500" />
													<span className="text-zinc-200">{member.tribeName ?? "Tribe"}</span>
													{member.tribeId && (
														<span className="text-zinc-600">#{member.tribeId}</span>
													)}
												</>
											)}
										</div>
										<button
											type="button"
											onClick={() => onRemoveMember(member.id)}
											className="text-zinc-600 hover:text-red-400"
										>
											<X size={14} />
										</button>
									</div>
								))}
							</div>
						)}

						<MemberInput onAdd={onAddMember} />
					</>
				)}
			</div>
		</div>
	);
}
