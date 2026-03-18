import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { type SharedAclInfo, queryAllSharedAcls, querySharedAcls } from "@tehfrontier/chain-shared";
import { AlertCircle, List, Loader2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CreateAclForm } from "./CreateAclForm";
import { SharedAclCard } from "./SharedAclCard";
import { SharedAclEditor } from "./SharedAclEditor";

interface SharedAclBrowserProps {
	packageId: string;
}

type ViewMode = "my-acls" | "browse" | "create";

export function SharedAclBrowser({ packageId }: SharedAclBrowserProps) {
	const account = useCurrentAccount();
	const client = useCurrentClient() as SuiGraphQLClient;

	const [viewMode, setViewMode] = useState<ViewMode>("my-acls");
	const [myAcls, setMyAcls] = useState<SharedAclInfo[]>([]);
	const [allAcls, setAllAcls] = useState<SharedAclInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedAclId, setSelectedAclId] = useState<string>();

	const loadMyAcls = useCallback(async () => {
		if (!account || !packageId) return;
		setLoading(true);
		setError(undefined);
		try {
			const acls = await querySharedAcls(client, packageId, account.address);
			setMyAcls(acls);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load ACLs");
		}
		setLoading(false);
	}, [account, packageId, client]);

	const loadAllAcls = useCallback(async () => {
		if (!packageId) return;
		setLoading(true);
		setError(undefined);
		try {
			const acls = await queryAllSharedAcls(client, packageId);
			setAllAcls(acls);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load ACLs");
		}
		setLoading(false);
	}, [packageId, client]);

	useEffect(() => {
		if (viewMode === "my-acls") {
			loadMyAcls();
		} else if (viewMode === "browse") {
			loadAllAcls();
		}
	}, [viewMode, loadMyAcls, loadAllAcls]);

	// If editing a specific ACL, show the editor
	if (selectedAclId) {
		return (
			<SharedAclEditor
				packageId={packageId}
				aclId={selectedAclId}
				onBack={() => setSelectedAclId(undefined)}
				onRefresh={() => {
					if (viewMode === "my-acls") loadMyAcls();
					else loadAllAcls();
				}}
			/>
		);
	}

	// If creating, show the create form
	if (viewMode === "create") {
		return (
			<CreateAclForm
				packageId={packageId}
				onCreated={() => {
					setViewMode("my-acls");
					loadMyAcls();
				}}
				onCancel={() => setViewMode("my-acls")}
			/>
		);
	}

	const displayAcls = viewMode === "my-acls" ? myAcls : allAcls;
	const filteredAcls = searchQuery
		? displayAcls.filter(
				(acl) =>
					acl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
					acl.objectId.includes(searchQuery),
			)
		: displayAcls;

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div className="mb-4 flex items-center justify-between">
				<h2 className="flex items-center gap-2 text-sm font-medium text-zinc-400">
					<List size={14} />
					Shared ACLs
				</h2>
				{account && (
					<button
						type="button"
						onClick={() => setViewMode("create")}
						className="flex items-center gap-1 rounded bg-cyan-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-500"
					>
						<Plus size={12} />
						New ACL
					</button>
				)}
			</div>

			{/* Tab bar */}
			<div className="mb-3 flex gap-1.5">
				<button
					type="button"
					onClick={() => setViewMode("my-acls")}
					className={`rounded px-3 py-1.5 text-xs font-medium ${
						viewMode === "my-acls"
							? "bg-cyan-500/20 text-cyan-400"
							: "bg-zinc-800 text-zinc-500 hover:text-zinc-400"
					}`}
				>
					My ACLs
				</button>
				<button
					type="button"
					onClick={() => setViewMode("browse")}
					className={`rounded px-3 py-1.5 text-xs font-medium ${
						viewMode === "browse"
							? "bg-cyan-500/20 text-cyan-400"
							: "bg-zinc-800 text-zinc-500 hover:text-zinc-400"
					}`}
				>
					Browse All
				</button>
			</div>

			{/* Search */}
			<div className="relative mb-3">
				<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
				<input
					type="text"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder="Search by name or ID..."
					className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
				/>
			</div>

			{/* Loading */}
			{loading && (
				<div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
					<Loader2 size={16} className="animate-spin" />
					Loading ACLs...
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="flex items-center gap-2 rounded border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-400">
					<AlertCircle size={14} />
					{error}
				</div>
			)}

			{/* Results */}
			{!loading && !error && filteredAcls.length === 0 && (
				<p className="py-8 text-center text-xs text-zinc-600">
					{viewMode === "my-acls"
						? "No shared ACLs found for your wallet. Create one to get started."
						: "No shared ACLs found on-chain."}
				</p>
			)}

			{!loading && !error && filteredAcls.length > 0 && (
				<div className="space-y-2">
					{filteredAcls.map((acl) => (
						<SharedAclCard
							key={acl.objectId}
							acl={acl}
							isOwner={account?.address === acl.creator}
							onSelect={() => setSelectedAclId(acl.objectId)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
