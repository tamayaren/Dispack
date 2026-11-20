import { AttachmentKind, AttachmentView, DISCORD_EPOCH, PkgUser } from "./types";

export const IMAGE_EXTS = new Set(["png", "gif", "jpg", "jpeg", "apng", "jfif", "webp", "avif"]);
export const VIDEO_EXTS = new Set(["mp4", "webm", "avi", "mov", "m4v"]);

// Float maths instead of BigInt: precision loss is in the low bits, far below 1 ms.
export function snowflakeToMs(id: string): number {
	const n = Number(id);
	return Number.isFinite(n) ? Math.floor(n / 4194304) + DISCORD_EPOCH : 0;
}

export function msToSnowflake(ms: number): string {
	return (BigInt(Math.max(0, ms - DISCORD_EPOCH)) << 22n).toString();
}

// Snowflakes are decimal strings; compare by length first, then lexically.
export function compareSnowflake(a: string, b: string): number {
	if (a.length !== b.length) return a.length - b.length;
	return a < b ? -1 : a > b ? 1 : 0;
}

const ATTACHMENT_RE = /attachments\/\d+\/(\d+)\/([^/?#]+)/;

export function parseAttachment(url: string): AttachmentView {
	const m = ATTACHMENT_RE.exec(url);
	const fileName = m ? decodeSafe(m[2]) : url.split("/").pop()?.split("?")[0] || "file";
	const dot = fileName.lastIndexOf(".");
	const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
	let kind: AttachmentKind = "file";
	if (IMAGE_EXTS.has(ext)) kind = "image";
	else if (VIDEO_EXTS.has(ext)) kind = "video";
	return { url, id: m ? m[1] : url, fileName, ext, kind };
}

// Decoded names can contain path separators; keep them safe to use as file or zip entry names.
function decodeSafe(s: string): string {
	let out = s;
	try {
		out = decodeURIComponent(s);
	} catch {
		// keep raw
	}
	return out.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "_") || "file";
}

export function isSignedUrl(url: string): boolean {
	return url.includes("?ex=") || url.includes("&ex=");
}

// Signed CDN links carry `ex` (hex unix seconds); treat links expiring within a minute as stale.
export function needsRefresh(url: string): boolean {
	if (!/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//.test(url)) return false;
	const m = /[?&]ex=([0-9a-f]+)/i.exec(url);
	if (!m) return true;
	return parseInt(m[1], 16) * 1000 < Date.now() + 60_000;
}

// Smaller preview from Discord's media proxy; signed query params carry over.
export function thumbnailUrl(url: string, size = 320): string {
	if (!url.startsWith("https://cdn.discordapp.com/attachments/")) return url;
	const proxied = url.replace("https://cdn.discordapp.com/", "https://media.discordapp.net/");
	const sep = proxied.includes("?") ? "&" : "?";
	return `${proxied}${sep}format=webp&width=${size}&height=${size}`;
}

export function userTag(u: PkgUser): string {
	return u.discriminator === "0" || u.discriminator === "0000" || !u.discriminator ? u.username : `${u.username}#${u.discriminator}`;
}

export function displayName(u: PkgUser): string {
	return u.globalName || u.username;
}

export function defaultAvatarIndex(id: string, discriminator: string): number {
	if (!discriminator || discriminator === "0" || discriminator === "0000") {
		try {
			return Number((BigInt(id) >> 22n) % 6n);
		} catch {
			return 0;
		}
	}
	return (parseInt(discriminator, 10) || 0) % 5;
}

export function avatarUrl(u: Pick<PkgUser, "id" | "avatarHash" | "discriminator">, size = 64): string {
	if (u.avatarHash) {
		const ext = u.avatarHash.startsWith("a_") ? "gif" : "png";
		return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatarHash}.${ext}?size=${size}`;
	}
	return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(u.id, u.discriminator)}.png`;
}

// RFC 4180 CSV parser (quoted fields may contain commas, quotes and newlines).
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let i = 0;
	let inQuotes = false;
	const n = text.length;
	if (text.charCodeAt(0) === 0xfeff) i = 1;
	while (i < n) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += c;
			i++;
			continue;
		}
		if (c === '"') {
			inQuotes = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else {
			field += c;
		}
		i++;
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

export function formatDate(ms: number, withTime = true): string {
	const d = new Date(ms);
	return withTime
		? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
		: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatNumber(n: number): string {
	return n.toLocaleString();
}

export function dateStamp(ms: number): string {
	const d = new Date(ms);
	const p = (x: number) => String(x).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
