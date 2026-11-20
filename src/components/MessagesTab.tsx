import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useApp, type ViewerItem } from "../context";
import { deleteMessage, refreshUrls } from "../lib/discord";
import { DEFAULT_SEARCH } from "../lib/storage";
import type { AttachmentView, MessageView, SearchOptions } from "../lib/types";
import { formatNumber } from "../lib/util";
import { IconFilter, IconSearch } from "./icons";
import { MessageItem } from "./MessageItem";
import { Modal } from "./Modal";

function toDateInput(ms?: number): string {
	if (ms === undefined) return "";
	const d = new Date(ms);
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fromDateInput(v: string): number | undefined {
	if (!v) return undefined;
	const [y, m, d] = v.split("-").map(Number);
	return new Date(y, m - 1, d).getTime();
}

function idList(s: string): string[] {
	return s.split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^\d{15,22}$/.test(x));
}

export function MessagesTab({ pendingSearch, active }: { pendingSearch: { ids: string[]; label: string; n: number } | null; active: boolean }) {
	const app = useApp();
	const { parser, settings } = app;
	const opts = settings.search;
	const [text, setText] = useState("");
	const [total, setTotal] = useState<number | null>(null);
	const [offset, setOffset] = useState(0);
	const [page, setPage] = useState<MessageView[]>([]);
	const [busy, setBusy] = useState(false);
	const [showOpts, setShowOpts] = useState(false);
	const [scopeLabel, setScopeLabel] = useState<string | null>(null);
	const [version, setVersion] = useState(0);
	const [massDelete, setMassDelete] = useState(false);
	const listTop = useRef<HTMLDivElement>(null);
	const pageSize = settings.pageSize;

	const setOpts = (patch: Partial<typeof opts>) => app.setSettings({ ...settings, search: { ...opts, ...patch } });

	// Ignores responses from superseded page loads (fast Next/Previous clicks, new searches).
	const loadSeq = useRef(0);
	const loadPage = useCallback(
		async (off: number) => {
			const seq = ++loadSeq.current;
			const msgs = await parser.results(off, pageSize);
			if (seq !== loadSeq.current) return;
			setPage(msgs);
			setOffset(off);
			listTop.current?.scrollIntoView({ block: "start" });
			// Refresh expired attachment links on this page when a bot token is set.
			const urls = msgs.flatMap((m) => m.attachments.map((a) => a.url));
			if (app.botToken && urls.length) {
				try {
					const map = await refreshUrls(urls, app.botToken);
					if (Object.keys(map).length) {
						parser.updateUrls(map);
						setVersion((v) => v + 1);
					}
				} catch (err) {
					app.toast(`Couldn't refresh image links: ${(err as Error).message}`, "error");
				}
			}
		},
		[parser, pageSize, app.botToken]
	);

	const run = useCallback(
		async (override?: Partial<SearchOptions>) => {
			const o: SearchOptions = { ...opts, text, ...override };
			if (o.mode === "regex" && o.text) {
				try {
					new RegExp(o.text, "u");
				} catch (err) {
					app.toast(`Invalid regex: ${(err as Error).message}`, "error");
					return;
				}
			}
			setBusy(true);
			try {
				const n = await parser.search(o);
				setTotal(n);
				await loadPage(0);
			} catch (err) {
				app.toast((err as Error).message, "error");
			} finally {
				setBusy(false);
			}
		},
		[opts, text, parser, loadPage]
	);

	// "Search in this channel/server" from elsewhere in the app.
	useEffect(() => {
		if (!pendingSearch) return;
		setScopeLabel(pendingSearch.label);
		setText("");
		setOpts({ includeIDs: pendingSearch.ids });
		run({ includeIDs: pendingSearch.ids, text: "" });
	}, [pendingSearch?.n]);

	// Page size changed in Settings: restart from the first page.
	const firstPageSize = useRef(pageSize);
	useEffect(() => {
		if (firstPageSize.current === pageSize) return;
		firstPageSize.current = pageSize;
		if (total) loadPage(0);
	}, [pageSize]);

	// Show the newest messages on first open.
	useEffect(() => {
		if (total === null && active) run();
	}, [active]);

	const openImage = (msg: MessageView, att: AttachmentView) => {
		const items: ViewerItem[] = [];
		let index = 0;
		for (const m of page) {
			for (const a of m.attachments) {
				if (a.kind !== "image") continue;
				if (m.id === msg.id && a.id === att.id) index = items.length;
				items.push({ ...a, messageId: m.id, channelId: m.channelId, ts: m.ts, content: m.content });
			}
		}
		app.openViewer({ items, index });
	};

	const activeFilters =
		(opts.mode !== "exact" ? 1 : 0) +
		[opts.caseSensitive, opts.excludeGuilds, opts.excludeDMs, opts.excludeGroupDMs, opts.excludeDeleted, opts.hasImage, opts.hasVideo, opts.hasFile].filter(Boolean).length +
		(opts.before !== undefined ? 1 : 0) +
		(opts.after !== undefined ? 1 : 0) +
		(opts.includeIDs.length ? 1 : 0) +
		(opts.excludeIDs.length ? 1 : 0);

	const pages = total ? Math.ceil(total / pageSize) : 0;
	const current = Math.floor(offset / pageSize) + 1;

	return (
		<div class="messages-tab">
			<div class="search-sticky">
			<form
				class="searchbar"
				onSubmit={(e) => {
					e.preventDefault();
					run();
				}}
			>
				<div class="search-input">
					<IconSearch size={18} />
					<input
						type="search"
						enterKeyHint="search"
						placeholder={opts.mode === "regex" ? "Regular expression" : "Search your messages"}
						value={text}
						onInput={(e) => setText((e.target as HTMLInputElement).value)}
					/>
				</div>
				<button type="button" class="btn icon-label" onClick={() => setShowOpts(true)} aria-label="Search filters">
					<IconFilter size={18} />
					<span class="desktop-only">Filters</span>
					{activeFilters > 0 && <span class="count">{activeFilters}</span>}
				</button>
				<button type="submit" class="btn primary" disabled={busy}>
					{busy ? "…" : "Search"}
				</button>
			</form>

			{app.summary.attachmentsOnly && <p class="load-note">Loaded with "Images and files only": messages without attachments were skipped.</p>}

			{opts.includeIDs.length > 0 && (
				<div class="scope">
					<span>
						Only in <strong>{scopeLabel ?? `${opts.includeIDs.length} selected IDs`}</strong>
					</span>
					<button
						type="button"
						class="btn ghost small"
						onClick={() => {
							setScopeLabel(null);
							setOpts({ includeIDs: [] });
							run({ includeIDs: [] });
						}}
					>
						Clear
					</button>
				</div>
			)}
			</div>

			<div ref={listTop} class="results-head">
				<span class="muted">{total === null ? "" : total === 0 ? "No results" : `${formatNumber(offset + 1)}–${formatNumber(Math.min(offset + pageSize, total))} of ${formatNumber(total)}`}</span>
				{!!total && (
					<button type="button" class="btn ghost small danger-text" onClick={() => setMassDelete(true)}>
						Mass delete…
					</button>
				)}
			</div>

			<div class="message-list">
				{page.map((m) => (
					<MessageItem key={m.id} msg={m} deleted={app.deleted.has(m.id)} version={version} onOpenImage={openImage} />
				))}
			</div>

			{pages > 1 && (
				<div class="pager">
					<button type="button" class="btn" disabled={current <= 1 || busy} onClick={() => loadPage(Math.max(0, offset - pageSize))}>
						Previous
					</button>
					<span class="muted">
						Page {current} of {formatNumber(pages)}
					</span>
					<button type="button" class="btn" disabled={current >= pages || busy} onClick={() => loadPage(offset + pageSize)}>
						Next
					</button>
				</div>
			)}

			{showOpts && (
				<Modal title="Search filters" onClose={() => setShowOpts(false)}>
					<SearchFilters opts={opts} setOpts={setOpts} />
					<div class="modal-actions">
						<button type="button" class="btn ghost" onClick={() => app.setSettings({ ...settings, search: DEFAULT_SEARCH })}>
							Reset
						</button>
						<button
							type="button"
							class="btn primary"
							onClick={() => {
								setShowOpts(false);
								run();
							}}
						>
							Apply
						</button>
					</div>
				</Modal>
			)}

			{massDelete && total !== null && <MassDelete total={total} onClose={() => setMassDelete(false)} />}
		</div>
	);
}

