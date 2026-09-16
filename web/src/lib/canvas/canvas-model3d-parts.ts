// Split a segmented 3D model into one file per part. Tripo's /mesh/segment returns a single glb whose meshes
// carry the part names it found (face, hair, body, …) rather than separate downloads, so the split happens
// here: the glb is parsed, its meshes grouped by name, and each group re-exported as its own glb.
//
// three.js and its loader/exporter come from the CDN on demand, matching the viewer, so the app bundle stays
// free of a 3D dependency. Vite must not resolve these at build time, hence @vite-ignore.
const THREE_VERSION = "0.180.0";
let modulesPromise: Promise<[any, any, any]> | undefined;

function loadModules() {
    if (!modulesPromise) {
        const base = `https://esm.sh/three@${THREE_VERSION}`;
        modulesPromise = Promise.all([import(/* @vite-ignore */ base), import(/* @vite-ignore */ `${base}/examples/jsm/loaders/GLTFLoader.js`), import(/* @vite-ignore */ `${base}/examples/jsm/exporters/GLTFExporter.js`)]) as Promise<[any, any, any]>;
    }
    return modulesPromise;
}

export type Model3dPart = { name: string; blob: Blob; meshCount: number };

/**
 * Group name for a mesh. Tripo's semantic segmentation names its meshes after the part, but the names carry
 * per-piece suffixes (`hair_1`, `hair.001`, `Hair_2`) that would otherwise scatter one part across several
 * nodes, so a trailing index is stripped and the rest is matched case-insensitively.
 */
function partKey(name: string) {
    const trimmed = (name || "").trim();
    if (!trimmed) return "";
    return trimmed
        .replace(/[._-]\d+$/, "")
        .replace(/\s+\d+$/, "")
        .toLowerCase();
}

/** A readable label for a part, taken from the first mesh that landed in the group. */
function partLabel(name: string) {
    const stripped = (name || "")
        .trim()
        .replace(/[._-]\d+$/, "")
        .replace(/\s+\d+$/, "");
    return stripped || name;
}

/**
 * Split the model at `url` into its parts.
 *
 * Returns null when the model has fewer than two distinct part names — an unsegmented model is a single mesh
 * (or a set of unnamed ones), and splitting it would just re-export the whole thing under a made-up name.
 * The caller reports that as "nothing to split" rather than creating one pointless node.
 */
export async function splitModel3dParts(url: string, signal?: AbortSignal): Promise<Model3dPart[] | null> {
    const [THREE, { GLTFLoader }, { GLTFExporter }] = await loadModules();
    const gltf = await new Promise<any>((resolve, reject) => {
        new GLTFLoader().load(url, resolve, undefined, reject);
    });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // Meshes are collected per part before anything is moved, because reparenting during a traverse would
    // mutate the tree being walked.
    const groups = new Map<string, { label: string; meshes: any[] }>();
    gltf.scene.traverse((child: any) => {
        if (!child.isMesh) return;
        const key = partKey(child.name);
        if (!key) return;
        const group = groups.get(key);
        if (group) group.meshes.push(child);
        else groups.set(key, { label: partLabel(child.name), meshes: [child] });
    });
    if (groups.size < 2) return null;

    const parts: Model3dPart[] = [];
    for (const group of groups.values()) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        // Each part is exported from a scene of clones, so the source tree keeps its meshes and the next
        // part still finds them. World transforms are baked in so a part sits where it did in the whole.
        const scene = new THREE.Scene();
        scene.name = group.label;
        for (const mesh of group.meshes) {
            mesh.updateWorldMatrix(true, false);
            const clone = mesh.clone();
            clone.applyMatrix4(mesh.matrixWorld);
            clone.matrixAutoUpdate = true;
            scene.add(clone);
        }
        const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
            new GLTFExporter().parse(scene, (result: any) => resolve(result as ArrayBuffer), reject, { binary: true });
        });
        parts.push({ name: group.label, blob: new Blob([glb], { type: "model/gltf-binary" }), meshCount: group.meshes.length });
    }
    return parts;
}
