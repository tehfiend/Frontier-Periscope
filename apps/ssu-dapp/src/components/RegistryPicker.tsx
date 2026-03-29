import { useSuiClient } from "@/hooks/useSuiClient";
import { getTenant } from "@/lib/constants";
import {
	type StandingsRegistryInfo,
	type TenantId,
	getContractAddresses,
	queryAllRegistries,
} from "@tehfrontier/chain-shared";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface RegistryPickerProps {
	value: string;
	onChange: (registryId: string) => void;
}

export function RegistryPicker({ value, onChange }: RegistryPickerProps) {
	const client = useSuiClient();
	const [open, setOpen] = useState(false);

	const { data: registries, isLoading } = useQuery({
		queryKey: ["all-registries"],
		queryFn: async (): Promise<StandingsRegistryInfo[]> => {
			const tenant = getTenant() as TenantId;
			const addrs = getContractAddresses(tenant);
			const pkgId = addrs.standingsRegistry?.packageId;
			if (!pkgId) return [];
			const items = await queryAllRegistries(client, pkgId);
			items.sort((a, b) => a.name.localeCompare(b.name));
			return items;
		},
		staleTime: 120_000,
	});

	const selected = registries?.find((r) => r.objectId === value);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center justify-between rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-left text-xs text-zinc-200 hover:border-zinc-600 focus:border-cyan-500 focus:outline-none"
			>
				{selected ? (
					<span>
						<span className="font-medium">{selected.name}</span>
						<span className="ml-1.5 text-zinc-500">[{selected.ticker}]</span>
					</span>
				) : value ? (
					<span className="font-mono text-zinc-400">{value.slice(0, 10)}...</span>
				) : (
					<span className="text-zinc-500">
						{isLoading ? "Loading..." : "Select registry..."}
					</span>
				)}
				<ChevronDown size={12} className="text-zinc-500" />
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 w-full rounded border border-zinc-700 bg-zinc-900 shadow-xl">
					<div className="max-h-48 overflow-auto">
						{(registries ?? []).map((r) => (
							<button
								key={r.objectId}
								type="button"
								onClick={() => {
									onChange(r.objectId);
									setOpen(false);
								}}
								className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-zinc-800 ${
									r.objectId === value ? "text-cyan-400" : "text-zinc-300"
								}`}
							>
								<span>
									<span className="font-medium">{r.name}</span>
									<span className="ml-1.5 text-zinc-600">[{r.ticker}]</span>
								</span>
							</button>
						))}
						{!isLoading && (registries ?? []).length === 0 && (
							<p className="px-2 py-2 text-xs text-zinc-600">No registries found</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
