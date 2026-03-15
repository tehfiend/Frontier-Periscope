import { create } from "zustand";
import { db } from "@/db";

interface AppState {
	// Data loading state
	staticDataReady: boolean;
	profileConfigured: boolean;

	// Instance identity
	instanceId: string | null;

	// Character selection
	activeCharacterId: string | "all";

	// Map state
	selectedSystemId: number | null;
	hoveredSystemId: number | null;

	// UI state
	searchQuery: string;
	sidebarCollapsed: boolean;

	// Actions
	setStaticDataReady: (ready: boolean) => void;
	setProfileConfigured: (configured: boolean) => void;
	setInstanceId: (id: string) => void;
	setActiveCharacterId: (id: string | "all") => void;
	selectSystem: (id: number | null) => void;
	hoverSystem: (id: number | null) => void;
	setSearchQuery: (query: string) => void;
	toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
	staticDataReady: false,
	profileConfigured: false,
	instanceId: null,
	activeCharacterId: "all",
	selectedSystemId: null,
	hoveredSystemId: null,
	searchQuery: "",
	sidebarCollapsed: false,

	setStaticDataReady: (ready) => set({ staticDataReady: ready }),
	setProfileConfigured: (configured) => set({ profileConfigured: configured }),
	setInstanceId: (id) => set({ instanceId: id }),
	setActiveCharacterId: (id) => {
		set({ activeCharacterId: id });
		db.settings.put({ key: "activeCharacterId", value: id });
	},
	selectSystem: (id) => set({ selectedSystemId: id }),
	hoverSystem: (id) => set({ hoveredSystemId: id }),
	setSearchQuery: (query) => set({ searchQuery: query }),
	toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
