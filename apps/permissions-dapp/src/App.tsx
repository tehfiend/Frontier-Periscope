import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createDAppKit,
	DAppKitProvider,
	ConnectButton,
	useCurrentAccount,
} from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { ShieldCheck, Shield } from "lucide-react";
import { AssemblySelector } from "./components/AssemblySelector";
import { AclEditor } from "./components/AclEditor";
import { AdminPanel } from "./components/AdminPanel";

const queryClient = new QueryClient();

const dAppKit = createDAppKit({
	networks: ["testnet"],
	createClient: (network) =>
		new SuiGraphQLClient({
			url: `https://graphql.${network}.sui.io/graphql`,
			network: network as "testnet",
		}),
	defaultNetwork: "testnet",
	autoConnect: true,
});

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<DAppKitProvider dAppKit={dAppKit}>
				<Main />
			</DAppKitProvider>
		</QueryClientProvider>
	);
}

function Main() {
	const account = useCurrentAccount();
	const [selectedAssemblyId, setSelectedAssemblyId] = useState<string>("");
	const [configObjectId, setConfigObjectId] = useState<string>("");
	const [packageId, setPackageId] = useState<string>("");

	return (
		<div className="mx-auto max-w-2xl p-6">
			{/* Header */}
			<div className="mb-8 flex items-center justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
						<ShieldCheck size={24} className="text-cyan-500" />
						Assembly Permissions
					</h1>
					<p className="mt-1 text-sm text-zinc-500">
						Configure access control for your EVE Frontier smart assemblies
					</p>
				</div>
				<ConnectButton />
			</div>

			{!account ? (
				<div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 py-16">
					<Shield size={48} className="text-zinc-700" />
					<p className="text-sm text-zinc-500">
						Connect your wallet to manage assembly permissions
					</p>
					<ConnectButton />
				</div>
			) : (
				<div className="space-y-6">
					{/* Contract config */}
					<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
						<h2 className="mb-3 text-sm font-medium text-zinc-400">Contract Configuration</h2>
						<div className="space-y-2">
							<div>
								<label className="mb-1 block text-xs text-zinc-500">Package ID</label>
								<input
									type="text"
									value={packageId}
									onChange={(e) => setPackageId(e.target.value)}
									placeholder="0x..."
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs text-zinc-500">Config Object ID</label>
								<input
									type="text"
									value={configObjectId}
									onChange={(e) => setConfigObjectId(e.target.value)}
									placeholder="0x..."
									className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
								/>
							</div>
						</div>
					</div>

					{/* Assembly selector */}
					<AssemblySelector
						walletAddress={account.address}
						selectedId={selectedAssemblyId}
						onSelect={setSelectedAssemblyId}
					/>

					{/* ACL Editor */}
					{selectedAssemblyId && packageId && configObjectId && (
						<AclEditor
							assemblyId={selectedAssemblyId}
							packageId={packageId}
							configObjectId={configObjectId}
						/>
					)}

					{/* Admin Panel */}
					{packageId && configObjectId && (
						<AdminPanel
							packageId={packageId}
							configObjectId={configObjectId}
						/>
					)}
				</div>
			)}

			{/* Footer */}
			<p className="mt-12 text-center text-xs text-zinc-700">
				TehFrontier · EVE Frontier Cycle 5
			</p>
		</div>
	);
}
