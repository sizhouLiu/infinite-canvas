import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { MULTIVIEW_VIEWS, type MultiviewView } from "@/services/api/model3d-ops";
import { useThemeStore } from "@/stores/use-theme-store";

export type MultiviewViewMenuState = {
    x: number;
    y: number;
    /** The images this connection carries, with the angle each one currently feeds. */
    items: Array<{ nodeId: string; title: string; view: MultiviewView }>;
    /** Every image feeding the same 3D node, so reassigning an angle can swap with whoever holds it. */
    assignment: Array<{ nodeId: string; view: MultiviewView }>;
};

/**
 * Reassigns which angle an upstream image feeds. Anchored at the clicked connection label, following the same
 * fixed-portal pattern as the 3D ops popover (outside-pointer close, viewport clamping).
 */
export function CanvasMultiviewViewMenu({ state, onSelect, onClose }: { state: MultiviewViewMenuState; onSelect: (nodeId: string, view: MultiviewView) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && panelRef.current?.contains(target)) return;
            onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [onClose]);

    const width = 268;
    const margin = 12;

    return createPortal(
        <div
            ref={panelRef}
            style={{
                position: "fixed",
                zIndex: 1200,
                width,
                left: Math.max(margin, Math.min(window.innerWidth - width - margin, state.x - width / 2)),
                top: Math.min(window.innerHeight - margin - 120, state.y + 14),
                background: theme.toolbar.panel,
                borderRadius: 16,
                boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
                padding: 12,
                color: theme.node.text,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 text-[11px]" style={{ color: theme.node.muted }}>
                {t("canvas.multiview.assignTitle")}
            </div>
            <div className="space-y-2.5">
                {state.items.map((item) => (
                    <div key={item.nodeId} className="space-y-1.5">
                        {state.items.length > 1 ? (
                            <div className="truncate text-[11px]" style={{ color: theme.node.muted }}>
                                {item.title}
                            </div>
                        ) : null}
                        <div className="grid grid-cols-4 gap-1.5">
                            {MULTIVIEW_VIEWS.map((view) => (
                                <button
                                    key={view}
                                    type="button"
                                    className="h-8 cursor-pointer rounded-full border px-1 text-xs transition hover:opacity-80"
                                    style={{ background: "transparent", borderColor: item.view === view ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onClick={() => onSelect(item.nodeId, view)}
                                >
                                    {t(`canvas.model3dOps.views.${view}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>,
        document.body,
    );
}
