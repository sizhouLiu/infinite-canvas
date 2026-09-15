import axios from "axios";

import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { imageToDataUrl } from "@/services/image-storage";
import { withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { apiText, assertTripoProxy, TRIPO_FAILED_STATES, TRIPO_POLL_INTERVAL_MS, TRIPO_POLL_TIMEOUT_MS, tripoDelay, tripoHeaders, tripoRequest, tripoUrl, unwrapTripo, uploadTripoFile, type TripoEnvelope, type TripoRequestOptions } from "./tripo-shared";

// Tripo image generation. Same async envelope as the 3D flow: create a task, poll it, read the output URL.
// Tripo exposes no model-list endpoint, so the channel editor offers these verified sets directly.
// Both lists come from the API's own 1004 validation message rather than the docs.
export const TRIPO_IMAGE_MODELS = ["seedream_v5", "seedream_v4", "banana", "banana_pro", "banana2", "chat_image_2", "chat_image_2.5_flare", "chat_image_2.5_sunburst", "chat_image_1.5", "chat_image_1"];

/** Only these accept `quality`; sending it with any other model is a hard 1004. */
const QUALITY_MODELS = ["chat_image_2", "chat_image_2.5_flare", "chat_image_2.5_sunburst"];
/** Only these accept `background`; others ignore it silently. */
const BACKGROUND_MODELS = ["chat_image_2.5_flare", "chat_image_2.5_sunburst"];
const QUALITY_TIERS_BY_MODEL: Record<string, string[]> = {
    chat_image_2: ["low", "medium", "high"],
    "chat_image_2.5_flare": ["low", "medium", "high", "xhigh", "max"],
    "chat_image_2.5_sunburst": ["low", "medium", "high", "xhigh", "max"],
};

type TripoImageOutput = { generated_image_url?: string; generated_image_urls?: string[] };
type TripoImageTask = { task_id?: string; status?: string; progress?: number; output?: TripoImageOutput | null; error_message?: string };

export type TripoImageParams = {
    /** Canvas quality token (1k/2k/4k or low/medium/high); mapped per model. */
    quality?: string;
    /** Either "WxH" pixels or a "W:H" ratio; routed to `size` or `aspect_ratio` depending on the model. */
    size?: string;
    background?: string;
};

export function supportsTripoQuality(model: string) {
    return QUALITY_MODELS.includes(model);
}

/** Tripo rejects `auto` outright — it prices the request up front — so an unknown tier is dropped. */
function resolveTripoQuality(model: string, quality: string | undefined) {
    const tiers = QUALITY_TIERS_BY_MODEL[model];
    if (!tiers) return undefined;
    const value = (quality || "").trim().toLowerCase();
    const mapped = value === "1k" ? "low" : value === "2k" ? "medium" : value === "4k" ? "high" : value;
    return tiers.includes(mapped) ? mapped : undefined;
}

/**
 * Sizing rules differ per family and per model version, all read off the API's own 1004 messages:
 * - seedream: K-tier or WxH, but each version accepts a different tier set and rejects a small WxH
 *   ("total pixels below minimum" for anything under roughly 8 MP), so a tier is used and clamped.
 * - banana / banana_pro: one of a fixed WxH list, no K-tier; `aspect_ratio` alone lets the gateway pick.
 * - banana2: K-tier only, plus the widest `aspect_ratio` set.
 * - chat_image: arbitrary WxH or the literal "auto", never a K-tier.
 */
type TripoImageFamily = "seedream" | "banana" | "banana2" | "chat_image";

const BANANA_SIZES = ["1024x1024", "832x1248", "1248x832", "864x1184", "1184x864", "896x1152", "1152x896", "768x1344", "1344x768", "1536x672"];
/** Accepted K-tiers per model; anything outside its own list is a hard 1004. */
const K_TIERS_BY_MODEL: Record<string, string[]> = {
    seedream_v4: ["2K", "4K"],
    seedream_v5: ["2K", "3K"],
    banana2: ["0.5K", "1K", "2K", "4K"],
};
const DEFAULT_K_TIERS = ["2K", "4K"];
/** Only the banana series accepts `aspect_ratio`; seedream and chat_image size by `size` instead. */
const ASPECT_RATIO_FAMILIES: TripoImageFamily[] = ["banana", "banana2"];

function tripoImageFamily(model: string): TripoImageFamily {
    if (model === "banana2") return "banana2";
    if (model.startsWith("banana")) return "banana";
    if (model.startsWith("chat_image")) return "chat_image";
    return "seedream";
}

/** The canvas expresses resolution as a quality tier; Tripo takes it as a K-tier size. */
function kTierFromQuality(quality: string | undefined) {
    const value = (quality || "").trim().toLowerCase();
    if (value === "4k" || value === "high") return 4;
    if (value === "2k" || value === "medium" || value === "hd") return 2;
    if (value === "1k" || value === "low" || value === "standard") return 1;
    return undefined;
}

/** Snap the requested tier to the nearest one this model accepts, so 1K or 4K never hard-fails. */
function resolveKTier(model: string, quality: string | undefined) {
    const requested = kTierFromQuality(quality);
    if (requested === undefined) return undefined;
    const allowed = K_TIERS_BY_MODEL[model] || DEFAULT_K_TIERS;
    return allowed.reduce((best, tier) => (Math.abs(parseFloat(tier) - requested) < Math.abs(parseFloat(best) - requested) ? tier : best), allowed[0]);
}

function resolveTripoSizing(model: string, size: string | undefined, quality: string | undefined) {
    const family = tripoImageFamily(model);
    const value = (size || "").trim();
    const isAuto = !value || value.toLowerCase() === "auto";
    const isRatio = !isAuto && value.includes(":");
    const pixels = !isAuto && !isRatio ? value : undefined;
    const kTier = resolveKTier(model, quality);
    const ratio = ASPECT_RATIO_FAMILIES.includes(family) && isRatio ? { aspect_ratio: value } : {};

    if (family === "chat_image") {
        // Accepts any WxH, otherwise "auto" — a ratio or K-tier would be rejected outright.
        return { size: pixels || "auto" };
    }
    if (family === "banana") {
        // A WxH outside the fixed list is rejected, so anything else defers to aspect_ratio.
        if (pixels && BANANA_SIZES.includes(pixels)) return { size: pixels };
        return ratio;
    }
    if (family === "banana2") return { ...ratio, ...(kTier ? { size: kTier } : {}) };
    // seedream: prefer the clamped tier; a small explicit WxH is rejected outright.
    return kTier ? { size: kTier } : {};
}

function resolveTripoBackground(model: string, background: string | undefined) {
    const value = (background || "").trim().toLowerCase();
    if (!BACKGROUND_MODELS.includes(model) || !value) return {};
    // transparent requires png, which is the only output format used here.
    return ["auto", "opaque", "transparent"].includes(value) ? { background: value } : {};
}

function tripoImageBody(config: AiConfig, prompt: string, params: TripoImageParams) {
    const model = config.model.trim();
    return {
        model,
        prompt,
        output_format: "png",
        ...resolveTripoSizing(model, params.size, params.quality),
        ...(resolveTripoQuality(model, params.quality) ? { quality: resolveTripoQuality(model, params.quality) } : {}),
        ...resolveTripoBackground(model, params.background),
    };
}

function assertTripoImageConfig(config: AiConfig) {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    if (!config.model.trim()) throw new Error(apiText("modelRequired"));
    assertTripoProxy();
}

/**
 * Run one Tripo image task end to end and return the output URL. Tripo has no `n` parameter, so callers
 * that want several images issue several tasks; each is billed separately.
 */
async function runTripoImageTask(config: AiConfig, path: string, body: Record<string, unknown>, options?: TripoRequestOptions) {
    const created = await tripoRequest("tripoImageTaskCreateFailed", () =>
        axios.post<TripoEnvelope<TripoImageTask>>(tripoUrl(config, path), body, { headers: tripoHeaders(config, "application/json"), signal: options?.signal }),
    );
    const taskId = unwrapTripo(created.data, "tripoImageTaskCreateFailed").task_id;
    if (!taskId) throw new Error(apiText("tripoImageNoTaskId"));

    const deadline = performance.now() + TRIPO_POLL_TIMEOUT_MS;
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await tripoDelay(TRIPO_POLL_INTERVAL_MS, options?.signal);
        const response = await tripoRequest("tripoImageTaskQueryFailed", () => axios.get<TripoEnvelope<TripoImageTask>>(tripoUrl(config, `/tasks/${taskId}`), { headers: tripoHeaders(config), signal: options?.signal }));
        const task = unwrapTripo(response.data, "tripoImageTaskQueryFailed");
        const url = task.output?.generated_image_url || task.output?.generated_image_urls?.[0];
        if (task.status === "success" && url) return url;
        if (TRIPO_FAILED_STATES.includes(task.status || "")) throw new Error(task.error_message || apiText("tripoImageGenerationFailed"));
        if (performance.now() >= deadline) throw new Error(apiText("tripoImageTimeout"));
    }
}

