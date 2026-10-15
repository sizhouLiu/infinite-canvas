import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// Alignment guides while dragging nodes: the dragged selection's bounding box snaps its left / center / right and
// top / middle / bottom to the same lines of the nearby nodes, and the matched lines are drawn as guides.

/** Snap distance in screen pixels, so the feel stays the same at every zoom level. */
const SNAP_SCREEN_PX = 6;

export type SnapGuide = { axis: "x" | "y"; at: number; from: number; to: number };
type Rect = { left: number; top: number; right: number; bottom: number };

const rectOf = (node: CanvasNodeData): Rect => ({ left: node.position.x, top: node.position.y, right: node.position.x + node.width, bottom: node.position.y + node.height });

function linesOf(rect: Rect, axis: "x" | "y") {
    return axis === "x" ? [rect.left, (rect.left + rect.right) / 2, rect.right] : [rect.top, (rect.top + rect.bottom) / 2, rect.bottom];
}

/**
 * The extra offset that snaps `moving` onto the nearest line of `others` on each axis, and the guides to draw.
 * Members of a dragged group move with it and are passed in `excludeIds`, so they never snap to themselves.
 */
export function snapMovingRect(moving: Rect, nodes: CanvasNodeData[], excludeIds: Set<string>, scale: number) {
    const threshold = SNAP_SCREEN_PX / Math.max(scale, 0.01);
    // A member dragged inside its group must not snap to that group's own frame, which merely wraps it.
    const ownGroups = new Set(nodes.flatMap((node) => (excludeIds.has(node.id) && node.metadata?.groupId ? [node.metadata.groupId] : [])));
    const others = nodes.filter((node) => !excludeIds.has(node.id) && !ownGroups.has(node.id) && !(node.metadata?.groupId && excludeIds.has(node.metadata.groupId))).map(rectOf);
    const offset = { x: 0, y: 0 };
    const guides: SnapGuide[] = [];

    for (const axis of ["x", "y"] as const) {
        const own = linesOf(moving, axis);
        let best: { delta: number; at: number } | null = null;
        for (const rect of others) {
            for (const target of linesOf(rect, axis)) {
                for (const line of own) {
                    const delta = target - line;
                    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: target };
                }
            }
        }
        if (!best) continue;
        offset[axis] = best.delta;
        const snapped = axis === "x" ? { ...moving, left: moving.left + best.delta, right: moving.right + best.delta } : { ...moving, top: moving.top + best.delta, bottom: moving.bottom + best.delta };
        // Every node sharing the matched line extends the guide, so it spans from the farthest one to the selection.
        const aligned = others.filter((rect) => linesOf(rect, axis).some((value) => Math.abs(value - best!.at) < 0.5));
        const span = [snapped, ...aligned].flatMap((rect) => (axis === "x" ? [rect.top, rect.bottom] : [rect.left, rect.right]));
        guides.push({ axis, at: best.at, from: Math.min(...span), to: Math.max(...span) });
    }
    return { offset, guides };
}

/** Bounding box of the nodes being dragged; a dragged group's own frame already wraps its members. */
export function draggedRect(nodes: CanvasNodeData[], ids: Set<string>, dx: number, dy: number): Rect | null {
    const moving = nodes.filter((node) => ids.has(node.id) && !(node.type !== CanvasNodeType.Group && node.metadata?.groupId && ids.has(node.metadata.groupId)));
    if (!moving.length) return null;
    const rects = moving.map(rectOf);
    return {
        left: Math.min(...rects.map((rect) => rect.left)) + dx,
        top: Math.min(...rects.map((rect) => rect.top)) + dy,
        right: Math.max(...rects.map((rect) => rect.right)) + dx,
        bottom: Math.max(...rects.map((rect) => rect.bottom)) + dy,
    };
}
