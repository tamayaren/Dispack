/// <reference lib="webworker" />
import { inflateSync } from "fflate";

// A data package opened either as a zip or as an extracted folder.
// Paths are normalised to the package root, e.g. "messages/c123/messages.json".

export interface SourceEntry {
	path: string;
	size: number;
	lastModified: number;
}

export interface PackageSource {
	entries: SourceEntry[];
	bytes(e: SourceEntry): Promise<Uint8Array>;
	stream(e: SourceEntry): Promise<ReadableStream<Uint8Array>>;
}

export interface FolderFile {
	path: string;
	file: File;
}

const utf8 = new TextDecoder();

export async function readText(src: PackageSource, e: SourceEntry): Promise<string> {
	return utf8.decode(await src.bytes(e));
}

// ---------------------------------------------------------------- path normalisation

const TOP_LEVEL = new Set(["account", "activity", "activities", "messages", "servers", "programs", "ads", "support_tickets", "applications"]);
const CHANNEL_FOLDER = /^c?\d{15,22}$/i;

// Strips any wrapper folders ("package/", "Downloads/discord/") so paths start at the package root.
// A folder picked at messages level ("c123/messages.json") is re-rooted under "messages/".
export function normalisePaths(paths: string[]): string[] {
	const split = paths.map((p) => p.replace(/\\/g, "/").replace(/^\/+/, "").split("/"));
	let cut = -1;
	let prefixMessages = false;
	for (const segs of split) {
		const i = segs.findIndex((s) => TOP_LEVEL.has(s.toLowerCase()));
		if (i >= 0 && (cut < 0 || i < cut)) cut = i;
	}
	if (cut < 0) {
		// No known top folder: maybe the messages folder itself (or its parent's contents) was picked.
		for (const segs of split) {
			const i = segs.findIndex((s) => CHANNEL_FOLDER.test(s));
			if (i >= 0 && i < segs.length - 1) {
				cut = i;
				prefixMessages = true;
				break;
			}
		}
	}
	return split.map((segs) => {
		if (cut < 0) return segs.join("/");
		const rest = segs.slice(Math.min(cut, segs.length - 1));
		if (!prefixMessages) return rest.join("/");
		// The picked messages folder's own index.json sits one level above the channel folders.
		if (segs.length === cut + 1 && segs[cut].toLowerCase() === "index.json") return `messages/${segs[cut]}`;
		return `messages/${rest.join("/")}`;
	});
}

// ---------------------------------------------------------------- folder source

export function folderSource(files: FolderFile[]): PackageSource {
	const paths = normalisePaths(files.map((f) => f.path));
	const byEntry = new Map<SourceEntry, File>();
	const entries: SourceEntry[] = files.map((f, i) => {
		const e = { path: paths[i], size: f.file.size, lastModified: f.file.lastModified };
		byEntry.set(e, f.file);
		return e;
	});
	return {
		entries,
		bytes: async (e) => new Uint8Array(await byEntry.get(e)!.arrayBuffer()),
		stream: async (e) => byEntry.get(e)!.stream() as ReadableStream<Uint8Array>
	};
}

// ---------------------------------------------------------------- zip source

interface ZipEntry extends SourceEntry {
	method: number;
	compressedSize: number;
	offset: number;
}

// Reads the file in large blocks so thousands of small entries don't each cost a separate
// file read (slow on Android, where picked files go through a content provider).
class BlockReader {
	private cache = new Map<number, Uint8Array>();
	constructor(private blob: Blob, private blockSize = 8 * 1024 * 1024, private maxBlocks = 8) {}

	private async block(index: number): Promise<Uint8Array> {
		const hit = this.cache.get(index);
		if (hit) {
			// Refresh LRU position.
			this.cache.delete(index);
			this.cache.set(index, hit);
			return hit;
		}
		const start = index * this.blockSize;
		const data = new Uint8Array(await this.blob.slice(start, Math.min(this.blob.size, start + this.blockSize)).arrayBuffer());
		this.cache.set(index, data);
		if (this.cache.size > this.maxBlocks) this.cache.delete(this.cache.keys().next().value!);
		return data;
	}

	async read(start: number, length: number): Promise<Uint8Array> {
		if (length > this.blockSize * 2) return new Uint8Array(await this.blob.slice(start, start + length).arrayBuffer());
		const first = Math.floor(start / this.blockSize);
		const last = Math.floor((start + Math.max(0, length - 1)) / this.blockSize);
		if (first === last) {
			const b = await this.block(first);
			const o = start - first * this.blockSize;
			return b.subarray(o, o + length);
		}
		const out = new Uint8Array(length);
		let written = 0;
		for (let i = first; i <= last; i++) {
			const b = await this.block(i);
			const from = i === first ? start - first * this.blockSize : 0;
			const to = Math.min(b.length, from + (length - written));
			out.set(b.subarray(from, to), written);
			written += to - from;
		}
		return out;
	}
}

