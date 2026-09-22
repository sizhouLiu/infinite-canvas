import { MULTIVIEW_VIEWS, type MultiviewView } from "@/services/api/model3d-ops";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle } from "@/types/canvas";

/** Vertical inset from the node top/bottom to the first/last of the four left-side view sockets. */
const VIEW_HANDLE_INSET = 36;

export function isMultiviewView(value: string | undefined): value is MultiviewView {
    return Boolean(value && (MULTIVIEW_VIEWS as readonly string[]).includes(value));
}

/**
 * World Y of a 3D node's left-side view socket. Four sockets sit in a vertical stack (front / left / back / right)
 * so a drag can land on one angle the way a Shader Editor input does, rather than sharing a single mid-left handle.
 */
export function getViewHandleY(node: CanvasNodeData, view: MultiviewView) {
    const index = MULTIVIEW_VIEWS.indexOf(view);
    const span = Math.max(node.height - VIEW_HANDLE_INSET * 2, 0);
    const step = MULTIVIEW_VIEWS.length > 1 ? span / (MULTIVIEW_VIEWS.length - 1) : 0;
    return node.position.y + VIEW_HANDLE_INSET + index * step;
}

export function nearestViewHandle(node: CanvasNodeData, worldY: number): MultiviewView {
    return MULTIVIEW_VIEWS.reduce((best, view) => (Math.abs(getViewHandleY(node, view) - worldY) < Math.abs(getViewHandleY(node, best) - worldY) ? view : best), MULTIVIEW_VIEWS[0]);
}

export function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (acc, node) => ({
            left: Math.min(acc.left, node.position.x),
            top: Math.min(acc.top, node.position.y),
            right: Math.max(acc.right, node.position.x + node.width),
            bottom: Math.max(acc.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
}

export function findGroupDropTarget(movedIds: Set<string>, nodes: CanvasNodeData[]) {
    if (nodes.some((node) => movedIds.has(node.id) && node.type === CanvasNodeType.Group)) return null;
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return null;
    return (
        [...nodes].reverse().find((group) => {
            if (group.type !== CanvasNodeType.Group || movedIds.has(group.id)) return false;
            return movingNodes.some((node) => {
                const centerX = node.position.x + node.width / 2;
                const centerY = node.position.y + node.height / 2;
                return centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height;
            });
        }) || null
    );
}

export function snapNodesIntoGroup(movedIds: Set<string>, nodes: CanvasNodeData[], group: CanvasNodeData) {
    const movingNodes = nodes.filter((node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group);
    if (!movingNodes.length) return nodes;
    const pad = 24;
    const bounds = nodeBounds(movingNodes);
    const left = group.position.x + pad;
    const top = group.position.y + pad;
    const right = group.position.x + group.width - pad;
    const bottom = group.position.y + group.height - pad;
    const dx = bounds.right - bounds.left > right - left ? left - bounds.left : bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0;
    const dy = bounds.bottom - bounds.top > bottom - top ? top - bounds.top : bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? bottom - bounds.bottom : 0;
    return nodes.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
        return { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: { ...node.metadata, groupId: group.id } };
    });
}

export const GROUP_WRAP_PADDING = 24;
export const GROUP_WRAP_TOP_PADDING = 52;

function selectedGroupIds(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    return new Set(nodes.filter((node) => selectedIds.has(node.id) && node.type === CanvasNodeType.Group).map((node) => node.id));
}

export function collectGroupMemberNodes(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    const groups = selectedGroupIds(selectedIds, nodes);
    return nodes.filter((node) => node.type !== CanvasNodeType.Group && (selectedIds.has(node.id) || (node.metadata?.groupId != null && groups.has(node.metadata.groupId))));
}

export function getGroupWrapRect(members: CanvasNodeData[]) {
    const bounds = nodeBounds(members);
    return {
        x: bounds.left - GROUP_WRAP_PADDING,
        y: bounds.top - GROUP_WRAP_TOP_PADDING,
        width: bounds.right - bounds.left + GROUP_WRAP_PADDING * 2,
        height: bounds.bottom - bounds.top + GROUP_WRAP_TOP_PADDING + GROUP_WRAP_PADDING,
    };
}

export function canGroupSelectedNodes(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    const members = collectGroupMemberNodes(selectedIds, nodes);
    if (members.length < 2) return false;
    const groupId = members[0].metadata?.groupId;
    return !groupId || members.some((node) => node.metadata?.groupId !== groupId);
}

export function canUngroupSelectedNodes(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    return nodes.some((node) => selectedIds.has(node.id) && (node.type === CanvasNodeType.Group || Boolean(node.metadata?.groupId)));
}

function emptyGroupIds(nodes: CanvasNodeData[], keepId?: string) {
    const used = new Set(nodes.flatMap((node) => (node.type !== CanvasNodeType.Group && node.metadata?.groupId ? [node.metadata.groupId] : [])));
    return new Set(nodes.filter((node) => node.type === CanvasNodeType.Group && node.id !== keepId && !used.has(node.id)).map((node) => node.id));
}

function withoutRemoved(nodes: CanvasNodeData[], connections: CanvasConnection[], removedIds: Set<string>) {
    return {
        nodes: nodes.filter((node) => !removedIds.has(node.id)),
        connections: connections.filter((connection) => !removedIds.has(connection.fromNodeId) && !removedIds.has(connection.toNodeId)),
    };
}

export function applyGroupSelection(selectedIds: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[], group: CanvasNodeData) {
    const members = collectGroupMemberNodes(selectedIds, nodes);
    if (members.length < 2) return null;
    const memberIds = new Set(members.map((node) => node.id));
    const flattenedGroupIds = selectedGroupIds(selectedIds, nodes);
    const updated = nodes.filter((node) => !flattenedGroupIds.has(node.id)).map((node) => (memberIds.has(node.id) ? { ...node, metadata: { ...node.metadata, groupId: group.id } } : node));
    const insertAt = updated.findIndex((node) => memberIds.has(node.id));
    const withGroup = insertAt < 0 ? [...updated, group] : [...updated.slice(0, insertAt), group, ...updated.slice(insertAt)];
    const next = withoutRemoved(withGroup, connections, new Set([...flattenedGroupIds, ...emptyGroupIds(withGroup, group.id)]));
    return { ...next, selectedIds: [group.id] };
}

export function applyUngroupSelection(selectedIds: Set<string>, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const flattenedGroupIds = selectedGroupIds(selectedIds, nodes);
    if (!flattenedGroupIds.size && !nodes.some((node) => selectedIds.has(node.id) && node.metadata?.groupId)) return null;
    const releasedIds = new Set<string>();
    const updated = nodes
        .filter((node) => !flattenedGroupIds.has(node.id))
        .map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            if (!flattenedGroupIds.has(groupId) && !selectedIds.has(node.id)) return node;
            releasedIds.add(node.id);
            return { ...node, metadata: { ...node.metadata, groupId: undefined } };
        });
    const next = withoutRemoved(updated, connections, new Set([...flattenedGroupIds, ...emptyGroupIds(updated)]));
    return { ...next, selectedIds: next.nodes.filter((node) => selectedIds.has(node.id) || releasedIds.has(node.id)).map((node) => node.id) };
}

