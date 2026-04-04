/**
 * Renders an error string with clickable URLs.
 * Splits on https:// URL patterns and renders them as anchor tags.
 */
export function ErrorMessage({ text }: { text: string }) {
	// Match URLs starting with https:// or http://
	const parts = text.split(/(https?:\/\/[^\s)]+)/g);

	if (parts.length === 1) {
		return <>{text}</>;
	}

	return (
		<>
			{parts.map((part, i) =>
				/^https?:\/\//.test(part) ? (
					<a
						key={`${i}-${part}`}
						href={part}
						target="_blank"
						rel="noopener noreferrer"
						className="text-cyan-400 hover:underline"
					>
						{part}
					</a>
				) : (
					<span key={`${i}-${part}`}>{part}</span>
				),
			)}
		</>
	);
}
