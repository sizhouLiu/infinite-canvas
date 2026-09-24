import i18n from "@/i18n";
import { fetchAgentJson } from "@/services/api/canvas-agent";
import { getMediaBlob } from "@/services/file-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const text = (key: string, options?: Record<string, unknown>) => i18n.t(`canvas.bambuStudio.${key}`, options);
const THREE_MF = /3mf/i;
const OPEN_GAP_MS = 700;

export function collectBambuImportNodes(selected: CanvasNodeData[], allNodes: CanvasNodeData[]) {
    const seen = new Set<string>();
    const out: CanvasNodeData[] = [];
    const consider = (node: CanvasNodeData) => {
        if (seen.has(node.id) || node.type !== CanvasNodeType.Model3d) return;
        if (!node.metadata?.storageKey && !node.metadata?.content && !node.metadata?.model3dConvertedKey) return;
        seen.add(node.id);
        out.push(node);
    };
    selected.forEach((node) => {
        if (node.type === CanvasNodeType.Group) allNodes.filter((item) => item.metadata?.groupId === node.id).forEach(consider);
        else consider(node);
    });
    return out;
}

type BambuFile = { title: string; fileName: string; remoteUrl?: string; blob?: Blob };

function isThreeMfNode(node: CanvasNodeData) {
    const format = node.metadata?.model3dConvertedFormat || "";
    const convertedMime = node.metadata?.model3dConvertedMime || "";
    const mime = node.metadata?.mimeType || "";
    return THREE_MF.test(format) || THREE_MF.test(convertedMime) || THREE_MF.test(mime);
}

async function resolveBambuFile(node: CanvasNodeData): Promise<BambuFile> {
    const title = node.title?.trim() || node.id;
    const fileName = `${title.replace(/[\\/]/g, "_").slice(0, 64) || "model"}.3mf`;
    if (!isThreeMfNode(node)) throw new Error(text("needConvert", { name: title }));

    const remoteUrl = node.metadata?.model3dConvertedUrl?.trim();
    if (remoteUrl && /^https?:\/\//i.test(remoteUrl) && THREE_MF.test(node.metadata?.model3dConvertedFormat || node.metadata?.model3dConvertedMime || "")) {
        return { title, fileName, remoteUrl };
    }

    const convertedKey = node.metadata?.model3dConvertedKey;
    if (convertedKey && THREE_MF.test(node.metadata?.model3dConvertedFormat || node.metadata?.model3dConvertedMime || "")) {
        const blob = await getMediaBlob(convertedKey);
        if (blob?.size) return { title, fileName, blob };
    }

    if (THREE_MF.test(node.metadata?.mimeType || "")) {
        let blob = node.metadata?.storageKey ? await getMediaBlob(node.metadata.storageKey) : null;
        if (!blob && node.metadata?.content) {
            try {
                blob = await (await fetch(node.metadata.content)).blob();
            } catch {
                blob = null;
            }
        }
        if (blob?.size) return { title, fileName, blob };
    }

    throw new Error(text("missing", { name: title }));
}

async function hostViaAgent(blob: Blob, fileName: string, agent: { url: string; token: string }) {
    const endpoint = agent.url.trim().replace(/\/$/, "");
    if (!endpoint || !agent.token) throw new Error(text("agentRequired"));
    const data = bufferToBase64(await blob.arrayBuffer());
    const result = await fetchAgentJson<{ ok?: boolean; id?: string }>(endpoint, agent.token, "/share/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mimeType: blob.type || "model/3mf", fileName, data }),
    });
    if (!result.id) throw new Error(text("agentRequired"));
    return `${endpoint}/share/file/${result.id}?token=${encodeURIComponent(agent.token)}`;
}

function bufferToBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    const size = 0x8000;
    for (let i = 0; i < bytes.length; i += size) chunks.push(String.fromCharCode(...bytes.subarray(i, i + size)));
    return btoa(chunks.join(""));
}

function launchBambu(fileUrl: string) {
    const href = `bambustudio://open?file=${encodeURIComponent(fileUrl)}`;
    const link = document.createElement("a");
    link.href = href;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

export async function openModelsInBambuStudio(nodes: CanvasNodeData[], agent: { url: string; token: string; connected: boolean }) {
    const files: BambuFile[] = [];
    for (const node of nodes) files.push(await resolveBambuFile(node));
    if (!files.length) throw new Error(text("none"));
    const urls: string[] = [];
    for (const file of files) {
        if (file.remoteUrl) urls.push(file.remoteUrl);
        else if (file.blob) {
            if (!agent.connected) throw new Error(text("agentRequired"));
            urls.push(await hostViaAgent(file.blob, file.fileName, agent));
        } else throw new Error(text("missing", { name: file.title }));
    }
    for (let i = 0; i < urls.length; i++) {
        launchBambu(urls[i]);
        if (i < urls.length - 1) await new Promise((resolve) => window.setTimeout(resolve, OPEN_GAP_MS));
    }
}