export function findContainingGroupId(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    const centerX = node.position.x + node.width / 2;
    const centerY = node.position.y + node.height / 2;
    return (
        [...nodes]
            .reverse()
            .find((group) => group.type === CanvasNodeType.Group && group.id !== node.id && centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height)?.id ||
        undefined
    );
}

export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle, worldY?: number) {
    const view = current.view || (node.type === CanvasNodeType.Model3d && current.handleType === "source" && worldY != null ? nearestViewHandle(node, worldY) : undefined);
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: view && node.type === CanvasNodeType.Model3d ? getViewHandleY(node, view) : node.position.y + node.height / 2,
    };
}

export function getConnectionEndpoint(node: CanvasNodeData, side: "source" | "target", view?: MultiviewView) {
    return {
        x: side === "source" ? node.position.x + node.width : node.position.x,
        y: view && node.type === CanvasNodeType.Model3d && side === "target" ? getViewHandleY(node, view) : node.position.y + node.height / 2,
    };
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target", view?: MultiviewView) {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    // A group is a source, never a generation target. Dragging out of a 3D socket onto a group still means the group feeds the 3D node.
    if (second.type === CanvasNodeType.Group) {
        if (firstHandleType === "target" && first.type === CanvasNodeType.Model3d) return { fromNodeId: second.id, toNodeId: first.id };
        return null;
    }
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    // Drawn out of a config node: it feeds the target's generation parameters rather than acting as a fan-in hub.
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id, kind: "parameter" as const };
    // Dragging out of a 3D view socket toward an image still means the image feeds that socket.
    if (firstHandleType === "target" && first.type === CanvasNodeType.Model3d && second.type !== CanvasNodeType.Model3d) {
        return { fromNodeId: second.id, toNodeId: first.id, ...(view && second.type !== CanvasNodeType.Group ? { toHandle: view } : {}) };
    }
    const toHandle = second.type === CanvasNodeType.Model3d && first.type !== CanvasNodeType.Group ? view : undefined;
    return { fromNodeId: first.id, toNodeId: second.id, ...(toHandle ? { toHandle } : {}) };
}
