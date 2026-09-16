import { Button, InputNumber } from "antd";
import { Link2Off, Crosshair } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { Model3dSettingsPanel } from "@/components/model3d-settings-panel";
import { TextSettingsPanel } from "@/components/text-settings-panel";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode, CanvasNodeMetadata } from "@/types/canvas";

type CanvasNodeParameterRowsProps = {
    mode: CanvasGenerationMode;
    config: AiConfig;
    textCount?: number;
    onPatch: (patch: Partial<CanvasNodeMetadata>) => void;
    /** Set when an upstream config node supplies these values; the rows then read as a preview of what will be sent. */
    inherited?: { title: string; onFocus: () => void; onDisconnect: () => void };
};

/**
 * The generation parameters laid out as rows, reusing the same panels the popovers use. Parameters that come from
 * an upstream config node are shown read-only rather than hidden: the values are still what the request will use,
 * but editing them here would be silently overridden on generate.
 */
export function CanvasNodeParameterRows({ mode, config, textCount, onPatch, inherited }: CanvasNodeParameterRowsProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="mt-3 border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
            {inherited ? (
                <div className="mb-3 flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px]" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                    <span className="min-w-0 flex-1 truncate">{t("canvas.parameters.inherited", { title: inherited.title })}</span>
                    <Button size="small" type="text" className="!h-6 !w-6 !min-w-6 !p-0" title={t("canvas.parameters.focusSource")} icon={<Crosshair className="size-3.5" />} onClick={inherited.onFocus} />
                    <Button size="small" type="text" className="!h-6 !w-6 !min-w-6 !p-0" title={t("canvas.parameters.disconnectSource")} icon={<Link2Off className="size-3.5" />} onClick={inherited.onDisconnect} />
                </div>
            ) : null}
            <div className={`thin-scrollbar max-h-[52dvh] overflow-y-auto pr-1${inherited ? " pointer-events-none opacity-60" : ""}`} aria-disabled={inherited ? true : undefined}>
                {mode === "image" ? (
                    <ImageSettingsPanel config={config} theme={theme} showTitle={false} className="space-y-4" onConfigChange={(key, value) => onPatch(key === "count" ? { count: Number(value) || 1 } : { [key]: value })} />
                ) : mode === "video" ? (
                    <VideoSettingsPanel config={config} theme={theme} showTitle={false} className="space-y-4" onConfigChange={(key, value) => onPatch(videoConfigPatch(key, value))} />
                ) : mode === "audio" ? (
                    <AudioSettingsPanel config={config} theme={theme} showTitle={false} className="space-y-4" onConfigChange={(key, value) => onPatch(audioConfigPatch(key, value))} />
                ) : mode === "model3d" ? (
                    <Model3dSettingsPanel config={config} theme={theme} showTitle={false} className="space-y-4" onConfigChange={(key, value) => onPatch({ [key]: value })} />
                ) : (
                    <>
                        <TextSettingsPanel config={config} theme={theme} className="space-y-4" onConfigChange={(_, value) => onPatch({ reasoningEffort: value })} />
                        <div className="mt-4 space-y-2.5">
                            <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.text.count")}
                            </div>
                            <InputNumber className="w-full" min={1} max={15} precision={0} value={textCount || 1} onChange={(value) => onPatch({ textCount: value || 1 })} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export function videoConfigPatch(key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode", value: string): Partial<CanvasNodeMetadata> {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

export function audioConfigPatch(key: "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions", value: string): Partial<CanvasNodeMetadata> {
    return { [key]: value };
}
