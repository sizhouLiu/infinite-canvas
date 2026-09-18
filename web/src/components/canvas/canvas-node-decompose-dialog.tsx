import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, Modal, Spin, Tooltip } from "antd";
import { Plus, RefreshCw, Trash2, WandSparkles, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readImageMeta } from "@/lib/image-utils";
import { DECOMPOSE_MAX_ITEMS, type DecomposeItem } from "@/lib/canvas/canvas-decompose-prompts";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";

/**
 * Scene decomposition, first half: show what the model found in the picture and let it be corrected before
 * any image credits are spent. The listing is one cheap text call, the extractions are one image call each,
 * so the editable list sits between them deliberately — fixing a wrong name here costs nothing, fixing it
 * after twelve generations costs twelve generations.
 */
export function CanvasNodeDecomposeDialog({
    dataUrl,
    open,
    transparentSupported,
    onClose,
    onAnalyze,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    /** Whether the image model honors a transparent background, so the copy can say what will come out. */
    transparentSupported: boolean;
    onClose: () => void;
    onAnalyze: () => Promise<DecomposeItem[]>;
    onConfirm: (items: DecomposeItem[]) => void;
}) {
    const { t } = useTranslation();
    const [items, setItems] = useState<DecomposeItem[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const viewport = useImageEditorViewport(image, open);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    const analyze = useCallback(async () => {
        setAnalyzing(true);
        setError(null);
        try {
            setItems(await onAnalyze());
        } catch (analyzeError) {
            setItems([]);
            setError(analyzeError instanceof Error ? analyzeError.message : t("canvas.decompose.analyzeFailed"));
        } finally {
            setAnalyzing(false);
        }
    }, [onAnalyze, t]);

    // The listing runs on open rather than behind a button: the user asked to decompose, so the first answer
    // is what they came for. Re-analyzing is then an explicit choice.
    useEffect(() => {
        if (!open) return;
        setItems([]);
        setError(null);
        void analyze();
    }, [analyze, open]);

    const validItems = items.filter((item) => item.name.trim());
    const rename = (index: number, name: string) => setItems((current) => current.map((item, position) => (position === index ? { ...item, name } : item)));
    const remove = (index: number) => setItems((current) => current.filter((_, position) => position !== index));

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={880} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">{t("canvas.decompose.title")}</h2>
                    <p className="mt-1 text-sm opacity-60">{t("canvas.decompose.description")}</p>
                </div>
                {transparentSupported ? null : <Alert type="warning" showIcon message={t("canvas.decompose.opaqueBackground")} />}
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
                    <div className="space-y-2">
                        <div
                            ref={viewport.viewportRef}
                            {...viewport.panHandlers}
                            className={`relative isolate h-[340px] min-h-[300px] rounded-lg bg-black/5 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                        >
                            <div className="relative" style={viewport.contentStyle}>
                                <div ref={viewport.stageRef} className="absolute isolate overflow-hidden rounded-lg [backface-visibility:hidden]" style={viewport.stageStyle}>
                                    <img src={dataUrl} alt="" className="absolute left-0 top-0 max-w-none select-none" draggable={false} style={viewport.mediaStyle} />
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Tooltip title={t("canvas.editors.zoomOut")}>
                                <Button type="text" icon={<ZoomOut className="size-4" />} disabled={!viewport.canZoomOut} aria-label={t("canvas.editors.zoomOut")} onClick={viewport.zoomOut} />
                            </Tooltip>
                            <button type="button" className="min-w-14 text-center text-xs font-semibold tabular-nums opacity-70" onClick={viewport.resetZoom}>
                                {Math.round(viewport.zoom * 100)}%
                            </button>
                            <Tooltip title={t("canvas.editors.zoomIn")}>
                                <Button type="text" icon={<ZoomIn className="size-4" />} disabled={!viewport.canZoomIn} aria-label={t("canvas.editors.zoomIn")} onClick={viewport.zoomIn} />
                            </Tooltip>
                        </div>
                    </div>
                    <div className="flex h-[380px] flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium opacity-75">{t("canvas.decompose.components", { count: validItems.length })}</span>
                            <Button size="small" type="text" icon={<RefreshCw className="size-4" />} loading={analyzing} onClick={() => void analyze()}>
                                {t("canvas.decompose.reanalyze")}
                            </Button>
                        </div>
                        {items.length >= DECOMPOSE_MAX_ITEMS ? <p className="text-xs opacity-60">{t("canvas.decompose.truncated", { count: DECOMPOSE_MAX_ITEMS })}</p> : null}
                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                            {analyzing ? (
                                <div className="flex h-full flex-col items-center justify-center gap-3 opacity-70">
                                    <Spin />
                                    <span className="text-sm">{t("canvas.decompose.analyzing")}</span>
                                </div>
                            ) : error ? (
                                <Alert type="error" showIcon message={error} />
                            ) : items.length ? (
                                items.map((item, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <Input value={item.name} placeholder={t("canvas.decompose.namePlaceholder")} onChange={(event) => rename(index, event.target.value)} />
                                        <Button type="text" icon={<Trash2 className="size-4" />} aria-label={t("canvas.decompose.remove")} onClick={() => remove(index)} />
                                    </div>
                                ))
                            ) : (
                                <p className="py-6 text-center text-sm opacity-60">{t("canvas.decompose.empty")}</p>
                            )}
                        </div>
                        <Button block icon={<Plus className="size-4" />} disabled={analyzing || items.length >= DECOMPOSE_MAX_ITEMS} onClick={() => setItems((current) => [...current, { name: "" }])}>
                            {t("canvas.decompose.add")}
                        </Button>
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <Button size="large" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button type="primary" size="large" icon={<WandSparkles className="size-4" />} disabled={analyzing || !validItems.length} onClick={() => onConfirm(validItems.map((item) => ({ ...item, name: item.name.trim() })))}>
                        {t("canvas.decompose.generate", { count: validItems.length })}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
