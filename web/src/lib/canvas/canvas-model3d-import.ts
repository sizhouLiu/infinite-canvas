// Import local model files as 3D nodes. GLB and FBX are stored as-is, since the viewer reads both. OBJ is converted
// to GLB here together with its .mtl and the textures that names: those are separate files a single stored blob could
// never reach again, while every downstream feature (viewer, re-skin, Tripo upload, Blender) already speaks GLB.
// three.js comes from the CDN on demand like the viewer, hence @vite-ignore.
import { toStandardMaterial } from "./canvas-model3d-textures";

const THREE_VERSION = "0.180.0";
let modulesPromise: Promise<[any, any, any, any]> | undefined;

function loadModules() {
    if (!modulesPromise) {
        const base = `https://esm.sh/three@${THREE_VERSION}`;
        modulesPromise = Promise.all([
            import(/* @vite-ignore */ base),
            import(/* @vite-ignore */ `${base}/examples/jsm/loaders/OBJLoader.js`),
            import(/* @vite-ignore */ `${base}/examples/jsm/loaders/MTLLoader.js`),
            import(/* @vite-ignore */ `${base}/examples/jsm/exporters/GLTFExporter.js`),
        ]) as Promise<[any, any, any, any]>;
    }
    return modulesPromise;
}

export const MODEL3D_IMPORT_ACCEPT = ".glb,.fbx,.obj,.mtl";

type Model3dFileKind = "glb" | "fbx" | "obj" | "mtl";

/** Browsers report an empty or unrelated type for these files, so the extension decides. */
export function model3dFileKind(file: File): Model3dFileKind | null {
    const ext = file.name.split(".").pop()?.toLowerCase();
    return ext === "glb" || ext === "fbx" || ext === "obj" || ext === "mtl" ? ext : null;
}

const baseName = (path: string) => (path.split(/[\\/]/).pop() || "").toLowerCase();

/** Texture file names an MTL refers to; the path is the last token, after options such as `-s 1 1 1`. */
function mtlTextureNames(text: string) {
    return [...text.matchAll(/^\s*(?:map_\w+|bump|disp|decal|refl|norm)\s+(.+)$/gim)].map((match) => baseName(match[1].trim().split(/\s+/).at(-1) || ""));
}

/**
 * Split an upload into model files, the resources they consume, and everything else. Images an MTL names belong to
 * the OBJ, so they must not also land on the canvas as separate image nodes.
 */
export async function splitModel3dFiles(files: File[]) {
    const models = files.filter((file) => ["glb", "fbx", "obj"].includes(model3dFileKind(file) || ""));
    const mtls = files.filter((file) => model3dFileKind(file) === "mtl");
    const hasObj = models.some((file) => model3dFileKind(file) === "obj");
    const names = new Set(hasObj ? (await Promise.all(mtls.map((file) => file.text()))).flatMap(mtlTextureNames) : []);
    const resources = hasObj ? [...mtls, ...files.filter((file) => file.type.startsWith("image/") && names.has(baseName(file.name)))] : [];
    const rest = files.filter((file) => !models.includes(file) && !resources.includes(file) && model3dFileKind(file) !== "mtl");
    return { models, resources, rest };
}

async function convertObj(file: File, resources: File[]) {
    const [THREE, { OBJLoader }, { MTLLoader }, { GLTFExporter }] = await loadModules();
    const text = await file.text();
    const urls = new Map(resources.map((resource) => [baseName(resource.name), URL.createObjectURL(resource)]));
    const missing = new Set<string>();
    const manager = new THREE.LoadingManager();
    // An MTL usually names textures by a path from the author's machine; only the file name can match the upload.
    manager.setURLModifier((url: string) => urls.get(baseName(url)) || url);
    manager.onError = (url: string) => missing.add(baseName(url));
    try {
        const loader = new OBJLoader(manager);
        const mtlName = /^\s*mtllib\s+(.+)$/im.exec(text)?.[1].trim();
        const mtlFiles = resources.filter((resource) => model3dFileKind(resource) === "mtl");
        const mtl = mtlFiles.find((resource) => mtlName && baseName(resource.name) === baseName(mtlName)) || mtlFiles[0];
        if (mtl) {
            let started = false;
            const loaded = new Promise<void>((resolve) => {
                manager.onStart = () => (started = true);
                manager.onLoad = () => resolve();
            });
            const materials = new MTLLoader(manager).parse(await mtl.text(), "");
            // Texture loads start synchronously here, so `started` tells whether there is anything to wait for.
            materials.preload();
            loader.setMaterials(materials);
            if (started) await loaded;
        }
        const root = loader.parse(text);
        // MTL yields Phong materials, which glTF cannot carry; Standard keeps the color and texture maps.
        root.traverse((child: any) => {
            if (child.isMesh) child.material = Array.isArray(child.material) ? child.material.map((material: any) => toStandardMaterial(THREE, material)) : toStandardMaterial(THREE, child.material);
        });
        const glb = await new GLTFExporter().parseAsync(root, { binary: true });
        return { blob: new Blob([glb as ArrayBuffer], { type: "model/gltf-binary" }), missing: [...missing] };
    } finally {
        urls.forEach((url) => URL.revokeObjectURL(url));
    }
}

/** The blob a 3D node stores for an imported file, plus any textures the OBJ's MTL named but the upload lacked. */
export async function prepareModel3dFile(file: File, resources: File[]): Promise<{ blob: Blob; missing: string[] }> {
    const kind = model3dFileKind(file);
    if (kind === "obj") return convertObj(file, resources);
    return { blob: new Blob([file], { type: kind === "fbx" ? "model/fbx" : "model/gltf-binary" }), missing: [] };
}
