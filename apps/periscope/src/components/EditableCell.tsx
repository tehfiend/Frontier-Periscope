import { useState, useRef, useEffect, useCallback } from "react";
import { Pencil } from "lucide-react";

interface EditableCellProps {
	value: string;
	onSave: (value: string) => void | Promise<void>;
	/** Whether the cell is editable. Default true. */
	editable?: boolean;
	/** Tooltip to show when not editable. */
	disabledTooltip?: string;
	/** Placeholder text when value is empty. */
	placeholder?: string;
	/** Additional CSS classes for the display text. */
	className?: string;
	/** Render custom display content instead of plain text. */
	children?: React.ReactNode;
}

/**
 * Inline-editable cell for DataGrid.
 * Click to edit, Enter/blur to save, Escape to cancel.
 * Shows a subtle pencil icon on hover to indicate editability.
 */
export function EditableCell({
	value,
	onSave,
	editable = true,
	disabledTooltip,
	placeholder = "",
	className = "",
	children,
}: EditableCellProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const inputRef = useRef<HTMLInputElement>(null);

	// Sync draft when value changes externally
	useEffect(() => {
		if (!editing) setDraft(value);
	}, [value, editing]);

	// Focus input on entering edit mode
	useEffect(() => {
		if (editing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editing]);

	const handleSave = useCallback(() => {
		setEditing(false);
		const trimmed = draft.trim();
		if (trimmed !== value) {
			onSave(trimmed);
		}
	}, [draft, value, onSave]);

	const handleCancel = useCallback(() => {
		setDraft(value);
		setEditing(false);
	}, [value]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSave();
			} else if (e.key === "Escape") {
				e.preventDefault();
				handleCancel();
			}
		},
		[handleSave, handleCancel],
	);

	if (editing) {
		return (
			<input
				ref={inputRef}
				type="text"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={handleSave}
				onKeyDown={handleKeyDown}
				className="w-full rounded border border-cyan-600 bg-zinc-800 px-1.5 py-0.5 text-sm text-zinc-100 outline-none"
			/>
		);
	}

	if (!editable) {
		return (
			<span className={className} title={disabledTooltip}>
				{children ?? (value || placeholder)}
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setEditing(true)}
			className={`group flex w-full items-center gap-1 text-left ${className}`}
			title="Click to edit"
		>
			<span className="min-w-0 truncate">{children ?? (value || placeholder)}</span>
			<Pencil
				size={11}
				className="shrink-0 text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100"
			/>
		</button>
	);
}
