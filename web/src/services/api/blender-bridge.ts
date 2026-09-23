import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { getMediaBlob } from "@/services/file-storage";
import { detectModel3dMime } from "@/services/api/tripo-shared";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const BRIDGE_URL = "ws://127.0.0.1:60600";
const PROTOCOL_VERSION = "1.0.0";
const CLIENT_NAME = "Infinite Canvas";
const CHUNK_SIZE = 256 * 1024;
const CONNECT_TIMEOUT_MS = 8000;
const ACK_TIMEOUT_MS = 15000;
const IMPORT_TIMEOUT_MS = 180000;
const PING_INTERVAL_MS = 25000;

const text = (key: string, options?: Record<string, unknown>) => i18n.t(`canvas.blenderBridge.${key}`, options);

type BridgeMessage = { type?: string; payload?: Record<string, unknown> };

export function collectBlenderImportNodes(selected: CanvasNodeData[], allNodes: CanvasNodeData[]) {
    const seen = new Set<string>();
    const out: CanvasNodeData[] = [];
    const consider = (node: CanvasNodeData) => {
        if (seen.has(node.id) || node.type !== CanvasNodeType.Model3d) return;
        if (!node.metadata?.storageKey && !node.metadata?.content) return;
        seen.add(node.id);
        out.push(node);
    };
    selected.forEach((node) => {
        if (node.type === CanvasNodeType.Group) allNodes.filter((item) => item.metadata?.groupId === node.id).forEach(consider);
        else consider(node);
    });
    return out;
}

type ImportFile = { blob: Blob; fileType: string; fileName: string; title: string };

async function resolveImportFile(node: CanvasNodeData): Promise<ImportFile> {
    const title = node.title?.trim() || node.id;
    let blob = node.metadata?.storageKey ? await getMediaBlob(node.metadata.storageKey) : null;
    if (!blob && node.metadata?.content) {
        try {
            blob = await (await fetch(node.metadata.content)).blob();
        } catch {
            blob = null;
        }
    }
    if (!blob?.size) throw new Error(text("missing", { name: title }));
    const mime = await detectModel3dMime(blob, node.metadata?.mimeType || "model/gltf-binary");
    const fileType = bridgeFileType(mime);
    if (!fileType) throw new Error(text("unsupported", { name: title, format: mime || "unknown" }));
    return { blob, fileType, fileName: blenderObjectName(title), title };
}

function bridgeFileType(mime: string) {
    const lower = mime.toLowerCase();
    if (lower.includes("3mf")) return null;
    if (lower.includes("fbx")) return "fbx";
    if (lower.includes("gltf+json") || lower === "model/gltf") return "gltf";
    if (lower.includes("gltf")) return "glb";
    if (lower.includes("obj")) return "obj";
    if (lower.includes("stl") || lower.includes("sla")) return "stl";
    if (lower.includes("usd")) return "usdz";
    return "glb";
}

function blenderObjectName(title: string) {
    return title.replace(/[\\/]/g, "_").slice(0, 64) || "model";
}

let importing = false;

export async function importModelsToBlender(nodes: CanvasNodeData[]) {
    if (typeof location !== "undefined" && location.protocol === "https:") throw new Error(text("mixedHttps"));
    if (importing) throw new Error(text("busy"));
    const files: ImportFile[] = [];
    for (const node of nodes) files.push(await resolveImportFile(node));
    if (!files.length) throw new Error(text("none"));
    importing = true;
    let session: BridgeSession | undefined;
    try {
        session = await connectBridge();
        for (const file of files) await transferFile(session, file);
    } finally {
        session?.close();
        importing = false;
    }
}

type BridgeSession = {
    wait: (pred: (msg: BridgeMessage) => boolean, timeoutMs: number, timeoutKey?: string) => Promise<BridgeMessage>;
    sendJson: (message: BridgeMessage) => void;
    sendBinary: (bytes: Uint8Array) => void;
    close: () => void;
};

