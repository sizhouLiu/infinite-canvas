import { useEffect, useMemo, useState } from "react";
import { InputNumber, Modal, Segmented, Select, Switch } from "antd";
import { useTranslation } from "react-i18next";

import { model3dOpDefaults, model3dOpDefinition, model3dOpLabel, type Model3dOpId } from "./canvas-model3d-ops";
import { RETARGET_PRESETS, RIG_MODELS } from "@/services/api/model3d-ops";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

export type Model3dOpParams = Record<string, string | number | boolean>;

/**
 * One dialog for every follow-up operation; the fields come from the operation definition rather than a
 * separate panel per endpoint. Retarget is the one special case: its animation list depends on the rig
 * type the model was rigged with, so the options are computed here instead of being a static enum.
 */
export function CanvasModel3dOpDialog({ op, node, onCancel, onConfirm }: { op: Model3dOpId | null; node: CanvasNodeData | null; onCancel: () => void; onConfirm: (op: Model3dOpId, params: Model3dOpParams) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [params, setParams] = useState<Model3dOpParams>({});

    const animationOptions = useMemo(() => {
        const rigType = String(node?.metadata?.model3dRigType || "biped");
        const presets = RETARGET_PRESETS[rigType] || [];
        return presets.map((value) => ({ label: value.replace(/^preset:(?:[a-z]+:)?/, ""), value }));
    }, [node?.metadata?.model3dRigType]);

    useEffect(() => {
        if (!op) return;
        const defaults = model3dOpDefaults(op);
        // The animation enum is per rig type, so the first available preset becomes the default.
        setParams(op === "retarget" ? { ...defaults, animation: animationOptions[0]?.value || "" } : defaults);
    }, [op, animationOptions]);

    if (!op || !node) return null;

    const fields = model3dOpDefinition(op).fields;
    const missingAnimation = op === "retarget" && !params.animation;

    return (
        <Modal open title={model3dOpLabel(op)} okText={t("canvas.model3dOps.run")} cancelText={t("common.cancel")} okButtonProps={{ disabled: missingAnimation }} onCancel={onCancel} onOk={() => onConfirm(op, params)} width={420}>
            <div className="space-y-4 py-2">
                {fields.map((field) => {
                    const options = field.type === "select" ? (field.key === "animation" ? animationOptions : field.options) : [];
                    return (
                        <div key={field.key} className="flex items-center justify-between gap-4">
                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                {field.label}
                            </span>
                            {field.type === "switch" ? (
                                <Switch size="small" checked={Boolean(params[field.key])} onChange={(checked) => setParams((current) => ({ ...current, [field.key]: checked }))} />
                            ) : field.type === "number" ? (
                                <InputNumber
                                    size="small"
                                    min={field.min}
                                    max={field.max}
                                    placeholder={field.placeholder}
                                    value={typeof params[field.key] === "number" ? (params[field.key] as number) : null}
                                    onChange={(value) => setParams((current) => ({ ...current, [field.key]: value ?? "" }))}
                                    className="!w-40"
                                />
                            ) : options.length <= 3 ? (
                                <Segmented size="small" options={options} value={String(params[field.key] ?? "")} onChange={(value) => setParams((current) => ({ ...current, [field.key]: String(value) }))} />
                            ) : (
                                <Select size="small" options={options} value={String(params[field.key] ?? "")} onChange={(value) => setParams((current) => ({ ...current, [field.key]: value }))} className="!w-40" />
                            )}
                        </div>
                    );
                })}
                {op === "retarget" && !animationOptions.length ? (
                    <p className="text-xs" style={{ color: "#f87171" }}>
                        {t("canvas.model3dOps.noAnimationForRigType")}
                    </p>
                ) : null}
                {op === "rig" ? (
                    <p className="text-xs" style={{ color: theme.node.muted }}>
                        {t("canvas.model3dOps.rigModelHint", { model: RIG_MODELS[1] })}
                    </p>
                ) : null}
            </div>
        </Modal>
    );
}
