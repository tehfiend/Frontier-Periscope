import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

const VIEW_SHORTCUTS: Record<string, string> = {
	"1": "/",
	"2": "/map",
	"3": "/intel",
	"4": "/targets",
	"5": "/deployables",
	"6": "/logs",
	"7": "/killmails",
	"8": "/blueprints",
	"9": "/notes",
	"0": "/settings",
};

/**
 * Global keyboard shortcuts:
 * - Number keys (1-9, 0) switch between views
 * - Ctrl+K opens command palette (handled by CommandPalette component)
 * - Escape closes panels (handled by individual components)
 */
export function useKeyboardShortcuts() {
	const navigate = useNavigate();

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			// Don't intercept when typing in inputs
			const target = e.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable
			) {
				return;
			}

			// Don't intercept modifier combos (Ctrl+K handled by CommandPalette)
			if (e.ctrlKey || e.metaKey || e.altKey) return;

			const path = VIEW_SHORTCUTS[e.key];
			if (path) {
				e.preventDefault();
				navigate({ to: path });
			}
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [navigate]);
}
