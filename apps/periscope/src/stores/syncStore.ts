import { create } from "zustand";
import type { PeerStatus, TrustTier } from "@/sync/types";

interface PeerEntry {
	instanceId: string;
	name: string;
	trustTier: TrustTier;
	status: PeerStatus;
	characterName?: string;
	lastSeen?: string;
}

interface SyncState {
	peers: Map<string, PeerEntry>;
	pairingOffer: string | null;
	pendingId: string | null;
	showPairingDialog: boolean;

	setPeerState: (id: string, entry: PeerEntry) => void;
	updatePeerStatus: (id: string, status: PeerStatus) => void;
	removePeer: (id: string) => void;
	setPairingOffer: (offer: string | null, pendingId?: string | null) => void;
	setShowPairingDialog: (show: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
	peers: new Map(),
	pairingOffer: null,
	pendingId: null,
	showPairingDialog: false,

	setPeerState: (id, entry) =>
		set((s) => {
			const next = new Map(s.peers);
			next.set(id, entry);
			return { peers: next };
		}),

	updatePeerStatus: (id, status) =>
		set((s) => {
			const existing = s.peers.get(id);
			if (!existing) return s;
			const next = new Map(s.peers);
			next.set(id, { ...existing, status });
			return { peers: next };
		}),

	removePeer: (id) =>
		set((s) => {
			const next = new Map(s.peers);
			next.delete(id);
			return { peers: next };
		}),

	setPairingOffer: (offer, pendingId = null) => set({ pairingOffer: offer, pendingId }),

	setShowPairingDialog: (show) => set({ showPairingDialog: show }),
}));
