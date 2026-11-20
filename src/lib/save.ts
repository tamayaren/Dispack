import { BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { cachedUrl, refreshUrls } from "./discord";
import type { SaveMethod } from "./storage";
import type { AttachmentView } from "./types";
import { dateStamp } from "./util";

export interface Saveable extends AttachmentView {
	ts?: number;
}

const MIME: Record<string, string> = {
	png: "image/png", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
	webp: "image/webp", apng: "image/apng", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime"
};

export function isTouchDevice(): boolean {
	return matchMedia("(pointer: coarse)").matches;
}

async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
	const res = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
	if (!res.ok) throw new Error(res.status === 404 || res.status === 403 ? "Link expired or file deleted" : `HTTP ${res.status}`);
	return res.blob();
}

// Recently fetched files, so a second tap can call the share sheet without a network wait
// (iOS only allows navigator.share right after a tap).
const blobCache = new Map<string, Promise<Blob>>();

function cachedBlob(url: string): Promise<Blob> {
	let p = blobCache.get(url);
	if (!p) {
		p = fetchBlob(url);
		p.catch(() => blobCache.delete(url));
		blobCache.set(url, p);
		if (blobCache.size > 12) blobCache.delete(blobCache.keys().next().value!);
	}
	return p;
}

// Warm the cache for the image currently on screen in the viewer.
export function prefetch(url: string) {
	cachedBlob(url).catch(() => undefined);
}

function fileNameFor(item: Saveable): string {
	return item.ts ? `${dateStamp(item.ts)}_${item.id}_${item.fileName}` : item.fileName;
}

function downloadBlob(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export class TapAgainError extends Error {
	constructor() {
		super("Ready. Tap Save again to open the share sheet.");
	}
}

type ShareResult = "shared" | "unsupported" | "needs-tap";

async function shareFiles(files: File[]): Promise<ShareResult> {
	if (!navigator.canShare?.({ files })) return "unsupported";
	try {
		await navigator.share({ files });
		return "shared";
	} catch (err) {
		const name = (err as DOMException)?.name;
		// Closing the share sheet isn't a failure.
		if (name === "AbortError") return "shared";
		// The tap's user activation expired while downloading.
		if (name === "NotAllowedError") return "needs-tap";
		return "unsupported";
	}
}

export async function saveOne(item: Saveable, botToken: string | null, method: SaveMethod): Promise<void> {
	try {
		await refreshUrls([item.url], botToken);
	} catch {
		// Try the link we have anyway.
	}
	const url = cachedUrl(item.url);
	let blob: Blob;
	try {
		blob = await cachedBlob(url);
	} catch (err) {
		// Last resort: let the browser open it so the user can long-press / save manually.
		window.open(url, "_blank", "noopener");
		throw err;
	}
	const name = fileNameFor(item);
	const type = blob.type || MIME[item.ext] || "application/octet-stream";
	const useShare = method === "share" || (method === "auto" && isTouchDevice());
	if (useShare) {
		const r = await shareFiles([new File([blob], name, { type })]);
		if (r === "shared") return;
		if (r === "needs-tap") throw new TapAgainError();
	}
	downloadBlob(blob, name);
}

export interface BulkProgress {
	done: number;
	total: number;
	failed: number;
}

export interface BulkResult extends BulkProgress {
	cancelled: boolean;
	error?: string;
}

// Saves many files into one zip; streams straight to disk when the browser supports it.
// The save location is asked for first, while the click still counts as a user gesture.
export async function saveZip(
	source: Saveable[] | (() => Promise<Saveable[]>),
	botToken: string | null,
	zipName: string,
	onProgress: (p: BulkProgress) => void,
	signal: AbortSignal
): Promise<BulkResult> {
	let fileStream: FileSystemWritableFileStream | null = null;
	const picker = (window as any).showSaveFilePicker as undefined | ((o: unknown) => Promise<FileSystemFileHandle>);
	if (picker && !isTouchDevice()) {
		try {
			const handle = await picker({ suggestedName: zipName, types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }] });
			fileStream = await handle.createWritable();
		} catch (err) {
			if ((err as DOMException)?.name === "AbortError") return { done: 0, total: 0, failed: 0, cancelled: true };
		}
	}

	const items = typeof source === "function" ? await source() : source;
	const writer = fileStream ? new ZipWriter(fileStream as unknown as WritableStream) : new ZipWriter(new BlobWriter("application/zip"));
	const progress: BulkProgress = { done: 0, total: items.length, failed: 0 };
	const used = new Set<string>();
	let firstError: string | undefined;
	onProgress({ ...progress });

	for (let i = 0; i < items.length; i += 50) {
		if (signal.aborted) break;
		const chunk = items.slice(i, i + 50);
		try {
			await refreshUrls(chunk.map((c) => c.url), botToken);
		} catch (err) {
			firstError ??= (err as Error).message;
		}
		for (const item of chunk) {
			if (signal.aborted) break;
			try {
				const blob = await fetchBlob(cachedUrl(item.url), signal);
				let name = fileNameFor(item);
				while (used.has(name)) name = `_${name}`;
				used.add(name);
				await writer.add(name, blob.stream(), { level: 0, lastModDate: item.ts ? new Date(item.ts) : undefined });
			} catch (err) {
				if (signal.aborted) break;
				progress.failed++;
				firstError ??= (err as Error).message;
			}
			progress.done++;
			onProgress({ ...progress });
		}
	}

	const cancelled = signal.aborted;
	if (cancelled && !fileStream) {
		// Nothing has been written anywhere yet; just drop the in-memory zip.
		return { ...progress, cancelled, error: firstError };
	}
	const result = await writer.close();
	if (!fileStream && result instanceof Blob && progress.done - progress.failed > 0) {
		const file = new File([result], zipName, { type: "application/zip" });
		if (!isTouchDevice() || (await shareFiles([file])) !== "shared") downloadBlob(result, zipName);
	}
	return { ...progress, cancelled, error: firstError };
}
