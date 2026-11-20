import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		addEventListener("keydown", h);
		return () => removeEventListener("keydown", h);
	}, [onClose]);
	return (
		<div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
			<div class={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
				<div class="modal-head">
					<h2>{title}</h2>
					<button type="button" class="icon-btn" aria-label="Close" onClick={onClose}>
						✕
					</button>
				</div>
				<div class="modal-body">{children}</div>
			</div>
		</div>
	);
}

export interface SheetAction {
	label: string;
	onSelect: () => void;
	danger?: boolean;
	hidden?: boolean;
}

export function ActionSheet({ title, actions, onClose }: { title: string; actions: SheetAction[]; onClose: () => void }) {
	return (
		<Modal title={title} onClose={onClose}>
			<div class="sheet-list">
				{actions
					.filter((a) => !a.hidden)
					.map((a) => (
						<button
							key={a.label}
							type="button"
							class={`sheet-item${a.danger ? " danger" : ""}`}
							onClick={() => {
								onClose();
								a.onSelect();
							}}
						>
							{a.label}
						</button>
					))}
			</div>
		</Modal>
	);
}
