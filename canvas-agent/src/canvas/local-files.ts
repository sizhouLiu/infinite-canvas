import path from "node:path";

/** 本机文件按扩展名归属的画布节点类型，以及发给网页时使用的 MIME。 */
const LOCAL_FILE_KINDS = {
    image: { extensions: ["avif", "gif", "jpg", "jpeg", "png", "webp"], mimeTypes: { avif: "image/avif", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } },
    video: { extensions: ["mp4", "webm", "mov"], mimeTypes: { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" } },
    audio: { extensions: ["mp3", "wav", "m4a", "ogg", "flac"], mimeTypes: { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac" } },
    // OBJ 依赖同目录的 mtl 和贴图，单个文件读不全，交给网页的文件导入处理。
    model3d: { extensions: ["glb", "fbx"], mimeTypes: { glb: "model/gltf-binary", fbx: "application/octet-stream" } },
} satisfies Record<string, { extensions: string[]; mimeTypes: Record<string, string> }>;

export type LocalFileKind = keyof typeof LOCAL_FILE_KINDS;

export const LOCAL_FILE_EXTENSIONS = Object.values(LOCAL_FILE_KINDS).flatMap((item) => item.extensions);

function fileExtension(filePath: string) {
    return path.extname(filePath).replace(".", "").toLowerCase();
}

/** 判断本机文件应创建成哪种画布节点，不支持的扩展名返回 null。 */
export function localFileKind(filePath: string): LocalFileKind | null {
    const extension = fileExtension(filePath);
    return (Object.keys(LOCAL_FILE_KINDS) as LocalFileKind[]).find((kind) => LOCAL_FILE_KINDS[kind].extensions.includes(extension)) || null;
}

/** 读取本机文件对应的 MIME，未知扩展名按二进制流返回。 */
export function localFileMimeType(filePath: string) {
    const kind = localFileKind(filePath);
    if (!kind) return "application/octet-stream";
    return (LOCAL_FILE_KINDS[kind].mimeTypes as Record<string, string>)[fileExtension(filePath)] || "application/octet-stream";
}
