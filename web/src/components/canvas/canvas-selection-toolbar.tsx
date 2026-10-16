import type { ReactNode } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Box, Copy, Group, Printer, Trash2, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { AlignMode } from "@/lib/canvas/canvas-align";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    showToolbar,
    canGroup,
    canUngroup,
    canImportToBlender,
    canOpenInBambuStudio,
    onGroup,
    onUngroup,
    onImportToBlender,
    onOpenInBambuStudio,
    canDistribute,
    onAlign,
    onDuplicate,
    onDelete,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    canImportToBlender?: boolean;
    canOpenInBambuStudio?: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onImportToBlender?: () => void;
    onOpenInBambuStudio?: () => void;
    canDistribute: boolean;
    onAlign: (mode: AlignMode) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    // Align, duplicate and delete apply to any multi-selection, so the bar shows whenever dragging stops.
    const showActions = showToolbar;
    const alignActions: Array<{ mode: AlignMode; icon: ReactNode }> = [
        { mode: "left", icon: <AlignStartVertical className="size-4" /> },
        { mode: "centerX", icon: <AlignCenterVertical className="size-4" /> },
        { mode: "right", icon: <AlignEndVertical className="size-4" /> },
        { mode: "top", icon: <AlignStartHorizontal className="size-4" /> },
        { mode: "centerY", icon: <AlignCenterHorizontal className="size-4" /> },
        { mode: "bottom", icon: <AlignEndHorizontal className="size-4" /> },
        ...(canDistribute
            ? [
                  { mode: "distributeX" as const, icon: <AlignHorizontalDistributeCenter className="size-4" /> },
                  { mode: "distributeY" as const, icon: <AlignVerticalDistributeCenter className="size-4" /> },
              ]
            : []),
    ];

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showActions ? (
                <div
                    className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                    style={{ left: left + width / 2, top: top - 8 }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {alignActions.map((action) => (
                        <SelectionAction key={action.mode} title={t(`canvas.selectionToolbar.align.${action.mode}`)} icon={action.icon} onClick={() => onAlign(action.mode)} />
                    ))}
                    <span className="mx-1 h-6 w-px bg-black/10" />
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                    {canImportToBlender && onImportToBlender ? <SelectionAction title={t("canvas.blenderBridge.title")} label={t("canvas.blenderBridge.label")} icon={<Box className="size-4" />} onClick={onImportToBlender} /> : null}
                    {canOpenInBambuStudio && onOpenInBambuStudio ? <SelectionAction title={t("canvas.bambuStudio.title")} label={t("canvas.bambuStudio.label")} icon={<Printer className="size-4" />} onClick={onOpenInBambuStudio} /> : null}
                    <SelectionAction title={t("canvas.selectionToolbar.duplicate")} icon={<Copy className="size-4" />} onClick={onDuplicate} />
                    <SelectionAction title={t("canvas.selectionToolbar.delete")} icon={<Trash2 className="size-4 text-[#ef4444]" />} onClick={onDelete} />
                </div>
            ) : null}
        </>
    );
}

function SelectionAction({ title, label, icon, onClick }: { title: string; label?: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5" onClick={onClick} aria-label={title}>
                <span className={`flex h-9 items-center gap-2 rounded-lg transition group-hover:bg-[#f0f0f1] ${label ? "px-2.5" : "px-2"}`}>
                    {icon}
                    {label ? <span>{label}</span> : null}
                </span>
            </button>
        </Tooltip>
    );
}
