// Shapes shared between the parser worker and the UI.

export const DELETED_USER_ID = "456226577798135808";
export const DISCORD_EPOCH = 1420070400000;

export enum ChannelType {
	GuildText = 0,
	DM = 1,
	GuildVoice = 2,
	GroupDM = 3,
	GuildAnnouncement = 5,
	AnnouncementThread = 10,
	PublicThread = 11,
	PrivateThread = 12,
	GuildStageVoice = 13,
	GuildForum = 15,
	GuildMedia = 16
}

export interface PkgUser {
	id: string;
	username: string;
	globalName?: string | null;
	discriminator: string;
	avatarHash?: string | null;
}

export interface Relationship {
	id: string;
	type: string;
	nickname?: string | null;
	user: PkgUser;
}

export interface ChannelMeta {
	id: string;
	type: number;
	name?: string | null;
	guildId?: string | null;
	guildName?: string | null;
	recipientIds?: string[];
	dmRecipientId?: string;
	fallbackName?: string;
	count: number;
	firstTs: number;
	hasDuplicates?: boolean;
}

export type AttachmentKind = "image" | "video" | "file";

export interface AttachmentView {
	url: string;
	id: string;
	fileName: string;
	ext: string;
	kind: AttachmentKind;
}

export interface MessageView {
	id: string;
	ts: number;
	content: string;
	channelId: string;
	attachments: AttachmentView[];
	deleted: boolean;
}

export interface ImageItem extends AttachmentView {
	index: number;
	messageId: string;
	channelId: string;
	ts: number;
	content: string;
}

export interface Summary {
	user: PkgUser;
	partialUser: boolean;
	avatar?: Blob;
	users: Record<string, PkgUser>;
	relationships: Relationship[];
	notes: Record<string, string>;
	channels: ChannelMeta[];
	guildNames: Record<string, string>;
	totalMessages: number;
	totalImages: number;
	creationTime: number;
	unsignedLinks: boolean;
	loadMs: number;
}

export interface GuildJoin {
	id: string;
	joinType: string;
	joinMethod?: string;
	applicationId?: string;
	location?: string;
	invites: string[];
	ts: number;
}

export type ActivityState = "ok" | "none" | "disabled_now" | "partially_disabled_now" | "disabled_before";

export interface GuildsResult {
	guilds: GuildJoin[];
	state: ActivityState;
	missingData: boolean | null;
	cutoff?: number;
}

export type SearchMode = "exact" | "words" | "regex";

export interface SearchOptions {
	text: string;
	mode: SearchMode;
	caseSensitive: boolean;
	excludeGuilds: boolean;
	excludeDMs: boolean;
	excludeGroupDMs: boolean;
	excludeDeleted: boolean;
	hasImage: boolean;
	hasVideo: boolean;
	hasFile: boolean;
	before?: number;
	after?: number;
	includeIDs: string[];
	excludeIDs: string[];
	sort: "asc" | "desc";
}

export interface Progress {
	phase: "messages" | "guilds";
	done: number;
	total: number;
	label: string;
}

export interface WorkerApi {
	load(file: File, deletedIds: string[]): Summary;
	search(opts: SearchOptions): number;
	results(offset: number, limit: number): MessageView[];
	resultIds(): string[];
	images(offset: number, limit: number): ImageItem[];
	updateUrls(map: Record<string, string>): void;
	setDeleted(ids: string[], deleted: boolean): void;
	channelMessageCount(channelId: string): number;
}
