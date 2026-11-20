import { useMemo, useState } from "preact/hooks";
import { dmRecipient, useApp } from "../context";
import { copyText, fetchInfo, reopenDM, viewProfile } from "../lib/actions";
import { ChannelType, type ChannelMeta } from "../lib/types";
import { avatarUrl, formatDate, formatNumber, userTag } from "../lib/util";
import { IconMore } from "./icons";
import { ActionSheet, type SheetAction } from "./Modal";

type Sort = "recent" | "messages" | "name";

export function DmsTab() {
	const app = useApp();
	const [filter, setFilter] = useState("");
	const [sort, setSort] = useState<Sort>("messages");
	const [limit, setLimit] = useState(150);
	const [menuFor, setMenuFor] = useState<ChannelMeta | null>(null);

	const rows = useMemo(() => {
		const dms = app.summary.channels.filter((c) => c.type === ChannelType.DM);
		const mapped = dms.map((c) => {
			const r = dmRecipient(c, app);
			const name = r.deleted ? "Deleted User" : r.user ? userTag(r.user) : "Unknown user";
			const note = r.id ? app.summary.notes[r.id] ?? "" : "";
			return { c, r, name, note };
		});
		const q = filter.trim().toLowerCase();
		const filtered = q ? mapped.filter((x) => x.name.toLowerCase().includes(q) || (x.r.id ?? "").includes(q) || x.note.toLowerCase().includes(q) || x.c.id.includes(q)) : mapped;
		filtered.sort((a, b) =>
			sort === "messages" ? b.c.count - a.c.count : sort === "recent" ? b.c.firstTs - a.c.firstTs : a.name.localeCompare(b.name)
		);
		return filtered;
	}, [app.summary, app.users, app.resolvedByChannel, filter, sort]);

	const groups = app.summary.channels.filter((c) => c.type === ChannelType.GroupDM).length;

	const actionsFor = (c: ChannelMeta): SheetAction[] => {
		const r = dmRecipient(c, app);
		return [
			{ label: "Search messages in this DM", onSelect: () => app.searchIn([c.id], r.user ? userTag(r.user) : "this DM") },
			{ label: "Reopen DM", hidden: !r.id, onSelect: () => reopenDM(app, r.id!, c.id) },
			{ label: "Fetch user info", hidden: !r.deleted, onSelect: () => fetchInfo(app, c.id) },
			{ label: "View profile in Discord", hidden: !r.id, onSelect: () => viewProfile(app, r.id!) },
			{ label: "Copy user ID", hidden: !r.id, onSelect: () => copyText(app, r.id!) },
			{ label: "Copy channel ID", onSelect: () => copyText(app, c.id) },
			{ label: "Copy note", hidden: !(r.id && app.summary.notes[r.id]), onSelect: () => copyText(app, app.summary.notes[r.id!]) }
		];
	};

	return (
		<div class="dms-tab">
			<div class="toolbar">
				<input type="search" class="input" placeholder="Filter by name, ID or note" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
				<select class="input" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)} aria-label="Sort DMs">
					<option value="messages">Most messages</option>
					<option value="recent">Newest DM</option>
					<option value="name">Name</option>
				</select>
			</div>
			<p class="muted small">
				{formatNumber(rows.length)} DMs{groups ? ` · ${formatNumber(groups)} group DMs (find them with search)` : ""}. Only DMs where you sent at least one message are in your package.
			</p>
			<ul class="dm-list">
				{rows.slice(0, limit).map(({ c, r, name, note }) => (
					<li key={c.id} class="dm-row">
						<img class="avatar" src={avatarUrl(r.user ?? { id: r.id ?? "0", discriminator: "0", avatarHash: null }, 64)} alt="" width={40} height={40} loading="lazy" />
						<button type="button" class="dm-main" onClick={() => app.searchIn([c.id], name)}>
							<span class="dm-name">
								<strong class="ellipsis">{name}</strong>
								{c.hasDuplicates && (
									<span class="badge warn" title="You have more than one DM channel with this user. Discord may reopen a different one.">
										duplicate
									</span>
								)}
							</span>
							<span class="muted small ellipsis">
								{formatNumber(c.count)} messages · since {formatDate(c.firstTs, false)}
								{r.id ? ` · ${r.id}` : ""}
							</span>
							{note && <span class="note small ellipsis">📝 {note}</span>}
						</button>
						<button type="button" class="icon-btn" aria-label={`Actions for ${name}`} onClick={() => setMenuFor(c)}>
							<IconMore />
						</button>
					</li>
				))}
			</ul>
			{rows.length > limit && (
				<button type="button" class="btn block" onClick={() => setLimit((l) => l + 300)}>
					Show more ({formatNumber(rows.length - limit)} left)
				</button>
			)}
			{menuFor && <ActionSheet title="Direct message" actions={actionsFor(menuFor)} onClose={() => setMenuFor(null)} />}
		</div>
	);
}
