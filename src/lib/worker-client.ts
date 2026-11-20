import type { GuildsResult, Progress, WorkerApi } from "./types";

type Listener<T> = (data: T) => void;

type Promisified<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

export interface ParserClient extends Promisified<WorkerApi> {
	onProgress(fn: Listener<Progress>): void;
	terminate(): void;
}

export function createParser(): ParserClient {
	const worker = new Worker(new URL("../worker/parser.ts", import.meta.url), { type: "module" });
	let nextId = 1;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	const listeners: Record<string, Listener<any>[]> = { progress: [], guilds: [], guildsError: [] };

	worker.onmessage = (ev: MessageEvent) => {
		const d = ev.data;
		if (d.event) {
			listeners[d.event]?.forEach((fn) => fn(d.data));
			return;
		}
		const p = pending.get(d.id);
		if (!p) return;
		pending.delete(d.id);
		if (d.ok) p.resolve(d.result);
		else p.reject(new Error(d.error));
	};
	worker.onerror = (ev) => {
		const err = new Error(ev.message || "The parser crashed. The package may be too large for this device's memory.");
		pending.forEach((p) => p.reject(err));
		pending.clear();
	};

	const call = (method: string) => (...args: unknown[]) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, method, args });
		});

	const methods = ["load", "loadGuilds", "search", "results", "resultIds", "images", "updateUrls", "setDeleted", "channelMessageCount"];
	const client: Record<string, unknown> = {};
	for (const m of methods) client[m] = call(m);
	client.onProgress = (fn: Listener<Progress>) => listeners.progress.push(fn);
	client.terminate = () => worker.terminate();
	return client as unknown as ParserClient;
}
