import { useRef, useState } from "preact/hooks";

export interface FolderFile {
	path: string;
	file: File;
}

export type OpenInput = { kind: "zip"; file: File } | { kind: "folder"; files: FolderFile[] };

export interface OpenOptions {
	attachmentsOnly: boolean;
}

// ---- folder collection (File System Access API, <input webkitdirectory>, or drag and drop)

async function walkHandle(dir: FileSystemDirectoryHandle, prefix: string, out: FolderFile[]) {
	for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (handle.kind === "directory") await walkHandle(handle as FileSystemDirectoryHandle, path, out);
		else out.push({ path, file: await (handle as FileSystemFileHandle).getFile() });
	}
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
	return new Promise((resolve, reject) => {
		const all: FileSystemEntry[] = [];
		const next = () =>
			reader.readEntries((batch) => {
				if (!batch.length) resolve(all);
				else {
					all.push(...batch);
					next();
				}
			}, reject);
		next();
	});
}

async function walkEntry(entry: FileSystemEntry, out: FolderFile[]) {
	if (entry.isFile) {
		const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
		out.push({ path: entry.fullPath.replace(/^\//, ""), file });
	} else if (entry.isDirectory) {
		for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) await walkEntry(child, out);
	}
}

const supportsDirectoryPicker = typeof (window as any).showDirectoryPicker === "function";

export function Landing({ onOpen, error }: { onOpen: (input: OpenInput, opts: OpenOptions) => void; error: string | null }) {
	const zipInput = useRef<HTMLInputElement>(null);
	const dirInput = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);
	const [attachmentsOnly, setAttachmentsOnly] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const opts = { attachmentsOnly };

	const openFolder = (files: FolderFile[]) => {
		if (!files.length) {
			setLocalError("That folder is empty, or your browser didn't share its contents.");
			return;
		}
		onOpen({ kind: "folder", files }, opts);
	};

	const pickZip = (files: FileList | null | undefined) => {
		const f = files?.[0];
		if (f) onOpen({ kind: "zip", file: f }, opts);
	};

	const pickFolder = async () => {
		setLocalError(null);
		if (!supportsDirectoryPicker) {
			dirInput.current?.click();
			return;
		}
		try {
			const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: "read" });
			setScanning(true);
			const out: FolderFile[] = [];
			await walkHandle(dir, dir.name, out);
			openFolder(out);
		} catch (err) {
			if ((err as DOMException)?.name !== "AbortError") dirInput.current?.click();
		} finally {
			setScanning(false);
		}
	};

	const onDrop = async (e: DragEvent) => {
		e.preventDefault();
		setOver(false);
		setLocalError(null);
		const items = [...(e.dataTransfer?.items ?? [])];
		const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
		if (entries.length === 1 && entries[0].isFile) {
			pickZip(e.dataTransfer?.files);
			return;
		}
		setScanning(true);
		try {
			const out: FolderFile[] = [];
			for (const entry of entries) await walkEntry(entry, out);
			openFolder(out);
		} finally {
			setScanning(false);
		}
	};

	return (
		<main class="landing">
			<div class="landing-inner">
				<div class="brand">
					<img src="./favicon.svg" alt="" width={44} height={44} />
					<h1>Dispack</h1>
				</div>
				<p class="lede">Browse what's actually inside your Discord data package: messages, images, DMs and servers.</p>

				<div
					class={`dropzone${over ? " over" : ""}`}
					onDragOver={(e) => {
						e.preventDefault();
						setOver(true);
					}}
					onDragLeave={() => setOver(false)}
					onDrop={onDrop}
				>
					<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
						<path fill="currentColor" d="M12 3l5 5h-3v6h-4V8H7l5-5zm-7 14h14v2H5v-2z" />
					</svg>
					<div class="open-buttons">
						<button type="button" class="btn primary" onClick={() => zipInput.current?.click()} disabled={scanning}>
							Open package.zip
						</button>
						<button type="button" class="btn" onClick={pickFolder} disabled={scanning}>
							{scanning ? "Reading folder…" : "Open extracted folder"}
						</button>
					</div>
					<span>
						Or drop the zip or folder here. A folder can be the whole extracted package, or just the parts you want, like <code>messages</code>.
					</span>
				</div>
				<label class="check load-option">
					<input type="checkbox" checked={attachmentsOnly} onChange={(e) => setAttachmentsOnly((e.target as HTMLInputElement).checked)} />
					<span>
						<strong>Images and files only.</strong> <span class="muted">Skips messages without attachments. Uses much less memory, but search then only covers those messages.</span>
					</span>
				</label>
				<input ref={zipInput} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={(e) => pickZip((e.target as HTMLInputElement).files)} />
				<input
					ref={dirInput}
					type="file"
					hidden
					multiple
					{...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
					onChange={(e) => {
						const list = [...((e.target as HTMLInputElement).files ?? [])];
						openFolder(list.map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file })));
					}}
				/>

				{(error || localError) && (
					<p class="error-box" role="alert">
						{error ?? localError}
					</p>
				)}

				<section class="info-grid">
					<div>
						<h2>Stays on your device</h2>
						<p>The package is read inside your browser. Nothing is uploaded. The only network requests go to Discord's own CDN and API.</p>
					</div>
					<div>
						<h2>Getting your package</h2>
						<p>
							In Discord, go to <em>User Settings → Data &amp; Privacy → Request all of my data</em>. Discord emails you a link, usually within a few days.
						</p>
					</div>
					<div>
						<h2>Seeing old images</h2>
						<p>Attachment links in the package expire. Add a bot token in Settings and Dispack asks Discord for fresh links.</p>
					</div>
				</section>
				<p class="fineprint">
					A browser port of{" "}
					<a href="https://github.com/aamiaa/Data-Package-Tool" target="_blank" rel="noopener noreferrer">
						Data Package Tool
					</a>{" "}
					by aamiaa. Not affiliated with Discord.
				</p>
			</div>
		</main>
	);
}
