import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

// Locks the built page down to Discord's API/CDN so a pasted token can't be sent anywhere else.
// Applied only to production builds; the dev server needs inline scripts and websockets.
const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"worker-src 'self' blob:",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' blob: data: https://cdn.discordapp.com https://media.discordapp.net",
	"media-src 'self' blob: https://cdn.discordapp.com https://media.discordapp.net",
	"connect-src 'self' https://discord.com https://cdn.discordapp.com https://media.discordapp.net",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'"
].join("; ");

function csp(): Plugin {
	return {
		name: "dispack-csp",
		apply: "build",
		transformIndexHtml(html) {
			return html.replace("<head>", `<head>\n\t\t<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
		}
	};
}

// Relative base so the build works at any GitHub Pages path (user.github.io/<repo>/).
export default defineConfig({
	base: "./",
	plugins: [preact(), csp()],
	worker: { format: "es" },
	build: { target: "es2022" }
});
