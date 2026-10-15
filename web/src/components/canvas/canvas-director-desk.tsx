import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { uploadImage } from "@/services/image-storage";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { registerDirectorDeskSender } from "@/lib/canvas/director-desk-bridge";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

// The director desk is a separate Vite app served same-origin under this path (see director-desk/).
const DIRECTOR_DESK_URL = `${import.meta.env.BASE_URL}director-desk/`;
const CAPTURE_MAX_SIZE = 420;
const CAPTURE_GAP = 96;

// The desk picks its loader from the file extension, so canvas models need one even when the title has none.
const MODEL_EXTENSIONS: Record<string, string> = { "model/gltf-binary": "glb", "model/gltf+json": "gltf", "model/fbx": "fbx", "model/obj": "obj" };

function imageFileName(node: CanvasNodeData) {
    const title = node.title || "image";
    if (/\.(png|jpe?g|webp|gif)$/i.test(title)) return title;
    return `${title}.png`;
}

type DirectorDeskCanvasAsset = { sourceNodeId: string; kind: "model" | "image"; url: string; fileName: string; name: string; thumbUrl?: string };

/** Every 3D model and image on the canvas, offered in the desk's "画布" library tab whether or not it is connected. */
function listCanvasAssets(nodes: CanvasNodeData[]): DirectorDeskCanvasAsset[] {
    return nodes.flatMap((item): DirectorDeskCanvasAsset[] => {
        const url = item.metadata?.content;
        if (!url) return [];
        if (item.type === CanvasNodeType.Model3d) return [{ sourceNodeId: item.id, kind: "model", url, fileName: modelFileName(item), name: item.title || item.id, thumbUrl: item.metadata?.model3dPreview }];
        if (item.type === CanvasNodeType.Image) return [{ sourceNodeId: item.id, kind: "image", url, fileName: imageFileName(item), name: item.title || item.id, thumbUrl: url }];
        return [];
    });
}

function modelFileName(node: CanvasNodeData) {
    const title = node.title || "model";
    if (/\.(glb|gltf|fbx|obj)$/i.test(title)) return title;
    return `${title}.${MODEL_EXTENSIONS[node.metadata?.mimeType || ""] || "glb"}`;
}

