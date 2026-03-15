import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, notDeleted } from "@/db";
import { StickyNote, Plus, Pencil, Trash2, Check, X, Search } from "lucide-react";
import type { NoteIntel } from "@/db/types";

export function Notes() {
	const notes = useLiveQuery(() => db.notes.orderBy("updatedAt").reverse().filter(notDeleted).toArray());
	const [searchQuery, setSearchQuery] = useState("");
	const [editing, setEditing] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const filtered = notes?.filter((n) => {
		if (!searchQuery) return true;
		const q = searchQuery.toLowerCase();
		return n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);
	});

	async function createNote() {
		const note: NoteIntel = {
			id: crypto.randomUUID(),
			title: "New Note",
			body: "",
			linkedEntities: [],
			source: "manual",
			tags: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await db.notes.put(note);
		setEditing(note.id);
		setCreating(false);
	}

	async function deleteNote(id: string) {
		if (!confirm("Delete this note?")) return;
		await db.notes.update(id, { _deleted: true, updatedAt: new Date().toISOString() });
		if (editing === id) setEditing(null);
	}

	return (
		<div className="flex h-full">
			{/* Sidebar - Note list */}
			<div className="flex w-72 shrink-0 flex-col border-r border-zinc-800">
				<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
					<h1 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
						<StickyNote size={16} className="text-lime-500" />
						Notes
					</h1>
					<button
						type="button"
						onClick={createNote}
						className="flex items-center gap-1 rounded bg-lime-600 px-2 py-1 text-xs font-medium text-white hover:bg-lime-500"
					>
						<Plus size={12} />
						New
					</button>
				</div>

				{/* Search */}
				<div className="relative border-b border-zinc-800 px-3 py-2">
					<Search size={12} className="absolute left-5 top-4 text-zinc-500" />
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search notes..."
						className="w-full rounded border border-zinc-700 bg-zinc-900 py-1 pl-7 pr-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-lime-600 focus:outline-none"
					/>
				</div>

				{/* Note list */}
				<div className="flex-1 overflow-y-auto">
					{filtered && filtered.length > 0 ? (
						filtered.map((note) => (
							<button
								key={note.id}
								type="button"
								onClick={() => setEditing(note.id)}
								className={`flex w-full flex-col border-b border-zinc-800/50 px-4 py-3 text-left transition-colors hover:bg-zinc-800/50 ${
									editing === note.id ? "bg-zinc-800/70" : ""
								}`}
							>
								<span className="text-sm font-medium text-zinc-200 line-clamp-1">
									{note.title || "Untitled"}
								</span>
								<span className="mt-0.5 text-xs text-zinc-500 line-clamp-2">
									{note.body || "Empty note"}
								</span>
								<span className="mt-1 text-xs text-zinc-600">
									{new Date(note.updatedAt).toLocaleDateString()}
								</span>
							</button>
						))
					) : (
						<div className="p-4 text-center text-xs text-zinc-600">
							{searchQuery ? "No matching notes" : "No notes yet"}
						</div>
					)}
				</div>
			</div>

			{/* Editor */}
			<div className="flex-1">
				{editing ? (
					<NoteEditor noteId={editing} onClose={() => setEditing(null)} onDelete={deleteNote} />
				) : (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<StickyNote size={48} className="mx-auto mb-3 text-zinc-800" />
							<p className="text-sm text-zinc-500">
								Select a note or create a new one
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function NoteEditor({
	noteId,
	onClose,
	onDelete,
}: {
	noteId: string;
	onClose: () => void;
	onDelete: (id: string) => void;
}) {
	const note = useLiveQuery(() => db.notes.get(noteId), [noteId]);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [tagInput, setTagInput] = useState("");
	const [dirty, setDirty] = useState(false);

	// Sync state from DB when note changes
	const [loadedId, setLoadedId] = useState<string | null>(null);
	if (note && note.id !== loadedId) {
		setTitle(note.title);
		setBody(note.body);
		setLoadedId(note.id);
		setDirty(false);
	}

	const save = useCallback(async () => {
		if (!note) return;
		try {
			await db.notes.update(noteId, {
				title,
				body,
				updatedAt: new Date().toISOString(),
			});
			setDirty(false);
		} catch (e) {
			console.error("[Notes] Save failed:", e);
			alert("Failed to save note. Please try again.");
		}
	}, [noteId, title, body, note]);

	async function addTag() {
		const tag = tagInput.trim();
		if (!tag || !note) return;
		if (note.tags.includes(tag)) return;
		await db.notes.update(noteId, {
			tags: [...note.tags, tag],
			updatedAt: new Date().toISOString(),
		});
		setTagInput("");
	}

	async function removeTag(tag: string) {
		if (!note) return;
		await db.notes.update(noteId, {
			tags: note.tags.filter((t) => t !== tag),
			updatedAt: new Date().toISOString(),
		});
	}

	if (!note) return null;

	return (
		<div className="flex h-full flex-col">
			{/* Toolbar */}
			<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
				<div className="flex items-center gap-2">
					{dirty && <span className="text-xs text-yellow-500">Unsaved</span>}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={save}
						disabled={!dirty}
						className="flex items-center gap-1 rounded bg-lime-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-lime-500 disabled:opacity-40"
					>
						<Check size={12} />
						Save
					</button>
					<button
						type="button"
						onClick={() => onDelete(noteId)}
						className="text-zinc-600 hover:text-red-400"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>

			{/* Title */}
			<input
				type="text"
				value={title}
				onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
				placeholder="Note title..."
				className="border-b border-zinc-800/50 bg-transparent px-6 py-4 text-xl font-bold text-zinc-100 placeholder:text-zinc-700 focus:outline-none"
			/>

			{/* Tags */}
			<div className="flex items-center gap-2 border-b border-zinc-800/50 px-6 py-2">
				{note.tags.map((tag) => (
					<span key={tag} className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
						{tag}
						<button type="button" onClick={() => removeTag(tag)} className="text-zinc-600 hover:text-zinc-300">
							<X size={10} />
						</button>
					</span>
				))}
				<input
					type="text"
					value={tagInput}
					onChange={(e) => setTagInput(e.target.value)}
					onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
					placeholder="Add tag..."
					className="bg-transparent text-xs text-zinc-400 placeholder:text-zinc-700 focus:outline-none"
				/>
			</div>

			{/* Body */}
			<textarea
				value={body}
				onChange={(e) => { setBody(e.target.value); setDirty(true); }}
				placeholder="Write your intel notes here..."
				className="flex-1 resize-none bg-transparent px-6 py-4 text-sm leading-relaxed text-zinc-300 placeholder:text-zinc-700 focus:outline-none"
			/>

			{/* Footer */}
			<div className="border-t border-zinc-800/50 px-6 py-2 text-xs text-zinc-600">
				Created {new Date(note.createdAt).toLocaleString()} &middot; Updated{" "}
				{new Date(note.updatedAt).toLocaleString()}
			</div>
		</div>
	);
}
