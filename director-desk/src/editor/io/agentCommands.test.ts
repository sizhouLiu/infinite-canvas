import { beforeEach, expect, it } from "vitest";
import { runDirectorCommand } from "./agentCommands";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";

beforeEach(async () => {
  await useDirectorStore.getState().openScopedScene(null);
  useDirectorStore.setState({ ...useDirectorStore.getState(), ...createInitialDirectorState() });
});

it("adds a posed character and moves it", async () => {
  const { id } = (await runDirectorCommand({ action: "add_character", pose: "wave" })) as { id: string };
  const character = useDirectorStore.getState().project.objects.find((item) => item.id === id);
  expect(character?.kind).toBe("character");
  expect(character?.characterRig?.posePresetId).toBe("wave");

  await runDirectorCommand({ action: "set_transform", id, position: [1, 0, 2] });
  expect(useDirectorStore.getState().project.objects.find((item) => item.id === id)?.transform.position).toEqual([1, 0, 2]);
});

it("reports the scene and rejects unknown values", async () => {
  await runDirectorCommand({ action: "add_geometry", geometry: "box" });
  const scene = (await runDirectorCommand({ action: "get_scene" })) as { objects: Array<{ kind: string }>; options: { poses: readonly string[] } };
  expect(scene.objects.some((item) => item.kind === "prop")).toBe(true);
  expect(scene.options.poses).toContain("stand");
  await expect(runDirectorCommand({ action: "add_geometry", geometry: "teapot" })).rejects.toThrow("geometry");
  await expect(runDirectorCommand({ action: "set_pose", id: "missing", pose: "stand" })).rejects.toThrow("missing");
});

it("deletes objects and adds a camera from a pose", async () => {
  const { id } = (await runDirectorCommand({ action: "add_geometry", geometry: "sphere" })) as { id: string };
  await runDirectorCommand({ action: "delete_objects", ids: [id] });
  expect(useDirectorStore.getState().project.objects.some((item) => item.id === id)).toBe(false);

  const { cameraId } = (await runDirectorCommand({ action: "add_camera", position: [0, 2, 6], target: [0, 1, 0] })) as { cameraId: string };
  expect(useDirectorStore.getState().project.cameras.find((camera) => camera.id === cameraId)?.target).toEqual([0, 1, 0]);
});
