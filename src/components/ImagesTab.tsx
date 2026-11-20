import { memo } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useApp, type ViewerItem } from "../context";
import { refreshUrls } from "../lib/discord";
import { saveZip, type BulkProgress } from "../lib/save";
import type { ImageItem } from "../lib/types";
import { formatNumber } from "../lib/util";
import { IconCheck, IconDownload } from "./icons";
import { Thumb } from "./Thumb";

const CHUNK = 60;

export function ImagesTab({ active }: { active: boolean }) {
	const app = useApp();
	const { parser, summary } = app;
	const [items, setItems] = useState<ImageItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [version, setVersion] = useState(0);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [bulk, setBulk] = useState<BulkProgress | null>(null);
	const abort = useRef<AbortController | null>(null);
	const sentinel = useRef<HTMLDivElement>(null);
	const total = summary.totalImages;

	const refresh = useCallback(
		async (list: ImageItem[]) => {
			if (!app.botToken) return;
			try {
				const map = await refreshUrls(list.map((i) => i.url), app.botToken);
				if (Object.keys(map).length) {
					parser.updateUrls(map);
					setVersion((v) => v + 1);
				}
			} catch (err) {
				app.toast(`Couldn't refresh image links: ${(err as Error).message}`, "error");
			}
		},
		[app.botToken, parser]
	);

	// A ref, not state, guards loading so two observer callbacks can't fetch the same chunk.
	const inFlight = useRef(false);
	const loadMore = useCallback(async () => {
		if (inFlight.current || items.length >= total) return;
		inFlight.current = true;
		setLoading(true);
		const offset = items.length;
		try {
			const next = await parser.images(offset, CHUNK);
			setItems((prev) => (prev.length === offset ? [...prev, ...next] : prev));
			refresh(next);
		} finally {
			inFlight.current = false;
			setLoading(false);
		}
	}, [items.length, total, parser, refresh]);

	// When a bot token is added later, refresh what's already on screen.
	useEffect(() => {
		if (app.botToken && items.length) refresh(items);
	}, [app.botToken]);

	useEffect(() => {
		if (!active || !sentinel.current) return;
		const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: "800px" });
		io.observe(sentinel.current);
		return () => io.disconnect();
	}, [active, loadMore]);

	const toViewer = (i: ImageItem): ViewerItem => ({ ...i });

	const open = (index: number) => {
		app.openViewer({
			items: items.map(toViewer),
			index,
			total,
			loadMore: async (offset) => {
				const next = await parser.images(offset, CHUNK);
				setItems((prev) => (prev.length === offset ? [...prev, ...next] : prev));
				refresh(next);
				return next.map(toViewer);
			}
		});
	};

	// Stable handler so memoized tiles don't re-render on unrelated app updates.
	const tapRef = useRef<(i: number) => void>(() => undefined);
	tapRef.current = (i: number) => (selecting ? toggle(i) : open(i));
	const onTap = useCallback((i: number) => tapRef.current(i), []);

	const toggle = (i: number) => {
		setSelected((s) => {
			const n = new Set(s);
			if (n.has(i)) n.delete(i);
			else n.add(i);
			return n;
		});
	};

	async function saveMany(list: ImageItem[] | (() => Promise<ImageItem[]>), name: string, count: number) {
		if (!count) return;
		if (summary.unsignedLinks && !app.botToken) {
			app.toast("These links need a bot token before they can be downloaded. Add one in Settings.", "error");
			return;
		}
		abort.current = new AbortController();
		setBulk({ done: 0, total: count, failed: 0 });
		try {
			const r = await saveZip(list, app.botToken, name, setBulk, abort.current.signal);
			if (r.cancelled) {
				if (r.done) app.toast("Cancelled. Images already written stay in the zip.", "info");
			} else if (r.failed === r.total && r.total) {
				app.toast(`Couldn't save any images: ${r.error ?? "unknown error"}`, "error");
			} else if (r.done) {
				app.toast(`Saved ${r.done - r.failed} of ${r.total} images${r.failed ? ` (${r.failed} failed)` : ""}`, r.failed ? "info" : "success");
			}
		} catch (err) {
			app.toast((err as Error).message, "error");
		} finally {
			setBulk(null);
			abort.current = null;
		}
	}

	async function saveAll() {
		if (!confirm(`Download all ${formatNumber(total)} images into one zip? This can take a long time and use a lot of data.`)) return;
		saveMany(
			async () => {
				const all: ImageItem[] = [];
				for (let o = 0; o < total; o += 5000) all.push(...(await parser.images(o, 5000)));
				return all;
			},
			"discord-images.zip",
			total
		);
	}

	if (!total) {
		return <p class="empty">No images found in this package.</p>;
	}

	return (
		<div class="images-tab">
			<div class="toolbar">
				<span class="muted">{formatNumber(total)} images you've sent, newest first</span>
				<div class="toolbar-actions">
					{selecting ? (
						<>
							<button type="button" class="btn small" onClick={() => setSelected(new Set(items.map((i) => i.index)))}>
								Select loaded
							</button>
							<button
								type="button"
								class="btn small primary"
								disabled={!selected.size || !!bulk}
								onClick={() => saveMany(items.filter((i) => selected.has(i.index)), "discord-images-selected.zip", selected.size)}
							>
								<IconDownload size={16} /> Save {selected.size || ""}
							</button>
							<button
								type="button"
								class="btn small ghost"
								onClick={() => {
									setSelecting(false);
									setSelected(new Set());
								}}
							>
								Done
							</button>
						</>
					) : (
						<>
							<button type="button" class="btn small" onClick={() => setSelecting(true)}>
								Select
							</button>
							<button type="button" class="btn small" disabled={!!bulk} onClick={saveAll}>
								<IconDownload size={16} /> Save all
							</button>
						</>
					)}
				</div>
			</div>

			{summary.unsignedLinks && !app.botToken && (
				<div class="warn-box">
					This package's image links have expired.{" "}
					<button type="button" class="link" onClick={() => app.setTab("settings")}>
						Add a bot token
					</button>{" "}
					to load them.
				</div>
			)}

			{bulk && (
				<div class="bulk">
					<div class="bar">
						<div style={{ width: `${(bulk.done / bulk.total) * 100}%` }} />
					</div>
					<span class="muted small">
						Zipping {bulk.done.toLocaleString()} / {bulk.total.toLocaleString()}
						{bulk.failed ? ` · ${bulk.failed} failed` : ""}
					</span>
					<button type="button" class="btn small" onClick={() => abort.current?.abort()}>
						Cancel
					</button>
				</div>
			)}

			<div class="image-grid">
				{items.map((it) => (
					<Tile key={it.index} item={it} selecting={selecting} selected={selected.has(it.index)} version={version} onTap={onTap} />
				))}
			</div>
			<div ref={sentinel} class="sentinel">
				{loading ? "Loading…" : items.length < total ? "" : `All ${formatNumber(total)} images loaded`}
			</div>
		</div>
	);
}

const Tile = memo(function Tile({
	item,
	selecting,
	selected,
	version,
	onTap
}: {
	item: ImageItem;
	selecting: boolean;
	selected: boolean;
	version: number;
	onTap: (i: number) => void;
}) {
	return (
		<button type="button" class={`tile${selected ? " selected" : ""}`} onClick={() => onTap(item.index)} aria-label={item.fileName}>
			<Thumb url={item.url} alt={item.fileName} version={version} size={300} />
			{selecting && <span class="tick">{selected && <IconCheck size={16} />}</span>}
		</button>
	);
});
