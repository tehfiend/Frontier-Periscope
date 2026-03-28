import { db } from "@/db";
import { create } from "zustand";

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

	// Private map default
	defaultMapId: string | null;

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
	setDefaultMapId: (id: string | null) => void;
	setSearchQuery: (query: string) => void;
	toggleSidebar: () => void;
}

// Read persisted value synchronously from localStorage as a fast cache,
// so the store initializes with the correct value before first render.
function getPersistedCharacterId(): string | "all" {
	try {
		const cached = localStorage.getItem("periscope:activeCharacterId");
		if (cached) return cached;
	} catch {
		// localStorage unavailable
	}
	return "all";
}

function getPersistedDefaultMapId(): string | null {
	try {
		const cached = localStorage.getItem("periscope:defaultMapId");
		if (cached) return cached;
	} catch {
		// localStorage unavailable
	}
	return null;
}

export const useAppStore = create<AppState>((set) => ({
	staticDataReady: false,
	profileConfigured: false,
	instanceId: null,
	activeCharacterId: getPersistedCharacterId(),
	selectedSystemId: null,
	hoveredSystemId: null,
	defaultMapId: getPersistedDefaultMapId(),
	searchQuery: "",
	sidebarCollapsed: false,

	setStaticDataReady: (ready) => set({ staticDataReady: ready }),
	setProfileConfigured: (configured) => set({ profileConfigured: configured }),
	setInstanceId: (id) => set({ instanceId: id }),
	setActiveCharacterId: (id) => {
		set({ activeCharacterId: id });
		localStorage.setItem("periscope:activeCharacterId", id);
		db.settings.put({ key: "activeCharacterId", value: id });
	},
	selectSystem: (id) => set({ selectedSystemId: id }),
	hoverSystem: (id) => set({ hoveredSystemId: id }),
	setDefaultMapId: (id) => {
		set({ defaultMapId: id });
		if (id) {
			localStorage.setItem("periscope:defaultMapId", id);
		} else {
			localStorage.removeItem("periscope:defaultMapId");
		}
		db.settings.put({ key: "defaultMapId", value: id });
	},
	setSearchQuery: (query) => set({ searchQuery: query }),
	toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

// Also hydrate from IndexedDB (authoritative) once it's ready,
// in case localStorage was cleared but IndexedDB wasn't.
db.settings.get("activeCharacterId").then((setting) => {
	if (setting?.value) {
		const current = useAppStore.getState().activeCharacterId;
		if (current !== setting.value) {
			useAppStore.setState({ activeCharacterId: setting.value as string });
			localStorage.setItem("periscope:activeCharacterId", setting.value as string);
		}
	}
});

db.settings.get("defaultMapId").then((setting) => {
	if (setting?.value) {
		const current = useAppStore.getState().defaultMapId;
		if (current !== setting.value) {
			useAppStore.setState({ defaultMapId: setting.value as string });
			localStorage.setItem("periscope:defaultMapId", setting.value as string);
		}
	}
});
