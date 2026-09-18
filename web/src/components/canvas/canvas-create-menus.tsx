import { useEffect, useRef } from "react";
import { Box, ImageIcon, List, Music2, Settings2, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData, type ConnectionHandle, type Position } from "@/types/canvas";
import { model3dOpBlockedReason, model3dOpLabel, type Model3dOpId } from "./canvas-model3d-ops";
import { MODEL3D_MENU_OPS, MODEL3D_OP_ICONS } from "./canvas-model3d-ops-popover";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({
    pending,
    sourceNode,
    onCreate,
    onModel3dOp,
    onClose,
}: {
    pending: PendingConnectionCreate;
    sourceNode?: CanvasNodeData;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Model3d) => void;
    onModel3dOp?: (op: Model3dOpId) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const showModel3dOps = pending.connection.handleType === "source" && sourceNode?.type === CanvasNodeType.Model3d && Boolean(sourceNode.metadata?.content) && Boolean(onModel3dOp);
    return (
        <div
            className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                {showModel3dOps && sourceNode ? (
                    <>
                        {MODEL3D_MENU_OPS.map((op) => {
                            const blocked = model3dOpBlockedReason(op, sourceNode);
                            return <ConnectionCreateOption key={op} theme={theme} icon={<span className="[&>svg]:size-5">{MODEL3D_OP_ICONS[op]}</span>} title={model3dOpLabel(op)} disabled={Boolean(blocked)} hint={blocked || undefined} onClick={() => onModel3dOp?.(op)} />;
                        })}
                        <div className="my-1 border-t" style={{ borderColor: theme.node.stroke }} />
                    </>
                ) : null}
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title={t("canvas.createMenu.text")} description={t("canvas.createMenu.textDescription")} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title={t("canvas.createMenu.image")} onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title={t("canvas.createMenu.video")} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title={t("canvas.createMenu.audio")} onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Box className="size-5" />} title={t("canvas.createMenu.model3d")} onClick={() => onCreate(CanvasNodeType.Model3d)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title={t("canvas.createMenu.config")} description={t("canvas.createMenu.configDescription")} onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, disabled, hint, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; disabled?: boolean; hint?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={hint}
            className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => {
                if (disabled) return;
                event.currentTarget.style.background = theme.node.fill;
            }}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, onCreate, onClose }: { position: Position; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-canvas-no-zoom
            style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.select")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                {definitions.map((def) => (
                    <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} onClick={() => onCreate(def.type)} />
                ))}
            </div>
        </div>
    );
}
