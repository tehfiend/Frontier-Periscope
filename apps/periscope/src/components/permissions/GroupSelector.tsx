import { X } from "lucide-react";
import type { PermissionGroup } from "@/db/types";

interface GroupSelectorProps {
	groups: PermissionGroup[];
	selectedIds: string[];
	onChange: (ids: string[]) => void;
}

export function GroupSelector({ groups, selectedIds, onChange }: GroupSelectorProps) {
	const available = groups.filter((g) => !selectedIds.includes(g.id));

	function handleAdd(groupId: string) {
		onChange([...selectedIds, groupId]);
	}

	function handleRemove(groupId: string) {
		onChange(selectedIds.filter((id) => id !== groupId));
	}

	return (
		<div className="space-y-2">
			{/* Selected groups as chips */}
			<div className="flex flex-wrap gap-1.5">
				{selectedIds.map((id) => {
					const group = groups.find((g) => g.id === id);
					if (!group) return null;
					return (
						<span
							key={id}
							className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200"
						>
							<span
								className="h-2 w-2 rounded-full"
								style={{ backgroundColor: group.color }}
							/>
							{group.name}
							<button
								type="button"
								onClick={() => handleRemove(id)}
								className="ml-0.5 text-zinc-500 hover:text-zinc-300"
							>
								<X size={12} />
							</button>
						</span>
					);
				})}
			</div>

			{/* Add dropdown */}
			{available.length > 0 && (
				<select
					value=""
					onChange={(e) => {
						if (e.target.value) handleAdd(e.target.value);
					}}
					className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-cyan-500 focus:outline-none"
				>
					<option value="">+ Add group</option>
					{available.map((g) => (
						<option key={g.id} value={g.id}>
							{g.name}
						</option>
					))}
				</select>
			)}
		</div>
	);
}
