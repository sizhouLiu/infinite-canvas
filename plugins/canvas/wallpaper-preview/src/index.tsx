// 壁纸预览节点:iframe 加载 girl_desk_wallpaper 的预览页(默认 http://localhost:4173/),
// 可改地址、切机位(?camera=)、刷新;连上游文本节点时取其中第一条 http(s) 地址。
// 交互:iframe 始终可点(点灯、显示器、窗帘等),顶部控制条空白处可拖动节点;
// 拖动期间 iframe 临时不吃指针,避免鼠标滑进 iframe 后画布丢失拖拽事件。
import { definePlugin, useEffect, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeData } from "@infinite-canvas/plugin-sdk";

const DEFAULT_URL = "http://localhost:4173/";
const CAMERAS = [
    { value: "", label: "默认机位" },
    { value: "CAM_Front", label: "正面" },
    { value: "SCN_Camera", label: "书桌" },
    { value: "CAM_Bedroom", label: "卧室" },
    { value: "CAM_Shelf", label: "书架" },
];

const css = `
.wp-btn{background:transparent;border:0;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;color:inherit;white-space:nowrap}
.wp-btn:hover{background:var(--wp-hover)}
.wp-field{background:transparent;border:0;border-bottom:1px dashed currentColor;outline:none;font-size:12px;color:inherit;min-width:0}
.wp-field option{background:var(--wp-bg);color:var(--wp-fg)}
`;

// 自身地址(metadata.wallpaperUrl)与上游文本里的 http(s) 地址,上游优先
function baseUrl(node: CanvasNodeData, upstream: CanvasNodeData[]) {
    const fromUpstream = upstream
        .map((item) => (typeof item.metadata?.content === "string" ? item.metadata.content.match(/https?:\/\/\S+/)?.[0] : undefined))
        .find(Boolean);
    return { url: fromUpstream || (node.metadata?.wallpaperUrl as string | undefined) || DEFAULT_URL, fromUpstream: Boolean(fromUpstream) };
}

function pageUrl(base: string, camera: string) {
    try {
        const url = new URL(base);
        if (camera) url.searchParams.set("camera", camera);
        return url.toString();
    } catch {
        return "";
    }
}

function WallpaperContent({ ctx }: CanvasNodeContentProps) {
    const t = ctx.theme;
    const { url: base, fromUpstream } = baseUrl(ctx.node, ctx.getUpstream());
    const camera = (ctx.node.metadata?.wallpaperCamera as string | undefined) || "";
    const src = pageUrl(base, camera);
    const [draft, setDraft] = useState(base);
    const [reloadKey, setReloadKey] = useState(0);
    const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");
    const [dragging, setDragging] = useState(false);

    useEffect(() => setDraft(base), [base]);

    // 跨域 iframe 拿不到加载失败,用 no-cors 探测:连接被拒会 reject,能连上返回 opaque 响应
    useEffect(() => {
        if (!src) return setStatus("error");
        let alive = true;
        setStatus("checking");
        fetch(src, { mode: "no-cors", cache: "no-store" })
            .then(() => alive && setStatus("ok"))
            .catch(() => alive && setStatus("error"));
        return () => {
            alive = false;
        };
    }, [src, reloadKey]);

    useEffect(() => {
        if (!dragging) return;
        const stop = () => setDragging(false);
        window.addEventListener("mouseup", stop);
        return () => window.removeEventListener("mouseup", stop);
    }, [dragging]);

    const commitUrl = () => {
        const next = draft.trim() || DEFAULT_URL;
        if (next !== base) ctx.updateMetadata({ wallpaperUrl: next });
        else setReloadKey((v) => v + 1);
    };
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

    return (
        <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", color: t.node.text, ["--wp-hover" as string]: `${t.node.text}14`, ["--wp-bg" as string]: t.toolbar.panel, ["--wp-fg" as string]: t.node.text }}>
            {/* 控制条:空白处冒泡给宿主 = 拖动节点;控件本身 stopPropagation */}
            <div onMouseDown={() => setDragging(true)} style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "move", fontSize: 12 }}>
                <input
                    className="wp-field"
                    data-canvas-no-zoom
                    value={draft}
                    disabled={fromUpstream}
                    title={fromUpstream ? "地址来自上游节点" : "壁纸预览地址,回车生效"}
                    onMouseDown={stop}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitUrl}
                    onKeyDown={(e) => e.key === "Enter" && commitUrl()}
                    style={{ flex: "0 1 320px", borderColor: t.node.muted, opacity: fromUpstream ? 0.6 : 1 }}
                />
                <span title="拖动此处移动节点" style={{ flex: "1 1 auto", alignSelf: "stretch", minWidth: 24 }} />
                <select className="wp-field" data-canvas-no-zoom value={camera} title="机位" onMouseDown={stop} onChange={(e) => ctx.updateMetadata({ wallpaperCamera: e.target.value })} style={{ flex: "0 0 auto", borderColor: t.node.muted }}>
                    {CAMERAS.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>
                <button type="button" className="wp-btn" title="重新加载" onMouseDown={stop} onClick={() => setReloadKey((v) => v + 1)}>
                    ⟳ 刷新
                </button>
            </div>
            <div data-canvas-no-zoom style={{ position: "relative", flex: "1 1 auto", minHeight: 0, borderRadius: "0 0 22px 22px", overflow: "hidden", background: "#000" }}>
                {status === "ok" ? (
                    <iframe
                        key={`${src}#${reloadKey}`}
                        title="wallpaper-preview"
                        src={src}
                        allow="autoplay; fullscreen"
                        style={{ height: "100%", width: "100%", border: 0, display: "block", pointerEvents: dragging ? "none" : undefined }}
                    />
                ) : (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 20, textAlign: "center", fontSize: 13, color: t.node.placeholder, background: t.node.fill }}>
                        {status === "checking" ? (
                            "正在连接壁纸预览…"
                        ) : (
                            <>
                                <span style={{ color: t.node.text }}>无法访问 {src || base}</span>
                                <span>请在壁纸项目目录运行 npm run preview(或 npm run pipeline 构建后再预览)</span>
                                <button type="button" className="wp-btn" onMouseDown={stop} onClick={() => setReloadKey((v) => v + 1)} style={{ color: t.node.text }}>
                                    ⟳ 重试
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default definePlugin({
    id: "wallpaper-preview",
    name: "壁纸预览节点",
    version: "1.0.0",
    description: "在画布里预览并交互 Wallpaper Engine 网页壁纸,可切换机位",
    css,
    nodes: [
        {
            type: "wallpaper-preview:viewer",
            title: "壁纸预览",
            icon: "🖼",
            description: "iframe 预览网页壁纸(默认 localhost:4173)",
            defaultSize: { width: 640, height: 400 },
            defaultMetadata: { wallpaperUrl: DEFAULT_URL, wallpaperCamera: "" },
            minimapColor: "#f59e0b",
            hidePanel: true,
            // 作为上游被消费时输出当前预览地址
            resource: (node) => {
                const text = pageUrl((node.metadata?.wallpaperUrl as string | undefined) || DEFAULT_URL, (node.metadata?.wallpaperCamera as string | undefined) || "");
                return text ? { kind: "text", text } : null;
            },
            Content: WallpaperContent,
        },
    ],
});
