const LINK_LABELS: Record<string, string> = {
	"faucet.sui.io": "SUI Faucet",
};

/**
 * Renders an error string with clickable URLs.
 * Splits on https:// URL patterns and renders them as anchor tags.
 * Known domains get friendly link text (e.g. "SUI Faucet").
 */
export function ErrorMessage({ text }: { text: string }) {
	// Match URLs starting with https:// or http://
	const parts = text.split(/(https?:\/\/[^\s)]+)/g);

	if (parts.length === 1) {
		return <>{text}</>;
	}

	return (
		<>
			{parts.map((part, i) => {
				if (!/^https?:\/\//.test(part)) {
					return <span key={`${i}-${part}`}>{part}</span>;
				}
				let label = part;
				try {
					const host = new URL(part).hostname;
					if (LINK_LABELS[host]) label = LINK_LABELS[host];
				} catch {}
				return (
					<a
						key={`${i}-${part}`}
						href={part}
						target="_blank"
						rel="noopener noreferrer"
						className="text-cyan-400 hover:underline"
					>
						{label}
					</a>
				);
			})}
		</>
	);
}
