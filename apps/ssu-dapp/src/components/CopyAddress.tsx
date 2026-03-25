import { useState } from "react";

interface CopyAddressProps {
	address: string;
	sliceStart?: number;
	sliceEnd?: number;
	explorerUrl?: string;
	className?: string;
	mono?: boolean;
}

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

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(address);
		} catch {
			// Fallback for older browsers
			const el = document.createElement("textarea");
			el.value = address;
			el.style.position = "fixed";
			el.style.opacity = "0";
			document.body.appendChild(el);
			el.select();
			document.execCommand("copy");
			document.body.removeChild(el);
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	return (
		<span
			className={`inline-flex items-center gap-1 ${mono ? "font-mono" : ""} ${className ?? ""}`}
			title={address}
		>
			{truncated}
			<button
				type="button"
				onClick={handleCopy}
				className="opacity-50 transition-opacity hover:opacity-100"
				title={copied ? "Copied!" : "Copy address"}
			>
				{copied ? (
					<svg
						aria-hidden="true"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="h-3.5 w-3.5 text-emerald-400"
					>
						<path
							fillRule="evenodd"
							d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
							clipRule="evenodd"
						/>
					</svg>
				) : (
					<svg
						aria-hidden="true"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="h-3.5 w-3.5"
					>
						<path
							fillRule="evenodd"
							d="M10.986 3H12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h1.5v1a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5h-1.014A2 2 0 0 1 9 6H5a2 2 0 0 1-2-2V2.5A1.5 1.5 0 0 1 4.5 1h5A1.5 1.5 0 0 1 11 2.5V3ZM4.5 2.5a.5.5 0 0 0-.5.5V4a.5.5 0 0 0 .5.5H9a.5.5 0 0 0 .5-.5V2.5A.5.5 0 0 0 9 2H4.5Z"
							clipRule="evenodd"
						/>
					</svg>
				)}
			</button>
			{explorerUrl && (
				<a
					href={explorerUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="opacity-50 transition-opacity hover:opacity-100"
					title="View on explorer"
					aria-label="View on explorer"
				>
					<svg
						aria-hidden="true"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="h-3.5 w-3.5"
					>
						<path
							fillRule="evenodd"
							d="M4.22 11.78a.75.75 0 0 1 0-1.06L9.44 5.5H5.75a.75.75 0 0 1 0-1.5h5.5a.75.75 0 0 1 .75.75v5.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 0 1-1.06 0Z"
							clipRule="evenodd"
						/>
					</svg>
					<span className="sr-only">View on explorer</span>
				</a>
			)}
		</span>
	);
}
