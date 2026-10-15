// Re-skin a 3D model locally: read each of its base color textures out as an image, derive normal / roughness / AO
// maps from an image, and write chosen maps back per texture into a re-exported glb. Nothing here calls Tripo, so it spends no
// credits. three.js comes from the CDN on demand like the viewer and part splitter, hence @vite-ignore.
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const THREE_VERSION = "0.180.0";
let modulesPromise: Promise<[any, any, any, any]> | undefined;

function loadModules() {
    if (!modulesPromise) {
        const base = `https://esm.sh/three@${THREE_VERSION}`;
        modulesPromise = Promise.all([
            import(/* @vite-ignore */ base),
            import(/* @vite-ignore */ `${base}/examples/jsm/loaders/GLTFLoader.js`),
            import(/* @vite-ignore */ `${base}/examples/jsm/loaders/FBXLoader.js`),
            import(/* @vite-ignore */ `${base}/examples/jsm/exporters/GLTFExporter.js`),
        ]) as Promise<[any, any, any, any]>;
    }
    return modulesPromise;
}

export type TextureRole = "baseColor" | "normal" | "roughness" | "ao";
export const PBR_MAP_ROLES = ["normal", "roughness", "ao"] as const;
export type PbrMapRole = (typeof PBR_MAP_ROLES)[number];
export type MaterialMaps = Partial<Record<TextureRole, Blob>>;

export type TextureLineage = Map<string, { source: string; role: TextureRole; slot?: number }>;

/**
 * Which model and map each image node belongs to. Tagged images (extracted or derived) seed the walk, and any
 * image reached downstream through connections inherits their tag, so an AI edit, mask edit or upload that grew
 * out of a texture counts as a newer version of it. An image carrying its own tag keeps it, which stops a base
 * color's derived normal map from being read as another base color.
 */
export function resolveTextureLineage(nodes: CanvasNodeData[], connections: CanvasConnection[]): TextureLineage {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const lineage: TextureLineage = new Map();
    const queue: string[] = [];
    for (const node of nodes) {
        const { model3dTextureSource: source, model3dTextureRole: role, model3dTextureSlot } = node.metadata || {};
        if (node.type === CanvasNodeType.Image && source && role) {
            lineage.set(node.id, { source, role, slot: Number.isFinite(Number(model3dTextureSlot)) ? Number(model3dTextureSlot) : undefined });
            queue.push(node.id);
        }
    }
    // Config nodes sit between an image and its edit, so the walk passes through them without tagging them.
    const carried = new Map(queue.map((id) => [id, lineage.get(id)!]));
    while (queue.length) {
        const id = queue.shift()!;
        const tag = carried.get(id)!;
        for (const connection of connections) {
            if (connection.fromNodeId !== id || carried.has(connection.toNodeId)) continue;
            const next = byId.get(connection.toNodeId);
            if (!next || next.type === CanvasNodeType.Model3d) continue;
            if (next.type === CanvasNodeType.Image && next.metadata?.model3dTextureRole) continue;
            carried.set(next.id, tag);
            if (next.type === CanvasNodeType.Image && next.metadata?.content) lineage.set(next.id, tag);
            queue.push(next.id);
        }
    }
    return lineage;
}

/** Prompts for the AI path. They insist on keeping every pixel in place, since the map must still line up with the UVs. */
export const PBR_MAP_PROMPTS: Record<PbrMapRole, string> = {
    normal: "Convert this texture into a tangent-space normal map (OpenGL convention, green channel up). Keep exactly the same layout, size and pixel positions; do not move, crop, add or remove anything. Output only the normal map.",
    roughness: "Convert this texture into a grayscale roughness map: white is rough, black is smooth or glossy. Keep exactly the same layout, size and pixel positions; do not move, crop, add or remove anything. Output only the roughness map.",
    ao: "Convert this texture into a grayscale ambient occlusion map: white is fully lit, dark areas are creases and contact shadows. Keep exactly the same layout, size and pixel positions; do not move, crop, add or remove anything. Output only the ambient occlusion map.",
};

