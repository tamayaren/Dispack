import type { Progress } from "../lib/types";

export function LoadingView({ name, progress }: { name: string; progress: Progress | null }) {
	const pct = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
	return (
		<main class="landing">
			<div class="landing-inner loading">
				<h1>Reading {name}</h1>
				<div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
					<div style={{ width: `${pct}%` }} />
				</div>
				<p class="muted ellipsis">{progress ? `${progress.label} (${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} files)` : "Opening archive…"}</p>
				<p class="fineprint">Large packages with a million messages can take a minute, and longer on phones.</p>
			</div>
		</main>
	);
}
