import { COMPLETION_MODES, CONVERT_FORMATS, DECIMATE_MODELS, RIG_MODELS, RIG_OUT_FORMATS, RIG_SPECS, RIG_TYPES, SEGMENT_GRANULARITIES, SEGMENT_MODELS, TEXTURE_MODELS, TEXTURE_QUALITIES, type Model3dTaskKind } from "@/services/api/model3d-ops";
import i18n from "@/i18n";
import type { CanvasNodeData } from "@/types/canvas";

export type Model3dOpId = "texture" | "convert" | "rig" | "retarget" | "segment" | "complete" | "decimate" | "multiview";

/** One parameter row in the shared operation dialog. */
export type Model3dOpField =
    | { key: string; type: "select"; label: string; options: Array<{ label: string; value: string }>; defaultValue: string }
    | { key: string; type: "switch"; label: string; defaultValue: boolean }
    | { key: string; type: "number"; label: string; placeholder?: string; min?: number; max?: number; defaultValue?: number };

export type Model3dOpDefinition = {
    id: Model3dOpId;
    /** Operations that need a specific upstream task kind cannot fall back to uploading the model. */
    requiresTaskKind?: Model3dTaskKind;
    /** Conversion writes back to the source node; every other operation produces a new 3D node. */
    writesBack?: boolean;
    fields: Model3dOpField[];
};

const enumOptions = (values: string[], prefix?: string) => values.map((value) => ({ label: prefix ? i18n.t(`${prefix}.${value}`, { defaultValue: value }) : value, value }));

const OP_DEFINITIONS = (): Record<Model3dOpId, Model3dOpDefinition> => ({
    texture: {
        id: "texture",
        fields: [
            { key: "model", type: "select", label: i18n.t("canvas.model3dOps.fields.model"), options: enumOptions(TEXTURE_MODELS), defaultValue: TEXTURE_MODELS[0] },
            { key: "textureQuality", type: "select", label: i18n.t("canvas.model3dOps.fields.textureQuality"), options: enumOptions(TEXTURE_QUALITIES, "settingsPanels.model3d.qualities"), defaultValue: TEXTURE_QUALITIES[0] },
            { key: "pbr", type: "switch", label: i18n.t("canvas.model3dOps.fields.pbr"), defaultValue: true },
        ],
    },
    convert: {
        id: "convert",
        writesBack: true,
        fields: [
            { key: "format", type: "select", label: i18n.t("canvas.model3dOps.fields.format"), options: enumOptions(CONVERT_FORMATS), defaultValue: CONVERT_FORMATS[0] },
            { key: "quad", type: "switch", label: i18n.t("canvas.model3dOps.fields.quad"), defaultValue: false },
            { key: "faceLimit", type: "number", label: i18n.t("canvas.model3dOps.fields.faceLimit"), placeholder: i18n.t("settingsPanels.model3d.faceLimitAuto"), min: 1 },
        ],
    },
    rig: {
        id: "rig",
        fields: [
            { key: "model", type: "select", label: i18n.t("canvas.model3dOps.fields.model"), options: enumOptions(RIG_MODELS), defaultValue: RIG_MODELS[1] },
            { key: "rigType", type: "select", label: i18n.t("canvas.model3dOps.fields.rigType"), options: enumOptions(RIG_TYPES, "canvas.model3dOps.rigTypes"), defaultValue: RIG_TYPES[0] },
            { key: "spec", type: "select", label: i18n.t("canvas.model3dOps.fields.spec"), options: enumOptions(RIG_SPECS), defaultValue: RIG_SPECS[0] },
            { key: "outFormat", type: "select", label: i18n.t("canvas.model3dOps.fields.outFormat"), options: enumOptions(RIG_OUT_FORMATS), defaultValue: RIG_OUT_FORMATS[0] },
        ],
    },
    retarget: {
        // Tripo only accepts a rig task id here, so this chains off an in-canvas rig and nothing else.
        id: "retarget",
        requiresTaskKind: "rig",
        fields: [
            { key: "animation", type: "select", label: i18n.t("canvas.model3dOps.fields.animation"), options: [], defaultValue: "" },
            { key: "outFormat", type: "select", label: i18n.t("canvas.model3dOps.fields.outFormat"), options: enumOptions(RIG_OUT_FORMATS), defaultValue: RIG_OUT_FORMATS[0] },
            { key: "animateInPlace", type: "switch", label: i18n.t("canvas.model3dOps.fields.animateInPlace"), defaultValue: false },
        ],
    },
    segment: {
        id: "segment",
        fields: [
            { key: "model", type: "select", label: i18n.t("canvas.model3dOps.fields.model"), options: enumOptions(SEGMENT_MODELS), defaultValue: SEGMENT_MODELS[0] },
            { key: "granularity", type: "select", label: i18n.t("canvas.model3dOps.fields.granularity"), options: enumOptions(SEGMENT_GRANULARITIES, "canvas.model3dOps.granularities"), defaultValue: SEGMENT_GRANULARITIES[1] },
            { key: "splitByConnectivity", type: "switch", label: i18n.t("canvas.model3dOps.fields.splitByConnectivity"), defaultValue: true },
        ],
    },
    complete: {
        // Only a mesh/segment task can be completed; Tripo rejects any other input outright.
        id: "complete",
        requiresTaskKind: "segment",
        fields: [{ key: "completionMode", type: "select", label: i18n.t("canvas.model3dOps.fields.completionMode"), options: enumOptions(COMPLETION_MODES, "canvas.model3dOps.completionModes"), defaultValue: COMPLETION_MODES[0] }],
    },
    decimate: {
        id: "decimate",
        fields: [
            { key: "model", type: "select", label: i18n.t("canvas.model3dOps.fields.model"), options: enumOptions(DECIMATE_MODELS), defaultValue: DECIMATE_MODELS[0] },
            { key: "faceLimit", type: "number", label: i18n.t("canvas.model3dOps.fields.faceLimit"), placeholder: i18n.t("settingsPanels.model3d.faceLimitAuto"), min: 1 },
            { key: "quad", type: "switch", label: i18n.t("canvas.model3dOps.fields.quad"), defaultValue: false },
        ],
    },
    multiview: { id: "multiview", fields: [] },
});

/** Resolved per call so labels follow the active language. */
export function model3dOpDefinition(id: Model3dOpId) {
    return OP_DEFINITIONS()[id];
}

export function model3dOpLabel(id: Model3dOpId) {
    return i18n.t(`canvas.model3dOps.ops.${id}`);
}

/**
 * Why an operation is unavailable on this node, or null when it can run. Retarget and mesh completion
 * require a specific upstream task, so they are only offered on a node this canvas produced that way.
 */
export function model3dOpBlockedReason(id: Model3dOpId, node: CanvasNodeData) {
    const definition = model3dOpDefinition(id);
    if (!definition.requiresTaskKind) return null;
    if (node.metadata?.model3dTaskKind === definition.requiresTaskKind && node.metadata?.model3dSourceTaskId) return null;
    return i18n.t(`canvas.model3dOps.requires.${definition.requiresTaskKind}`);
}

export function model3dOpDefaults(id: Model3dOpId): Record<string, string | number | boolean> {
    return Object.fromEntries(
        model3dOpDefinition(id)
            .fields.filter((field) => field.defaultValue !== undefined)
            .map((field) => [field.key, field.defaultValue as string | number | boolean]),
    );
}