function isFbx(url: string, mimeType?: string) {
    const mime = (mimeType || "").toLowerCase();
    if (mime.includes("fbx")) return true;
    if (mime.includes("gltf") || mime.includes("glb")) return false;
    return /\.fbx(?:[?#]|$)/i.test(url);
}

async function loadModel(url: string, mimeType?: string) {
    const [THREE, { GLTFLoader }, { FBXLoader }] = await loadModules();
    const fbx = isFbx(url, mimeType);
    const loaded = await new Promise<any>((resolve, reject) => (fbx ? new FBXLoader() : new GLTFLoader()).load(url, resolve, undefined, reject));
    // GLTFLoader returns a wrapper with `scene`; FBXLoader returns the Group itself.
    return { THREE, root: fbx ? loaded : loaded.scene, animations: loaded.animations || [], fbx };
}

const materialsOf = (material: any): any[] => (Array.isArray(material) ? material : material ? [material] : []);

function drawToCanvas(image: any, width?: number, height?: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width || image.naturalWidth || image.width;
    canvas.height = height || image.naturalHeight || image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

async function blobToCanvas(blob: Blob, width?: number, height?: number) {
    const bitmap = await createImageBitmap(blob);
    try {
        return drawToCanvas(bitmap, width, height);
    } finally {
        bitmap.close();
    }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode texture"))), "image/png"));
}

/** Material names joined per slot; empty when the model names none, so the caller can fall back to a number. */
function materialLabel(material: any) {
    return String(material?.name || "").trim();
}

/**
 * One PNG per unique base-color texture, in first-seen material order. A later apply uses that same order, so
 * each extracted image writes back onto the materials that originally used it rather than covering the whole model.
 */
export async function extractModel3dBaseColors(url: string, mimeType?: string) {
    const { root } = await loadModel(url, mimeType);
    const slots: Array<{ label: string; image: any }> = [];
    const seen = new Map<any, number>();
    root.traverse((child: any) => {
        if (!child.isMesh) return;
        for (const material of materialsOf(child.material)) {
            const image = material?.map?.image;
            if (!image) continue;
            const label = materialLabel(material);
            const existing = seen.get(image);
            if (existing !== undefined) {
                const slot = slots[existing];
                if (label && !slot.label.split(" / ").includes(label)) slot.label = slot.label ? `${slot.label} / ${label}` : label;
                continue;
            }
            seen.set(image, slots.length);
            slots.push({ label, image });
        }
    });
    return Promise.all(slots.map(async (slot, index) => ({ blob: await canvasToBlob(drawToCanvas(slot.image)), label: slot.label, slot: index })));
}

/** An AI result rarely keeps the source resolution, so it is scaled back onto the texture's exact size. */
export async function fitTextureToSize(blob: Blob, width: number, height: number) {
    return canvasToBlob(await blobToCanvas(blob, width, height));
}

/** Separable box blur via running sums, radius in pixels. */
function boxBlur(values: Float32Array, width: number, height: number, radius: number) {
    const temp = new Float32Array(values.length);
    const out = new Float32Array(values.length);
    const size = radius * 2 + 1;
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = -radius; x <= radius; x++) sum += values[y * width + Math.min(width - 1, Math.max(0, x))];
        for (let x = 0; x < width; x++) {
            temp[y * width + x] = sum / size;
            sum += values[y * width + Math.min(width - 1, x + radius + 1)] - values[y * width + Math.max(0, x - radius)];
        }
    }
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = -radius; y <= radius; y++) sum += temp[Math.min(height - 1, Math.max(0, y)) * width + x];
        for (let y = 0; y < height; y++) {
            out[y * width + x] = sum / size;
            sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
        }
    }
    return out;
}

/**
 * Approximate PBR maps from a color texture, treating luminance as height: Sobel gradients give the normal map,
 * darker areas read as rougher, and pixels darker than their blurred surroundings become occlusion. This is a
 * heuristic, not a material scan, but it stays pixel-aligned with the UVs, which an AI rewrite cannot promise.
 */
