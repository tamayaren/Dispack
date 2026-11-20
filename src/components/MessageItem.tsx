import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import { channelLabel, dmRecipient, useApp } from "../context";
import { copyText, deleteOne, fetchInfo, jumpToMessage, reopenDM, viewProfile } from "../lib/actions";
import { cachedUrl } from "../lib/discord";
import { saveOne, TapAgainError } from "../lib/save";
import { ChannelType, type AttachmentView, type MessageView } from "../lib/types";
import { displayName, formatDate } from "../lib/util";
import { Content } from "./Content";
import { IconFile, IconMore } from "./icons";
import { ActionSheet, type SheetAction } from "./Modal";
import { Thumb } from "./Thumb";

interface Props {
	msg: MessageView;
	deleted: boolean;
	version: number;
	onOpenImage: (msg: MessageView, att: AttachmentView) => void;
}

function MessageItemInner({ msg, deleted, version, onOpenImage }: Props) {
	const app = useApp();
	const [menu, setMenu] = useState(false);
	const ch = app.channels.get(msg.channelId);
	const label = channelLabel(ch, app);
	const isDM = ch?.type === ChannelType.DM;
	const recipient = ch && isDM ? dmRecipient(ch, app) : null;
	const images = msg.attachments.filter((a) => a.kind === "image");
	const others = msg.attachments.filter((a) => a.kind !== "image");

	const actions: SheetAction[] = [
		{ label: "Jump to message in Discord", onSelect: () => jumpToMessage(app, msg.channelId, msg.id) },
		{ label: "Search in this channel", onSelect: () => app.searchIn([msg.channelId], label.title) },
		{ label: "Search in this server", hidden: !ch?.guildId, onSelect: () => app.searchIn([ch!.guildId!], label.sub ?? "server") },
		{ label: "Copy message text", hidden: !msg.content, onSelect: () => copyText(app, msg.content) },
		{ label: "Copy message ID", onSelect: () => copyText(app, msg.id) },
		{ label: "Copy channel ID", onSelect: () => copyText(app, msg.channelId) },
		{ label: "Copy server ID", hidden: !ch?.guildId, onSelect: () => copyText(app, ch!.guildId!) },
		{ label: "Copy user ID", hidden: !recipient?.id, onSelect: () => copyText(app, recipient!.id!) },
		{ label: "View user profile", hidden: !recipient?.id, onSelect: () => viewProfile(app, recipient!.id!) },
		{ label: "Reopen DM", hidden: !isDM || !recipient?.id, onSelect: () => reopenDM(app, recipient!.id!, msg.channelId) },
		{ label: "Fetch user info", hidden: !isDM || !recipient?.deleted, onSelect: () => fetchInfo(app, msg.channelId) },
		...msg.attachments.map((a) => ({
			label: `Save ${a.fileName}`,
			onSelect: () => saveOne({ ...a, ts: msg.ts }, app.botToken, app.settings.saveMethod).catch((e) => app.toast(e.message, e instanceof TapAgainError ? "info" : "error"))
		})),
		{
			label: "Delete message",
			danger: true,
			hidden: deleted,
			onSelect: async () => {
				if (!confirm("Delete this message from Discord? This can't be undone.")) return;
				if (await deleteOne(app, msg.channelId, msg.id)) app.toast("Message deleted", "success");
			}
		}
	];

	return (
		<article class={`message${deleted ? " deleted" : ""}`}>
			<img class="avatar" src={app.avatarUrl} alt="" width={40} height={40} loading="lazy" />
			<div class="message-body">
				<div class="message-head">
					<strong>{displayName(app.summary.user)}</strong>
					<time class="muted small" dateTime={new Date(msg.ts).toISOString()}>
						{formatDate(msg.ts)}
					</time>
					{deleted && <span class="badge danger">deleted</span>}
					<button type="button" class="icon-btn more" aria-label="Message actions" onClick={() => setMenu(true)}>
						<IconMore />
					</button>
				</div>
				<button type="button" class="channel-chip" onClick={() => app.searchIn([msg.channelId], label.title)} title="Search in this channel">
					<span class="ellipsis">{label.title}</span>
					{label.sub && <span class="muted ellipsis">· {label.sub}</span>}
				</button>
				<Content text={msg.content} />
				{images.length > 0 && (
					<div class={`att-grid n${Math.min(images.length, 4)}`}>
						{images.map((a) => (
							<button key={a.id} type="button" class="att-img" onClick={() => onOpenImage(msg, a)} aria-label={`Open ${a.fileName}`}>
								<Thumb url={a.url} alt={a.fileName} version={version} />
							</button>
						))}
					</div>
				)}
				{others.map((a) =>
					a.kind === "video" ? (
						<video key={a.id} class="att-video" controls preload="none" playsInline src={cachedUrl(a.url)} />
					) : (
						<a key={a.id} class="att-file" href={cachedUrl(a.url)} target="_blank" rel="noopener noreferrer">
							<IconFile size={28} />
							<span class="ellipsis">{a.fileName}</span>
						</a>
					)
				)}
			</div>
			{menu && <ActionSheet title="Message" actions={actions} onClose={() => setMenu(false)} />}
		</article>
	);
}

export const MessageItem = memo(MessageItemInner);
