/**
 * Slider bounds for the 3D face limit. The real ceiling differs per model version (P2 accepts 48-25000), so this is a
 * common range and Tripo still validates the value it receives. Auto sends no face_limit at all and lets Tripo pick.
 */
export const MODEL3D_FACE_LIMIT_MIN = 48;
export const MODEL3D_FACE_LIMIT_MAX = 25000;
export const MODEL3D_FACE_LIMIT_STEP = 100;
export const MODEL3D_FACE_LIMIT_DEFAULT = 5000;

/**
 * Auto is stored as this marker rather than a blank. The config store's merge runs on every load and falls back to the
 * default for an empty value, so a blank could never persist: turning auto on would silently revert on the next reload.
 */
export const MODEL3D_FACE_LIMIT_AUTO = "auto";

/**
 * Clamps the face limit to the slider range; Tripo validates the result against the model's own ceiling. Returns the
 * auto marker for auto, and treats an unusable value as auto rather than inventing a count.
 */
export function normalizeModel3dFaceLimitValue(value: string | undefined) {
    if (value === MODEL3D_FACE_LIMIT_AUTO) return MODEL3D_FACE_LIMIT_AUTO;
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit < 1) return MODEL3D_FACE_LIMIT_AUTO;
    return String(Math.max(MODEL3D_FACE_LIMIT_MIN, Math.min(MODEL3D_FACE_LIMIT_MAX, Math.floor(limit))));
}

/** Whether the face limit is left to Tripo, in which case no face_limit is sent. */
export function isModel3dFaceLimitAuto(value: string | undefined) {
    return normalizeModel3dFaceLimitValue(value) === MODEL3D_FACE_LIMIT_AUTO;
}
