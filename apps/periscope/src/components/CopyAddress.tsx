import { useCallback, useState } from "react";

interface CopyAddressProps {
	address: string;
	sliceStart?: number;
	sliceEnd?: number;
	explorerUrl?: string;
	className?: string;
	mono?: boolean;
}

/**
 * Truncated address display with copy-to-clipboard and optional explorer link.
 * Shows `0x1234ab...cdef` with a small clipboard icon. Clicking copies the full address.
 */
export function CopyAddress({
	address,
	sliceStart = 8,
	sliceEnd = 4,
	explorerUrl,
	className,
	mono = true,
}: CopyAddressProps) {
	const [copied, setCopied] = useState(false);

	const truncated =
		address.length > sliceStart + sliceEnd + 3
			? `${address.slice(0, sliceStart)}...${sliceEnd > 0 ? address.slice(-sliceEnd) : ""}`
			: address;

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(address);
		} catch {
			// Fallback for insecure context
			const textarea = document.createElement("textarea");
			textarea.value = address;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand("copy");
			document.body.removeChild(textarea);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [address]);

	return (
		<span className={`inline-flex items-center gap-1 ${className ?? ""}`} title={address}>
			<span className={mono ? "font-mono" : ""}>{truncated}</span>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					handleCopy();
				}}
				className="shrink-0 opacity-50 transition-opacity hover:opacity-100"
				title={copied ? "Copied!" : "Copy address"}
			>
				{copied ? (
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="text-green-400"
					>
						<polyline points="20 6 9 17 4 12" />
					</svg>
				) : (
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
						<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
					</svg>
				)}
			</button>
			{explorerUrl && (
				<a
					href={explorerUrl}
					target="_blank"
					rel="noopener noreferrer"
					onClick={(e) => e.stopPropagation()}
					className="shrink-0 opacity-50 transition-opacity hover:opacity-100"
					title="View on explorer"
				>
					<span className="sr-only">View on explorer</span>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
						<polyline points="15 3 21 3 21 9" />
						<line x1="10" y1="14" x2="21" y2="3" />
					</svg>
				</a>
			)}
		</span>
	);
}
