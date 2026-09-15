import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Settings2 } from "lucide-react";
import { Button } from "antd";

import { Model3dSettingsPanel, model3dFaceLimitLabel, model3dQuadLabel, model3dTextureLabel, model3dTextureQualityLabel } from "@/components/model3d-settings-panel";
import { supportsModel3dQuad } from "@/services/api/model3d";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";

export type CanvasModel3dSettingKey = "model3dTexture" | "model3dPbr" | "model3dTextureQuality" | "model3dFaceLimit" | "model3dQuad";

type CanvasModel3dSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: CanvasModel3dSettingKey, value: string) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
};

export function CanvasModel3dSettingsPopover({ config, onConfigChange, buttonClassName, placement = "topLeft" }: CanvasModel3dSettingsPopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const panel = open && buttonRect ? <Model3dSettingsPortal buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} config={config} onConfigChange={onConfigChange} /> : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button
                    size="small"
                    type="text"
                    className={buttonClassName || "!h-8 !max-w-[190px] !justify-start !rounded-full !px-2.5"}
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    icon={<Settings2 className="size-3.5" />}
                    onClick={() => setOpen((current) => !current)}
                >
                    <span className="truncate">
                        {model3dTextureLabel(config.model3dTexture)} · {model3dTextureQualityLabel(config.model3dTextureQuality)}
                        {supportsModel3dQuad(config.model || config.model3dModel) ? ` · ${model3dQuadLabel(config.model3dQuad)}` : ""} · {model3dFaceLimitLabel(config.model3dFaceLimit)}
                    </span>
                </Button>
            </span>
            {panel}
        </>
    );
}

function Model3dSettingsPortal({
    buttonRect,
    panelRef,
    placement,
    theme,
    config,
    onConfigChange,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: CanvasModel3dSettingsPopoverProps["placement"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    config: AiConfig;
    onConfigChange: (key: CanvasModel3dSettingKey, value: string) => void;
}) {
    const width = 356;
    const gap = 8;
    const margin = 12;
    const alignRight = placement?.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topPlacement = placement?.startsWith("top");
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap, maxHeight: Math.max(260, buttonRect.top - margin * 2) } : { top: buttonRect.bottom + gap, maxHeight: Math.max(260, window.innerHeight - buttonRect.bottom - margin * 2) }),
        background: theme.toolbar.panel,
        borderRadius: 18,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 18,
        overflowY: "auto",
        color: theme.node.text,
    } as const;

    return createPortal(
        <div ref={panelRef} className="canvas-image-settings-popover" style={style} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <Model3dSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} className="space-y-4" />
        </div>,
        document.body,
    );
}
