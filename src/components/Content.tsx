import type { ComponentChildren } from "preact";
import { useApp, channelLabel } from "../context";
import { userTag } from "../lib/util";

// Discord markup tokens: custom emoji, mentions, channel links, timestamps, URLs.
const TOKEN_RE = /<(a?):(\w{1,32}):(\d{15,22})>|<@!?(\d{15,22})>|<@&(\d{15,22})>|<#(\d{15,22})>|<t:(-?\d{1,13})(?::([tTdDfFR]))?>|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

function formatStamp(sec: number, style?: string): string {
	const d = new Date(sec * 1000);
	switch (style) {
		case "t":
			return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
		case "T":
			return d.toLocaleTimeString();
		case "d":
			return d.toLocaleDateString();
		case "D":
			return d.toLocaleDateString(undefined, { dateStyle: "long" });
		case "F":
			return d.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
		case "R": {
			const diff = (sec * 1000 - Date.now()) / 1000;
			const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
			const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]];
			for (const [u, s] of units) if (Math.abs(diff) >= s || u === "second") return rtf.format(Math.round(diff / s), u);
			return d.toLocaleString();
		}
		default:
			return d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
	}
}

export function Content({ text }: { text: string }) {
	const app = useApp();
	if (!text) return null;

	const stripped = text.replace(/<a?:\w+:\d+>/g, "").replace(/\p{Extended_Pictographic}|️|‍|\s/gu, "");
	const jumbo = stripped === "" && text.length < 200;
	const out: ComponentChildren[] = [];
	let last = 0;
	let key = 0;
	TOKEN_RE.lastIndex = 0;
	for (let m: RegExpExecArray | null; (m = TOKEN_RE.exec(text)); ) {
		if (m.index > last) out.push(text.slice(last, m.index));
		last = m.index + m[0].length;
		const k = key++;
		if (m[3]) {
			const size = jumbo ? 48 : 22;
			out.push(
				<img
					key={k}
					class={`emoji${jumbo ? " jumbo" : ""}`}
					src={`https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? "gif" : "webp"}?size=${size * 2}&quality=lossless`}
					alt={`:${m[2]}:`}
					title={`:${m[2]}:`}
					width={size}
					height={size}
					loading="lazy"
				/>
			);
		} else if (m[4]) {
			const u = app.users[m[4]];
			out.push(<span key={k} class="mention">@{u ? userTag(u) : m[4] === app.summary.user.id ? userTag(app.summary.user) : "unknown-user"}</span>);
		} else if (m[5]) {
			out.push(<span key={k} class="mention">@role</span>);
		} else if (m[6]) {
			const ch = app.channels.get(m[6]);
			out.push(<span key={k} class="mention">{ch ? channelLabel(ch, app).title : "#unknown-channel"}</span>);
		} else if (m[7]) {
			out.push(<span key={k} class="stamp">{formatStamp(Number(m[7]), m[8])}</span>);
		} else if (m[9]) {
			out.push(
				<a key={k} href={m[9]} target="_blank" rel="noopener noreferrer nofollow">
					{m[9]}
				</a>
			);
		}
	}
	if (last < text.length) out.push(text.slice(last));
	return <div class={`content-text${jumbo ? " jumbo-text" : ""}`}>{out}</div>;
}
