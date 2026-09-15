import axios from "axios";

import i18n from "@/i18n";
import { useConfigStore, withLocalProxy, type AiConfig } from "@/stores/use-config-store";

// Shared Tripo protocol layer used by both the 3D and image capabilities.
// Every authenticated /v3 call needs the local proxy (Tripo sends no CORS headers on any region host),
// while the output CDN allows direct browser access, so result files are fetched without the proxy.
const TRIPO_API_VERSION = "v3";

// Poll boundaries are shared with the 3D flow; the user signed off on 5s / 600s.
export const TRIPO_POLL_INTERVAL_MS = 5000;
export const TRIPO_POLL_TIMEOUT_MS = 600000;

export const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type TripoRequestOptions = { signal?: AbortSignal };
export type TripoEnvelope<T> = { code?: number; data?: T | null; message?: string; suggestion?: string };

/** Terminal task states other than success; each releases the frozen credits. */
export const TRIPO_FAILED_STATES = ["failed", "banned", "expired", "cancelled"];

export function tripoUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    const base = config.baseUrl.trim().replace(/\/+$/, "");
    const root = new RegExp(`/${TRIPO_API_VERSION}$`, "i").test(base) ? base : `${base}/${TRIPO_API_VERSION}`;
    return withLocalProxy(`${root}${path}`);
}

/**
 * Every authenticated Tripo endpoint needs the local proxy, so bail out with a readable message instead of
 * letting the browser fail the preflight. An `Authorization` header forces a CORS preflight, preflights carry
 * no credentials, and Tripo answers an uncredentialed OPTIONS with a bare 401 — so nothing the page sends can
 * satisfy it. Without this check the only symptom is a console full of CORS errors.
 */
export function assertTripoProxy() {
    if (!useConfigStore.getState().config.proxyEnabled) throw new Error(apiText("tripoProxyRequired"));
}

export function tripoHeaders(config: Pick<AiConfig, "apiKey">, contentType?: string) {
    return { Authorization: `Bearer ${config.apiKey}`, ...(contentType ? { "Content-Type": contentType } : {}) };
}

/**
 * Turn a failed Tripo request into a readable message. Tripo answers an auth failure with a 401 and a body of
 * `{code: 2, message: "Authentication required" | "Invalid API key"}`; without this the user only sees axios's
 * "Request failed with status code 401" and has to open the network tab to learn anything. The two regions are
 * separate accounts, so a valid key sent to the wrong region 401s exactly like a missing one — hence the hint.
 */
export function readTripoError(error: unknown, fallbackKey: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const payload = error.response?.data as TripoEnvelope<unknown> | undefined;
        const detail = [payload?.message, payload?.suggestion].filter(Boolean).join(" — ");
        if (status === 401 || status === 403) return `${apiText("tripoAuthFailed")}${detail ? `（${detail}）` : ""}`;
        if (detail) return detail;
        if (!error.response && error.code === "ERR_NETWORK") return apiText("tripoProxyUnreachable");
        if (status) return apiText("httpFailed", { status });
        return error.message || apiText(fallbackKey);
    }
    return error instanceof Error ? error.message : apiText(fallbackKey);
}

/** Wrap a Tripo call so every failure carries a readable message instead of an axios status string. */
export async function tripoRequest<T>(fallbackKey: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if (isTripoTaskFailed(error) || (error instanceof DOMException && error.name === "AbortError")) throw error;
        throw new Error(readTripoError(error, fallbackKey));
    }
}

/** Tripo answers with { code, data } and uses code 0 for success; any other code carries a readable message. */
export function unwrapTripo<T>(payload: TripoEnvelope<T> | null | undefined, fallbackKey: string): T {
    if (payload && typeof payload.code === "number" && payload.code !== 0) {
        throw new Error([payload.message, payload.suggestion].filter(Boolean).join(" — ") || apiText(fallbackKey));
    }
    const data = payload?.data;
    if (!data) throw new Error(apiText(fallbackKey));
    return data;
}

export function isTripoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "TripoTaskFailed";
}

export function tripoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "TripoTaskFailed";
    return error;
}

/** Upload a file so a generation can reference it; Tripo rejects data: URLs and local blob URLs. */
export async function uploadTripoFile(config: AiConfig, file: File, options?: TripoRequestOptions) {
    const form = new FormData();
    form.append("file", file);
    const response = await tripoRequest("tripoUploadFailed", () =>
        axios.post<TripoEnvelope<{ file_token?: string }>>(tripoUrl(config, "/files"), form, { headers: tripoHeaders(config), signal: options?.signal }),
    );
    const token = unwrapTripo(response.data, "tripoUploadFailed").file_token;
    if (!token) throw new Error(apiText("tripoUploadFailed"));
    return token;
}

export function tripoDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
