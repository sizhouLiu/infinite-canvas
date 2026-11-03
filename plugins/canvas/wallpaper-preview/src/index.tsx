// 壁纸预览节点:从壁纸项目的预览服务(npm run preview,默认 http://localhost:4173/)读 wallpapers.json,
// 下拉选壁纸、选机位(机位随壁纸变),iframe 加载 <服务>/w/<id>/?camera=。
// 连上游文本节点时:文本是壁纸 id 就选中它;是 http(s) 地址则直接预览该页(兼容旧用法)。
// 交互:iframe 始终可点(点灯、显示器、窗帘等),顶部控制条空白处可拖动节点;
// 拖动期间 iframe 临时不吃指针,避免鼠标滑进 iframe 后画布丢失拖拽事件。
import { definePlugin, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeData } from "@infinite-canvas/plugin-sdk";

const DEFAULT_SERVER = "http://localhost:4173/";

type Wallpaper = { id: string; title: string; path: string; defaultCamera: string; cameras: { id: string; label: string }[] };

// 预览服务列出的已构建壁纸;服务没开或不是新版服务时返回 null
async function loadWallpapers(server: string): Promise<Wallpaper[] | null> {
    try {
        const res = await fetch(new URL("wallpapers.json", server).toString(), { cache: "no-store" });
        if (!res.ok) return null;
        const list = (await res.json()) as unknown;
        if (!Array.isArray(list)) return null;
        return list
            .filter((w): w is Wallpaper => !!w && typeof w.id === "string" && typeof w.path === "string")
            .map((w) => ({ ...w, title: w.title || w.id, cameras: Array.isArray(w.cameras) ? w.cameras.filter((c) => c && typeof c.id === "string") : [] }));
    } catch {
        return null;
    }
}

const css = `
.wp-btn{background:transparent;border:0;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;color:inherit;white-space:nowrap}
.wp-btn:hover{background:var(--wp-hover)}
.wp-field{background:transparent;border:0;border-bottom:1px dashed currentColor;outline:none;font-size:12px;color:inherit;min-width:0;max-width:100%}
.wp-field option{background:var(--wp-bg);color:var(--wp-fg)}
.wp-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:10px;padding:20px 32px 32px;background:rgba(0,0,0,.78);font:13px system-ui,sans-serif;color:#e5e5e5}
.wp-overlay-bar{display:flex;align-items:center;gap:12px}
.wp-overlay-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
.wp-overlay-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:4px 12px;color:inherit;cursor:pointer;font:inherit}
.wp-overlay-btn:hover{background:rgba(255,255,255,.16)}
.wp-overlay iframe{flex:1 1 auto;width:100%;min-height:0;border:0;border-radius:14px;background:#000;box-shadow:0 20px 60px rgba(0,0,0,.6)}
`;

const DBLCLICK = "wallpaper-preview:dblclick";
const ESCAPE = "wallpaper-preview:escape";

// 放大预览:直接挂到 document.body(节点在画布的 transform 里,position:fixed 会跟着画布缩放),所以不用 React 渲染。
// 退出:按钮、Esc、点遮罩空白、或在壁纸空白处再双击。返回关闭函数。
function openOverlay(src: string, title: string, onClose: () => void) {
    const root = document.createElement("div");
    root.className = "wp-overlay";
    const bar = document.createElement("div");
    bar.className = "wp-overlay-bar";
    const label = document.createElement("span");
    label.className = "wp-overlay-title";
    label.textContent = title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "wp-overlay-btn";
    close.textContent = "✕ 退出放大 (Esc)";
    bar.append(label, close);
    const frame = document.createElement("iframe");
    frame.src = src;
    frame.title = "wallpaper-preview-large";
    frame.allow = "autoplay; fullscreen";
    root.append(bar, frame);
    document.body.appendChild(root);

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // 壁纸页里的双击空白、以及焦点在壁纸页里时按的 Esc(键盘事件不会冒泡出跨域 iframe,由页面转发)
    const onMsg = (e: MessageEvent) => {
        const type = (e.data as { type?: string } | null)?.type;
        if (e.source === frame.contentWindow && (type === DBLCLICK || type === ESCAPE)) onClose();
    };
    close.addEventListener("click", onClose);
    root.addEventListener("mousedown", (e) => e.target === root && onClose());
    // 遮罩上的滚轮/按键不要传给画布(否则画布会跟着缩放、触发快捷键)
    root.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("message", onMsg);
    frame.focus();
    return () => {
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("message", onMsg);
        root.remove();
    };
}

