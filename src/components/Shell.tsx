import { useState } from "preact/hooks";
import { useApp, type Tab } from "../context";
import { displayName, formatNumber } from "../lib/util";
import { DmsTab } from "./DmsTab";
import { IconChat, IconCog, IconImage, IconSearch, IconServer } from "./icons";
import { ImagesTab } from "./ImagesTab";
import { MessagesTab } from "./MessagesTab";
import { ServersTab } from "./ServersTab";
import { SettingsTab } from "./SettingsTab";

const TABS: { id: Tab; label: string; Icon: typeof IconSearch }[] = [
	{ id: "messages", label: "Messages", Icon: IconSearch },
	{ id: "images", label: "Images", Icon: IconImage },
	{ id: "dms", label: "DMs", Icon: IconChat },
	{ id: "servers", label: "Servers", Icon: IconServer },
	{ id: "settings", label: "Settings", Icon: IconCog }
];

export function Shell({ tab, setTab, pendingSearch }: { tab: Tab; setTab: (t: Tab) => void; pendingSearch: { ids: string[]; label: string; n: number } | null }) {
	const app = useApp();
	const { summary } = app;
	// Tabs stay mounted once opened so search results and scroll position survive switching.
	const [visited, setVisited] = useState<Set<Tab>>(new Set([tab]));
	if (!visited.has(tab)) setVisited(new Set([...visited, tab]));

	const nav = (
		<nav class="tabs" aria-label="Sections">
			{TABS.map(({ id, label, Icon }) => (
				<button key={id} type="button" class={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
					<Icon size={22} />
					<span>{label}</span>
				</button>
			))}
		</nav>
	);

	return (
		<div class="shell">
			<header class="topbar">
				<div class="me">
					<img class="avatar" src={app.avatarUrl} alt="" width={36} height={36} />
					<div class="me-text">
						<strong class="ellipsis">{displayName(summary.user)}</strong>
						<span class="muted small">
							{formatNumber(summary.totalMessages)} messages · {formatNumber(summary.totalImages)} images
						</span>
					</div>
				</div>
				<div class="desktop-only">{nav}</div>
				<button
					type="button"
					class="btn ghost small"
					onClick={() => {
						if (confirm("Close this package? You'll need to open the zip again.")) app.unload();
					}}
				>
					Close
				</button>
			</header>
			<div class="content">
				{TABS.map(({ id }) =>
					visited.has(id) ? (
						<section key={id} class="tab-panel" hidden={tab !== id}>
							{id === "messages" && <MessagesTab pendingSearch={pendingSearch} active={tab === "messages"} />}
							{id === "images" && <ImagesTab active={tab === "images"} />}
							{id === "dms" && <DmsTab />}
							{id === "servers" && <ServersTab />}
							{id === "settings" && <SettingsTab />}
						</section>
					) : null
				)}
			</div>
			<div class="mobile-only bottom-nav">{nav}</div>
		</div>
	);
}
