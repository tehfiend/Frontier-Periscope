import { db } from "@/db";
import { EXPORT_TABLES } from "./constants";

const BACKUP_HANDLE_KEY = "backupDirHandle";
const BACKUP_DB_NAME = "periscope-handles";
const BACKUP_STORE = "handles";

async function openHandleDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(BACKUP_DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(BACKUP_STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function storeBackupHandle(handle: FileSystemDirectoryHandle): Promise<void> {
	const idb = await openHandleDB();
	return new Promise((resolve, reject) => {
		const tx = idb.transaction(BACKUP_STORE, "readwrite");
		tx.objectStore(BACKUP_STORE).put(handle, BACKUP_HANDLE_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function getBackupHandle(): Promise<FileSystemDirectoryHandle | null> {
	const idb = await openHandleDB();
	return new Promise((resolve) => {
		const tx = idb.transaction(BACKUP_STORE, "readonly");
		const req = tx.objectStore(BACKUP_STORE).get(BACKUP_HANDLE_KEY);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => resolve(null);
	});
}

export async function clearBackupHandle(): Promise<void> {
	const idb = await openHandleDB();
	return new Promise((resolve, reject) => {
		const tx = idb.transaction(BACKUP_STORE, "readwrite");
		tx.objectStore(BACKUP_STORE).delete(BACKUP_HANDLE_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function requestBackupDirectory(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const handle = await window.showDirectoryPicker({ mode: "readwrite" });
		await storeBackupHandle(handle);
		return handle;
	} catch {
		return null;
	}
}

/** Write a backup JSON file to the stored backup directory. */
export async function writeAutoBackup(): Promise<boolean> {
	const handle = await getBackupHandle();
	if (!handle) return false;

	// Verify we still have permission
	const perm = await handle.queryPermission({ mode: "readwrite" });
	if (perm !== "granted") {
		const req = await handle.requestPermission({ mode: "readwrite" });
		if (req !== "granted") {
			console.warn("[AutoBackup] Permission denied for backup directory");
			return false;
		}
	}

	const tables: Record<string, unknown[]> = {};
	for (const name of EXPORT_TABLES) {
		tables[name] = await db.table(name).toArray();
	}

	const data = {
		version: 1,
		exportedAt: new Date().toISOString(),
		tables,
	};

	const fileName = `periscope-auto-${new Date().toISOString().slice(0, 10)}.json`;
	const fileHandle = await handle.getFileHandle(fileName, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(JSON.stringify(data));
	await writable.close();
	return true;
}