export async function derivePbrMaps(blob: Blob, strength = 2): Promise<Record<PbrMapRole, Blob>> {
    const source = await blobToCanvas(blob);
    const { width, height } = source;
    const pixels = source.getContext("2d")!.getImageData(0, 0, width, height).data;
    const raw = new Float32Array(width * height);
    for (let i = 0; i < raw.length; i++) raw[i] = (0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]) / 255;
    // A light blur keeps texel noise from turning into a field of tiny bumps.
    const lum = boxBlur(raw, width, height, 1);
    const wide = boxBlur(raw, width, height, Math.max(2, Math.round(Math.max(width, height) / 128)));

    const maps = Object.fromEntries(PBR_MAP_ROLES.map((role) => [role, new ImageData(width, height)])) as Record<PbrMapRole, ImageData>;
    const at = (x: number, y: number) => lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
            const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
            // Image rows grow downward while OpenGL normals point green-up, so the y gradient keeps its sign.
            const nx = -dx * strength;
            const ny = dy * strength;
            const length = Math.hypot(nx, ny, 1);
            const o = i * 4;
            maps.normal.data.set([((nx / length) * 0.5 + 0.5) * 255, ((ny / length) * 0.5 + 0.5) * 255, ((1 / length) * 0.5 + 0.5) * 255, 255], o);
            const rough = Math.min(1, Math.max(0, 0.35 + (1 - raw[i]) * 0.6)) * 255;
            maps.roughness.data.set([rough, rough, rough, 255], o);
            const ao = Math.min(1, Math.max(0, 1 - Math.max(0, wide[i] - raw[i]) * 2.5)) * 255;
            maps.ao.data.set([ao, ao, ao, 255], o);
        }
    }

    const entries = await Promise.all(
        PBR_MAP_ROLES.map(async (role) => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d")!.putImageData(maps[role], 0, 0);
            return [role, await canvasToBlob(canvas)] as const;
        }),
    );
    return Object.fromEntries(entries) as Record<PbrMapRole, Blob>;
}

/**
 * glTF packs occlusion, roughness and metalness into one texture (R / G / B). Roughness and AO maps are merged
 * here with a uniform metalness so the exporter writes a single valid metallicRoughness texture; a lone grayscale
 * roughness map would otherwise be read with its blue channel as metalness.
 */
async function buildOrmCanvas(roughness: Blob | undefined, ao: Blob | undefined, metalness: number) {
    const sizeSource = await blobToCanvas((roughness || ao)!);
    const { width, height } = sizeSource;
    const read = async (blob?: Blob) => (blob ? (await blobToCanvas(blob, width, height)).getContext("2d")!.getImageData(0, 0, width, height).data : null);
    const [roughData, aoData] = await Promise.all([read(roughness), read(ao)]);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    const out = context.createImageData(width, height);
    const metal = Math.round(Math.min(1, Math.max(0, metalness)) * 255);
    for (let i = 0; i < width * height; i++) {
        out.data.set([aoData ? aoData[i * 4] : 255, roughData ? roughData[i * 4] : 204, metal, 255], i * 4);
    }
    context.putImageData(out, 0, 0);
    return canvas;
}

export function toStandardMaterial(THREE: any, material: any) {
    if (material?.isMeshStandardMaterial) return material.clone();
    return new THREE.MeshStandardMaterial({
        name: material?.name || "",
        color: material?.color ? material.color.clone() : new THREE.Color(1, 1, 1),
        map: material?.map || null,
        normalMap: material?.normalMap || null,
        transparent: Boolean(material?.transparent),
        opacity: material?.opacity ?? 1,
        side: material?.side ?? THREE.FrontSide,
        alphaTest: material?.alphaTest ?? 0,
        vertexColors: Boolean(material?.vertexColors),
    });
}

export type MaterialSlotMaps = { slot: number; maps: MaterialMaps };

