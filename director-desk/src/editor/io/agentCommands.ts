import { requestViewportCapture, type ViewportCapturePreset } from "./captureBridge";
import { getHostCanvasAssets, postDirectorDeskCapturesToHost } from "./hostBridge";
import { BODY_TYPE_OPTIONS } from "../runtime/mannequin/bodyTypes";
import { GEOMETRY_PRIMITIVE_OPTIONS, type CharacterBodyType, type GeometryPrimitiveType } from "../schema/directorProject";
import { POSE_PRESET_IDS, type PosePresetId } from "../schema/poseSchema";
import { VIEWPORT_ASPECT_RATIO_OPTIONS, type ViewportAspectRatio } from "../schema/viewportAspectRatio";
import { useDirectorStore } from "../store/directorStore";

// Commands the host canvas relays from the Agent. Each runs against the same store actions the toolbar and panels
// use, so an Agent edit behaves exactly like a manual one and lands in the desk's own undo history.

type Vec3 = [number, number, number];
type Command = Record<string, unknown> & { action?: unknown };

const store = () => useDirectorStore.getState();

function vec3(value: unknown): Vec3 | undefined {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item)) ? (value as Vec3) : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${name} 必须是 ${allowed.join(" / ")} 之一`);
}

function requireObject(id: unknown) {
  const object = store().project.objects.find((item) => item.id === id);
  if (!object) throw new Error(`导演台中没有对象 ${String(id)}`);
  return object;
}

/** A compact scene summary: enough for the Agent to pick ids and reason about layout without the full project. */
export function describeDirectorScene() {
  const { project, viewMode, viewportAspectRatio, selectedObjectIds } = store();
  const panorama = project.assets.find((item) => item.id === project.panoramaAssetId);
  return {
    viewMode,
    aspectRatio: viewportAspectRatio,
    activeCameraId: project.activeCameraId,
    selectedObjectIds,
    panorama: panorama ? { name: panorama.name || panorama.fileName } : null,
    objects: project.objects.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      visible: item.visible,
      position: item.transform.position,
      rotation: item.transform.rotation,
      scale: item.transform.scale,
      ...(item.kind === "character" ? { bodyType: item.bodyType, pose: item.characterRig?.posePresetId ?? null } : {}),
      ...(item.linkedCameraId ? { cameraId: item.linkedCameraId } : {}),
    })),
    cameras: project.cameras.map((camera) => ({ id: camera.id, name: camera.name, fov: camera.fov, position: camera.transform.position, target: camera.target, captures: camera.captures?.length ?? 0 })),
    canvasAssets: getHostCanvasAssets().map((item) => ({ sourceNodeId: item.sourceNodeId, kind: item.kind, name: item.name })),
    options: {
      bodyTypes: BODY_TYPE_OPTIONS.map((item) => item.bodyType),
      poses: POSE_PRESET_IDS,
      geometry: GEOMETRY_PRIMITIVE_OPTIONS.map((item) => item.type),
      aspectRatios: VIEWPORT_ASPECT_RATIO_OPTIONS.map((item) => item.id),
    },
  };
}

/** Id of the object a store action just added; the actions select what they create. */
const lastAddedId = () => store().selectedObjectId;

export async function runDirectorCommand(command: Command): Promise<unknown> {
  switch (command.action) {
    case "get_scene":
      return describeDirectorScene();
    case "add_character": {
      const bodyType = command.bodyType === undefined ? undefined : oneOf<CharacterBodyType>(command.bodyType, BODY_TYPE_OPTIONS.map((item) => item.bodyType), "bodyType");
      store().addPresetCharacter(bodyType);
      const id = lastAddedId();
      if (id && command.pose !== undefined) store().applyPosePreset(id, oneOf<PosePresetId>(command.pose, POSE_PRESET_IDS, "pose"));
      return { id };
    }
    case "add_geometry": {
      store().addGeometryPrimitive(oneOf<GeometryPrimitiveType>(command.geometry, GEOMETRY_PRIMITIVE_OPTIONS.map((item) => item.type), "geometry"));
      return { id: lastAddedId() };
    }
    case "add_canvas_asset": {
      const asset = getHostCanvasAssets().find((item) => item.sourceNodeId === command.sourceNodeId);
      if (!asset) throw new Error(`画布上没有可用的模型或图片节点 ${String(command.sourceNodeId)}`);
      if (asset.kind === "image") {
        store().addImportedAsset({ kind: "panorama", name: asset.name, fileName: asset.fileName, url: asset.url, projectionMode: "backdrop" });
        return { panorama: asset.name };
      }
      store().upsertHostModelAsset({ hostSourceId: asset.sourceNodeId, name: asset.name, fileName: asset.fileName, url: asset.url });
      return { id: lastAddedId() };
    }
    case "set_transform": {
      const object = requireObject(command.id);
      const patch = { position: vec3(command.position), rotation: vec3(command.rotation), scale: vec3(command.scale) };
      store().updateObjectTransform(object.id, Object.fromEntries(Object.entries(patch).filter(([, value]) => value)));
      return { id: object.id, transform: requireObject(object.id).transform };
    }
    case "set_pose": {
      const object = requireObject(command.id);
      if (object.kind !== "character") throw new Error(`${object.id} 不是角色，不能设置姿势`);
      store().applyPosePreset(object.id, oneOf<PosePresetId>(command.pose, POSE_PRESET_IDS, "pose"));
      return { id: object.id, pose: command.pose };
    }
    case "delete_objects": {
      const ids = Array.isArray(command.ids) ? command.ids.filter((id): id is string => typeof id === "string") : [];
      const existing = ids.filter((id) => store().project.objects.some((item) => item.id === id));
      if (!existing.length) throw new Error("没有可删除的对象");
      existing.forEach((id, index) => (index === 0 ? store().selectObject(id) : store().toggleObjectSelection(id)));
      store().deleteSelectedObject();
      return { deleted: existing };
    }
    case "add_camera": {
      const position = vec3(command.position);
      const target = vec3(command.target) ?? [0, 1.2, 0];
      const fov = typeof command.fov === "number" ? command.fov : 50;
      const id = store().addCameraShot(position ? { position, target, fov } : undefined);
      return { cameraId: id };
    }
    case "set_aspect_ratio": {
      store().setViewportAspectRatio(oneOf<ViewportAspectRatio>(command.aspectRatio, VIEWPORT_ASPECT_RATIO_OPTIONS.map((item) => item.id), "aspectRatio"));
      return { aspectRatio: command.aspectRatio };
    }
    case "capture": {
      // Same flow as the toolbar: capture through a camera, keep the shots on it, and hand them to the canvas.
      const preset = command.preset === undefined ? "current" : oneOf<ViewportCapturePreset>(command.preset, ["current", "four", "twelve"], "preset");
      let cameraId = typeof command.cameraId === "string" ? command.cameraId : store().project.activeCameraId;
      if (cameraId && !store().project.cameras.some((camera) => camera.id === cameraId)) throw new Error(`导演台中没有机位 ${cameraId}`);
      if (!cameraId) cameraId = store().addCameraShot();
      store().setActiveCamera(cameraId);
      store().setViewMode("camera");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const results = await requestViewportCapture({ preset, source: "camera-panel", cameraId });
      store().addCameraCaptures(cameraId, results.map((result) => result.dataUrl));
      const camera = store().project.cameras.find((item) => item.id === cameraId);
      // Shots go to the canvas through the same message the camera panel's "send to canvas" uses.
      if (command.sendToCanvas !== false) postDirectorDeskCapturesToHost(results.map((result, index) => ({ dataUrl: result.dataUrl, fileName: `${camera?.name || "机位"}-${result.label || index + 1}.png` })));
      return { cameraId, count: results.length, labels: results.map((result) => result.label), sentToCanvas: command.sendToCanvas !== false };
    }
    default:
      throw new Error(`导演台不支持操作 ${String(command.action)}`);
  }
}
