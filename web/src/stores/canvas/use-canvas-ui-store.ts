import { create } from "zustand";

/**
 * How many 3D nodes may hold a live WebGL context at once. Browsers cap concurrent contexts (Chrome around
 * 8-16) and start dropping the oldest past that, so this leaves room for the enlarged viewer and any plugin
 * that needs one. Four also matches the common case of comparing one four-view set.
 */
export const MODEL3D_LIVE_LIMIT = 4;

type CanvasUiStore = {
    editingProjectId: string | null;
    editingProjectTitle: string;
    selectedProjectIds: string[];
    deleteProjectIds: string[];
    /** Whether the node panel shows its parameter rows expanded; a per-session view preference, not canvas data. */
    parameterRowsOpen: boolean;
    setParameterRowsOpen: (open: boolean) => void;
    /**
     * 3D nodes currently allowed to render live, most recently activated first. Every live node costs a WebGL
     * context and a render loop, and browsers cap how many contexts may exist at once, so a canvas holding
     * twenty-odd 3D nodes shows saved thumbnails and only these few actually run. Session view state, not
     * canvas data. Node ids are unique, so an id left behind by another canvas can never hold a slot: it is
     * only ever pushed off the end by newer activations.
     */
    model3dLiveNodeIds: string[];
    activateModel3dNode: (nodeId: string) => void;
    deactivateModel3dNode: (nodeId: string) => void;
    startEditingProject: (id: string, title: string) => void;
    setEditingProjectTitle: (title: string) => void;
    stopEditingProject: () => void;
    toggleSelectedProjectId: (id: string, selected: boolean) => void;
    setDeleteProjectIds: (ids: string[]) => void;
    removeSelectedProjectIds: (ids: string[]) => void;
};

export const useCanvasUiStore = create<CanvasUiStore>((set) => ({
    editingProjectId: null,
    editingProjectTitle: "",
    selectedProjectIds: [],
    deleteProjectIds: [],
    parameterRowsOpen: true,
    setParameterRowsOpen: (parameterRowsOpen) => set({ parameterRowsOpen }),
    model3dLiveNodeIds: [],
    // Newly activated goes to the front, so a node the user just clicked is always live and it is the
    // least recently activated one that gives up its context.
    activateModel3dNode: (nodeId) => set((state) => ({ model3dLiveNodeIds: [nodeId, ...state.model3dLiveNodeIds.filter((id) => id !== nodeId)].slice(0, MODEL3D_LIVE_LIMIT) })),
    deactivateModel3dNode: (nodeId) => set((state) => ({ model3dLiveNodeIds: state.model3dLiveNodeIds.filter((id) => id !== nodeId) })),
    startEditingProject: (editingProjectId, editingProjectTitle) => set({ editingProjectId, editingProjectTitle }),
    setEditingProjectTitle: (editingProjectTitle) => set({ editingProjectTitle }),
    stopEditingProject: () => set({ editingProjectId: null }),
    toggleSelectedProjectId: (id, selected) => set((state) => ({ selectedProjectIds: selected ? [...new Set([...state.selectedProjectIds, id])] : state.selectedProjectIds.filter((item) => item !== id) })),
    setDeleteProjectIds: (deleteProjectIds) => set({ deleteProjectIds }),
    removeSelectedProjectIds: (ids) => set((state) => ({ selectedProjectIds: state.selectedProjectIds.filter((id) => !ids.includes(id)) })),
}));
