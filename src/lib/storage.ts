import type { PkgUser, SearchOptions } from "./types";

// Per-device preferences only. Tokens are never written here.

export type OpenTarget = "web" | "ptb" | "canary" | "app";
export type SaveMethod = "auto" | "download" | "share";

export interface Settings {
	openIn: OpenTarget;
	saveMethod: SaveMethod;
	pageSize: number;
	search: Omit<SearchOptions, "text">;
}

export const DEFAULT_SEARCH: Omit<SearchOptions, "text"> = {
	mode: "exact",
	caseSensitive: false,
	excludeGuilds: false,
	excludeDMs: false,
	excludeGroupDMs: false,
	excludeDeleted: false,
	hasImage: false,
	hasVideo: false,
	hasFile: false,
	includeIDs: [],
	excludeIDs: [],
	sort: "desc"
};

const DEFAULTS: Settings = { openIn: "web", saveMethod: "auto", pageSize: 50, search: DEFAULT_SEARCH };

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown): boolean {
	try {
		localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		// Storage can be full or blocked (private mode).
		return false;
	}
}

export function loadSettings(): Settings {
	const s = read<Partial<Settings>>("dispack.settings", {});
	return { ...DEFAULTS, ...s, search: { ...DEFAULT_SEARCH, ...(s.search ?? {}) } };
}

// The "only search in" scope is per session, so it isn't persisted.
export function saveSettings(s: Settings) {
	write("dispack.settings", { ...s, search: { ...s.search, includeIDs: [] } });
}

// Deleted message IDs are keyed per account so packages from different accounts don't mix.
export function loadDeleted(userId: string): string[] {
	return read<string[]>(`dispack.deleted.${userId}`, []);
}

export function saveDeleted(userId: string, ids: Iterable<string>): boolean {
	return write(`dispack.deleted.${userId}`, [...ids]);
}

export function loadResolvedUsers(userId: string): Record<string, PkgUser> {
	return read<Record<string, PkgUser>>(`dispack.resolved.${userId}`, {});
}

export function saveResolvedUsers(userId: string, map: Record<string, PkgUser>) {
	write(`dispack.resolved.${userId}`, map);
}

export function clearAccountData(userId: string) {
	try {
		localStorage.removeItem(`dispack.deleted.${userId}`);
		localStorage.removeItem(`dispack.resolved.${userId}`);
	} catch {
		// ignore
	}
}
