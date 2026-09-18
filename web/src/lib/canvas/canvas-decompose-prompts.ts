/**
 * Scene decomposition: ask the model what separable objects a picture holds, then extract each one as its
 * own image. Splitting by prompt rather than by grid is the whole point — a grid cell is still a patch of the
 * original scene, while an extracted object is a usable asset that can be recomposed or sent to 3D.
 *
 * The listing step and the extraction step are deliberately separate requests: the list is cheap text the
 * user can correct before any image credits are spent, and each extraction then runs on its own so one bad
 * object does not contaminate the others.
 */
import { imageReferenceLabel } from "@/lib/image-reference-prompt";

/**
 * How many components one listing may return. The extractions run one at a time, so this is really a bound on
 * how long a single click can keep generating; anything past it is dropped by visual importance and the user
 * can still delete rows before generating.
 */
export const DECOMPOSE_MAX_ITEMS = 12;

export type DecomposeItem = {
    /** Short label, used as the generated node's title. */
    name: string;
    /** Appearance description carried into the extraction prompt, when the model supplied one. */
    description?: string;
};

/**
 * Prompt for the listing step. It asks for JSON because there is no structured-output mode on the text path
 * (`requestImageQuestion` returns a plain string), so the shape has to be requested and then parsed
 * defensively — see `parseDecomposeList`.
 */
export function decomposeListPrompt(max: number = DECOMPOSE_MAX_ITEMS) {
    return [
        `List the separable objects in ${imageReferenceLabel(0)} — the things that could be lifted out of the scene and used on their own, such as characters, props, furniture, vehicles, plants, and devices.`,
        "Exclude anything that is not a discrete object: background, sky, ground, walls, floors, lighting, shadows, reflections, atmosphere, and the scene as a whole.",
        `Order them by visual importance and return at most ${max}.`,
        'Answer with a JSON array only, no prose and no code fence, where each element is {"name": string, "description": string}.',
        '"name" is a short label of two to six words in the same language as this instruction; "description" is an English sentence describing that object\'s appearance, colors, and material as seen in the image.',
    ].join(" ");
}

/**
 * Read the listing answer. Model output is untrusted text: it may arrive fenced, wrapped in explanation, or
 * as a plain markdown list, so JSON is attempted first and a line-based reading is the fallback rather than
 * an error. Empty and duplicate names are dropped, and the result is capped at `max`.
 */
export function parseDecomposeList(text: string, max: number = DECOMPOSE_MAX_ITEMS): DecomposeItem[] {
    const raw = String(text ?? "");
    const fenced = raw.replace(/```(?:json)?/gi, "");
    const start = fenced.indexOf("[");
    const end = fenced.lastIndexOf("]");
    let items: DecomposeItem[] = [];
    if (start >= 0 && end > start) {
        try {
            const parsed = JSON.parse(fenced.slice(start, end + 1));
            if (Array.isArray(parsed)) {
                items = parsed.flatMap((entry) => {
                    const name = typeof entry === "string" ? entry : String((entry as { name?: unknown })?.name ?? "");
                    const description = typeof entry === "object" && entry ? String((entry as { description?: unknown }).description ?? "") : "";
                    return name.trim() ? [{ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }] : [];
                });
            }
        } catch {
            items = [];
        }
    }
    if (!items.length) {
        items = fenced
            .split("\n")
            .map((line) => line.replace(/^\s*(?:[-*+•]|\d+[.)])\s*/, "").trim())
            .filter((line) => line && !line.startsWith("{") && !line.startsWith("["))
            .map((line) => ({ name: line.replace(/^["'`]|["'`,]$/g, "").trim() }))
            .filter((item) => Boolean(item.name));
    }
    const seen = new Set<string>();
    return items
        .filter((item) => {
            const key = item.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, Math.max(1, max));
}

/**
 * Prompt for one extraction. Every constraint is restated per object rather than relying on the previous
 * request, because each extraction is an independent edit against the original scene.
 */
export function decomposeExtractPrompt(item: DecomposeItem) {
    const subject = item.description ? `${item.name} (${item.description})` : item.name;
    return [
        `From ${imageReferenceLabel(0)}, redraw only this one object: ${subject}.`,
        "Show that object complete and unoccluded, centered and filling the frame, reconstructing any part hidden in the original.",
        "Keep its identity, proportions, colors, materials, art style, and lighting direction exactly as in the reference.",
        "Fully transparent background. No other objects, no ground plane, no cast shadow on anything else, no text, no watermark.",
    ].join(" ");
}