const meta = (node: CanvasNodeData, key: string) => (typeof node.metadata?.[key] === "string" ? (node.metadata[key] as string) : "");

// 上游文本:http(s) 地址 -> 直接预览该页;否则整段文本当作壁纸 id
function upstreamValue(upstream: CanvasNodeData[]) {
    for (const item of upstream) {
        const text = typeof item.metadata?.content === "string" ? item.metadata.content.trim() : "";
        if (!text) continue;
        const url = text.match(/https?:\/\/\S+/)?.[0];
        return url ? { url } : { id: text.split(/\s+/)[0] };
    }
    return null;
}

function withCamera(base: string, camera: string) {
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
    const server = meta(ctx.node, "wallpaperServer") || DEFAULT_SERVER;
    const up = upstreamValue(ctx.getUpstream());
    const [reloadKey, setReloadKey] = useState(0);
    // null = 读取中;false = 服务不可用
    const [list, setList] = useState<Wallpaper[] | null | false>(null);
    const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");
    const [dragging, setDragging] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const frameRef = useRef<HTMLIFrameElement | null>(null);

    useEffect(() => {
        let alive = true;
        setList(null);
        loadWallpapers(server).then((items) => alive && setList(items || false));
        return () => {
            alive = false;
        };
    }, [server, reloadKey]);

    const wallpapers = list || [];
    // 选中的壁纸:上游 id > 节点里存的 id > 列表第一个
    const wantId = up && "id" in up ? up.id : meta(ctx.node, "wallpaperId");
    const current = wallpapers.find((w) => w.id === wantId) || wallpapers[0] || null;
    const stored = meta(ctx.node, "wallpaperCamera");
    const camera = current && current.cameras.some((c) => c.id === stored) ? stored : "";
    const external = up && "url" in up ? up.url : "";
    const src = external || (current ? withCamera(new URL(current.path, server).toString(), camera) : "");

    // 跨域 iframe 拿不到加载失败,用 no-cors 探测:连接被拒会 reject,能连上返回 opaque 响应
    useEffect(() => {
        if (!src) return setStatus(list === null ? "checking" : "error");
        let alive = true;
        setStatus("checking");
        fetch(src, { mode: "no-cors", cache: "no-store" })
            .then(() => alive && setStatus("ok"))
            .catch(() => alive && setStatus("error"));
        return () => {
            alive = false;
        };
    }, [src, list, reloadKey]);

    useEffect(() => {
        if (!dragging) return;
        const stop = () => setDragging(false);
        window.addEventListener("mouseup", stop);
        return () => window.removeEventListener("mouseup", stop);
    }, [dragging]);

    // 节点里的壁纸页在空白处被双击时会 postMessage 过来(跨域 iframe 的 dblclick 不会冒泡到画布)
    useEffect(() => {
        const onMsg = (e: MessageEvent) => {
            if (e.source && e.source === frameRef.current?.contentWindow && (e.data as { type?: string } | null)?.type === DBLCLICK) setExpanded(true);
        };
        window.addEventListener("message", onMsg);
        return () => window.removeEventListener("message", onMsg);
    }, []);

    // 放大时只保留大窗口里的一份页面(两个 WebGL 页面同时跑没必要),退出后节点重新加载
    useEffect(() => {
        if (!expanded || !src || status !== "ok") return;
        const title = external || (current ? current.title + (camera ? ` · ${current.cameras.find((c) => c.id === camera)?.label || camera}` : "") : src);
        return openOverlay(src, title, () => setExpanded(false));
    }, [expanded, src, status]);

    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
    const fieldStyle = { flex: "0 1 auto", borderColor: t.node.muted };
    const lockedByUpstream = !!up;

    let message = "";
    if (status === "checking") message = "正在连接壁纸预览…";
    else if (external) message = `无法访问 ${external}`;
    else if (list === false) message = `连不上壁纸预览服务 ${server}`;
    else if (!wallpapers.length) message = "还没有构建好的壁纸";
    else if (up && "id" in up && !wallpapers.some((w) => w.id === up.id)) message = `没有名为 ${up.id} 的壁纸`;
    else message = `无法访问 ${src}`;

    return (
        <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", color: t.node.text, ["--wp-hover" as string]: `${t.node.text}14`, ["--wp-bg" as string]: t.toolbar.panel, ["--wp-fg" as string]: t.node.text }}>
            {/* 控制条:空白处冒泡给宿主 = 拖动节点;控件本身 stopPropagation */}
            <div
                onMouseDown={() => setDragging(true)}
                // 双击控制条空白处也能放大;拦下来,不让画布当成节点双击
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (status === "ok") setExpanded(true);
                }}
                style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", cursor: "move", fontSize: 12 }}
            >
                {external ? (
                    <span title="地址来自上游节点" style={{ opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {external}
                    </span>
                ) : (
                    <select
                        className="wp-field"
                        data-canvas-no-zoom
                        value={current ? current.id : ""}
                        disabled={lockedByUpstream || !wallpapers.length}
                        title={lockedByUpstream ? "壁纸由上游节点指定" : "选择壁纸"}
                        onMouseDown={stop}
                        // 换壁纸时清掉机位:不同壁纸的机位互不通用
                        onChange={(e) => ctx.updateMetadata({ wallpaperId: e.target.value, wallpaperCamera: "" })}
                        style={{ ...fieldStyle, opacity: lockedByUpstream ? 0.6 : 1 }}
                    >
                        {!wallpapers.length && <option value="">{list === null ? "读取中…" : "无可用壁纸"}</option>}
                        {wallpapers.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.title}
                            </option>
                        ))}
                    </select>
                )}
                <span title="拖动此处移动节点" style={{ flex: "1 1 auto", alignSelf: "stretch", minWidth: 24 }} />
                {!external && (
                    <select className="wp-field" data-canvas-no-zoom value={camera} disabled={!current} title="机位" onMouseDown={stop} onChange={(e) => ctx.updateMetadata({ wallpaperCamera: e.target.value })} style={fieldStyle}>
                        <option value="">默认机位</option>
                        {(current ? current.cameras : []).map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.label || c.id}
                            </option>
                        ))}
                    </select>
                )}
                <button type="button" className="wp-btn" title="放大预览(也可双击壁纸空白处)" disabled={status !== "ok"} onMouseDown={stop} onDoubleClick={stop} onClick={() => setExpanded(true)}>
                    ⤢ 放大
                </button>
                <button type="button" className="wp-btn" title="重新读取壁纸列表并刷新" onMouseDown={stop} onDoubleClick={stop} onClick={() => setReloadKey((v) => v + 1)}>
                    ⟳ 刷新
                </button>
            </div>
            <div data-canvas-no-zoom style={{ position: "relative", flex: "1 1 auto", minHeight: 0, borderRadius: "0 0 22px 22px", overflow: "hidden", background: "#000" }}>
                {status === "ok" && expanded ? (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: t.node.placeholder, background: t.node.fill }}>正在放大预览 · 按 Esc 或双击返回</div>
                ) : status === "ok" ? (
                    <iframe
                        ref={frameRef}
                        key={`${src}#${reloadKey}`}
                        title="wallpaper-preview"
                        src={src}
                        allow="autoplay; fullscreen"
                        style={{ height: "100%", width: "100%", border: 0, display: "block", pointerEvents: dragging ? "none" : undefined }}
                    />
                ) : (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 20, textAlign: "center", fontSize: 13, color: t.node.placeholder, background: t.node.fill }}>
                        <span style={{ color: t.node.text }}>{message}</span>
                        {status === "error" && (
                            <>
                                <span>{wallpapers.length || external ? "确认预览服务还在运行" : "在壁纸项目目录运行 npm run preview;没有壁纸时先 npm run pipeline 构建"}</span>
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
    version: "1.1.0",
    description: "在画布里预览并交互 Wallpaper Engine 网页壁纸:下拉选择已构建的壁纸和机位",
    css,
    nodes: [
        {
            type: "wallpaper-preview:viewer",
            title: "壁纸预览",
            icon: "🖼",
            description: "选择壁纸项目里已构建的壁纸预览(npm run preview)",
            defaultSize: { width: 640, height: 400 },
            defaultMetadata: { wallpaperServer: DEFAULT_SERVER, wallpaperId: "", wallpaperCamera: "" },
            minimapColor: "#f59e0b",
            hidePanel: true,
            // 作为上游被消费时输出当前壁纸 id(下游壁纸预览节点会跟着选中它)
            resource: (node) => {
                const id = meta(node, "wallpaperId");
                return id ? { kind: "text", text: id } : null;
            },
            Content: WallpaperContent,
        },
    ],
});
