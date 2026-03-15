/// <reference types="vite/client" />

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
