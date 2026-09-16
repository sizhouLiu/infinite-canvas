import { type ReactNode } from "react";
import { Slider, Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { isModel3dFaceLimitAuto, MODEL3D_FACE_LIMIT_AUTO, MODEL3D_FACE_LIMIT_DEFAULT, MODEL3D_FACE_LIMIT_MAX, MODEL3D_FACE_LIMIT_MIN, MODEL3D_FACE_LIMIT_STEP, normalizeModel3dFaceLimitValue } from "@/lib/model3d-face-limit";
import { supportsModel3dQuad } from "@/services/api/model3d";
import type { AiConfig } from "@/stores/use-config-store";

export const model3dTextureQualityOptions = [
    { value: "standard", labelKey: "standard" },
    { value: "detailed", labelKey: "detailed" },
    { value: "extreme", labelKey: "extreme" },
];

export function normalizeModel3dTextureValue(value: string | undefined) {
    return value === "false" ? "false" : "true";
}

export function normalizeModel3dPbrValue(value: string | undefined) {
    return value === "false" ? "false" : "true";
}

/** Topology defaults to triangles, matching Tripo's own `quad: false` default. */
export function normalizeModel3dQuadValue(value: string | undefined) {
    return value === "true" ? "true" : "false";
}

export function normalizeModel3dTextureQualityValue(value: string | undefined) {
    return model3dTextureQualityOptions.some((item) => item.value === value) ? value! : "standard";
}

export function model3dTextureLabel(value: string | undefined) {
    return i18n.t(`settingsPanels.model3d.onOff.${normalizeModel3dTextureValue(value)}`);
}

export function model3dPbrLabel(value: string | undefined) {
    return i18n.t(`settingsPanels.model3d.onOff.${normalizeModel3dPbrValue(value)}`);
}

export function model3dQuadLabel(value: string | undefined) {
    return i18n.t(`settingsPanels.model3d.topologies.${normalizeModel3dQuadValue(value)}`);
}

export function model3dTextureQualityLabel(value: string | undefined) {
    return i18n.t(`settingsPanels.model3d.qualities.${normalizeModel3dTextureQualityValue(value)}`);
}

export function model3dFaceLimitLabel(value: string | undefined) {
    const limit = normalizeModel3dFaceLimitValue(value);
    return limit === MODEL3D_FACE_LIMIT_AUTO ? i18n.t("settingsPanels.model3d.faceLimitAuto") : limit;
}

type Model3dSettingKey = "model3dTexture" | "model3dPbr" | "model3dTextureQuality" | "model3dFaceLimit" | "model3dQuad";

type Model3dSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: Model3dSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function Model3dSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: Model3dSettingsPanelProps) {
    const { t } = useTranslation();
    const texture = normalizeModel3dTextureValue(config.model3dTexture);
    const pbr = normalizeModel3dPbrValue(config.model3dPbr);
    const textureQuality = normalizeModel3dTextureQualityValue(config.model3dTextureQuality);
    // Quad is only accepted by P2 and H-series v3.0+, so the row is hidden rather than offered and rejected.
    const quadAvailable = supportsModel3dQuad(config.model || config.model3dModel);
    const quad = normalizeModel3dQuadValue(config.model3dQuad);
    // An empty face limit means auto: no face_limit is sent and Tripo picks the count.
    const faceLimitAuto = isModel3dFaceLimitAuto(config.model3dFaceLimit);
    const faceLimit = faceLimitAuto ? MODEL3D_FACE_LIMIT_DEFAULT : Number(normalizeModel3dFaceLimitValue(config.model3dFaceLimit));

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.model3d.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.model3d.texture")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {(["true", "false"] as const).map((value) => (
                            <OptionPill key={value} selected={texture === value} theme={theme} onClick={() => onConfigChange("model3dTexture", value)}>
                                {t(`settingsPanels.model3d.onOff.${value}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.model3d.pbr")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {(["true", "false"] as const).map((value) => (
                            <OptionPill key={value} selected={pbr === value} theme={theme} onClick={() => onConfigChange("model3dPbr", value)}>
                                {t(`settingsPanels.model3d.onOff.${value}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.model3d.textureQuality")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {model3dTextureQualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={textureQuality === item.value} theme={theme} onClick={() => onConfigChange("model3dTextureQuality", item.value)}>
                                {t(`settingsPanels.model3d.qualities.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                {quadAvailable ? (
                    <SettingGroup title={t("settingsPanels.model3d.topology")} color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2.5">
                            {(["false", "true"] as const).map((value) => (
                                <OptionPill key={value} selected={quad === value} theme={theme} onClick={() => onConfigChange("model3dQuad", value)}>
                                    {t(`settingsPanels.model3d.topologies.${value}`)}
                                </OptionPill>
                            ))}
                        </div>
                        {quad === "true" ? (
                            <p className="text-xs" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.model3d.quadHint")}
                            </p>
                        ) : null}
                    </SettingGroup>
                ) : null}
                <SettingGroup title={t("settingsPanels.model3d.faceLimit")} color={theme.node.muted}>
                    <div className="flex items-center justify-between gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {t("settingsPanels.model3d.faceLimitAuto")}
                        </span>
                        <Switch size="small" checked={faceLimitAuto} onChange={(checked) => onConfigChange("model3dFaceLimit", checked ? MODEL3D_FACE_LIMIT_AUTO : String(MODEL3D_FACE_LIMIT_DEFAULT))} />
                    </div>
                    {faceLimitAuto ? null : (
                        <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                            <Slider
                                className="min-w-0 flex-1"
                                min={MODEL3D_FACE_LIMIT_MIN}
                                max={MODEL3D_FACE_LIMIT_MAX}
                                step={MODEL3D_FACE_LIMIT_STEP}
                                value={faceLimit}
                                onChange={(value) => onConfigChange("model3dFaceLimit", String(Array.isArray(value) ? value[0] : value))}
                            />
                            <FaceLimitInput value={faceLimit} theme={theme} onCommit={(value) => onConfigChange("model3dFaceLimit", String(value))} />
                        </div>
                    )}
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function FaceLimitInput({ value, theme, onCommit }: { value: number; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const normalized = normalizeModel3dFaceLimitValue(input.value);
        const next = normalized === MODEL3D_FACE_LIMIT_AUTO ? MODEL3D_FACE_LIMIT_DEFAULT : Number(normalized);
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[82px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={MODEL3D_FACE_LIMIT_MIN}
                max={MODEL3D_FACE_LIMIT_MAX}
                step={MODEL3D_FACE_LIMIT_STEP}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
