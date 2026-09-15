import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CanvasTheme } from "@/lib/canvas-theme";

// three.js is loaded from a CDN on demand so the app bundle stays free of a 3D dependency,
// matching the panorama plugin. Vite must not resolve these at build time, hence @vite-ignore.
const THREE_VERSION = "0.180.0";
let threePromise: Promise<[any, any, any]> | undefined;

function loadThree() {
    if (!threePromise) {
        const base = `https://esm.sh/three@${THREE_VERSION}`;
        threePromise = Promise.all([import(/* @vite-ignore */ base), import(/* @vite-ignore */ `${base}/examples/jsm/loaders/GLTFLoader.js`), import(/* @vite-ignore */ `${base}/examples/jsm/controls/OrbitControls.js`)]) as Promise<[any, any, any]>;
    }
    return threePromise;
}

type Model3dViewerProps = { src: string; poster?: string; theme: CanvasTheme; interactive: boolean };

export function CanvasModel3dViewer({ src, poster, theme, interactive }: Model3dViewerProps) {
    const { t } = useTranslation();
    const mountRef = useRef<HTMLDivElement>(null);
    const controlsRef = useRef<any>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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
        loadThree()
            .then(([THREE, { GLTFLoader }, { OrbitControls }]) => {
                if (disposed) return;
                scene = new THREE.Scene();
                const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
                renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
                controls.enablePan = false;
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

                new GLTFLoader().load(
                    src,
                    (gltf: any) => {
                        if (disposed) return;
                        const model = gltf.scene;
                        // Center the model and pull the camera back far enough to frame its bounding sphere.
                        const box = new THREE.Box3().setFromObject(model);
                        const sphere = box.getBoundingSphere(new THREE.Sphere());
                        model.position.sub(sphere.center);
                        scene.add(model);
                        const distance = (sphere.radius || 1) / Math.sin((camera.fov * Math.PI) / 360);
                        camera.position.set(distance * 0.6, distance * 0.5, distance * 0.9);
                        controls.target.set(0, 0, 0);
                        controls.update();
                        setStatus("ready");
                        const render = () => {
                            if (disposed) return;
                            controls.update();
                            renderer.render(scene, camera);
                            frame = requestAnimationFrame(render);
                        };
                        render();
                    },
                    undefined,
                    () => !disposed && setStatus("error"),
                );
            })
            .catch(() => !disposed && setStatus("error"));

        return () => {
            disposed = true;
            if (frame) cancelAnimationFrame(frame);
            resizeObserver?.disconnect();
            controls?.dispose?.();
            controlsRef.current = null;
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
    }, [src]);

    // Toggling interaction must not rebuild the scene, so controls are switched in place.
    useEffect(() => {
        if (controlsRef.current) controlsRef.current.enabled = interactive;
    }, [interactive]);

    return (
        <div className="relative size-full overflow-hidden rounded-xl" style={{ background: theme.node.fill }}>
            <div
                ref={mountRef}
                data-canvas-no-zoom
                className="absolute inset-0"
                style={{ cursor: interactive ? "grab" : "default", pointerEvents: interactive ? "auto" : "none" }}
                onPointerDown={(event) => interactive && event.stopPropagation()}
                onWheel={(event) => interactive && event.stopPropagation()}
            />
            {status !== "ready" ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    {poster && status === "loading" ? <img src={poster} alt="" className="size-full object-contain opacity-70" /> : null}
                    <span className="absolute text-xs" style={{ color: status === "error" ? theme.node.muted : theme.node.placeholder }}>
                        {t(status === "error" ? "canvas.model3d.loadFailed" : "canvas.model3d.loading")}
                    </span>
                </div>
            ) : null}
        </div>
    );
}
