import { useEffect, useRef, useState } from "react";
import { Bone, Grid3x3, Package, Pause, Play, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasTheme } from "@/lib/canvas-theme";

// three.js is loaded from a CDN on demand so the app bundle stays free of a 3D dependency,
// matching the panorama plugin. Vite must not resolve these at build time, hence @vite-ignore.
const THREE_VERSION = "0.180.0";
let threePromise: Promise<[any, any, any]> | undefined;
let fbxPromise: Promise<any> | undefined;

function threeBase() {
    return `https://esm.sh/three@${THREE_VERSION}`;
}

function loadThree() {
    if (!threePromise) {
        const base = threeBase();
        threePromise = Promise.all([import(/* @vite-ignore */ base), import(/* @vite-ignore */ `${base}/examples/jsm/loaders/GLTFLoader.js`), import(/* @vite-ignore */ `${base}/examples/jsm/controls/OrbitControls.js`)]) as Promise<[any, any, any]>;
    }
    return threePromise;
}

/** FBX pulls in its own parser, so it is fetched only for a model that actually needs it. */
function loadFbxLoader() {
    if (!fbxPromise) fbxPromise = import(/* @vite-ignore */ `${threeBase()}/examples/jsm/loaders/FBXLoader.js`).then((module: any) => module.FBXLoader);
    return fbxPromise;
}

/**
 * H-series quad output and rig/retarget results with `out_format: fbx` are FBX, not glb, so the format is
 * chosen from the mime type and the URL. Blob URLs carry no extension, hence the mime type comes first.
 */
