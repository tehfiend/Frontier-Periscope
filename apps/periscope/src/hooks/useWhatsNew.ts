import { CHANGELOG, type ChangelogEntry } from "@/version";
import { useCallback, useMemo, useState } from "react";

const STORAGE_KEY = "periscope:lastSeenVersion";

export function useWhatsNew(): {
	show: boolean;
	newEntries: ChangelogEntry[];
	dismiss: () => void;
} {
	const [lastSeen] = useState(() => localStorage.getItem(STORAGE_KEY));
	const [dismissed, setDismissed] = useState(false);

	const newEntries = useMemo(() => {
		if (!lastSeen) return CHANGELOG;
		return CHANGELOG.filter((entry) => entry.version > lastSeen);
	}, [lastSeen]);

	const show =
		!dismissed && __APP_VERSION__ !== lastSeen && newEntries.length > 0;

	const dismiss = useCallback(() => {
		localStorage.setItem(STORAGE_KEY, __APP_VERSION__);
		setDismissed(true);
	}, []);

	return { show, newEntries, dismiss };
}
