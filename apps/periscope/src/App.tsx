import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { DataInitializer } from "@/components/DataInitializer";
import { WalletProvider } from "@/components/WalletProvider";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: 1,
		},
	},
});

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<WalletProvider>
				<DataInitializer>
					<RouterProvider router={router} />
				</DataInitializer>
			</WalletProvider>
		</QueryClientProvider>
	);
}
