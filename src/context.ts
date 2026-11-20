import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Settings } from "./lib/storage";
import type { ChannelMeta, GuildsResult, PkgUser, Progress, Summary } from "./lib/types";
import { ChannelType, DELETED_USER_ID } from "./lib/types";
import type { ParserClient } from "./lib/worker-client";
import { userTag } from "./lib/util";

export type Tab = "messages" | "images" | "dms" | "servers" | "settings";

export interface ViewerItem {
	url: string;
	id: string;
	fileName: string;
	ext: string;
	kind: "image" | "video" | "file";
	messageId: string;
	channelId: string;
	ts: number;
	content: string;
}

export interface ViewerSource {
	items: ViewerItem[];
	index: number;
	total?: number;
	loadMore?: (offset: number) => Promise<ViewerItem[]>;
}

export interface AppCtx {
	parser: ParserClient;
	summary: Summary;
	channels: Map<string, ChannelMeta>;
	users: Record<string, PkgUser>;
	avatarUrl: string;
	settings: Settings;
	setSettings: (s: Settings) => void;
	botToken: string | null;
	setBotToken: (t: string | null) => void;
	userToken: string | null;
	setUserToken: (t: string | null) => void;
	guilds: GuildsResult | null;
	guildsError: string | null;
	guildsProgress: Progress | null;
	deleted: Set<string>;
	markDeleted: (ids: string[]) => void;
	resolveUser: (channelId: string, user: PkgUser) => void;
	resolvedByChannel: Record<string, PkgUser>;
	toast: (msg: string, kind?: "info" | "error" | "success") => void;
	openViewer: (src: ViewerSource) => void;
	searchIn: (ids: string[], label: string) => void;
	setTab: (t: Tab) => void;
	requestGuilds: () => void;
	requireUserToken: () => string | null;
	unload: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
	const c = useContext(Ctx);
	if (!c) throw new Error("App context missing");
	return c;
}

export function dmRecipient(ch: ChannelMeta, app: Pick<AppCtx, "users" | "resolvedByChannel">): { id: string | null; user: PkgUser | null; deleted: boolean } {
	const resolved = app.resolvedByChannel[ch.id];
	if (resolved) return { id: resolved.id, user: resolved, deleted: false };
	const id = ch.dmRecipientId ?? null;
	if (!id || id === DELETED_USER_ID) return { id: null, user: null, deleted: true };
	return { id, user: app.users[id] ?? null, deleted: false };
}

export function channelLabel(ch: ChannelMeta | undefined, app: Pick<AppCtx, "users" | "resolvedByChannel" | "summary">): { title: string; sub?: string } {
	if (!ch) return { title: "Unknown channel" };
	if (ch.type === ChannelType.DM) {
		const r = dmRecipient(ch, app);
		if (r.deleted) return { title: "Deleted User", sub: "Direct message" };
		return { title: r.user ? userTag(r.user) : `Unknown user ${r.id}`, sub: "Direct message" };
	}
	if (ch.type === ChannelType.GroupDM) {
		const names = (ch.recipientIds ?? [])
			.filter((id) => id !== app.summary.user.id)
			.map((id) => (app.users[id] ? userTag(app.users[id]) : null))
			.filter(Boolean);
		return { title: ch.name || names.join(", ") || "Unnamed group", sub: "Group DM" };
	}
	const guild = ch.guildName || (ch.guildId ? app.summary.guildNames[ch.guildId] : null);
	if (ch.name) return { title: `#${ch.name}`, sub: guild ?? undefined };
	return { title: ch.fallbackName || `Channel ${ch.id}`, sub: guild ?? undefined };
}
