import { useWhatsNew } from "@/hooks/useWhatsNew";
import { ChangelogModal } from "./ChangelogModal";

export function WhatsNew() {
	const { show, newEntries, dismiss } = useWhatsNew();

	return <ChangelogModal open={show} onClose={dismiss} entries={newEntries} />;
}
