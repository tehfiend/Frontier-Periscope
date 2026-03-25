import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "path";
import { APP_VERSION } from "./src/version";

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(APP_VERSION),
	},
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			registerType: "prompt",
			includeAssets: ["favicon.svg"],
			manifest: {
				name: "Frontier Periscope",
				short_name: "Frontier Periscope",
				description: "EVE Frontier intel management tool",
				theme_color: "#09090b",
				background_color: "#09090b",
				display: "standalone",
				orientation: "landscape",
				scope: "/",
				start_url: "/",
				icons: [
					{ src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
					{ src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
					{ src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
				],
				shortcuts: [
					{ name: "Star Map", url: "/map", description: "3D star map with route planner" },
					{ name: "Deployables", url: "/deployables", description: "Manage your assemblies" },
					{ name: "Log Analyzer", url: "/logs", description: "Parse game logs" },
					{ name: "Intel Channel", url: "/intel", description: "Chat intel feed" },
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
				// Cache the static data files for offline access
				runtimeCaching: [
					{
						urlPattern: /\/data\/.*\.json$/,
						handler: "CacheFirst",
						options: {
							cacheName: "static-data",
							expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 },
						},
					},
				],
			},
		}),
	],
	server: {
		port: 5173,
		strictPort: true,
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
	optimizeDeps: {
		exclude: ["@mysten/move-bytecode-template"],
	},
	build: {
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("three") || id.includes("@react-three")) return "three";
					if (id.includes("@mysten")) return "sui";
					if (
						id.includes("node_modules/react/") ||
						id.includes("node_modules/react-dom/") ||
						id.includes("node_modules/dexie") ||
						id.includes("node_modules/zustand") ||
						id.includes("node_modules/lucide-react")
					) return "vendor";
				},
			},
		},
	},
});
