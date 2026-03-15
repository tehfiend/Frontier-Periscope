import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
	title: "TehFrontier",
	description: "Governance, trading, and claims management for EVE Frontier",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="antialiased">
				<Providers>
					<div className="flex min-h-screen">
						<Sidebar />
						<main className="flex-1 p-6">{children}</main>
					</div>
				</Providers>
			</body>
		</html>
	);
}
