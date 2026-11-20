import { useEffect, useRef, useState } from "preact/hooks";
import { channelLabel, useApp, type ViewerItem, type ViewerSource } from "../context";
import { copyText, jumpToMessage } from "../lib/actions";
import { cachedUrl, refreshUrls } from "../lib/discord";
import { isTouchDevice, prefetch, saveOne, TapAgainError } from "../lib/save";
import { formatDate, needsRefresh } from "../lib/util";
import { Content } from "./Content";
import { IconClose, IconDownload, IconExternal, IconLeft, IconRight, IconShare } from "./icons";

interface View {
	scale: number;
	x: number;
	y: number;
}

const IDENTITY: View = { scale: 1, x: 0, y: 0 };

export function ImageViewer({ source, onClose }: { source: ViewerSource; onClose: () => void }) {
	const app = useApp();
	const [items, setItems] = useState<ViewerItem[]>(source.items);
	const [index, setIndex] = useState(source.index);
	const [view, setView] = useState<View>(IDENTITY);
	const [swipe, setSwipe] = useState({ x: 0, y: 0 });
	const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
	const [, bump] = useState(0);
	const [showInfo, setShowInfo] = useState(true);
	const [saving, setSaving] = useState(false);
	const loadingMore = useRef(false);
	const pointers = useRef(new Map<number, { x: number; y: number }>());
	const gesture = useRef<{ dist: number; scale: number; startX: number; startY: number; vx: number; vy: number; moved: boolean } | null>(null);
	const lastTap = useRef(0);

	const total = source.total ?? items.length;
	const item = items[index];
	const url = item ? cachedUrl(item.url) : "";

	const go = (d: number) => {
		const next = index + d;
		if (next < 0 || next >= total) return;
		if (next >= items.length) return;
		setIndex(next);
		setView(IDENTITY);
		setStatus("loading");
	};

	// Refresh links for the current image and its neighbours.
	useEffect(() => {
		const near = items.slice(Math.max(0, index - 2), index + 3).map((i) => i.url);
		if (app.botToken && near.some(needsRefresh)) {
			refreshUrls(near, app.botToken)
				.then((map) => {
					if (Object.keys(map).length) {
						app.parser.updateUrls(map);
						bump((n) => n + 1);
					}
				})
				.catch((err) => app.toast(err.message, "error"));
		}
		if (source.loadMore && index >= items.length - 5 && items.length < total && !loadingMore.current) {
			loadingMore.current = true;
			source
				.loadMore(items.length)
				.then((more) => setItems((prev) => [...prev, ...more]))
				.finally(() => (loadingMore.current = false));
		}
	}, [index, items.length, app.botToken]);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			else if (e.key === "ArrowRight") go(1);
			else if (e.key === "ArrowLeft") go(-1);
		};
		addEventListener("keydown", h);
		document.body.classList.add("no-scroll");
		return () => {
			removeEventListener("keydown", h);
			document.body.classList.remove("no-scroll");
		};
	});

	const clampScale = (s: number) => Math.min(8, Math.max(1, s));

	const onPointerDown = (e: PointerEvent) => {
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const pts = [...pointers.current.values()];
		if (pts.length === 2) {
			gesture.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), scale: view.scale, startX: 0, startY: 0, vx: view.x, vy: view.y, moved: true };
		} else if (pts.length === 1) {
			gesture.current = { dist: 0, scale: view.scale, startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y, moved: false };
		}
	};

	const onPointerMove = (e: PointerEvent) => {
		if (!pointers.current.has(e.pointerId) || !gesture.current) return;
		pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
		const pts = [...pointers.current.values()];
		const g = gesture.current;
		if (pts.length === 2 && g.dist) {
			const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
			const scale = clampScale((g.scale * d) / g.dist);
			setView((v) => ({ ...v, scale, ...(scale === 1 ? { x: 0, y: 0 } : {}) }));
			return;
		}
		const dx = e.clientX - g.startX;
		const dy = e.clientY - g.startY;
		if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true;
		if (view.scale > 1) setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }));
		else setSwipe({ x: dx, y: dy });
	};

	const onPointerUp = (e: PointerEvent) => {
		pointers.current.delete(e.pointerId);
		const g = gesture.current;
		if (pointers.current.size > 0) {
			// Lifting one finger of a pinch: continue as a pan from here.
			const p = [...pointers.current.values()][0];
			gesture.current = { dist: 0, scale: view.scale, startX: p.x, startY: p.y, vx: view.x, vy: view.y, moved: true };
			return;
		}
		gesture.current = null;
		if (!g) return;
		if (view.scale === 1 && g.moved) {
			const { x, y } = swipe;
			setSwipe({ x: 0, y: 0 });
			if (Math.abs(x) > 60 && Math.abs(x) > Math.abs(y)) go(x < 0 ? 1 : -1);
			else if (y > 110 && Math.abs(y) > Math.abs(x)) onClose();
			return;
		}
		setSwipe({ x: 0, y: 0 });
		if (!g.moved) {
			const now = Date.now();
			if (now - lastTap.current < 300) {
				setView((v) => (v.scale > 1 ? IDENTITY : { scale: 2.5, x: 0, y: 0 }));
				lastTap.current = 0;
			} else {
				lastTap.current = now;
				// Single tap toggles the info panel (after the double-tap window).
				setTimeout(() => {
					if (lastTap.current === now) setShowInfo((s) => !s);
				}, 310);
			}
		}
	};

	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		setView((v) => {
			const scale = clampScale(v.scale * Math.exp(-e.deltaY * 0.0025));
			return scale === 1 ? IDENTITY : { ...v, scale };
		});
	};

	async function save() {
		if (!item) return;
		setSaving(true);
		try {
			await saveOne(item, app.botToken, app.settings.saveMethod);
		} catch (err) {
			if (err instanceof TapAgainError) app.toast(err.message, "info");
			else app.toast(`Couldn't save: ${(err as Error).message}`, "error");
		} finally {
			setSaving(false);
		}
	}

	if (!item) return null;
	const ch = app.channels.get(item.channelId);
	const label = channelLabel(ch, app);
	const touch = isTouchDevice();
	const swipeStyle = view.scale === 1 && (swipe.x || swipe.y) ? `translate(${swipe.x}px, ${Math.max(0, swipe.y)}px)` : "";
	const fade = swipe.y > 0 ? Math.max(0.3, 1 - swipe.y / 400) : 1;

	return (
		<div class="viewer" role="dialog" aria-modal="true" aria-label="Image viewer" style={{ background: `rgba(0,0,0,${0.94 * fade})` }}>
			<div class={`viewer-top${showInfo ? "" : " hidden-ui"}`}>
				<span class="counter">
					{index + 1} / {total.toLocaleString()}
				</span>
				<div class="viewer-actions">
					<button type="button" class="icon-btn" onClick={save} disabled={saving} aria-label="Save image" title="Save image">
						{touch ? <IconShare /> : <IconDownload />}
					</button>
					<a class="icon-btn" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open original" title="Open original">
						<IconExternal />
					</a>
					<button type="button" class="icon-btn" onClick={onClose} aria-label="Close viewer" title="Close">
						<IconClose />
					</button>
				</div>
			</div>

			<div
				class="viewer-stage"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onWheel={onWheel}
			>
				{status === "loading" && <div class="spinner" aria-label="Loading" />}
				{status === "error" && (
					<div class="viewer-error">
						<p>{needsRefresh(url) ? (app.botToken ? "Discord couldn't refresh this link. The file may have been deleted." : "This link has expired. Add a bot token in Settings to view it.") : "This image couldn't be loaded."}</p>
					</div>
				)}
				<img
					key={url}
					src={url}
					alt={item.fileName}
					draggable={false}
					onLoad={() => {
						setStatus("ok");
						// Phones save through the share sheet, which needs the file ready when the button is tapped.
						if (touch) prefetch(url);
					}}
					onError={() => setStatus("error")}
					style={{
						transform: swipeStyle || `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
						transition: pointers.current.size ? "none" : "transform .18s ease-out",
						opacity: status === "ok" ? 1 : 0
					}}
				/>
			</div>

			{!touch && index > 0 && (
				<button type="button" class="viewer-nav prev" onClick={() => go(-1)} aria-label="Previous image">
					<IconLeft size={28} />
				</button>
			)}
			{!touch && index < Math.min(total, items.length) - 1 && (
				<button type="button" class="viewer-nav next" onClick={() => go(1)} aria-label="Next image">
					<IconRight size={28} />
				</button>
			)}

			<div class={`viewer-info${showInfo ? "" : " hidden-ui"}`}>
				<div class="viewer-meta">
					<strong class="ellipsis">{item.fileName}</strong>
					<span class="muted small">
						{formatDate(item.ts)} · {label.title}
						{label.sub ? ` · ${label.sub}` : ""}
					</span>
				</div>
				{item.content && (
					<div class="viewer-caption">
						<Content text={item.content} />
					</div>
				)}
				<div class="viewer-buttons">
					<button type="button" class="btn small" onClick={() => jumpToMessage(app, item.channelId, item.messageId)}>
						Jump to message
					</button>
					<button type="button" class="btn small" onClick={() => copyText(app, url, "Link copied")}>
						Copy link
					</button>
					<button type="button" class="btn small primary" onClick={save} disabled={saving}>
						{saving ? "Saving…" : "Save"}
					</button>
				</div>
			</div>
		</div>
	);
}
