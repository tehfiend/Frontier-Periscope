import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { FUEL_WARNING_HOURS } from "@/lib/constants";

/**
 * Monitors for new intel reports and fuel alerts, then:
 * 1. Updates the PWA badge count via navigator.setAppBadge()
 * 2. Shows toast notifications via the Notification API
 */
export function useNotifications() {
	const prevCountRef = useRef<number | null>(null);
	const permissionRef = useRef<NotificationPermission>("default");

	// Count active alerts: unexpired chat intel + low-fuel deployables
	const intelCount = useLiveQuery(async () => {
		const now = new Date().toISOString();
		return db.chatIntel.where("expiresAt").above(now).count();
	}, []);

	const fuelAlertCount = useLiveQuery(async () => {
		const all = await db.deployables.where("status").equals("online").toArray();
		const cutoff = Date.now() + FUEL_WARNING_HOURS * 3600000;
		return all.filter((d) => {
			if (!d.fuelExpiresAt) return false;
			return new Date(d.fuelExpiresAt).getTime() < cutoff;
		}).length;
	}, []);

	const totalAlerts = (intelCount ?? 0) + (fuelAlertCount ?? 0);

	// Request notification permission on first render
	useEffect(() => {
		if ("Notification" in window) {
			permissionRef.current = Notification.permission;
			if (Notification.permission === "default") {
				Notification.requestPermission().then((perm) => {
					permissionRef.current = perm;
				});
			}
		}
	}, []);

	// Update badge count
	useEffect(() => {
		if ("setAppBadge" in navigator) {
			if (totalAlerts > 0) {
				(navigator as Navigator & { setAppBadge: (count: number) => Promise<void> })
					.setAppBadge(totalAlerts)
					.catch(() => {});
			} else {
				(navigator as Navigator & { clearAppBadge: () => Promise<void> })
					.clearAppBadge?.()
					?.catch(() => {});
			}
		}
	}, [totalAlerts]);

	// Show toast when new alerts arrive
	useEffect(() => {
		if (prevCountRef.current === null) {
			prevCountRef.current = totalAlerts;
			return;
		}

		if (totalAlerts > prevCountRef.current && permissionRef.current === "granted") {
			const newCount = totalAlerts - prevCountRef.current;
			new Notification("EF Periscope", {
				body: `${newCount} new alert${newCount > 1 ? "s" : ""} (${intelCount} intel, ${fuelAlertCount} fuel)`,
				icon: "/icons/icon-192.png",
				tag: "periscope-alert",
			});
		}

		prevCountRef.current = totalAlerts;
	}, [totalAlerts, intelCount, fuelAlertCount]);
}