/** A slot that covers every material, used when maps were picked without extracting the model's textures first. */
export const ALL_MATERIALS_SLOT = -1;

/**
 * Write maps onto matching materials and re-export as glb, keeping skeletons and animation. Slot numbers follow
 * extract order (unique base-color textures, first-seen). Materials that share a texture share a slot, so one
 * image covers every mesh that originally used that texture. Unlisted slots stay as they were.
 */
export async function applyModel3dTextures(url: string, mimeType: string | undefined, slots: MaterialSlotMaps[], metalness: number) {
    const { THREE, root, animations, fbx } = await loadModel(url, mimeType);
    const [, , , { GLTFExporter }] = await loadModules();
    const bySlot = new Map(slots.map((item) => [item.slot, item.maps]));

    const images: any[] = [];
    const seen = new Map<any, number>();
    const materialSlot = new Map<any, number>();
    root.traverse((child: any) => {
        if (!child.isMesh) return;
        for (const material of materialsOf(child.material)) {
            const image = material?.map?.image;
            if (!image) continue;
            let slot = seen.get(image);
            if (slot === undefined) {
                slot = images.length;
                seen.set(image, slot);
                images.push(image);
            }
            materialSlot.set(material, slot);
        }
    });

    const prepared = new Map<number, { baseColor: any; normal: any; orm: any; ao: boolean }>();
    for (const [slot, maps] of bySlot) {
        // A group left empty in the dialog keeps its original material untouched.
        if (!Object.values(maps).some(Boolean)) continue;
        // New textures must be sampled the way the originals were, or the skin lands upside down on the UVs.
        let flipY = fbx;
        root.traverse((child: any) => {
            if (!child.isMesh) return;
            for (const material of materialsOf(child.material)) {
                if (materialSlot.get(material) !== slot) continue;
                if (material?.map) flipY = material.map.flipY;
            }
            // The all-materials slot has no own texture, so it borrows the orientation of any textured material.
            if (slot === ALL_MATERIALS_SLOT) {
                const map = materialsOf(child.material).find((material) => material?.map)?.map;
                if (map) flipY = map.flipY;
            }
        });
        const texture = (image: HTMLCanvasElement, srgb: boolean) => {
            const created = new THREE.CanvasTexture(image);
            created.flipY = flipY;
            created.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            return created;
        };
        prepared.set(slot, {
            baseColor: maps.baseColor ? texture(await blobToCanvas(maps.baseColor), true) : null,
            normal: maps.normal ? texture(await blobToCanvas(maps.normal), false) : null,
            orm: maps.roughness || maps.ao ? texture(await buildOrmCanvas(maps.roughness, maps.ao, metalness), false) : null,
            ao: Boolean(maps.ao),
        });
    }

    const replaced = new Map<any, any>();
    root.traverse((child: any) => {
        if (!child.isMesh) return;
        const next = materialsOf(child.material).map((material) => {
            const cached = replaced.get(material);
            if (cached) return cached;
            const slot = materialSlot.get(material);
            const maps = (slot === undefined ? undefined : prepared.get(slot)) || prepared.get(ALL_MATERIALS_SLOT);
            if (!maps) {
                replaced.set(material, material);
                return material;
            }
            const updated = toStandardMaterial(THREE, material);
            if (maps.baseColor) updated.map = maps.baseColor;
            if (maps.normal) {
                updated.normalMap = maps.normal;
                updated.normalScale = new THREE.Vector2(1, 1);
            }
            if (maps.orm) {
                updated.roughnessMap = maps.orm;
                updated.metalnessMap = maps.orm;
                updated.roughness = 1;
                updated.metalness = 1;
                if (maps.ao) updated.aoMap = maps.orm;
            } else {
                updated.metalness = metalness;
            }
            updated.needsUpdate = true;
            replaced.set(material, updated);
            return updated;
        });
        child.material = Array.isArray(child.material) ? next : next[0];
    });

    const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations, onlyVisible: false });
    return new Blob([glb as ArrayBuffer], { type: "model/gltf-binary" });
}