function isFbxSource(src: string, mimeType?: string) {
    const mime = (mimeType || "").toLowerCase();
    if (mime.includes("fbx")) return true;
    if (mime.includes("gltf") || mime.includes("glb")) return false;
    return /\.fbx(?:[?#]|$)/i.test(src);
}

/** Inspection modes: the shaded original, the untextured form, its topology, and the rig. */
export const MODEL3D_MODES = ["shaded", "clay", "claywire", "wireframe", "skeleton"] as const;
export type Model3dViewerMode = (typeof MODEL3D_MODES)[number];

const MODE_ICONS: Record<Model3dViewerMode, typeof Bone> = { shaded: Package, clay: Package, claywire: Grid3x3, wireframe: Grid3x3, skeleton: Bone };

/** Wire overlay colors: bright cyan reads on the dark wireframe ground, dark slate on the light clay. */
const WIRE_STYLE: Record<"wireframe" | "claywire", { color: number; opacity: number }> = {
    wireframe: { color: 0x22d3ee, opacity: 0.6 },
    claywire: { color: 0x1e293b, opacity: 0.45 },
};

/** A matcap sphere shading the untextured model in neutral grey, so only its form and topology read. */
function createClayMatcap(THREE: any) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(size * 0.35, size * 0.35, size * 0.05, size * 0.5, size * 0.5, size * 0.6);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.5, "#c8c8cc");
    gradient.addColorStop(1, "#6b6b73");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/**
 * Recover quad edges from a triangulated mesh. Tripo's quad output is real quads in the FBX, but both glTF and
 * FBX arrive here triangulated, so every quad shows up as two triangles plus the diagonal that split it. An edge
 * is treated as such a diagonal when it is shared by exactly two triangles and is the longest edge of both —
 * splitting a quad always cuts corner to corner, so the diagonal outruns the four sides it was drawn between.
 *
 * The heuristic is deliberately conservative: a genuine triangle whose longest edge happens to be shared with a
 * neighbour of the same shape can lose that edge, and a very skewed quad can keep its diagonal. It reads the
 * topology far better than drawing every triangle edge, which is what the quad setting is there to avoid.
 */
function createQuadEdgeGeometry(THREE: any, geometry: any) {
    const position = geometry.getAttribute("position");
    if (!position) return null;
    const index = geometry.getIndex();
    const triangleCount = Math.floor((index ? index.count : position.count) / 3);
    if (!triangleCount) return null;
    const vertexOf = (slot: number) => (index ? index.getX(slot) : slot);
    const edgeKey = (a: number, b: number) => (a < b ? a * position.count + b : b * position.count + a);
    const lengthSquared = (a: number, b: number) => {
        const dx = position.getX(a) - position.getX(b);
        const dy = position.getY(a) - position.getY(b);
        const dz = position.getZ(a) - position.getZ(b);
        return dx * dx + dy * dy + dz * dz;
    };

    // Per edge: how many triangles use it, and whether it was the longest edge of every one of them.
    const uses = new Map<number, { a: number; b: number; count: number; longestInAll: boolean }>();
    for (let triangle = 0; triangle < triangleCount; triangle++) {
        const corners = [vertexOf(triangle * 3), vertexOf(triangle * 3 + 1), vertexOf(triangle * 3 + 2)];
        const edges: Array<[number, number]> = [
            [corners[0], corners[1]],
            [corners[1], corners[2]],
            [corners[2], corners[0]],
        ];
        const lengths = edges.map(([a, b]) => lengthSquared(a, b));
        const longest = Math.max(...lengths);
        edges.forEach(([a, b], slot) => {
            if (a === b) return;
            const key = edgeKey(a, b);
            const entry = uses.get(key);
            const isLongest = lengths[slot] === longest;
            if (entry) {
                entry.count++;
                entry.longestInAll = entry.longestInAll && isLongest;
            } else uses.set(key, { a, b, count: 1, longestInAll: isLongest });
        });
    }

    // Two triangles per quad means a real quad mesh drops close to a third of its edges. A mesh of near-equilateral
    // triangles instead ties on "longest" everywhere and would drop nearly all of them, leaving an empty overlay —
    // measured at 100% on a regular octahedron. Past this ratio the result is not trustworthy, so the caller falls
    // back to the plain triangle wireframe rather than showing almost no lines.
    const MAX_DROP_RATIO = 0.5;
    const diagonals: Array<{ a: number; b: number }> = [];
    const keep: Array<{ a: number; b: number }> = [];
    for (const edge of uses.values()) (edge.count === 2 && edge.longestInAll ? diagonals : keep).push(edge);
    if (!keep.length || diagonals.length / uses.size > MAX_DROP_RATIO) return null;

    const points: number[] = [];
    for (const edge of keep) points.push(position.getX(edge.a), position.getY(edge.a), position.getZ(edge.a), position.getX(edge.b), position.getY(edge.b), position.getZ(edge.b));
    const wire = new THREE.BufferGeometry();
    wire.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return wire;
}

/**
 * The wire overlay must share the original vertex pipeline, or skinned and morph animation will not carry it.
 * Building a separate LineSegments from WireframeGeometry copies only `position` — dropping skinIndex and
 * skinWeight — and three only enables skinning in the vertex shader for an isSkinnedMesh, so the wireframe
 * would sit frozen in bind pose while the model moves.
 */
function createWireOverlay(THREE: any, mesh: any, style: { color: number; opacity: number }, quadEdges: boolean) {
    // Quad edges live in their own line geometry, which cannot carry skinning — three has no skinned line type,
    // so an animating rig would drag the mesh out from under a wireframe frozen in bind pose. Topology fidelity
    // is therefore given up for exactly that case, and the shared-pipeline triangle wireframe is used instead.
    if (quadEdges) {
        const wireGeometry = createQuadEdgeGeometry(THREE, mesh.geometry);
        if (wireGeometry) {
            const lines = new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity }));
            lines.userData.isWireOverlay = true;
            // Unlike the shared-geometry overlay below, this geometry is its own and must be disposed with it.
            lines.userData.ownsGeometry = true;
            return lines;
        }
    }
    const material = new THREE.MeshBasicMaterial({ color: style.color, wireframe: true, transparent: true, opacity: style.opacity });
    const overlay = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, material) : new THREE.Mesh(mesh.geometry, material);
    if (mesh.isSkinnedMesh) {
        // Sharing skeleton and bindMatrix: as a child its local transform is identity, so matrixWorld matches
        // the parent and bindMatrixInverse cancels the parent transform out rather than applying it twice.
        overlay.bindMode = mesh.bindMode;
        overlay.bind(mesh.skeleton, mesh.bindMatrix);
    }
    // The mixer writes morph influences into the original array in place, so sharing the reference follows it.
    if (mesh.morphTargetInfluences) {
        overlay.morphTargetInfluences = mesh.morphTargetInfluences;
        overlay.morphTargetDictionary = mesh.morphTargetDictionary;
    }
    overlay.castShadow = false;
    overlay.receiveShadow = false;
    overlay.userData.isWireOverlay = true;
    return overlay;
}

/** Remove the overlay. Shared geometry belongs to the mesh; only a quad-edge overlay owns its own. */
function removeWireOverlay(mesh: any) {
    const existing = mesh.children.find((child: any) => child.userData?.isWireOverlay);
    if (!existing) return;
    const material = existing.material;
    for (const item of Array.isArray(material) ? material : [material]) item?.dispose?.();
    if (existing.userData?.ownsGeometry) existing.geometry?.dispose?.();
    mesh.remove(existing);
}

