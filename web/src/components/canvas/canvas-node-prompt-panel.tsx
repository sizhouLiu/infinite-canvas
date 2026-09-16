import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, Maximize2, Settings2, Square } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasNodeParameterRows } from "./canvas-node-parameter-rows";
import { buildGenerationConfig, type ParameterMetadata } from "@/lib/canvas/canvas-generation-helpers";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import { MULTIVIEW_VIEWS } from "@/services/api/model3d-ops";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    nodes: CanvasNodeData[];
    connectedNodes?: CanvasNodeData[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
    /** An upstream config node supplying this node's parameters, if any. */
    parameterSource?: { nodeId: string; title: string; parameters: ParameterMetadata };
    onFocusNode?: (nodeId: string) => void;
};

export function CanvasNodePromptPanel({ node, nodes, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], connectedNodes = [], onDisconnectReference, onStartReferenceSelection, modeOverride, parameterSource, onFocusNode }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const parametersOpen = useCanvasUiStore((state) => state.parameterRowsOpen);
    const setParametersOpen = useCanvasUiStore((state) => state.setParameterRowsOpen);
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildGenerationConfig(globalConfig, node, mode, parameterSource?.parameters);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    // Image-to-3D and multiview-to-3D take the upstream images alone, so 3D generation needs no prompt once an
    // image is connected — the request drops it anyway. The input is hidden rather than left there to be typed
    // into and silently ignored; every other mode still requires a prompt.
    const model3dImageCount = mode === "model3d" ? mentionReferences.filter((reference) => reference.kind === "image").length : 0;
    const promptOptional = model3dImageCount > 0;
    const model3dHint =
        model3dImageCount > MULTIVIEW_VIEWS.length
            ? t("canvas.promptPanel.model3dMultiviewTrimmedHint", { count: model3dImageCount, max: MULTIVIEW_VIEWS.length })
            : model3dImageCount > 1
              ? t("canvas.promptPanel.model3dMultiviewHint", { count: model3dImageCount })
              : t("canvas.promptPanel.model3dSingleImageHint");
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if ((!text && !promptOptional) || isRunning) return;
        onGenerate(node.id, mode, text);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={onStartReferenceSelection} />
            {promptOptional ? (
                <div className="flex h-40 w-full items-center justify-center rounded-xl px-4 text-center text-sm leading-5" style={{ color: theme.node.muted }}>
                    {model3dHint}
                </div>
            ) : (
                <CanvasPromptChipInput
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                    style={{ background: "transparent", color: theme.node.text }}
                    placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                />
            )}

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    {promptOptional ? null : (
                        <>
                            <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                                <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<Maximize2 className="size-3.5" />} onClick={openExpandedEditor} aria-label={t("canvas.promptPanel.expandEditor")} />
                            </Tooltip>
                            <CanvasPromptLibrary onSelect={updatePrompt} />
                        </>
                    )}
                    <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                    <Button
                        type="text"
                        className="!h-10 shrink-0 !rounded-full !px-3"
                        style={{ background: parametersOpen ? theme.toolbar.activeBg : theme.node.fill, color: theme.node.text }}
                        icon={<Settings2 className="size-3.5" />}
                        onClick={() => setParametersOpen(!parametersOpen)}
                    >
                        <span className="text-xs">{t("canvas.parameters.title")}</span>
                    </Button>
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim() && !promptOptional}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={t(isRunning ? "canvas.promptPanel.stopGeneration" : "canvas.promptPanel.generate")}
                >
                    <span className="flex items-center gap-1.5">
                        {isRunning ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span className="text-xs font-medium">{t("canvas.promptPanel.stop")}</span>
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
            {parametersOpen ? (
                <CanvasNodeParameterRows
                    mode={mode}
                    config={config}
                    textCount={node.metadata?.textCount}
                    onPatch={(patch) => onConfigChange(node.id, patch)}
                    inherited={parameterSource ? { title: parameterSource.title, onFocus: () => onFocusNode?.(parameterSource.nodeId), onDisconnect: () => onDisconnectReference?.(parameterSource.nodeId, node.id) } : undefined}
                />
            ) : null}
            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded && !promptOptional} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} />
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : type === CanvasNodeType.Model3d ? "model3d" : "image";
}
