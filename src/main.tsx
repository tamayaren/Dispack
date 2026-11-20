import { render } from "preact";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("app")!;

// A meta CSP can't set frame-ancestors, so refuse to run inside a frame (clickjacking on token actions).
if (window.top !== window.self) {
	root.innerHTML = '<p class="framed">Dispack can\'t run inside a frame. <a target="_top" rel="noopener">Open it directly.</a></p>';
	root.querySelector("a")!.setAttribute("href", location.href);
} else {
	render(<App />, root);
}
