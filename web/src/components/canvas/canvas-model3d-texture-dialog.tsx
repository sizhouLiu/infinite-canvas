import { useEffect, useMemo, useState } from "react";
import { Modal, Select, Slider } from "antd";
import { useTranslation } from "react-i18next";

import { ALL_MATERIALS_SLOT, resolveTextureLineage, type TextureRole } from "@/lib/canvas/canvas-model3d-textures";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type RoleMaps = Partial<Record<TextureRole, string>>;
export type Model3dTextureSelection = { slots: Array<{ slot: number; maps: RoleMaps }>; metalness: number };

const ROLES: TextureRole[] = ["baseColor", "normal", "roughness", "ao"];

/**
 * Pick which canvas images become each texture's base color / normal / roughness / AO maps. A model can carry several
 * textures, so the rows are grouped per extracted texture; each role defaults to the newest image of that texture and
 * role, edits included. A model that was never extracted gets one group that applies to every material.
 */
export function CanvasModel3dTextureDialog({ node, nodes, connections, onCancel, onConfirm }: { node: CanvasNodeData | null; nodes: CanvasNodeData[]; connections: CanvasConnection[]; onCancel: () => void; onConfirm: (selection: Model3dTextureSelection) => void }) {
    const { t } = useTranslation();
    const images = useMemo(() => nodes.filter((item) => item.type === CanvasNodeType.Image && item.metadata?.content), [nodes]);
    const [groups, setGroups] = useState<Array<{ slot: number; label: string }>>([]);
    const [maps, setMaps] = useState<Record<number, RoleMaps>>({});
    const [metalness, setMetalness] = useState(0);

    useEffect(() => {
        if (!node) return;
        const lineage = resolveTextureLineage(nodes, connections);
        const owned = images.filter((item) => lineage.get(item.id)?.source === node.id);
        const slotOf = (id: string) => lineage.get(id)?.slot ?? ALL_MATERIALS_SLOT;
        const slots = [...new Set(owned.map((item) => slotOf(item.id)))].sort((a, b) => a - b);
        if (!slots.length) slots.push(ALL_MATERIALS_SLOT);
        setGroups(
            slots.map((slot) => {
                // The extracted image itself carries the material name in its title; edits are named after their prompt.
                const extracted = owned.find((item) => slotOf(item.id) === slot && item.metadata?.model3dTextureRole === "baseColor" && item.metadata?.model3dTextureSource === node.id);
                return { slot, label: slot === ALL_MATERIALS_SLOT ? t("canvas.model3dTextures.allMaterials") : extracted?.title || t("canvas.model3dTextures.slotLabel", { index: slot + 1 }) };
            }),
        );
        // Later nodes sit later in the array, so the last match is the newest edit of that map.
        setMaps(
            Object.fromEntries(
                slots.map((slot) => [slot, Object.fromEntries(ROLES.map((role) => [role, owned.filter((item) => slotOf(item.id) === slot && lineage.get(item.id)?.role === role).at(-1)?.id]).filter(([, id]) => id))]),
            ),
        );
        setMetalness(0);
        // Preselect once per open; recomputing on every canvas change would overwrite the user's picks.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node?.id]);

    const options = images.map((item) => ({ label: item.title || item.id, value: item.id }));
    const hasPick = Object.values(maps).some((roles) => Object.values(roles).some(Boolean));
    return (
        <Modal
            open={Boolean(node)}
            title={t("canvas.model3dTextures.applyTitle")}
            okText={t("canvas.model3dTextures.applyRun")}
            okButtonProps={{ disabled: !hasPick }}
            onCancel={onCancel}
            onOk={() => onConfirm({ slots: groups.map(({ slot }) => ({ slot, maps: maps[slot] || {} })), metalness })}
            destroyOnHidden
        >
            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
                <div className="text-xs opacity-70">{t("canvas.model3dTextures.applyHint")}</div>
                {groups.map(({ slot, label }) => (
                    <div key={slot} className="flex flex-col gap-2">
                        {groups.length > 1 ? <div className="text-sm font-medium">{label}</div> : null}
                        {ROLES.map((role) => (
                            <label key={role} className="flex items-center gap-3 text-sm">
                                <span className="w-24 shrink-0">{t(`canvas.model3dTextures.roles.${role}`)}</span>
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    className="flex-1"
                                    placeholder={t("canvas.model3dTextures.keepOriginal")}
                                    options={options}
                                    value={maps[slot]?.[role]}
                                    onChange={(value) => setMaps((prev) => ({ ...prev, [slot]: { ...prev[slot], [role]: value } }))}
                                />
                            </label>
                        ))}
                    </div>
                ))}
                <label className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0">{t("canvas.model3dTextures.metalness")}</span>
                    <Slider className="flex-1" min={0} max={1} step={0.05} value={metalness} onChange={setMetalness} />
                </label>
            </div>
        </Modal>
    );
}
