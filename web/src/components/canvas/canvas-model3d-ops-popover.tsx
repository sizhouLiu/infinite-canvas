import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bone, Boxes, Brush, Download, Grid3x3, ImageDown, PaintBucket, PersonStanding, Scissors, Shrink, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { model3dOpBlockedReason, model3dOpLabel, type Model3dOpId } from "./canvas-model3d-ops";
import { convertExtension } from "@/services/api/model3d-ops";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

export const MODEL3D_OP_ICONS: Record<Model3dOpId, ReactNode> = {
    texture: <Brush className="size-4" />,
    rig: <Bone className="size-4" />,
    retarget: <PersonStanding className="size-4" />,
    decimate: <Shrink className="size-4" />,
    segment: <Scissors className="size-4" />,
    complete: <Wand2 className="size-4" />,
    convert: <Boxes className="size-4" />,
    uv: <Grid3x3 className="size-4" />,
    multiview: <Boxes className="size-4" />,
};

/** Operations offered on an existing 3D node, in the order they are most often used. */
export const MODEL3D_MENU_OPS: Model3dOpId[] = ["texture", "uv", "rig", "retarget", "decimate", "segment", "complete", "convert"];

/**
 * The toolbar's ToolbarTool only supports a flat onClick, so this is a self-managed portal popover
 * following the same pattern as the 3D settings popover (outside-pointer close, viewport clamping).
 */
export function CanvasModel3dOpsPopover({
    node,
    onSelect,
    onDownloadConverted,
    onExtractTexture,
    onApplyTextures,
}: {
    node: CanvasNodeData;
    onSelect: (op: Model3dOpId) => void;
    onDownloadConverted: (node: CanvasNodeData) => void;
    onExtractTexture?: (node: CanvasNodeData) => void;
    onApplyTextures?: (node: CanvasNodeData) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLButtonElement>(null);
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

    return (
        <>
            {/* The hover toolbar it sits in is white in both themes, so the trigger inherits the toolbar's text color
                and hover styles like its sibling buttons instead of following the canvas theme. */}
            <button ref={buttonRef} type="button" title={t("canvas.model3dOps.title")} className="group relative flex h-12 items-center whitespace-nowrap px-1.5" onClick={() => setOpen((current) => !current)}>
                <span className={`flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1] ${open ? "bg-[#eeeeef]" : ""}`}>
                    <Boxes className="size-4" />
                    <span>{t("canvas.model3dOps.title")}</span>
                </span>
            </button>
            {open && buttonRect
                ? createPortal(
                      <div
                          ref={panelRef}
                          className="fixed z-[1200] min-w-52 overflow-hidden rounded-xl border py-1 shadow-2xl"
                          style={{
                              left: Math.max(12, Math.min(window.innerWidth - 220, buttonRect.left)),
                              top: buttonRect.bottom + 8,
                              background: theme.toolbar.panel,
                              borderColor: theme.toolbar.border,
                              color: theme.node.text,
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                      >
                          {MODEL3D_MENU_OPS.map((op) => {
                              const blocked = model3dOpBlockedReason(op, node);
                              return (
                                  <button
                                      key={op}
                                      type="button"
                                      title={blocked || undefined}
                                      disabled={Boolean(blocked)}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors enabled:hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                                      style={{ color: theme.node.text }}
                                      onClick={() => {
                                          setOpen(false);
                                          onSelect(op);
                                      }}
                                  >
                                      {MODEL3D_OP_ICONS[op]}
                                      <span>{model3dOpLabel(op)}</span>
                                  </button>
                              );
                          })}
                          {onExtractTexture && onApplyTextures ? (
                              <>
                                  {/* Local re-skin tools: no Tripo request, so they are never blocked by task requirements. */}
                                  <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                                  {[
                                      { key: "extract", icon: <ImageDown className="size-4" />, label: t("canvas.model3dTextures.extract"), run: onExtractTexture },
                                      { key: "apply", icon: <PaintBucket className="size-4" />, label: t("canvas.model3dTextures.apply"), run: onApplyTextures },
                                  ].map((item) => (
                                      <button
                                          key={item.key}
                                          type="button"
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80"
                                          style={{ color: theme.node.text }}
                                          onClick={() => {
                                              setOpen(false);
                                              item.run(node);
                                          }}
                                      >
                                          {item.icon}
                                          <span>{item.label}</span>
                                      </button>
                                  ))}
                              </>
                          ) : null}
                          {node.metadata?.model3dConvertedKey && node.metadata?.model3dConvertedFormat ? (
                              <>
                                  <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                                  <button
                                      type="button"
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80"
                                      style={{ color: theme.node.text }}
                                      onClick={() => {
                                          setOpen(false);
                                          onDownloadConverted(node);
                                      }}
                                  >
                                      <Download className="size-4" />
                                      <span>{t("canvas.model3dOps.downloadConverted", { ext: convertExtension(node.metadata.model3dConvertedFormat).toUpperCase() })}</span>
                                  </button>
                              </>
                          ) : null}
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}