function SearchFilters({ opts, setOpts }: { opts: typeof DEFAULT_SEARCH; setOpts: (p: Partial<typeof DEFAULT_SEARCH>) => void }) {
	const check = (key: keyof typeof opts, label: string) => (
		<label class="check">
			<input type="checkbox" checked={!!opts[key]} onChange={(e) => setOpts({ [key]: (e.target as HTMLInputElement).checked })} />
			<span>{label}</span>
		</label>
	);
	return (
		<div class="filters">
			<fieldset>
				<legend>Match</legend>
				<div class="segmented">
					{(["exact", "words", "regex"] as const).map((m) => (
						<button key={m} type="button" class={opts.mode === m ? "active" : ""} onClick={() => setOpts({ mode: m })}>
							{m === "exact" ? "Exact text" : m === "words" ? "All words" : "Regex"}
						</button>
					))}
				</div>
				{check("caseSensitive", "Case sensitive")}
			</fieldset>
			<fieldset>
				<legend>Sort</legend>
				<div class="segmented">
					<button type="button" class={opts.sort === "desc" ? "active" : ""} onClick={() => setOpts({ sort: "desc" })}>
						Newest first
					</button>
					<button type="button" class={opts.sort === "asc" ? "active" : ""} onClick={() => setOpts({ sort: "asc" })}>
						Oldest first
					</button>
				</div>
			</fieldset>
			<fieldset>
				<legend>Exclude</legend>
				{check("excludeGuilds", "Servers")}
				{check("excludeDMs", "Direct messages")}
				{check("excludeGroupDMs", "Group DMs")}
				{check("excludeDeleted", "Messages you deleted here")}
			</fieldset>
			<fieldset>
				<legend>Has attachment</legend>
				{check("hasImage", "Image")}
				{check("hasVideo", "Video")}
				{check("hasFile", "Other file")}
			</fieldset>
			<fieldset class="dates">
				<legend>Date</legend>
				<label>
					<span>After</span>
					<input type="date" value={toDateInput(opts.after)} onChange={(e) => setOpts({ after: fromDateInput((e.target as HTMLInputElement).value) })} />
				</label>
				<label>
					<span>Before</span>
					<input type="date" value={toDateInput(opts.before)} onChange={(e) => setOpts({ before: fromDateInput((e.target as HTMLInputElement).value) })} />
				</label>
			</fieldset>
			<fieldset>
				<legend>Channel / server IDs</legend>
				<label class="stack">
					<span>Only search in</span>
					<textarea rows={2} placeholder="IDs separated by spaces or commas" value={opts.includeIDs.join(" ")} onChange={(e) => setOpts({ includeIDs: idList((e.target as HTMLTextAreaElement).value) })} />
				</label>
				<label class="stack">
					<span>Never search in</span>
					<textarea rows={2} placeholder="IDs separated by spaces or commas" value={opts.excludeIDs.join(" ")} onChange={(e) => setOpts({ excludeIDs: idList((e.target as HTMLTextAreaElement).value) })} />
				</label>
			</fieldset>
		</div>
	);
}

