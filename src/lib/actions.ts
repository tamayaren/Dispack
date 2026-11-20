import type { AppCtx } from "../context";
import { deleteMessage, discordUrl, fetchChannelRecipient, messagePath, openDM, sendMessage } from "./discord";
import { ChannelType, DELETED_USER_ID } from "./types";

export async function copyText(app: AppCtx, text: string, what = "Copied") {
	try {
		await navigator.clipboard.writeText(text);
		app.toast(what, "success");
	} catch {
		prompt("Copy this:", text);
	}
}

export function jumpToMessage(app: AppCtx, channelId: string, messageId: string) {
	const path = messagePath(app.channels.get(channelId), messageId);
	if (!path) {
		app.toast("Can't tell which server this message is in. This usually means you've left it.", "error");
		return;
	}
	window.open(discordUrl(path, app.settings.openIn), "_blank", "noopener");
}

export function viewProfile(app: AppCtx, userId: string) {
	window.open(discordUrl(`users/${userId}`, app.settings.openIn), "_blank", "noopener");
}

export async function deleteOne(app: AppCtx, channelId: string, messageId: string): Promise<boolean> {
	const token = app.requireUserToken();
	if (!token) return false;
	try {
		await deleteMessage(token, channelId, messageId);
		app.markDeleted([messageId]);
		return true;
	} catch (err) {
		const code = (err as { code?: number }).code;
		if (code === 50001) app.toast("You no longer have access to this channel.", "error");
		else if (code === 50083) app.toast("This message is in an archived thread.", "error");
		else app.toast((err as Error).message, "error");
		return false;
	}
}

export async function reopenDM(app: AppCtx, userId: string, expectedChannelId?: string): Promise<void> {
	const token = app.requireUserToken();
	if (!token) return;
	if (!userId || userId === DELETED_USER_ID) {
		app.toast("This user's ID is unknown. Use Fetch info first.", "error");
		return;
	}
	try {
		const channelId = await openDM(token, userId);
		let target = channelId;
		if (expectedChannelId && channelId !== expectedChannelId) {
			const ok = confirm(
				"Discord opened a different DM channel than the one in your package. You can still reopen the original one by sending a message in it.\n\nSend a message in the original DM?"
			);
			if (ok) {
				const text = prompt("Message to send");
				if (text) {
					await sendMessage(token, expectedChannelId, text);
					target = expectedChannelId;
				}
			}
		}
		app.toast("DM reopened", "success");
		window.open(discordUrl(`channels/@me/${target}`, app.settings.openIn), "_blank", "noopener");
	} catch (err) {
		app.toast((err as Error).message, "error");
	}
}

export async function fetchInfo(app: AppCtx, channelId: string): Promise<void> {
	const token = app.requireUserToken();
	if (!token) return;
	const ch = app.channels.get(channelId);
	if (!ch || ch.type !== ChannelType.DM) return;
	try {
		const user = await fetchChannelRecipient(token, channelId);
		if (!user) {
			app.toast("Discord didn't return a user for this DM.", "error");
			return;
		}
		app.resolveUser(channelId, user);
		app.toast(`Found ${user.username}`, "success");
	} catch (err) {
		app.toast((err as Error).message, "error");
	}
}