export function CanvasDirectorDeskNodeContent({ node }: { node: CanvasNodeData }) {
    const { t } = useTranslation();
    const preview = node.metadata?.content;

    return (
        <div className="pointer-events-none relative h-full w-full overflow-hidden rounded-[inherit]">
            {preview ? (
                <img src={preview} alt={node.title || t("canvas.nodeTypes.directorDesk")} className="h-full w-full object-cover" />
            ) : (
                <div className="grid h-full w-full place-items-center text-xs opacity-55">{t("canvas.directorDesk.empty")}</div>
            )}
            {preview ? <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-6 text-right text-[11px] text-white/90">{t("canvas.directorDesk.doubleClickToOpen")}</div> : null}
        </div>
    );
}

export function CanvasDirectorDeskOverlay({
    node,
    nodes,
    connections,
    onClose,
    onCreateImageNode,
    onUpdateNodeMetadata,
}: {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    onClose: () => void;
    onCreateImageNode: (node: CanvasNodeData) => void;
    onUpdateNodeMetadata: (nodeId: string, patch: CanvasNodeMetadata) => void;
}) {
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    // The iframe URL is fixed for the overlay's lifetime; changing it would reload the desk.
    const [src] = useState(() => `${DIRECTOR_DESK_URL}?${new URLSearchParams({ instanceId: node.id, theme })}`);
    const latest = useRef({ node, nodes, onClose, onCreateImageNode, onUpdateNodeMetadata });
    latest.current = { node, nodes, onClose, onCreateImageNode, onUpdateNodeMetadata };

    const connected = connections.filter((connection) => connection.toNodeId === node.id).map((connection) => nodes.find((item) => item.id === connection.fromNodeId));
    const connectedModels = connected.filter((item): item is CanvasNodeData => item?.type === CanvasNodeType.Model3d && Boolean(item.metadata?.content));
    const panorama = connected.find((item): item is CanvasNodeData => item?.type === CanvasNodeType.Image && Boolean(item.metadata?.content));
    const libraryAssets = listCanvasAssets(nodes);
    const connectedKey = JSON.stringify([connectedModels.map((item) => [item.id, item.metadata?.content]), panorama?.metadata?.content]);
    const libraryKey = JSON.stringify(libraryAssets.map((item) => [item.sourceNodeId, item.url, item.thumbUrl]));

    // Push every canvas 3D / image node into the desk's library. Connected models still drop into the scene;
    // the first connected image still becomes the panorama, matching the previous behaviour.
    useEffect(() => {
        const target = iframeRef.current?.contentWindow;
        if (!ready || !target) return;
        target.postMessage({ type: "storyai:director-desk-assets", payload: { assets: libraryAssets } }, window.location.origin);
        connectedModels.forEach((item) => {
            target.postMessage({ type: "storyai:director-desk-model", payload: { sourceNodeId: item.id, url: item.metadata?.content, fileName: modelFileName(item), name: item.title } }, window.location.origin);
        });
        if (panorama) {
            target.postMessage({ type: "storyai:director-desk-panorama", payload: { edgeId: `${panorama.id}->${node.id}`, sourceNodeId: panorama.id, imageUrl: panorama.metadata?.content, fileName: panorama.title } }, window.location.origin);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, connectedKey, libraryKey]);

    useEffect(() => {
        const saveCaptures = async (captures: Array<{ dataUrl?: string; fileName?: string }>) => {
            const { node: deskNode, nodes: currentNodes } = latest.current;
            let y = deskNode.position.y;
            let lastImage: Awaited<ReturnType<typeof uploadImage>> | null = null;
            for (const capture of captures) {
                if (!capture.dataUrl?.startsWith("data:image/")) continue;
                const image = await uploadImage(capture.dataUrl);
                const size = fitNodeSize(image.width, image.height, CAPTURE_MAX_SIZE, CAPTURE_MAX_SIZE);
                const x = deskNode.position.x + deskNode.width + CAPTURE_GAP;
                while (currentNodes.some((item) => item.position.x < x + size.width && item.position.x + item.width > x && item.position.y < y + size.height && item.position.y + item.height > y)) y += size.height + 24;
                latest.current.onCreateImageNode({ id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: CanvasNodeType.Image, title: capture.fileName?.replace(/\.png$/i, "") || t("canvas.nodeTypes.directorDesk"), position: { x, y }, ...size, metadata: imageMetadata(image) });
                y += size.height + 24;
                lastImage = image;
            }
            // The latest capture doubles as the node's thumbnail; it lives in image storage like any image node.
            if (lastImage) latest.current.onUpdateNodeMetadata(deskNode.id, { content: lastImage.url, storageKey: lastImage.storageKey, status: "success" });
        };

        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
            const type = event.data?.type;
            if (type === "storyai:director-desk-ready") setReady(true);
            if (type === "storyai:director-desk-close") latest.current.onClose();
            if (type === "storyai:director-desk-captures-sent") void saveCaptures(Array.isArray(event.data.payload?.captures) ? event.data.payload.captures : []);
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [t]);

    // Once the desk is ready, Agent commands for this node go to its iframe and resolve on the matching reply.
    useEffect(() => {
        const target = iframeRef.current?.contentWindow;
        if (!ready || !target) return;
        const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
        const handleResult = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== target || event.data?.type !== "storyai:director-desk-command-result") return;
            const entry = pending.get(event.data.requestId);
            if (!entry) return;
            pending.delete(event.data.requestId);
            if (event.data.error) entry.reject(new Error(String(event.data.error)));
            else entry.resolve(event.data.result);
        };
        window.addEventListener("message", handleResult);
        const unregister = registerDirectorDeskSender(node.id, (command) => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            return new Promise((resolve, reject) => {
                pending.set(requestId, { resolve, reject });
                target.postMessage({ type: "storyai:director-desk-command", requestId, payload: command }, window.location.origin);
            });
        });
        return () => {
            unregister();
            window.removeEventListener("message", handleResult);
            pending.forEach((entry) => entry.reject(new Error("导演台已关闭")));
        };
    }, [ready, node.id]);

    // The desk renders its own close button and posts storyai:director-desk-close.
    return createPortal(
        <div className="fixed inset-0 z-[1000] bg-black">
            <iframe ref={iframeRef} src={src} title={node.title || t("canvas.nodeTypes.directorDesk")} className="h-full w-full border-0" />
        </div>,
        document.body,
    );
}
