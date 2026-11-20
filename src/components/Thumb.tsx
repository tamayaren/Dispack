import { useEffect, useState } from "preact/hooks";
import { cachedUrl } from "../lib/discord";
import { needsRefresh, thumbnailUrl } from "../lib/util";

// Tries the resized media-proxy version first, then the original, then shows a placeholder.
export function Thumb({ url, alt, size = 320, version }: { url: string; alt: string; size?: number; version?: number }) {
	const fresh = cachedUrl(url);
	const [stage, setStage] = useState(0);
	useEffect(() => setStage(0), [fresh, version]);

	if (stage >= 2) {
		return (
			<div class="thumb-missing" title={needsRefresh(fresh) ? "Link expired. Add a bot token in Settings." : "Couldn't load"}>
				<span>{needsRefresh(fresh) ? "Expired link" : "Unavailable"}</span>
			</div>
		);
	}
	return (
		<img
			src={stage === 0 ? thumbnailUrl(fresh, size) : fresh}
			alt={alt}
			loading="lazy"
			decoding="async"
			draggable={false}
			onError={() => setStage((s) => s + 1)}
		/>
	);
}
