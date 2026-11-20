import { useState } from "preact/hooks";
import { useApp } from "../context";
import { checkBotToken, checkUserToken } from "../lib/discord";
import { clearAccountData, type OpenTarget, type SaveMethod } from "../lib/storage";
import { formatDate, formatNumber } from "../lib/util";

function TokenField({
	label,
	value,
	onSave,
	validate,
	children
}: {
	label: string;
	value: string | null;
	onSave: (t: string | null) => void;
	validate: (t: string) => string | null;
	children: preact.ComponentChildren;
}) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	return (
		<div class="card">
			<h3>{label}</h3>
			{children}
			{value ? (
				<div class="token-set">
					<span class="badge ok">Set for this session</span>
					<button type="button" class="btn small ghost" onClick={() => onSave(null)}>
						Remove
					</button>
				</div>
			) : (
				<form
					class="token-form"
					onSubmit={(e) => {
						e.preventDefault();
						const t = draft.trim().replace(/^Bot\s+/i, "").replace(/^"|"$/g, "");
						const problem = validate(t);
						setError(problem);
						if (!problem) {
							onSave(t);
							setDraft("");
						}
					}}
				>
					<input
						type="password"
						class="input"
						autoComplete="off"
						spellcheck={false}
						placeholder="Paste token"
						value={draft}
						onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
					/>
					<button type="submit" class="btn primary" disabled={!draft.trim()}>
						Use
					</button>
				</form>
			)}
			{error && <p class="error-text small">{error}</p>}
		</div>
	);
}

export function SettingsTab() {
	const app = useApp();
	const { settings, summary } = app;
	const userId = summary.user.id;

	return (
		<div class="settings-tab">
			<p class="muted small">Tokens are kept in memory only. They're gone when you close or reload the page, and they're only sent to discord.com.</p>

			<TokenField label="Bot token (for images)" value={app.botToken} onSave={app.setBotToken} validate={(t) => checkBotToken(t, userId)}>
				<p class="small">
					Attachment links in data packages expire. With a bot token, Dispack asks Discord for fresh links through the official <code>refresh-urls</code> endpoint. Any bot works and
					it doesn't need to be in a server.
				</p>
				<ol class="small steps">
					<li>
						Open the{" "}
						<a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer">
							Discord Developer Portal
						</a>{" "}
						and create an application.
					</li>
					<li>Go to <em>Bot</em>, press <em>Reset Token</em> and copy it.</li>
					<li>Paste it here.</li>
				</ol>
			</TokenField>

			<TokenField label="Account token (optional)" value={app.userToken} onSave={app.setUserToken} validate={(t) => checkUserToken(t, userId)}>
				<p class="warn-box small">
					Needed only for deleting messages, reopening DMs and looking up deleted users. Using your account token with tools like this counts as self-botting, which is against
					Discord's rules and can get your account banned. Anyone with this token can fully control your account, so never paste it into a site you don't trust.
				</p>
			</TokenField>

			<div class="card">
				<h3>Preferences</h3>
				<label class="row">
					<span>Open Discord links in</span>
					<select class="input" value={settings.openIn} onChange={(e) => app.setSettings({ ...settings, openIn: (e.target as HTMLSelectElement).value as OpenTarget })}>
						<option value="web">Discord (web / mobile app)</option>
						<option value="app">Desktop app (discord://)</option>
						<option value="ptb">PTB (web)</option>
						<option value="canary">Canary (web)</option>
					</select>
				</label>
				<label class="row">
					<span>Saving images</span>
					<select class="input" value={settings.saveMethod} onChange={(e) => app.setSettings({ ...settings, saveMethod: (e.target as HTMLSelectElement).value as SaveMethod })}>
						<option value="auto">Automatic (share sheet on phones)</option>
						<option value="download">Always download file</option>
						<option value="share">Always use share sheet</option>
					</select>
				</label>
				<label class="row">
					<span>Messages per page</span>
					<select class="input" value={settings.pageSize} onChange={(e) => app.setSettings({ ...settings, pageSize: Number((e.target as HTMLSelectElement).value) })}>
						{[25, 50, 100, 200].map((n) => (
							<option key={n} value={n}>
								{n}
							</option>
						))}
					</select>
				</label>
			</div>

			<div class="card">
				<h3>Package</h3>
				<dl class="facts">
					<dt>Account</dt>
					<dd>
						{summary.user.username} ({userId}){summary.partialUser && " (guessed, no account folder)"}
					</dd>
					<dt>Created</dt>
					<dd>{formatDate(summary.creationTime)}</dd>
					<dt>Messages</dt>
					<dd>{formatNumber(summary.totalMessages)}</dd>
					<dt>Channels</dt>
					<dd>{formatNumber(summary.channels.length)}</dd>
					<dt>Parsed in</dt>
					<dd>{(summary.loadMs / 1000).toFixed(1)} s</dd>
				</dl>
				<p class="small muted">
					Remembered on this device: {formatNumber(app.deleted.size)} deleted messages, {formatNumber(Object.keys(app.resolvedByChannel).length)} looked-up users.
				</p>
				<button
					type="button"
					class="btn small ghost"
					onClick={() => {
						if (confirm("Forget the deleted messages and looked-up users saved on this device for this account?")) {
							clearAccountData(userId);
							location.reload();
						}
					}}
				>
					Clear saved data and reload
				</button>
			</div>
		</div>
	);
}
