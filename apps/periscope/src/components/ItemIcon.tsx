/** Inline icon for a game item, looked up by typeID from /icons/items/{typeID}.png */
export function ItemIcon({
	typeId,
	size = 16,
	className = "",
}: {
	typeId: number;
	size?: number;
	className?: string;
}) {
	return (
		<img
			src={`/icons/items/${typeId}.png`}
			alt=""
			width={size}
			height={size}
			loading="lazy"
			className={`inline-block shrink-0 ${className}`}
			onError={(e) => {
				(e.target as HTMLImageElement).style.display = "none";
			}}
		/>
	);
}