type Model3dViewerProps = {
    src: string;
    poster?: string;
    theme: CanvasTheme;
    interactive: boolean;
    /** Distinguishes an FBX payload from glb; blob URLs have no extension to go by. */
    mimeType?: string;
    /** Set when the model was generated with quad topology, so the wireframe can hide triangulation edges. */
    quad?: boolean;
    /** Mode and animation controls; off on the canvas node, where there is no room for them. */
    showControls?: boolean;
};

export function CanvasModel3dViewer({ src, poster, theme, interactive, mimeType, quad = false, showControls = false }: Model3dViewerProps) {
    const { t } = useTranslation();
    const mountRef = useRef<HTMLDivElement>(null);
    const controlsRef = useRef<any>(null);
    const applyModeRef = useRef<((mode: Model3dViewerMode) => void) | null>(null);
    const mixerRef = useRef<any>(null);
    const actionsRef = useRef<any[]>([]);
    const resetCameraRef = useRef<(() => void) | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [mode, setMode] = useState<Model3dViewerMode>("shaded");
    const [boneCount, setBoneCount] = useState(0);
    const [clipNames, setClipNames] = useState<string[]>([]);
    const [activeClip, setActiveClip] = useState(0);
    const [playing, setPlaying] = useState(true);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !src) return;
        let disposed = false;
        let frame = 0;
        let renderer: any = null;
        let controls: any = null;
        let scene: any = null;
        let resizeObserver: ResizeObserver | null = null;

        setStatus("loading");
        setBoneCount(0);
        setClipNames([]);
        setActiveClip(0);
        setPlaying(true);
        loadThree()
            .then(([THREE, { GLTFLoader }, { OrbitControls }]) => {
                if (disposed) return;
                scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
                renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                renderer.outputColorSpace = THREE.SRGBColorSpace;
                const canvas: HTMLCanvasElement = renderer.domElement;
                canvas.style.width = "100%";
                canvas.style.height = "100%";
                canvas.style.display = "block";
                mount.appendChild(canvas);

                scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
                const key = new THREE.DirectionalLight(0xffffff, 1.4);
                key.position.set(3, 6, 4);
                scene.add(key);

                controls = new OrbitControls(camera, canvas);
                controls.enableDamping = true;
                // Right-drag (or two-finger drag) moves the model within the frame; screen-space panning keeps it
                // following the pointer regardless of how far the camera has been orbited.
                controls.enablePan = true;
                controls.screenSpacePanning = true;
                controls.enabled = interactive;
                controlsRef.current = controls;

                const resize = () => {
                    const { clientWidth, clientHeight } = mount;
                    if (!clientWidth || !clientHeight) return;
                    renderer.setSize(clientWidth, clientHeight, false);
                    camera.aspect = clientWidth / clientHeight;
                    camera.updateProjectionMatrix();
                };
                resizeObserver = new ResizeObserver(resize);
                resizeObserver.observe(mount);
                resize();

                const onLoaded = (loaded: any) => {
                    if (disposed) return;
                    // GLTFLoader returns a wrapper with `scene`; FBXLoader returns the Group itself.
                    const model = loaded.scene || loaded;
                    // Center the model and pull the camera back far enough to frame its bounding sphere.
                    const box = new THREE.Box3().setFromObject(model);
                    const sphere = box.getBoundingSphere(new THREE.Sphere());
                    model.position.sub(sphere.center);
                    scene.add(model);
                    const distance = (sphere.radius || 1) / Math.sin((camera.fov * Math.PI) / 360);
                    // Looking down the X axis: level with the model, no elevation. The 1.2 keeps the same framing
                    // margin the previous 3/4 angle had, so the model does not suddenly fill the frame edge to edge.
                    const home = new THREE.Vector3(distance * 1.2, 0, 0);
                    camera.position.copy(home);
                    camera.lookAt(0, 0, 0);
                    controls.target.set(0, 0, 0);
                    controls.update();
                    resetCameraRef.current = () => {
                        camera.position.copy(home);
                        controls.target.set(0, 0, 0);
                        controls.update();
                    };

                    // Keep the shipped materials so the shaded mode can be restored after a mode switch.
                    const originalMaterials = new Map<string, any>();
                    model.traverse((child: any) => {
                        if (child.isMesh) originalMaterials.set(child.uuid, child.material);
                    });

                    let bones = 0;
                    model.traverse((child: any) => {
                        if (child.isBone) bones++;
                    });
                    setBoneCount(bones);

                    // Only build the helper for a model that has bones; otherwise its geometry is empty
                    // and it draws nothing at all.
                    let skeletonHelper: any = null;
                    if (bones > 0) {
                        skeletonHelper = new THREE.SkeletonHelper(model);
                        skeletonHelper.visible = false;
                        skeletonHelper.material.color = new THREE.Color(0xfacc15);
                        scene.add(skeletonHelper);
                    }

                    const clips: any[] = loaded.animations?.length ? loaded.animations : model.animations || [];
                    if (clips.length) {
                        const mixer = new THREE.AnimationMixer(model);
                        mixerRef.current = mixer;
                        actionsRef.current = clips.map((clip: any) => mixer.clipAction(clip));
                        actionsRef.current[0]?.play();
                        setClipNames(clips.map((clip: any, index: number) => clip.name || `${t("canvas.model3d.clip")} ${index + 1}`));
                    }

                    const clayMatcap = createClayMatcap(THREE);
                    const applyMode = (targetMode: Model3dViewerMode) => {
                        if (skeletonHelper) {
                            skeletonHelper.visible = targetMode === "skeleton";
                            // Draw the rig on top of the mesh so it is not hidden inside it (x-ray).
                            skeletonHelper.material.depthTest = targetMode !== "skeleton";
                            skeletonHelper.material.needsUpdate = true;
                        }
                        model.traverse((child: any) => {
                            if (!child.isMesh) return;
                            // The overlay is a Mesh too, and traverse reads children after the callback,
                            // so without this it would get an overlay of its own, recursively.
                            if (child.userData?.isWireOverlay) return;
                            removeWireOverlay(child);
                            if (targetMode === "wireframe" || targetMode === "claywire") child.add(createWireOverlay(THREE, child, WIRE_STYLE[targetMode], quad && bones === 0));

                            if (targetMode === "wireframe") {
                                // Pure wireframe: keep the surface barely visible rather than hidden, or
                                // the lines on the far side show through.
                                child.material = new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.05 });
                            } else if (targetMode === "clay" || targetMode === "claywire") {
                                child.material = new THREE.MeshMatcapMaterial({
                                    matcap: clayMatcap,
                                    // Lines coplanar with the faces z-fight and break up, and WebGL can
                                    // only offset fills, so the faces are pushed back instead.
                                    ...(targetMode === "claywire" ? { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } : {}),
                                });
                            } else if (targetMode === "skeleton" && bones > 0) {
                                child.material = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.18, depthWrite: false });
                            } else {
                                child.material = originalMaterials.get(child.uuid) || child.material;
                            }
                        });
                    };
                    applyModeRef.current = applyMode;
                    applyMode(mode);

                    setStatus("ready");
                    const clock = new THREE.Clock();
                    const render = () => {
                        if (disposed) return;
                        const delta = clock.getDelta();
                        mixerRef.current?.update(delta);
                        controls.update();
                        renderer.render(scene, camera);
                        frame = requestAnimationFrame(render);
                    };
                    render();
                };
                const onLoadError = () => !disposed && setStatus("error");
                if (isFbxSource(src, mimeType)) loadFbxLoader().then((FBXLoader: any) => !disposed && new FBXLoader().load(src, onLoaded, undefined, onLoadError), onLoadError);
                else new GLTFLoader().load(src, onLoaded, undefined, onLoadError);
            })
            .catch(() => !disposed && setStatus("error"));

        return () => {
            disposed = true;
            if (frame) cancelAnimationFrame(frame);
            resizeObserver?.disconnect();
            controls?.dispose?.();
            controlsRef.current = null;
            applyModeRef.current = null;
            resetCameraRef.current = null;
            mixerRef.current?.stopAllAction?.();
            mixerRef.current = null;
            actionsRef.current = [];
            scene?.traverse?.((object: any) => {
                object.geometry?.dispose?.();
                const material = object.material;
                for (const item of Array.isArray(material) ? material : material ? [material] : []) {
                    for (const value of Object.values(item)) if (value && typeof value === "object" && "isTexture" in (value as object)) (value as any).dispose?.();
                    item.dispose?.();
                }
            });
            if (renderer) {
                renderer.domElement?.remove?.();
                renderer.dispose?.();
                // Browsers cap concurrent WebGL contexts, so release this one explicitly.
                renderer.forceContextLoss?.();
            }
        };
        // `mode` is applied through applyModeRef so a mode switch never reloads the model.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, mimeType, quad]);

    // Toggling interaction must not rebuild the scene, so controls are switched in place.
    useEffect(() => {
        if (controlsRef.current) controlsRef.current.enabled = interactive;
    }, [interactive]);

    useEffect(() => {
        applyModeRef.current?.(mode);
    }, [mode, status]);

    useEffect(() => {
        for (const action of actionsRef.current) action.paused = !playing;
    }, [playing]);

    useEffect(() => {
        const actions = actionsRef.current;
        if (!actions.length) return;
        actions.forEach((action, index) => {
            if (index === activeClip) {
                action.reset().play();
                action.paused = !playing;
            } else action.stop();
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeClip]);

    // A rig is worth looking at even without clips, and clips exist only with a rig, so both live together.
    const hasSkeletonMode = boneCount > 0;
    const availableModes = MODEL3D_MODES.filter((item) => item !== "skeleton" || hasSkeletonMode);
    const controlsVisible = showControls && status === "ready";

    return (
        <div className="relative size-full overflow-hidden rounded-xl" style={{ background: theme.node.fill }}>
            <div
                ref={mountRef}
                data-canvas-no-zoom
                className="absolute inset-0"
                style={{ cursor: interactive ? "grab" : "default", pointerEvents: interactive ? "auto" : "none" }}
                onPointerDown={(event) => interactive && event.stopPropagation()}
                onWheel={(event) => interactive && event.stopPropagation()}
                onContextMenu={(event) => {
                    if (!interactive) return;
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onDoubleClick={(event) => showControls && event.stopPropagation()}
            />
            {status !== "ready" ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    {poster && status === "loading" ? <img src={poster} alt="" className="size-full object-contain opacity-70" /> : null}
                    <span className="absolute text-xs" style={{ color: status === "error" ? theme.node.muted : theme.node.placeholder }}>
                        {t(status === "error" ? "canvas.model3d.loadFailed" : "canvas.model3d.loading")}
                    </span>
                </div>
            ) : null}

            {controlsVisible ? (
                <>
                    <div className="absolute left-3 top-3 flex flex-wrap gap-1 rounded-lg border p-1" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} data-canvas-no-zoom>
                        {availableModes.map((item) => {
                            const Icon = MODE_ICONS[item];
                            const active = mode === item;
                            return (
                                <button
                                    key={item}
                                    type="button"
                                    title={t(`canvas.model3d.modes.${item}`)}
                                    className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-opacity hover:opacity-80"
                                    style={{ background: active ? theme.toolbar.activeBg : "transparent", color: active ? theme.node.text : theme.node.muted }}
                                    onClick={() => setMode(item)}
                                >
                                    <Icon className="size-3.5" />
                                    <span>{t(`canvas.model3d.modes.${item}`)}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border p-1" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} data-canvas-no-zoom>
                        {clipNames.length ? (
                            <>
                                {clipNames.length > 1 ? (
                                    <select className="max-w-32 rounded bg-transparent px-1 py-1 text-xs outline-none" style={{ color: theme.node.text }} value={activeClip} onChange={(event) => setActiveClip(Number(event.target.value))}>
                                        {clipNames.map((name, index) => (
                                            <option key={`${name}-${index}`} value={index}>
                                                {name}
                                            </option>
                                        ))}
                                    </select>
                                ) : null}
                                <button
                                    type="button"
                                    title={t(playing ? "canvas.model3d.pause" : "canvas.model3d.play")}
                                    className="rounded p-1.5 transition-opacity hover:opacity-80"
                                    style={{ color: theme.node.text }}
                                    onClick={() => setPlaying((current) => !current)}
                                >
                                    {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                                </button>
                            </>
                        ) : null}
                        <button type="button" title={t("canvas.model3d.resetCamera")} className="rounded p-1.5 transition-opacity hover:opacity-80" style={{ color: theme.node.text }} onClick={() => resetCameraRef.current?.()}>
                            <RotateCcw className="size-3.5" />
                        </button>
                    </div>

                    <div className="pointer-events-none absolute bottom-3 left-3 text-[11px]" style={{ color: theme.node.muted }}>
                        {mode === "skeleton"
                            ? t("canvas.model3d.boneCount", { count: boneCount })
                            : clipNames.length
                              ? t("canvas.model3d.clipCount", { count: clipNames.length })
                              : hasSkeletonMode
                                ? t("canvas.model3d.rigged")
                                : t("canvas.model3d.staticMesh")}
                    </div>
                </>
            ) : null}
        </div>
    );
}
