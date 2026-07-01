// Inline editable text -- plan 36 (industry-build-queue), Phase 5.
// Click the text to edit; commit on blur or Enter, cancel on Escape. Used for the queue name,
// queue description, and batch labels. Single-line by default; pass multiline for the description.

import { useEffect, useRef, useState } from "react";

interface EditableTextProps {
	value: string;
	onCommit: (value: string) => void;
	placeholder?: string;
	/** Shown (muted) in display mode when value is empty. */
	emptyLabel?: string;
	/** Classes for the display element (the clickable text). */
	className?: string;
	/** Classes for the input/textarea while editing. */
	inputClassName?: string;
	/** Render a textarea (Enter inserts a newline; commit on blur only). */
	multiline?: boolean;
}

export function EditableText({
	value,
	onCommit,
	placeholder,
	emptyLabel = "Add a description...",
	className = "",
	inputClassName = "",
	multiline = false,
}: EditableTextProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	// Intersection type is assignable to both the <input> and <textarea> ref slots.
	const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	function start() {
		setDraft(value);
		setEditing(true);
	}

	function commit() {
		setEditing(false);
		const next = draft.trim();
		if (next !== value) onCommit(next);
	}

	function cancel() {
		setEditing(false);
		setDraft(value);
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		} else if (e.key === "Enter" && !multiline) {
			e.preventDefault();
			commit();
		}
	}

	if (editing && multiline) {
		return (
			<textarea
				ref={inputRef}
				rows={2}
				value={draft}
				placeholder={placeholder}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={handleKeyDown}
				className={inputClassName}
			/>
		);
	}

	if (editing) {
		return (
			<input
				ref={inputRef}
				type="text"
				value={draft}
				placeholder={placeholder}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={handleKeyDown}
				className={inputClassName}
			/>
		);
	}

	return (
		<button type="button" onClick={start} className={className} title="Click to edit">
			{value.trim() ? value : <span className="text-zinc-600">{emptyLabel}</span>}
		</button>
	);
}