function u64(dv: DataView, o: number): number {
	return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32;
}

function dosTime(time: number, date: number): number {
	return new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
}

const INFLATE_SYNC_LIMIT = 256 * 1024 * 1024;

export async function zipSource(blob: Blob): Promise<PackageSource> {
	const reader = new BlockReader(blob);
	const size = blob.size;
	const tailLen = Math.min(size, 65557);
	const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
	const tv = new DataView(tail.buffer);
	let eocd = -1;
	for (let i = tail.length - 22; i >= 0; i--) {
		if (tv.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("This file isn't a readable zip archive. Select the package.zip that Discord emailed you.");

	let count = tv.getUint16(eocd + 10, true);
	let cdSize = tv.getUint32(eocd + 12, true);
	let cdOffset = tv.getUint32(eocd + 16, true);
	// Zip64: packages over 4 GB or with more than 65535 files.
	if (eocd >= 20 && tv.getUint32(eocd - 20, true) === 0x07064b50) {
		const recOffset = u64(tv, eocd - 20 + 8);
		const rec = new DataView((await blob.slice(recOffset, recOffset + 56).arrayBuffer()));
		if (rec.getUint32(0, true) === 0x06064b50) {
			count = u64(rec, 32);
			cdSize = u64(rec, 40);
			cdOffset = u64(rec, 48);
		}
	}

	const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
	const dv = new DataView(cd.buffer);
	const entries: ZipEntry[] = [];
	let p = 0;
	for (let n = 0; n < count && p + 46 <= cd.length; n++) {
		if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("The zip's file list is damaged.");
		const method = dv.getUint16(p + 10, true);
		const time = dv.getUint16(p + 12, true);
		const date = dv.getUint16(p + 14, true);
		let compressedSize = dv.getUint32(p + 20, true);
		let uncompressedSize = dv.getUint32(p + 24, true);
		const nameLen = dv.getUint16(p + 28, true);
		const extraLen = dv.getUint16(p + 30, true);
		const commentLen = dv.getUint16(p + 32, true);
		let offset = dv.getUint32(p + 42, true);
		const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen));
		let x = p + 46 + nameLen;
		const xEnd = x + extraLen;
		while (x + 4 <= xEnd) {
			const id = dv.getUint16(x, true);
			const len = dv.getUint16(x + 2, true);
			if (id === 0x0001) {
				let q = x + 4;
				if (uncompressedSize === 0xffffffff) (uncompressedSize = u64(dv, q)), (q += 8);
				if (compressedSize === 0xffffffff) (compressedSize = u64(dv, q)), (q += 8);
				if (offset === 0xffffffff) offset = u64(dv, q);
			}
			x += 4 + len;
		}
		p = xEnd + commentLen;
		if (name.endsWith("/")) continue;
		entries.push({ path: name, size: uncompressedSize, lastModified: dosTime(time, date), method, compressedSize, offset });
	}

	const norm = normalisePaths(entries.map((e) => e.path));
	entries.forEach((e, i) => (e.path = norm[i]));

	const dataStart = async (e: ZipEntry) => {
		const lh = await reader.read(e.offset, 30);
		const lv = new DataView(lh.buffer, lh.byteOffset, 30);
		if (lv.getUint32(0, true) !== 0x04034b50) throw new Error(`Damaged zip entry: ${e.path}`);
		return e.offset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
	};

	const stream = async (se: SourceEntry): Promise<ReadableStream<Uint8Array>> => {
		const e = se as ZipEntry;
		const start = await dataStart(e);
		const raw = blob.slice(start, start + e.compressedSize).stream() as ReadableStream<Uint8Array>;
		if (e.method === 0) return raw;
		if (e.method !== 8) throw new Error(`Unsupported compression in ${e.path}`);
		return raw.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
	};

	return {
		entries,
		stream,
		bytes: async (se) => {
			const e = se as ZipEntry;
			if (e.method === 8 && e.size > INFLATE_SYNC_LIMIT) {
				return new Uint8Array(await new Response(await stream(e)).arrayBuffer());
			}
			const start = await dataStart(e);
			const raw = await reader.read(start, e.compressedSize);
			if (e.method === 0) return raw;
			if (e.method !== 8) throw new Error(`Unsupported compression in ${e.path}`);
			return inflateSync(raw, { out: new Uint8Array(e.size) });
		}
	};
}
