import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { getConnectionEndpoint, nearestViewHandle } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type Position } from "@/types/canvas";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    label,
    onSelect,
    onContextMenu,
    onLabelClick,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    /** Multiview angle this connection feeds, shown as a chip at the midpoint. */
    label?: string;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
    onLabelClick?: (event: ReactMouseEvent<SVGGElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const start = getConnectionEndpoint(from, "source");
    const end = getConnectionEndpoint(to, "target", connection.toHandle);
    const startX = start.x;
    const startY = start.y;
    const endX = end.x;
    const endY = end.y;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    // The two control points are mirrored horizontally, so the curve's midpoint reduces to the midpoint of its ends.
    const labelX = (startX + endX) / 2;
    const labelY = (startY + endY) / 2;
    const labelWidth = Math.max(44, label ? label.length * 13 + 16 : 0);

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                d={pathD}
                stroke={active ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={active ? 3 : 2}
                strokeOpacity={active ? 1 : 0.82}
                fill="none"
                style={{ filter: active ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)` : undefined, pointerEvents: "none" }}
            />
            {label ? (
                <g
                    style={{ cursor: onLabelClick ? "pointer" : "default", pointerEvents: "auto" }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onLabelClick?.(event);
                    }}
                >
                    <rect x={labelX - labelWidth / 2} y={labelY - 11} width={labelWidth} height={22} rx={11} fill={theme.toolbar.panel} stroke={active ? theme.node.activeStroke : theme.node.muted} strokeWidth={1} />
                    <text x={labelX} y={labelY + 4} textAnchor="middle" fontSize={12} fill={theme.node.text} style={{ userSelect: "none" }}>
                        {label}
                    </text>
                </g>
            ) : null}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const fromPoint = handle.handleType === "source" ? getConnectionEndpoint(node, "source") : getConnectionEndpoint(node, "target", handle.view);
    const startX = handle.handleType === "source" ? fromPoint.x : mouseWorld.x;
    const startY = handle.handleType === "source" ? fromPoint.y : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : fromPoint.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : fromPoint.y;
    const snapView = handle.view || (handle.handleType === "source" && target?.type === CanvasNodeType.Model3d && node.type !== CanvasNodeType.Group ? nearestViewHandle(target, mouseWorld.y) : undefined);
    const snappedStart = handle.handleType === "target" && target ? getConnectionEndpoint(target, "source") : { x: startX, y: startY };
    const snappedEnd = handle.handleType === "source" && target ? getConnectionEndpoint(target, "target", snapView) : { x: endX, y: endY };
    const snappedStartX = snappedStart.x;
    const snappedStartY = snappedStart.y;
    const snappedEndX = snappedEnd.x;
    const snappedEndY = snappedEnd.y;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