/**
 * Tripo returns a signed CDN URL that expires within a day, so the image is fetched immediately and
 * converted to a data URL — matching what the OpenAI and Gemini paths hand back.
 *
 * Image outputs are served from CloudFront (tripo-data.*.data.tripo3d.com) which sends no
 * Access-Control-Allow-Origin, unlike the 3D output CDN (openapi.cdn.tripo3d.com) which does. So this
 * fetch must go through the local proxy; reading it directly fails with an opaque CORS error.
 */
async function toDataUrl(url: string) {
    const response = await fetch(withLocalProxy(url));
    if (!response.ok) throw new Error(apiText("tripoImageDownloadFailed"));
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(apiText("tripoImageDownloadFailed")));
        reader.readAsDataURL(blob);
    });
}

async function runTripoImageTasks(config: AiConfig, path: string, body: Record<string, unknown>, count: number, options?: TripoRequestOptions) {
    const urls = await Promise.all(Array.from({ length: count }, () => runTripoImageTask(config, path, body, options)));
    const dataUrls = await Promise.all(urls.map(toDataUrl));
    return dataUrls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
}

export async function requestTripoImageGeneration(config: AiConfig, prompt: string, count: number, params: TripoImageParams, options?: TripoRequestOptions) {
    assertTripoImageConfig(config);
    if (!prompt.trim()) throw new Error(apiText("promptRequired"));
    return runTripoImageTasks(config, "/generation/text-to-image", tripoImageBody(config, prompt.trim(), params), count, options);
}

export async function requestTripoImageEdit(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, params: TripoImageParams, options?: TripoRequestOptions) {
    assertTripoImageConfig(config);
    if (!references.length) throw new Error(apiText("referenceRequired"));
    // Tripo rejects data: URLs, so each reference is uploaded first and passed as a file_token.
    const tokens = await Promise.all(
        references.map(async (image) => {
            const file = dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) });
            return uploadTripoFile(config, file, options);
        }),
    );
    const body = {
        ...tripoImageBody(config, prompt.trim(), params),
        input: tokens[0],
        ...(tokens.length > 1 ? { inputs: tokens } : {}),
    };
    return runTripoImageTasks(config, "/generation/image-to-image", body, count, options);
}
