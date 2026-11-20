import { useMemo, useState } from "preact/hooks";
import { useApp } from "../context";
import { copyText } from "../lib/actions";
import { discordUrl } from "../lib/discord";
import { ChannelType } from "../lib/types";
import { formatDate, formatNumber } from "../lib/util";

export function ServersTab() {
	const app = useApp();
	const { guilds, guildsProgress, guildsError, summary } = app;
	const [filter, setFilter] = useState("");
	const [limit, setLimit] = useState(150);

	// Message counts per server, from the messages folder.
	const counts = useMemo(() => {
		const m = new Map<string, { count: number; name?: string }>();
		for (const c of summary.channels) {
			if (!c.guildId || c.type === ChannelType.DM || c.type === ChannelType.GroupDM) continue;
			const e = m.get(c.guildId) ?? { count: 0, name: c.guildName ?? undefined };
			e.count += c.count;
			m.set(c.guildId, e);
		}
		return m;
	}, [summary]);

	const nameOf = (id: string) => summary.guildNames[id] ?? counts.get(id)?.name ?? null;

	const rows = useMemo(() => {
		const list = guilds?.guilds ?? [];
		const q = filter.trim().toLowerCase();
		return q ? list.filter((g) => g.id.includes(q) || (nameOf(g.id) ?? "").toLowerCase().includes(q) || g.invites.some((i) => i.toLowerCase().includes(q))) : list;
	}, [guilds, filter]);

	const pct = guildsProgress && guildsProgress.total ? Math.min(100, Math.round((guildsProgress.done / guildsProgress.total) * 100)) : 0;

	return (
		<div class="servers-tab">
			{!guilds && !guildsError && (
				<div class="card">
					<p>{guildsProgress?.label ?? "Reading your activity data…"}</p>
					<div class="bar">
						<div style={{ width: `${pct}%` }} />
					</div>
					<p class="muted small">This reads the activity log, which can be several gigabytes. Everything else works while this runs.</p>
				</div>
			)}
			{guildsError && <p class="error-box">Couldn't read server history: {guildsError}</p>}
			{guilds?.state === "none" && <p class="warn-box">This package has no activity folder, so join history isn't available. Servers you've messaged in are still searchable.</p>}
			{guilds?.state === "disabled_now" && (
				<p class="warn-box">Usage statistics are turned off for this account, so Discord only included older activity data. Servers joined recently may be missing.</p>
			)}
			{guilds?.state === "partially_disabled_now" && <p class="warn-box">Some analytics are turned off for this account. The list may be incomplete.</p>}
			{guilds?.state === "disabled_before" && guilds.cutoff && (
				<p class="warn-box">Usage statistics were turned off at some point. Servers joined before {formatDate(guilds.cutoff, false)} may be missing.</p>
			)}

			{guilds && guilds.guilds.length > 0 && (
				<>
					<div class="toolbar">
						<input type="search" class="input" placeholder="Filter by name, ID or invite" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
					</div>
					<p class="muted small">{formatNumber(rows.length)} servers joined, newest first</p>
					<ul class="guild-list">
						{rows.slice(0, limit).map((g) => {
							const name = nameOf(g.id);
							const msgs = counts.get(g.id)?.count ?? 0;
							return (
								<li key={g.id} class="guild-row">
									<div class="guild-icon" aria-hidden="true">
										{(name ?? "?").slice(0, 2)}
									</div>
									<div class="guild-main">
										<strong class="ellipsis">{name ?? "Unknown server"}</strong>
										<span class="muted small">
											Joined {g.ts ? formatDate(g.ts, false) : "?"} · {g.joinType}
											{g.joinMethod ? ` (${g.joinMethod})` : ""}
											{msgs ? ` · ${formatNumber(msgs)} messages` : ""}
										</span>
										{g.invites.length > 0 && (
											<span class="invites small">
												{g.invites.map((i) => (
													<button key={i} type="button" class="chip" onClick={() => copyText(app, `https://discord.gg/${i}`, "Invite copied")}>
														{i}
													</button>
												))}
											</span>
										)}
									</div>
									<div class="guild-actions">
										{msgs > 0 && (
											<button type="button" class="btn small" onClick={() => app.searchIn([g.id], name ?? g.id)}>
												Messages
											</button>
										)}
										<button type="button" class="btn small ghost" onClick={() => copyText(app, g.id)}>
											Copy ID
										</button>
										<a class="btn small ghost" href={discordUrl(`channels/${g.id}`, app.settings.openIn)} target="_blank" rel="noopener noreferrer">
											Open
										</a>
									</div>
								</li>
							);
						})}
					</ul>
					{rows.length > limit && (
						<button type="button" class="btn block" onClick={() => setLimit((l) => l + 300)}>
							Show more
						</button>
					)}
				</>
			)}
			{guilds && guilds.guilds.length === 0 && guilds.state !== "none" && <p class="empty">No server joins found in your activity data.</p>}
		</div>
	);
}