function MassDelete({ total, onClose }: { total: number; onClose: () => void }) {
	const app = useApp();
	const [delay, setDelay] = useState(1000);
	const [state, setState] = useState<{ running: boolean; done: number; failed: number; of: number } | null>(null);
	const stop = useRef(false);

	async function start() {
		const token = app.requireUserToken();
		if (!token) return;
		const ids = (await app.parser.resultIds()).filter((k) => !app.deleted.has(k.split(":")[1]));
		if (!ids.length) {
			app.toast("Everything in these results is already deleted.", "info");
			return;
		}
		const typed = prompt(
			`This permanently deletes ${ids.length.toLocaleString()} messages from Discord (every message matching your current search and filters). Type DELETE to confirm.`
		);
		if (typed?.trim() !== "DELETE") return;
		stop.current = false;
		let done = 0;
		let failed = 0;
		let failStreak = 0;
		setState({ running: true, done, failed, of: ids.length });
		for (const key of ids) {
			if (stop.current) break;
			const [channelId, messageId] = key.split(":");
			try {
				await deleteMessage(token, channelId, messageId);
				app.markDeleted([messageId]);
				failStreak = 0;
			} catch (err) {
				failed++;
				failStreak++;
				const status = (err as { status?: number }).status;
				if (status === 401) {
					app.toast("Discord rejected the token. Stopping.", "error");
					break;
				}
				if (failStreak >= 5) {
					app.toast(`Stopped after 5 failures in a row: ${(err as Error).message}`, "error");
					break;
				}
			}
			done++;
			setState({ running: true, done, failed, of: ids.length });
			await new Promise((r) => setTimeout(r, delay));
		}
		setState((s) => (s ? { ...s, running: false } : s));
	}

	return (
		<Modal title="Mass delete" onClose={() => !state?.running && onClose()}>
			<p class="warn-box">
				This deletes every message in your current search results ({total.toLocaleString()}) from Discord, using your account token. Automating your account
				breaks Discord's rules and can get it banned.
			</p>
			<label class="stack">
				<span>Delay between deletions: {delay} ms</span>
				<input type="range" min={300} max={5000} step={100} value={delay} disabled={state?.running} onInput={(e) => setDelay(Number((e.target as HTMLInputElement).value))} />
			</label>
			{state && (
				<>
					<div class="bar">
						<div style={{ width: `${(state.done / state.of) * 100}%` }} />
					</div>
					<p class="muted">
						{state.done.toLocaleString()} / {state.of.toLocaleString()} processed{state.failed ? `, ${state.failed} failed` : ""}
						{!state.running && " (finished)"}
					</p>
				</>
			)}
			<div class="modal-actions">
				{state?.running ? (
					<button type="button" class="btn" onClick={() => (stop.current = true)}>
						Stop
					</button>
				) : (
					<>
						<button type="button" class="btn ghost" onClick={onClose}>
							Close
						</button>
						<button type="button" class="btn danger" onClick={start}>
							Start deleting
						</button>
					</>
				)}
			</div>
		</Modal>
	);
}
