import { useState } from "react";
import { Plus } from "lucide-react";
import type { MemberKind } from "@/db/types";

interface MemberInputProps {
	onAdd: (data: {
		kind: MemberKind;
		characterName?: string;
		characterId?: number;
		suiAddress?: string;
		tribeId?: number;
		tribeName?: string;
	}) => void;
}

export function MemberInput({ onAdd }: MemberInputProps) {
	const [kind, setKind] = useState<MemberKind>("character");
	const [name, setName] = useState("");
	const [idValue, setIdValue] = useState("");

	function handleAdd() {
		if (kind === "character") {
			const characterId = idValue ? Number(idValue) : undefined;
			const suiAddress = idValue.startsWith("0x") ? idValue : undefined;
			onAdd({
				kind: "character",
				characterName: name || undefined,
				characterId: suiAddress ? undefined : characterId,
				suiAddress,
			});
		} else {
			onAdd({
				kind: "tribe",
				tribeId: Number(idValue) || undefined,
				tribeName: name || undefined,
			});
		}
		setName("");
		setIdValue("");
	}

	const isValid = kind === "character"
		? name.trim() !== "" || idValue.trim() !== ""
		: idValue.trim() !== "";

	return (
		<div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
			{/* Kind toggle */}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => setKind("character")}
					className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
						kind === "character"
							? "bg-cyan-500/20 text-cyan-400"
							: "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
					}`}
				>
					Character
				</button>
				<button
					type="button"
					onClick={() => setKind("tribe")}
					className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
						kind === "tribe"
							? "bg-cyan-500/20 text-cyan-400"
							: "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
					}`}
				>
					Tribe
				</button>
			</div>

			{/* Inputs */}
			<div className="flex gap-2">
				<input
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={kind === "character" ? "Character name" : "Tribe name"}
					className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<input
					type="text"
					value={idValue}
					onChange={(e) => setIdValue(e.target.value)}
					placeholder={kind === "character" ? "ID or 0x address" : "Tribe ID"}
					className="w-40 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
				<button
					type="button"
					onClick={handleAdd}
					disabled={!isValid}
					className="rounded bg-cyan-600/20 px-2 py-1.5 text-cyan-400 transition-colors hover:bg-cyan-600/30 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Plus size={14} />
				</button>
			</div>
		</div>
	);
}
