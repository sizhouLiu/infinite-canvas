import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// Batch layout for a multi-selection: nudge, align and distribute. A selected group moves as one unit with its
// members, and a member whose group is also selected is not moved twice.

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom" | "distributeX" | "distributeY";

function movableItems(nodes: CanvasNodeData[], ids: Set<string>) {
    return nodes.filter((node) => ids.has(node.id) && !(node.metadata?.groupId && ids.has(node.metadata.groupId)));
}

/** Apply per-item offsets, carrying each moved group's members along. */
function applyOffsets(nodes: CanvasNodeData[], offsets: Map<string, { dx: number; dy: number }>) {
    const groupOffsets = new Map([...offsets].filter(([id]) => nodes.find((node) => node.id === id)?.type === CanvasNodeType.Group));
    return nodes.map((node) => {
        const offset = offsets.get(node.id) || (node.metadata?.groupId ? groupOffsets.get(node.metadata.groupId) : undefined);
        if (!offset || (!offset.dx && !offset.dy)) return node;
        return { ...node, position: { x: node.position.x + offset.dx, y: node.position.y + offset.dy } };
    });
}

export function moveNodes(nodes: CanvasNodeData[], ids: Set<string>, dx: number, dy: number) {
    return applyOffsets(nodes, new Map(movableItems(nodes, ids).map((node) => [node.id, { dx, dy }])));
}

/** Whether the mode can do anything: aligning needs two items, distributing needs three. */
export function canAlign(nodes: CanvasNodeData[], ids: Set<string>, mode: AlignMode) {
    return movableItems(nodes, ids).length >= (mode.startsWith("distribute") ? 3 : 2);
}

export function alignNodes(nodes: CanvasNodeData[], ids: Set<string>, mode: AlignMode) {
    const items = movableItems(nodes, ids);
    if (!canAlign(nodes, ids, mode)) return nodes;
    const left = Math.min(...items.map((node) => node.position.x));
    const top = Math.min(...items.map((node) => node.position.y));
    const right = Math.max(...items.map((node) => node.position.x + node.width));
    const bottom = Math.max(...items.map((node) => node.position.y + node.height));
    const offsets = new Map<string, { dx: number; dy: number }>();

    if (mode === "distributeX" || mode === "distributeY") {
        // Equal gaps between neighbours; the outermost two stay where they are.
        const horizontal = mode === "distributeX";
        const sorted = [...items].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y));
        const size = (node: CanvasNodeData) => (horizontal ? node.width : node.height);
        const gap = ((horizontal ? right - left : bottom - top) - sorted.reduce((sum, node) => sum + size(node), 0)) / (sorted.length - 1);
        let cursor = horizontal ? left : top;
        for (const node of sorted) {
            const delta = cursor - (horizontal ? node.position.x : node.position.y);
            offsets.set(node.id, horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
            cursor += size(node) + gap;
        }
        return applyOffsets(nodes, offsets);
    }

    for (const node of items) {
        if (mode === "left") offsets.set(node.id, { dx: left - node.position.x, dy: 0 });
        if (mode === "right") offsets.set(node.id, { dx: right - node.width - node.position.x, dy: 0 });
        if (mode === "centerX") offsets.set(node.id, { dx: (left + right) / 2 - node.width / 2 - node.position.x, dy: 0 });
        if (mode === "top") offsets.set(node.id, { dx: 0, dy: top - node.position.y });
        if (mode === "bottom") offsets.set(node.id, { dx: 0, dy: bottom - node.height - node.position.y });
        if (mode === "centerY") offsets.set(node.id, { dx: 0, dy: (top + bottom) / 2 - node.height / 2 - node.position.y });
    }
    return applyOffsets(nodes, offsets);
}
