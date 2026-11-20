import { useRef, useState } from "preact/hooks";

export function Landing({ onFile, error }: { onFile: (f: File) => void; error: string | null }) {
	const input = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);

	const pick = (files: FileList | null | undefined) => {
		const f = files?.[0];
		if (f) onFile(f);
	};

	return (
		<main class="landing">
			<div class="landing-inner">
				<div class="brand">
					<img src="./favicon.svg" alt="" width={44} height={44} />
					<h1>Dispack</h1>
				</div>
				<p class="lede">Browse what's actually inside your Discord data package: messages, images, DMs and servers.</p>

				<button
					type="button"
					class={`dropzone${over ? " over" : ""}`}
					onClick={() => input.current?.click()}
					onDragOver={(e) => {
						e.preventDefault();
						setOver(true);
					}}
					onDragLeave={() => setOver(false)}
					onDrop={(e) => {
						e.preventDefault();
						setOver(false);
						pick(e.dataTransfer?.files);
					}}
				>
					<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
						<path fill="currentColor" d="M12 3l5 5h-3v6h-4V8H7l5-5zm-7 14h14v2H5v-2z" />
					</svg>
					<strong>Open package.zip</strong>
					<span>Tap to choose, or drop the file here</span>
				</button>
				<input ref={input} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={(e) => pick((e.target as HTMLInputElement).files)} />

				{error && <p class="error-box" role="alert">{error}</p>}

				<section class="info-grid">
					<div>
						<h2>Stays on your device</h2>
						<p>The zip is read inside your browser. Nothing is uploaded. The only network requests go to Discord's own CDN and API.</p>
					</div>
					<div>
						<h2>Getting your package</h2>
						<p>
							In Discord, go to <em>User Settings → Data &amp; Privacy → Request all of my data</em>. Discord emails you a link, usually within a few days.
						</p>
					</div>
					<div>
						<h2>Seeing old images</h2>
						<p>Attachment links in the package expire. Add a bot token in Settings and Dispack asks Discord for fresh links.</p>
					</div>
				</section>
				<p class="fineprint">
					A browser port of{" "}
					<a href="https://github.com/aamiaa/Data-Package-Tool" target="_blank" rel="noopener noreferrer">
						Data Package Tool
					</a>{" "}
					by aamiaa. Not affiliated with Discord.
				</p>
			</div>
		</main>
	);
}
