import { db } from "@/db";

const HANDLE_STORE_KEY = "logDirectoryHandle";

export async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
	const entry = await db.settings.get(HANDLE_STORE_KEY);
	if (!entry?.value) return null;
	return entry.value as FileSystemDirectoryHandle;
}

export async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
	await db.settings.put({ key: HANDLE_STORE_KEY, value: handle });
}

export async function requestDirectoryAccess(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const handle = await window.showDirectoryPicker({
			id: "game-logs",
			mode: "read",
			startIn: "documents",
		});
		await storeHandle(handle);
		return handle;
	} catch {
		// User cancelled
		return null;
	}
}

export async function verifyPermission(
	handle: FileSystemDirectoryHandle,
): Promise<boolean> {
	const options = { mode: "read" as const };
	if ((await handle.queryPermission(options)) === "granted") return true;
	if ((await handle.requestPermission(options)) === "granted") return true;
	return false;
}
