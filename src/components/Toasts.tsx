export interface ToastMsg {
	id: number;
	msg: string;
	kind: "info" | "error" | "success";
}

export function Toasts({ toasts }: { toasts: ToastMsg[] }) {
	return (
		<div class="toasts" aria-live="polite">
			{toasts.map((t) => (
				<div key={t.id} class={`toast ${t.kind}`}>
					{t.msg}
				</div>
			))}
		</div>
	);
}