function connectBridge(): Promise<BridgeSession> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let pingTimer: number | null = null;
        const waiters: Array<{ pred: (msg: BridgeMessage) => boolean; resolve: (msg: BridgeMessage) => void; reject: (error: Error) => void; timer: number }> = [];
        const ws = new WebSocket(BRIDGE_URL);
        ws.binaryType = "arraybuffer";

        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(connectTimer);
            cleanup();
            reject(error);
        };

        const cleanup = () => {
            if (pingTimer != null) window.clearInterval(pingTimer);
            waiters.splice(0).forEach((waiter) => {
                window.clearTimeout(waiter.timer);
                waiter.reject(new Error(text("connectFailed")));
            });
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
        };

        const connectTimer = window.setTimeout(() => fail(new Error(text("connectFailed"))), CONNECT_TIMEOUT_MS);

        ws.onerror = () => fail(new Error(text("connectFailed")));
        ws.onclose = () => fail(new Error(text("connectFailed")));
        ws.onmessage = (event) => {
            const msg = parseBridgeMessage(event.data);
            if (!msg) return;
            const index = waiters.findIndex((waiter) => waiter.pred(msg));
            if (index < 0) return;
            const [waiter] = waiters.splice(index, 1);
            window.clearTimeout(waiter.timer);
            waiter.resolve(msg);
        };
        ws.onopen = () => {
            if (settled) return;
            const session: BridgeSession = {
                wait(pred, timeoutMs, timeoutKey = "timeout") {
                    return new Promise((ok, no) => {
                        const waiter = {
                            pred,
                            resolve: ok,
                            reject: no,
                            timer: window.setTimeout(() => {
                                const at = waiters.indexOf(waiter);
                                if (at >= 0) waiters.splice(at, 1);
                                no(new Error(text(timeoutKey)));
                            }, timeoutMs),
                        };
                        waiters.push(waiter);
                    });
                },
                sendJson(message) {
                    ws.send(JSON.stringify(message));
                },
                sendBinary(bytes) {
                    ws.send(bytes);
                },
                close() {
                    if (pingTimer != null) window.clearInterval(pingTimer);
                    pingTimer = null;
                    ws.onclose = null;
                    ws.onerror = null;
                    waiters.splice(0).forEach((waiter) => {
                        window.clearTimeout(waiter.timer);
                        waiter.reject(new Error(text("connectFailed")));
                    });
                    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
                },
            };
            session.sendJson({ type: "handshake", payload: { clientName: CLIENT_NAME, protocolVersion: PROTOCOL_VERSION } });
            session
                .wait((msg) => msg.type === "handshake_ack", CONNECT_TIMEOUT_MS, "handshakeFailed")
                .then((ack) => {
                    if (ack.payload?.success === false) throw new Error(text("handshakeFailed"));
                    settled = true;
                    window.clearTimeout(connectTimer);
                    ws.onerror = () => {};
                    ws.onclose = () => {
                        waiters.splice(0).forEach((waiter) => {
                            window.clearTimeout(waiter.timer);
                            waiter.reject(new Error(text("connectFailed")));
                        });
                    };
                    pingTimer = window.setInterval(() => session.sendJson({ type: "ping" }), PING_INTERVAL_MS);
                    resolve(session);
                })
                .catch((error) => fail(error instanceof Error ? error : new Error(text("handshakeFailed"))));
        };
    });
}

async function transferFile(session: BridgeSession, file: ImportFile) {
    const buffer = new Uint8Array(await file.blob.arrayBuffer());
    const fileId = nanoid();
    const chunkTotal = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_SIZE));
    const encoder = new TextEncoder();
    for (let chunkIndex = 0; chunkIndex < chunkTotal; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const chunk = buffer.subarray(start, start + CHUNK_SIZE);
        const header = encoder.encode(
            JSON.stringify({
                type: "file_transfer",
                payload: { fileType: file.fileType, fileId, fileName: file.fileName, chunkTotal, chunkIndex, chunkSize: chunk.byteLength },
            }),
        );
        const frame = new Uint8Array(header.length + chunk.byteLength);
        frame.set(header, 0);
        frame.set(chunk, header.length);
        session.sendBinary(frame);
        const ack = await session.wait((msg) => msg.type === "file_transfer_ack" && msg.payload?.fileId === fileId && msg.payload?.fileIndex === chunkIndex, ACK_TIMEOUT_MS, "timeout");
        if (ack.payload?.success === false) throw new Error(text("transferFailed", { name: file.title }));
    }
    const imported = await session.wait((msg) => msg.type === "import_complete" && msg.payload?.fileId === fileId, IMPORT_TIMEOUT_MS, "timeout");
    if (imported.payload?.success === false) {
        const detail = String(imported.payload?.message || "").trim();
        throw new Error(text("importFailed", { name: file.title, reason: detail ? ` — ${detail}` : "" }));
    }
}

function parseBridgeMessage(data: unknown): BridgeMessage | null {
    try {
        if (typeof data === "string") return JSON.parse(data) as BridgeMessage;
        if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data)) as BridgeMessage;
    } catch {
        return null;
    }
    return null;
}
