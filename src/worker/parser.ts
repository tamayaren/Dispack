/// <reference lib="webworker" />
import { BlobReader, BlobWriter, configure, Entry, FileEntry, TextWriter, ZipReader } from "@zip.js/zip.js";
import {
	ActivityState,
	ChannelMeta,
	ChannelType,
	DELETED_USER_ID,
	GuildJoin,
	GuildsResult,
	ImageItem,
	MessageView,
	PkgUser,
	Progress,
	Relationship,
	SearchOptions,
	Summary
} from "../lib/types";
import { compareSnowflake, parseAttachment, parseCsv, snowflakeToMs } from "../lib/util";

configure({ useWebWorkers: false });

interface Msg {
	id: string;
	ts: number;
	content: string;
	att: string[] | null;
	ch: ChannelRec;
	del: boolean;
}

interface ChannelRec {
	meta: ChannelMeta;
	msgs: Msg[];
}

interface ImageRef {
	msg: Msg;
	i: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let channels: ChannelRec[] = [];
let messageById = new Map<string, Msg>();
let images: ImageRef[] = [];
let lastResults: Msg[] = [];
let attIndex = new Map<string, ImageRef[]>();

function post(event: string, data: unknown) {
	ctx.postMessage({ event, data });
}

function progress(p: Progress) {
	post("progress", p);
}

function fileEntry(e: Entry | undefined): FileEntry | undefined {
	return e && !e.directory ? (e as FileEntry) : undefined;
}

async function readText(e: FileEntry): Promise<string> {
	return e.getData(new TextWriter());
}

async function readJson<T>(e: FileEntry): Promise<T> {
	return JSON.parse(await readText(e)) as T;
}

// Streams an entry line by line; returning early from the loop cancels decompression.
async function* readLines(e: FileEntry, onBytes?: (chars: number) => void): AsyncGenerator<string> {
	const pipe = new TransformStream<BufferSource, BufferSource>();
	const done = e.getData(pipe.writable).catch(() => undefined);
	const reader = pipe.readable.pipeThrough(new TextDecoderStream()).getReader();
	let buf = "";
	let finished = false;
	try {
		while (true) {
			const { value, done: end } = await reader.read();
			if (end) break;
			onBytes?.(value.length);
			buf += value;
			let nl: number;
			while ((nl = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, nl).replace(/\r$/, "");
				buf = buf.slice(nl + 1);
				if (line) yield line;
			}
		}
		if (buf.trim()) yield buf;
		finished = true;
	} finally {
		if (!finished) await reader.cancel().catch(() => undefined);
		await done;
	}
}

interface RawUser {
	id: string;
	username: string;
	global_name?: string | null;
	discriminator?: string;
	avatar_hash?: string | null;
	avatar?: string | null;
	relationships?: { id: string; type: number | string; nickname?: string | null; user: RawUser }[];
	notes?: Record<string, string>;
}

interface RawChannel {
	id: string;
	type: number | string;
	name?: string | null;
	guild?: { id: string; name: string } | null;
	recipients?: string[];
}

const RELATIONSHIP_NAMES = ["NONE", "FRIEND", "BLOCKED", "PENDING_INCOMING", "PENDING_OUTGOING", "IMPLICIT"];

function toUser(r: RawUser): PkgUser {
	return {
		id: String(r.id),
		username: r.username ?? "Unknown",
		globalName: r.global_name ?? null,
		discriminator: r.discriminator ?? "0",
		avatarHash: r.avatar_hash ?? r.avatar ?? null
	};
}

function channelType(t: number | string): number {
	if (typeof t === "number") return t;
	const map: Record<string, number> = {
		GUILD_TEXT: 0, DM: 1, GUILD_VOICE: 2, GROUP_DM: 3, GUILD_CATEGORY: 4, GUILD_ANNOUNCEMENT: 5, GUILD_NEWS: 5,
		ANNOUNCEMENT_THREAD: 10, PUBLIC_THREAD: 11, PRIVATE_THREAD: 12, GUILD_STAGE_VOICE: 13, GUILD_FORUM: 15, GUILD_MEDIA: 16
	};
	return map[t.toUpperCase()] ?? (Number(t) || 0);
}

function normalizeRecipients(rc: RawChannel): string[] {
	return (rc.recipients ?? []).map((r) => (r === "Deleted User" ? DELETED_USER_ID : String(r)));
}

async function load(file: File, deletedIds: string[]): Promise<Summary> {
	const started = performance.now();
	channels = [];
	messageById = new Map();
	images = [];
	lastResults = [];
	attIndex = new Map();

	const zip = new ZipReader(new BlobReader(file));
	let entries: Entry[];
	try {
		entries = await zip.getEntries();
	} catch {
		throw new Error("This file isn't a readable zip archive. Select the package.zip that Discord emailed you.");
	}
	const byName = new Map<string, Entry>();
	for (const e of entries) byName.set(e.filename.toLowerCase(), e);
	const get = (name: string) => fileEntry(byName.get(name.toLowerCase()));

	const index = get("messages/index.json");
	if (!index) throw new Error("Invalid data package: missing messages/index.json");
	const creationTime = index.lastModDate?.getTime() ?? Date.now();

	const channelEntryRe = /^messages\/(c?\d+)\/channel\.json$/i;
	const messagesEntryRe = /^messages\/(c?\d+)\/messages\.(csv|json)$/i;
	const avatarRe = /^account\/avatar\.[a-z]+$/i;
	const total = entries.length;

	// Account
	let user: PkgUser;
	let partialUser = false;
	let relationships: Relationship[] = [];
	let notes: Record<string, string> = {};
	const users: Record<string, PkgUser> = {};
	const userEntry = get("account/user.json");
	if (userEntry) {
		const raw = await readJson<RawUser>(userEntry);
		user = toUser(raw);
		notes = raw.notes ?? {};
		for (const r of raw.relationships ?? []) {
			if (!r.user) continue;
			const ru = toUser(r.user);
			const type = typeof r.type === "number" ? RELATIONSHIP_NAMES[r.type] ?? String(r.type) : String(r.type);
			relationships.push({ id: String(r.id), type, nickname: r.nickname, user: ru });
			if (ru.id !== DELETED_USER_ID) users[ru.id] = ru;
		}
	} else {
		// Partial package: guess our id as the most common DM recipient.
		partialUser = true;
		const counts = new Map<string, number>();
		let i = 0;
		for (const e of entries) {
			i++;
			if (i % 200 === 0) progress({ phase: "messages", done: i, total, label: "Working out your user ID" });
			const fe = fileEntry(e);
			if (!fe || !channelEntryRe.test(fe.filename)) continue;
			const rc = await readJson<RawChannel>(fe);
			if (channelType(rc.type) !== ChannelType.DM) continue;
			for (const id of normalizeRecipients(rc)) {
				if (id !== DELETED_USER_ID) counts.set(id, (counts.get(id) ?? 0) + 1);
			}
		}
		let best = "";
		let bestCount = 0;
		for (const [id, c] of counts) {
			if (c > bestCount) {
				best = id;
				bestCount = c;
			}
		}
		if (bestCount <= 2) {
			throw new Error('Couldn\'t work out your user ID. Request a new data package with the "Account" option ticked.');
		}
		user = { id: best, username: "You", globalName: "You", discriminator: "0" };
	}

	const channelNames = await readJson<Record<string, string>>(index).catch(() => ({} as Record<string, string>));
	const guildsIndex = get("servers/index.json");
	const guildNames = guildsIndex ? await readJson<Record<string, string>>(guildsIndex).catch(() => ({})) : {};

	const dmNameRe = /^Direct Message with (.+?)(?:#(\d{1,4}))?$/;
	const deleted = new Set(deletedIds);
	let avatar: Blob | undefined;
	let totalMessages = 0;
	let processed = 0;

	for (const e of entries) {
		processed++;
		if (processed % 50 === 0) progress({ phase: "messages", done: processed, total, label: `Reading ${e.filename}` });
		const fe = fileEntry(e);
		if (!fe) continue;

		if (avatarRe.test(fe.filename)) {
			avatar = await fe.getData(new BlobWriter(/png|gif|jpe?g|webp/i.test(fe.filename) ? `image/${fe.filename.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}` : undefined));
			continue;
		}

		const m = messagesEntryRe.exec(fe.filename);
		if (!m) continue;
		const folder = m[1];
		const channelId = folder.replace(/^c/i, "");
		const chEntry = get(`messages/${folder}/channel.json`);
		const rc: RawChannel = chEntry ? await readJson<RawChannel>(chEntry) : { id: channelId, type: 0 };
		const type = channelType(rc.type);
		const meta: ChannelMeta = {
			id: String(rc.id ?? channelId),
			type,
			name: rc.name ?? null,
			guildId: rc.guild?.id ?? null,
			guildName: rc.guild?.name ?? null,
			recipientIds: normalizeRecipients(rc),
			count: 0,
			firstTs: snowflakeToMs(String(rc.id ?? channelId))
		};
		const indexName = channelNames[channelId] ?? channelNames[meta.id];

		if (type === ChannelType.DM) {
			const other = meta.recipientIds!.find((r) => r !== user.id) ?? meta.recipientIds![0] ?? DELETED_USER_ID;
			meta.dmRecipientId = other;
			if (!users[other] && other !== DELETED_USER_ID && indexName) {
				const nm = dmNameRe.exec(indexName);
				if (nm) users[other] = { id: other, username: nm[1], discriminator: nm[2] ?? "0" };
			}
		}
		if (!meta.name && indexName) meta.fallbackName = indexName;

		const rec: ChannelRec = { meta, msgs: [] };
		const text = await readText(fe);
		const add = (id: string, content: string, attachments: string) => {
			if (!id) return;
			const msg: Msg = {
				id,
				ts: snowflakeToMs(id),
				content: content ?? "",
				att: attachments ? attachments.split(" ").filter(Boolean) : null,
				ch: rec,
				del: deleted.has(id)
			};
			rec.msgs.push(msg);
		};

		if (m[2].toLowerCase() === "csv") {
			const rows = parseCsv(text);
			for (const row of rows) {
				if (row[0] === "ID" || row.length < 3) continue;
				add(row[0], row[2], row[3] ?? "");
			}
		} else {
			const arr = JSON.parse(text) as Record<string, unknown>[];
			for (const o of arr) {
				add(String(o.ID ?? o.id ?? ""), String(o.Contents ?? o.contents ?? ""), String(o.Attachments ?? o.attachments ?? ""));
			}
		}

		for (const msg of rec.msgs) {
			messageById.set(msg.id, msg);
			if (msg.att) {
				msg.att.forEach((url, i) => {
					const ref = { msg, i };
					const refs = attIndex.get(url);
					if (refs) refs.push(ref);
					else attIndex.set(url, [ref]);
					if (parseAttachment(url).kind === "image") images.push(ref);
				});
			}
		}
		meta.count = rec.msgs.length;
		totalMessages += rec.msgs.length;
		channels.push(rec);
	}
	await zip.close();

	// Flag users with more than one DM channel (old bug allowed duplicate DMs).
	const dmByUser = new Map<string, ChannelRec[]>();
	for (const c of channels) {
		if (c.meta.type !== ChannelType.DM || !c.meta.dmRecipientId || c.meta.dmRecipientId === DELETED_USER_ID) continue;
		const list = dmByUser.get(c.meta.dmRecipientId) ?? [];
		list.push(c);
		dmByUser.set(c.meta.dmRecipientId, list);
	}
	for (const list of dmByUser.values()) {
		if (list.length > 1) list.forEach((c) => (c.meta.hasDuplicates = true));
	}

	images.sort((a, b) => compareSnowflake(b.msg.id, a.msg.id) || b.i - a.i);
	const firstImage = images[0];
	const unsignedLinks = !!firstImage && !/[?&]ex=/.test(firstImage.msg.att![firstImage.i]);

	progress({ phase: "messages", done: total, total, label: "Done" });

	// Activity is parsed afterwards so the UI is usable immediately.
	setTimeout(() => {
		loadGuilds(file).then(
			(r) => post("guilds", r),
			(err) => post("guildsError", String(err?.message ?? err))
		);
	}, 0);

	return {
		user,
		partialUser,
		avatar,
		users,
		relationships,
		notes,
		channels: channels.map((c) => c.meta),
		guildNames,
		totalMessages,
		totalImages: images.length,
		creationTime,
		unsignedLinks,
		loadMs: performance.now() - started
	};
}

interface RawEvent {
	event_type?: string;
	guild?: string;
	guild_id?: string;
	invite?: string;
	invite_code?: string;
	join_type?: string;
	join_method?: string;
	application_id?: string;
	location?: string;
	control_type?: string;
	timestamp?: string;
}

function eventTs(e: RawEvent): number {
	if (!e.timestamp) return 0;
	return Date.parse(e.timestamp.replace(/"/g, "")) || 0;
}

/*
 * Picking which activity file to trust (see upstream issue #12):
 * packages before 2024-05 use reporting; after 2024-06 use analytics;
 * in between, use reporting if the account registered in 2024 or has pre-2024 events.
 * If analytics is missing, fall back to modeling, then reporting.
 */
async function loadGuilds(file: File): Promise<GuildsResult> {
	const zip = new ZipReader(new BlobReader(file));
	const entries = await zip.getEntries();
	const parts: Record<"reporting" | "modeling" | "analytics", FileEntry[]> = { reporting: [], modeling: [], analytics: [] };
	for (const e of entries) {
		const fe = fileEntry(e);
		if (!fe) continue;
		const m = /activity\/(reporting|modeling|analytics)\/events.+\.json$/i.exec(fe.filename);
		if (m) parts[m[1].toLowerCase() as keyof typeof parts].push(fe);
	}
	for (const list of Object.values(parts)) list.sort((a, b) => a.filename.localeCompare(b.filename));
	const reporting = parts.reporting[0];
	const modeling = parts.modeling.length ? parts.modeling : undefined;
	const analytics = parts.analytics.length ? parts.analytics : undefined;

	const result: GuildsResult = { guilds: [], state: "ok", missingData: null };
	if (!reporting) {
		await zip.close();
		result.state = "none";
		return result;
	}

	type Pick = "analytics" | "modeling" | "reporting";
	let pick: Pick = "analytics";
	const created = reporting.lastModDate.getTime();
	const start = new Date(2024, 4, 1).getTime();
	const end = new Date(2024, 5, 30).getTime();

	if (created < start) {
		result.missingData = false;
		pick = "reporting";
	} else if (created <= end) {
		let registered: number | null = null;
		let pre2024 = false;
		const ignore = ["payment_", "subscription_"];
		let read = 0;
		let lastReport = 0;
		for await (const line of readLines(reporting, (n) => {
			read += n;
			if (read - lastReport > 2_000_000) {
				lastReport = read;
				progress({ phase: "guilds", done: read, total: reporting.uncompressedSize, label: "Checking activity history" });
			}
		})) {
			let ev: RawEvent;
			try {
				ev = JSON.parse(line);
			} catch {
				continue;
			}
			if (ev.event_type === "register") {
				registered = eventTs(ev);
			} else if (!pre2024) {
				const ts = eventTs(ev);
				if (ts && new Date(ts).getFullYear() < 2024 && !ignore.some((p) => ev.event_type?.startsWith(p))) pre2024 = true;
			}
			if (registered !== null && pre2024) break;
		}
		if (registered === null) throw new Error("Couldn't find the register event in your activity data");
		if (new Date(registered).getFullYear() === 2024 || pre2024) {
			result.missingData = false;
			pick = "reporting";
		}
	}

	if (pick === "analytics" && !analytics) {
		result.missingData = true;
		if (modeling) {
			result.state = "partially_disabled_now";
			pick = "modeling";
		} else {
			result.state = "disabled_now";
			pick = "reporting";
		}
	}

	const files = pick === "analytics" ? analytics! : pick === "modeling" ? modeling! : parts.reporting;
	const totalSize = files.reduce((n, f) => n + f.uncompressedSize, 0);
	const joined = new Map<string, GuildJoin>();
	const accepted: { guild: string; invite?: string; ts: number }[] = [];
	const prefixes = [
		'{"event_type":"guild_joined',
		'{"event_type":"create_guild',
		'{"event_type":"accepted_instant_invite',
		'{"event_type":"privacy_control_updated'
	];
	let read = 0;
	let lastReport = 0;
	const onBytes = (n: number) => {
		read += n;
		if (read - lastReport > 2_000_000) {
			lastReport = read;
			progress({ phase: "guilds", done: read, total: totalSize, label: "Reading server history" });
		}
	};
	for (const entry of files)
	for await (const line of readLines(entry, onBytes)) {
		if (!prefixes.some((p) => line.startsWith(p))) continue;
		let ev: RawEvent;
		try {
			ev = JSON.parse(line);
		} catch {
			continue;
		}
		const guildId = ev.guild_id ?? ev.guild;
		const invite = ev.invite_code ?? ev.invite;
		const ts = eventTs(ev);
		switch (ev.event_type) {
			case "guild_joined":
			case "guild_joined_pending": {
				if (!guildId) break;
				const g = joined.get(guildId);
				if (g) {
					if (invite && !g.invites.includes(invite)) g.invites.push(invite);
					if (ts && ts < g.ts) g.ts = ts;
				} else {
					joined.set(guildId, {
						id: guildId,
						joinType: ev.join_type ?? "unknown",
						joinMethod: ev.join_method,
						applicationId: ev.application_id,
						location: ev.location,
						invites: invite ? [invite] : [],
						ts
					});
				}
				break;
			}
			case "create_guild":
				if (guildId) joined.set(guildId, { id: guildId, joinType: "created by you", invites: [], ts });
				break;
			case "accepted_instant_invite":
				if (guildId) accepted.push({ guild: guildId, invite, ts });
				break;
			case "privacy_control_updated":
				if (ev.control_type === "usage_statistics") {
					if (result.missingData === null) result.missingData = true;
					result.state = "disabled_before";
					if (!result.cutoff || ts < result.cutoff) result.cutoff = ts;
				}
				break;
		}
	}
	await zip.close();

	accepted.sort((a, b) => a.ts - b.ts);
	for (const a of accepted) {
		const g = joined.get(a.guild);
		if (!g) {
			joined.set(a.guild, { id: a.guild, joinType: "invite", invites: a.invite ? [a.invite] : [], ts: a.ts });
		} else {
			if (a.invite && !g.invites.includes(a.invite)) g.invites.push(a.invite);
			if (a.ts && a.ts < g.ts) g.ts = a.ts;
		}
	}
	result.guilds = [...joined.values()].sort((a, b) => b.ts - a.ts);
	progress({ phase: "guilds", done: 1, total: 1, label: "Done" });
	return result;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function search(o: SearchOptions): number {
	const flags = o.caseSensitive ? "su" : "isu";
	let test: (s: string) => boolean;
	const text = o.text;
	if (!text) {
		test = () => true;
	} else if (o.mode === "regex") {
		const re = new RegExp(text, flags);
		test = (s) => re.test(s);
	} else if (o.mode === "words") {
		const words = text.split(/\s+/).filter(Boolean);
		const re = new RegExp("^" + words.map((w) => `(?=.*?(?<![\\p{L}\\p{N}_])${escapeRegex(w)}(?![\\p{L}\\p{N}_]))`).join(""), flags);
		test = (s) => re.test(s);
	} else if (o.caseSensitive) {
		test = (s) => s.includes(text);
	} else {
		const lower = text.toLowerCase();
		test = (s) => s.toLowerCase().includes(lower);
	}

	const include = new Set(o.includeIDs);
	const exclude = new Set(o.excludeIDs);
	const wantAttachments = o.hasImage || o.hasVideo || o.hasFile;
	const out: Msg[] = [];

	for (const c of channels) {
		const t = c.meta.type;
		const isDM = t === ChannelType.DM;
		const isGDM = t === ChannelType.GroupDM;
		if (isDM && o.excludeDMs) continue;
		if (isGDM && o.excludeGroupDMs) continue;
		if (!isDM && !isGDM && o.excludeGuilds) continue;
		const gid = c.meta.guildId;
		if (exclude.has(c.meta.id) || (gid && exclude.has(gid))) continue;
		if (include.size && !include.has(c.meta.id) && !(gid && include.has(gid))) continue;

		for (const m of c.msgs) {
			if (o.excludeDeleted && m.del) continue;
			if (o.before !== undefined && m.ts >= o.before) continue;
			if (o.after !== undefined && m.ts <= o.after) continue;
			if (wantAttachments) {
				if (!m.att) continue;
				let ok = false;
				for (const url of m.att) {
					const k = parseAttachment(url).kind;
					if ((o.hasImage && k === "image") || (o.hasVideo && k === "video") || (o.hasFile && k === "file")) {
						ok = true;
						break;
					}
				}
				if (!ok) continue;
			}
			if (test(m.content)) out.push(m);
		}
	}

	out.sort((a, b) => (o.sort === "asc" ? compareSnowflake(a.id, b.id) : compareSnowflake(b.id, a.id)));
	lastResults = out;
	return out.length;
}

function view(m: Msg): MessageView {
	return {
		id: m.id,
		ts: m.ts,
		content: m.content,
		channelId: m.ch.meta.id,
		attachments: (m.att ?? []).map(parseAttachment),
		deleted: m.del
	};
}

function imageView(ref: ImageRef, index: number): ImageItem {
	const a = parseAttachment(ref.msg.att![ref.i]);
	return { ...a, index, messageId: ref.msg.id, channelId: ref.msg.ch.meta.id, ts: ref.msg.ts, content: ref.msg.content };
}

function updateUrls(map: Record<string, string>) {
	for (const [from, to] of Object.entries(map)) {
		const refs = attIndex.get(from);
		if (!refs || from === to) continue;
		for (const r of refs) r.msg.att![r.i] = to;
		attIndex.delete(from);
		const existing = attIndex.get(to);
		attIndex.set(to, existing ? existing.concat(refs) : refs);
	}
}

const handlers: Record<string, (...args: any[]) => unknown> = {
	load,
	search,
	results: (offset: number, limit: number) => lastResults.slice(offset, offset + limit).map(view),
	resultIds: () => lastResults.filter((m) => !m.del).map((m) => `${m.ch.meta.id}:${m.id}`),
	images: (offset: number, limit: number) => images.slice(offset, offset + limit).map((r, k) => imageView(r, offset + k)),
	updateUrls,
	setDeleted: (ids: string[], value: boolean) => {
		for (const id of ids) {
			const m = messageById.get(id);
			if (m) m.del = value;
		}
	},
	channelMessageCount: (id: string) => channels.find((c) => c.meta.id === id)?.msgs.length ?? 0
};

ctx.onmessage = async (ev: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
	const { id, method, args } = ev.data;
	try {
		const fn = handlers[method];
		if (!fn) throw new Error(`Unknown method ${method}`);
		const result = await fn(...args);
		ctx.postMessage({ id, ok: true, result });
	} catch (err) {
		ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
	}
};
