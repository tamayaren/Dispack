import type { OpenTarget } from "./storage";
import type { ChannelMeta, PkgUser } from "./types";
import { ChannelType } from "./types";
import { needsRefresh } from "./util";

const API = "https://discord.com/api/v9";

export class DiscordError extends Error {
	constructor(message: string, public status: number, public code?: number) {
		super(message);
	}
}

function decodeTokenId(token: string): string | null {
	const parts = token.trim().split(".");
	if (parts.length !== 3) return null;
	try {
		let b = parts[0].replace(/-/g, "+").replace(/_/g, "/");
		while (b.length % 4) b += "=";
		const id = atob(b);
		return /^\d{15,22}$/.test(id) ? id : null;
	} catch {
		return null;
	}
}

export function checkUserToken(token: string, userId: string): string | null {
	const id = decodeTokenId(token);
	if (!id) return "That doesn't look like a Discord token.";
	if (id !== userId) return "This token belongs to a different account than the loaded package.";
	return null;
}

export function checkBotToken(token: string, userId: string): string | null {
	const id = decodeTokenId(token);
	if (!id) return "That doesn't look like a bot token.";
	if (id === userId) return "This is your account token, not a bot token. Create a bot in the Discord Developer Portal and use its token.";
	return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// IDs come from the (untrusted) zip; only digits may reach an API path.
function id(value: string): string {
	if (!/^\d{15,22}$/.test(value)) throw new DiscordError(`Invalid Discord ID: ${String(value).slice(0, 30)}`, 0);
	return value;
}

async function request<T>(
	method: string,
	path: string,
	auth: string,
	body?: unknown,
	extra?: Record<string, string>,
	allow404 = false
): Promise<{ status: number; data: T }> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const headers: Record<string, string> = { Authorization: auth, ...extra };
		if (body !== undefined) headers["Content-Type"] = "application/json";
		let res: Response;
		try {
			res = await fetch(API + path, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				credentials: "omit",
				referrerPolicy: "no-referrer"
			});
		} catch {
			throw new DiscordError("Couldn't reach Discord. Check your connection.", 0);
		}
		const text = await res.text();
		let data: any = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = text;
		}
		if (res.status === 429) {
			const wait = (Number(data?.retry_after) || 1) * 1000;
			await sleep(Math.min(wait + 100, 60_000));
			continue;
		}
		if (!res.ok && !(allow404 && res.status === 404)) {
			const msg = data?.message ?? `HTTP ${res.status}`;
			throw new DiscordError(`Discord error${data?.code ? ` (${data.code})` : ""}: ${msg}`, res.status, data?.code);
		}
		return { status: res.status, data: data as T };
	}
	throw new DiscordError("Rate limited by Discord too many times. Try again later.", 429);
}

// ---- Bot token: refresh expired/unsigned attachment links ----

const refreshed = new Map<string, string>();
// Links Discord wouldn't refresh (deleted files); not retried this session.
const unrefreshable = new Set<string>();

export function cachedUrl(url: string): string {
	return refreshed.get(url) ?? url;
}

export function clearUrlCache() {
	refreshed.clear();
	unrefreshable.clear();
}

export async function refreshUrls(urls: string[], botToken: string | null): Promise<Record<string, string>> {
	const todo = [
		...new Set(
			urls.filter((u) => {
				if (unrefreshable.has(u)) return false;
				const cached = refreshed.get(u);
				return cached ? needsRefresh(cached) : needsRefresh(u);
			})
		)
	];
	const out: Record<string, string> = {};
	if (!botToken || !todo.length) return out;
	for (let i = 0; i < todo.length; i += 50) {
		if (i) await sleep(100);
		const batch = todo.slice(i, i + 50);
		const { data } = await request<{ refreshed_urls: { original: string; refreshed: string }[] }>(
			"POST",
			"/attachments/refresh-urls",
			`Bot ${botToken}`,
			{ attachment_urls: batch }
		);
		const returned = new Set<string>();
		for (const r of data?.refreshed_urls ?? []) {
			if (!r.refreshed) continue;
			returned.add(r.original);
			refreshed.set(r.original, r.refreshed);
			out[r.original] = r.refreshed;
		}
		for (const u of batch) if (!returned.has(u)) unrefreshable.add(u);
	}
	return out;
}

// ---- User token actions (self-bot; against Discord's rules) ----

export async function deleteMessage(token: string, channelId: string, messageId: string): Promise<void> {
	// 404 means it's already gone, which counts as deleted.
	await request("DELETE", `/channels/${id(channelId)}/messages/${id(messageId)}`, token, undefined, undefined, true);
}

export async function openDM(token: string, userId: string): Promise<string> {
	const { data } = await request<{ id: string }>("POST", "/users/@me/channels", token, { recipients: [id(userId)] }, {
		"X-Context-Properties": btoa("{}")
	});
	if (!data?.id) throw new DiscordError("Discord didn't return a DM channel.", 0);
	return data.id;
}

export async function sendMessage(token: string, channelId: string, content: string): Promise<void> {
	await request("POST", `/channels/${id(channelId)}/messages`, token, { content, flags: 0, tts: false });
}

export async function fetchChannelRecipient(token: string, channelId: string): Promise<PkgUser | null> {
	const { status, data } = await request<any>("GET", `/channels/${id(channelId)}`, token, undefined, undefined, true);
	if (status === 404 || !data?.recipients?.length) return null;
	const r = data.recipients[0];
	return { id: r.id, username: r.username, globalName: r.global_name, discriminator: r.discriminator ?? "0", avatarHash: r.avatar };
}

// ---- Links into Discord ----

export function discordUrl(path: string, target: OpenTarget): string {
	switch (target) {
		case "app":
			return `discord://-/${path}`;
		case "ptb":
			return `https://ptb.discord.com/${path}`;
		case "canary":
			return `https://canary.discord.com/${path}`;
		default:
			return `https://discord.com/${path}`;
	}
}

export function messagePath(ch: ChannelMeta | undefined, messageId: string): string | null {
	if (!ch) return null;
	if (ch.guildId) return `channels/${ch.guildId}/${ch.id}/${messageId}`;
	if (ch.type === ChannelType.DM || ch.type === ChannelType.GroupDM) return `channels/@me/${ch.id}/${messageId}`;
	return null;
}
