import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";

/**
 * Generation history: what was asked for, which task served it, and where the result landed.
 *
 * Records hold metadata only — never blobs — so the store rides along in the existing `app_state` bucket.
 * A result's `storageKey` is a pointer, not a copy: the file GC only keeps blobs referenced by canvas nodes
 * and saved assets, so deleting the node eventually clears the file and the record is left as a receipt of
 * what ran (task id, prompt, model) rather than a way to get the file back.
 */
export type GenerationHistoryKind = "image" | "video" | "audio" | "model3d" | "multiview" | "model3dOp";
export type GenerationHistoryStatus = "running" | "success" | "error";

export type GenerationHistoryRecord = {
    id: string;
    createdAt: string;
    updatedAt: string;
    projectId: string;
    /** The node the result was written to; it may since have been deleted. */
    nodeId: string;
    kind: GenerationHistoryKind;
    title: string;
    status: GenerationHistoryStatus;
    prompt?: string;
    model?: string;
    /** Which 3D operation produced this, for the model3dOp kind. */
    op?: string;
    /** The provider-side task id, recorded as soon as the task exists so it survives losing the node. */
    taskId?: string;
    storageKey?: string;
    previewKey?: string;
    mimeType?: string;
    error?: string;
};

export type GenerationHistoryInput = Omit<GenerationHistoryRecord, "id" | "createdAt" | "updatedAt" | "status"> & { status?: GenerationHistoryStatus };

type GenerationHistoryStore = {
    hydrated: boolean;
    records: GenerationHistoryRecord[];
    /** Open a record when the request starts, so an interrupted run still leaves its task id behind. */
    startRecord: (input: GenerationHistoryInput) => string;
    updateRecord: (id: string, patch: Partial<Omit<GenerationHistoryRecord, "id" | "createdAt" | "projectId">>) => void;
    finishRecord: (id: string, patch?: Partial<Omit<GenerationHistoryRecord, "id" | "createdAt" | "projectId" | "status">>) => void;
    failRecord: (id: string, error: string) => void;
    /** Close out the record a resumed task belongs to, so a run interrupted by a reload does not stay "running". */
    resolveByTaskId: (taskId: string, patch: Partial<Omit<GenerationHistoryRecord, "id" | "createdAt" | "projectId">>) => void;
    removeRecords: (ids: string[]) => void;
    clearProject: (projectId: string) => void;
};

const HISTORY_STORE_KEY = "infinite-canvas:generation_history";

const historyStorage: PersistStorage<GenerationHistoryStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        return value ? (JSON.parse(value) as StorageValue<GenerationHistoryStore>) : null;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useGenerationHistoryStore = create<GenerationHistoryStore>()(
    persist(
        (set) => ({
            hydrated: false,
            records: [],
            startRecord: (input) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ records: [{ status: "running", ...input, id, createdAt: now, updatedAt: now }, ...state.records] }));
                return id;
            },
            updateRecord: (id, patch) =>
                set((state) => ({
                    records: state.records.map((record) => (record.id === id ? { ...record, ...patch, updatedAt: new Date().toISOString() } : record)),
                })),
            finishRecord: (id, patch) =>
                set((state) => ({
                    records: state.records.map((record) => (record.id === id ? { ...record, ...patch, status: "success" as const, updatedAt: new Date().toISOString() } : record)),
                })),
            failRecord: (id, error) =>
                set((state) => ({
                    records: state.records.map((record) => (record.id === id ? { ...record, status: "error" as const, error, updatedAt: new Date().toISOString() } : record)),
                })),
            resolveByTaskId: (taskId, patch) =>
                set((state) => {
                    const target = state.records.find((record) => record.taskId === taskId && record.status === "running");
                    if (!target) return state;
                    return { records: state.records.map((record) => (record.id === target.id ? { ...record, ...patch, updatedAt: new Date().toISOString() } : record)) };
                }),
            removeRecords: (ids) => set((state) => ({ records: state.records.filter((record) => !ids.includes(record.id)) })),
            clearProject: (projectId) => set((state) => ({ records: state.records.filter((record) => record.projectId !== projectId) })),
        }),
        {
            name: HISTORY_STORE_KEY,
            storage: historyStorage,
            partialize: (state) => ({ records: state.records }) as StorageValue<GenerationHistoryStore>["state"],
            onRehydrateStorage: () => () => {
                useGenerationHistoryStore.setState({ hydrated: true });
            },
        },
    ),
);
