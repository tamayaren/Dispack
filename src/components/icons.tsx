import type { JSX } from "preact";

type P = JSX.IntrinsicSVGElements["svg"] & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: JSX.Element | JSX.Element[] }) {
	return (
		<svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" {...rest}>
			{children}
		</svg>
	);
}

export const IconSearch = (p: P) => <Svg {...p}><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9.6l4-4 4 4 3-3 5 5V6H4zm11 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" /></Svg>;
export const IconChat = (p: P) => <Svg {...p}><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 1-2z" /></Svg>;
export const IconServer = (p: P) => <Svg {...p}><path d="M12 2l9 5v10l-9 5-9-5V7l9-5zm0 2.3L5 8.2v7.6l7 3.9 7-3.9V8.2l-7-3.9z" /></Svg>;
export const IconCog = (p: P) => <Svg {...p}><path d="M13.8 2l.5 2.6 1.7.9 2.4-1.2 2.4 2.4-1.2 2.4.8 1.8 2.6.5v3.4l-2.6.5-.8 1.8 1.2 2.4-2.4 2.4-2.4-1.2-1.7.8-.5 2.7h-3.6l-.5-2.7-1.7-.8-2.4 1.2-2.4-2.4 1.2-2.4-.8-1.8L2 13.7v-3.4l2.6-.5.8-1.8-1.2-2.4 2.4-2.4 2.4 1.2 1.7-.9.5-2.5h3.6zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" /></Svg>;
export const IconMore = (p: P) => <Svg {...p}><path d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3zM4 18h16v2H4z" /></Svg>;
export const IconLeft = (p: P) => <Svg {...p}><path d="M15.4 5.4L14 4l-8 8 8 8 1.4-1.4L8.8 12z" /></Svg>;
export const IconRight = (p: P) => <Svg {...p}><path d="M8.6 18.6L10 20l8-8-8-8-1.4 1.4 6.6 6.6z" /></Svg>;
export const IconExternal = (p: P) => <Svg {...p}><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5z" /></Svg>;
export const IconFilter = (p: P) => <Svg {...p}><path d="M3 5h18l-7 8.5V20l-4-2v-4.5z" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z" /></Svg>;
export const IconZoom = (p: P) => <Svg {...p}><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2zm-1 4v3H6v2h3v3h2v-3h3V9h-3V6H9z" /></Svg>;
export const IconShare = (p: P) => <Svg {...p}><path d="M12 2l4.7 4.7-1.4 1.4L13 5.8V15h-2V5.8L8.7 8.1 7.3 6.7 12 2zM4 13h2v6h12v-6h2v8H4v-8z" /></Svg>;
