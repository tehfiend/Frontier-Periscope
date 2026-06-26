/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_CHAIN_ENABLED?: string;
}
interface ImportMeta {
	readonly env: ImportMetaEnv;
}

// File System Access API (Chromium-only, not yet in standard TS DOM types)
interface FileSystemHandlePermissionDescriptor {
	mode?: "read" | "readwrite";
}

interface FileSystemHandle {
	queryPermission(
		descriptor?: FileSystemHandlePermissionDescriptor,
	): Promise<PermissionState>;
	requestPermission(
		descriptor?: FileSystemHandlePermissionDescriptor,
	): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface Window {
	showDirectoryPicker(options?: {
		id?: string;
		mode?: "read" | "readwrite";
		startIn?: "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
	}): Promise<FileSystemDirectoryHandle>;
}

declare const __APP_VERSION__: string;
