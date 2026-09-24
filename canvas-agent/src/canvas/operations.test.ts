import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCanvasToolRequest } from "./operations.js";

function opsOf(name: Parameters<typeof buildCanvasToolRequest>[0], input: Record<string, unknown>) {
    const request = buildCanvasToolRequest(name, input, null);
    return (request.input as { ops: Array<Record<string, any>> }).ops;
}

test("generation flow reuses referenced nodes when the prompt only mentions them", () => {
    const ops = opsOf("canvas_generate_image", { prompt: "@[node:text-1]", referenceNodeIds: ["text-1"], title: "Flow", autoRun: true });
    const addedTextNodes = ops.filter((op) => op.type === "add_node" && op.nodeType === "text");
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    const runs = ops.filter((op) => op.type === "run_generation");
    assert.equal(addedTextNodes.length, 0);
    assert.equal(ops.filter((op) => op.type === "connect_nodes" && op.fromNodeId === "text-1" && String(op.toNodeId).startsWith("config-")).length, 1);
    assert.match(String(config?.metadata?.prompt), /^@\[node:text-1\]$/);
    assert.equal(runs.length, 1);
});

test("generation flow still creates a prompt node for prose prompts", () => {
    const ops = opsOf("canvas_generate_image", { prompt: "a cat on a roof", referenceNodeIds: ["text-1"], autoRun: true });
    assert.equal(ops.filter((op) => op.type === "add_node" && op.nodeType === "text").length, 1);
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    assert.match(String(config?.metadata?.prompt), /@\[node:text-/);
});

test("canvas_generate_model3d creates a 3D generation flow and runs it", () => {
    const ops = opsOf("canvas_generate_model3d", { prompt: "a wooden chair", model: "P2-20260801", model3dTexture: "true", model3dPbr: "true", model3dQuad: "true", autoRun: true });
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    const runs = ops.filter((op) => op.type === "run_generation");
    assert.equal(config?.metadata?.generationMode, "model3d");
    assert.equal(config?.title, "3D 生成");
    assert.equal(config?.metadata?.model, "P2-20260801");
    assert.equal(config?.metadata?.model3dTexture, "true");
    assert.equal(config?.metadata?.model3dPbr, "true");
    assert.equal(config?.metadata?.model3dQuad, "true");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].mode, "model3d");
});

test("canvas_generate_model3d with image references still uses model3d mode", () => {
    const ops = opsOf("canvas_generate_model3d", { prompt: "@[node:image-1]", referenceNodeIds: ["image-1"], autoRun: true });
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    assert.equal(ops.filter((op) => op.type === "add_node" && op.nodeType === "text").length, 0);
    assert.equal(config?.metadata?.generationMode, "model3d");
    assert.equal(ops.filter((op) => op.type === "connect_nodes" && op.fromNodeId === "image-1").length, 1);
});
