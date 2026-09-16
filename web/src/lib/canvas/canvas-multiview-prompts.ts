import i18n from "@/i18n";
import { MULTIVIEW_VIEWS, type MultiviewView } from "@/services/api/model3d-ops";

/**
 * Prompts for the built-in multiview generator, which drives an ordinary image model instead of Tripo's
 * dedicated endpoint. Each view is its own edit request against the same source image, so the four run
 * independently and in parallel: one failure does not take the others down, and no view depends on the
 * quality of the one before it.
 *
 * Consistency between the views is therefore up to the model, which is why every prompt restates the
 * subject-preserving constraints rather than relying on the previous view for them.
 */
const VIEW_DIRECTIONS: Record<MultiviewView, string> = {
    front: "directly from the front, facing the camera",
    left: "from the subject's left side, a true 90-degree side profile",
    back: "from directly behind, showing the subject's back",
    right: "from the subject's right side, a true 90-degree side profile",
};

const SHARED_CONSTRAINTS = [
    "Keep the same subject, identity, proportions, outfit, colors, and art style as the reference image.",
    "Keep the camera height, distance, framing, and lighting identical to the reference.",
    "Full body in frame, centered, upright, neutral A-pose, on a plain neutral background.",
    "No text, no watermark, no extra objects, no additional views in the same image.",
].join(" ");

export function multiviewPrompt(view: MultiviewView) {
    return `Redraw this exact subject viewed ${VIEW_DIRECTIONS[view]}. ${SHARED_CONSTRAINTS}`;
}

/** Localized node title for a generated view, matching the Tripo multiview path's titles. */
export function multiviewViewTitle(view: MultiviewView) {
    return i18n.t(`canvas.model3dOps.views.${view}`);
}

export const BUILTIN_MULTIVIEW_VIEWS = MULTIVIEW_VIEWS;

/**
 * Seconds to wait before retrying a view, or null when the failure was not a rate limit. The image layer
 * recognizes the limit while the axios error is intact and attaches the delay to the Error it throws, since
 * wrapping the failure into a plain Error would otherwise drop the status, `Retry-After` header, and the
 * provider's error code (Tripo answers a generation limit with `code: 2000`).
 */
export function retryAfterSeconds(error: unknown): number | null {
    const seconds = (error as { retryAfterSeconds?: unknown })?.retryAfterSeconds;
    return typeof seconds === "number" && seconds > 0 ? seconds : null;
}

/** Abortable delay for the rate-limit backoff, so cancelling the run does not wait it out first. */
export function multiviewDelay(ms: number, signal?: AbortSignal) {
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
