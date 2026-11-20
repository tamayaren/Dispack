import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Ctx, type AppCtx, type Tab, type ViewerSource } from "./context";
import { checkUserToken, clearUrlCache } from "./lib/discord";
import { loadDeleted, loadResolvedUsers, loadSettings, saveDeleted, saveResolvedUsers, saveSettings, type Settings } from "./lib/storage";
import type { GuildsResult, PkgUser, Progress, Summary } from "./lib/types";
import { avatarUrl } from "./lib/util";
import { createParser, type ParserClient } from "./lib/worker-client";
import { Landing } from "./components/Landing";
import { LoadingView } from "./components/LoadingView";
import { Shell } from "./components/Shell";
import { Toasts, type ToastMsg } from "./components/Toasts";
import { ImageViewer } from "./components/ImageViewer";

let toastSeq = 0;

interface Loaded {
	parser: ParserClient;
	summary: Summary;
	avatarUrl: string;
}

export function App() {
	const [settings, setSettingsState] = useState<Settings>(loadSettings);
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const [loading, setLoading] = useState<{ name: string; progress: Progress | null } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [guilds, setGuilds] = useState<GuildsResult | null>(null);
	const [guildsError, setGuildsError] = useState<string | null>(null);
	const [guildsProgress, setGuildsProgress] = useState<Progress | null>(null);
	const [botToken, setBotToken] = useState<string | null>(null);
	const [userToken, setUserToken] = useState<string | null>(null);
	// Mutated in place and saved on a short debounce; mass delete can add thousands of IDs.
	const deletedRef = useRef<Set<string>>(new Set());
	const [deletedVersion, setDeletedVersion] = useState(0);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveWarned = useRef(false);
	const [resolved, setResolved] = useState<Record<string, PkgUser>>({});
	const [toasts, setToasts] = useState<ToastMsg[]>([]);
	const [viewer, setViewer] = useState<ViewerSource | null>(null);
	const [tab, setTab] = useState<Tab>("messages");
	const [pendingSearch, setPendingSearch] = useState<{ ids: string[]; label: string; n: number } | null>(null);

	const toast = useCallback((msg: string, kind: ToastMsg["kind"] = "info") => {
		const id = ++toastSeq;
		setToasts((t) => [...t, { id, msg, kind }]);
		setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
	}, []);

	const setSettings = useCallback((s: Settings) => {
		setSettingsState(s);
		saveSettings(s);
	}, []);

	// Warn before leaving with a package open, since reloading loses it.
	useEffect(() => {
		if (!loaded) return;
		const h = (e: BeforeUnloadEvent) => e.preventDefault();
		addEventListener("beforeunload", h);
		return () => removeEventListener("beforeunload", h);
	}, [loaded]);

	// Dev-only shortcut for testing: ?package=/test-fixtures/package.zip
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		const src = new URLSearchParams(location.search).get("package");
		if (!src || !src.startsWith("/")) return;
		fetch(src)
			.then((r) => r.blob())
			.then((b) => openFile(new File([b], src.split("/").pop() || "package.zip")));
	}, []);

	async function openFile(file: File) {
		setError(null);
		setLoading({ name: file.name, progress: null });
		const parser = createParser();
		parser.onProgress((p) => {
			if (p.phase === "messages") setLoading((l) => (l ? { ...l, progress: p } : l));
			else setGuildsProgress(p);
		});
		parser.onGuilds((g) => {
			setGuilds(g);
			setGuildsProgress(null);
		});
		parser.onGuildsError((e) => {
			setGuildsError(e);
			setGuildsProgress(null);
		});
		try {
			// We don't know the account until user.json is read, so deleted IDs are applied afterwards.
			const summary = await parser.load(file, []);
			const del = loadDeleted(summary.user.id);
			if (del.length) await parser.setDeleted(del, true);
			const av = summary.avatar ? URL.createObjectURL(summary.avatar) : avatarUrl(summary.user, 128);
			deletedRef.current = new Set(del);
			setDeletedVersion((v) => v + 1);
			setResolved(loadResolvedUsers(summary.user.id));
			setGuilds(null);
			setGuildsError(null);
			setLoaded({ parser, summary, avatarUrl: av });
			setTab("messages");
			if (summary.unsignedLinks) {
				toast("This package predates signed attachment links. Add a bot token in Settings to view images.", "info");
			}
		} catch (err) {
			parser.terminate();
			setError((err as Error).message);
		} finally {
			setLoading(null);
		}
	}

	const flushDeleted = useCallback(() => {
		if (!saveTimer.current) return;
		clearTimeout(saveTimer.current);
		saveTimer.current = null;
		if (loaded && !saveDeleted(loaded.summary.user.id, deletedRef.current) && !saveWarned.current) {
			saveWarned.current = true;
			toast("This browser's storage is full, so deleted-message markers won't be remembered after reload.", "error");
		}
	}, [loaded, toast]);

	const unload = useCallback(() => {
		flushDeleted();
		if (loaded) {
			loaded.parser.terminate();
			if (loaded.avatarUrl.startsWith("blob:")) URL.revokeObjectURL(loaded.avatarUrl);
		}
		setLoaded(null);
		setGuilds(null);
		setGuildsProgress(null);
		setViewer(null);
		setUserToken(null);
		setBotToken(null);
		setPendingSearch(null);
		clearUrlCache();
		deletedRef.current = new Set();
	}, [loaded, flushDeleted]);

	const ctx = useMemo<AppCtx | null>(() => {
		if (!loaded) return null;
		const { summary, parser } = loaded;
		const userId = summary.user.id;
		return {
			parser,
			summary,
			channels: new Map(summary.channels.map((c) => [c.id, c])),
			users: summary.users,
			avatarUrl: loaded.avatarUrl,
			settings,
			setSettings,
			botToken,
			setBotToken,
			userToken,
			setUserToken,
			guilds,
			guildsError,
			guildsProgress,
			deleted: deletedRef.current,
			markDeleted: (ids) => {
				ids.forEach((id) => deletedRef.current.add(id));
				setDeletedVersion((v) => v + 1);
				parser.setDeleted(ids, true);
				if (saveTimer.current) clearTimeout(saveTimer.current);
				saveTimer.current = setTimeout(() => {
					saveTimer.current = null;
					if (!saveDeleted(userId, deletedRef.current) && !saveWarned.current) {
						saveWarned.current = true;
						toast("This browser's storage is full, so deleted-message markers won't be remembered after reload.", "error");
					}
				}, 600);
			},
			resolvedByChannel: resolved,
			resolveUser: (channelId, user) => {
				setResolved((prev) => {
					const next = { ...prev, [channelId]: user };
					saveResolvedUsers(userId, next);
					return next;
				});
			},
			toast,
			openViewer: setViewer,
			searchIn: (ids, label) => {
				setPendingSearch((p) => ({ ids, label, n: (p?.n ?? 0) + 1 }));
				setTab("messages");
			},
			setTab,
			requireUserToken: () => {
				if (!userToken) {
					toast("Add your account token in Settings to use this.", "error");
					return null;
				}
				const problem = checkUserToken(userToken, userId);
				if (problem) {
					toast(problem, "error");
					return null;
				}
				return userToken;
			},
			unload
		};
	}, [loaded, settings, botToken, userToken, guilds, guildsError, guildsProgress, deletedVersion, resolved, toast, unload, setSettings]);

	let body;
	if (loading) body = <LoadingView name={loading.name} progress={loading.progress} />;
	else if (!ctx) body = <Landing onFile={openFile} error={error} />;
	else
		body = (
			<Ctx.Provider value={ctx}>
				<Shell tab={tab} setTab={setTab} pendingSearch={pendingSearch} />
				{viewer && <ImageViewer source={viewer} onClose={() => setViewer(null)} />}
			</Ctx.Provider>
		);

	return (
		<>
			{body}
			<Toasts toasts={toasts} />
		</>
	);
}
