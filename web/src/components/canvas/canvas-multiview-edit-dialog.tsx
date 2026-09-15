import { useEffect, useState } from "react";
import { Input, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { MULTIVIEW_VIEWS, type MultiviewView } from "@/services/api/model3d-ops";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

/**
 * Edit an existing multiview set. Tripo applies one prompt per view, so this collects a prompt for each
 * angle and sends only the ones that were filled in.
 */
export function CanvasMultiviewEditDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: (prompts: Array<{ prompt: string; view: MultiviewView }>) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [prompts, setPrompts] = useState<Partial<Record<MultiviewView, string>>>({});

    useEffect(() => {
        if (open) setPrompts({});
    }, [open]);

    const filled = MULTIVIEW_VIEWS.flatMap((view) => {
        const prompt = prompts[view]?.trim();
        return prompt ? [{ view, prompt }] : [];
    });

    return (
        <Modal open={open} title={t("canvas.model3dOps.editMultiview")} okText={t("canvas.model3dOps.run")} cancelText={t("common.cancel")} okButtonProps={{ disabled: !filled.length }} onCancel={onCancel} onOk={() => onConfirm(filled)} width={440}>
            <div className="space-y-3 py-2">
                <p className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.model3dOps.editMultiviewHint")}
                </p>
                {MULTIVIEW_VIEWS.map((view) => (
                    <div key={view} className="space-y-1">
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {t(`canvas.model3dOps.views.${view}`)}
                        </span>
                        <Input.TextArea rows={2} value={prompts[view] || ""} placeholder={t("canvas.model3dOps.editMultiviewPlaceholder")} onChange={(event) => setPrompts((current) => ({ ...current, [view]: event.target.value }))} />
                    </div>
                ))}
            </div>
        </Modal>
    );
}
