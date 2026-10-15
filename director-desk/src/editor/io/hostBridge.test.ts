import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearDirectorDeskHostBridge,
  initDirectorDeskHostBridge,
} from "./hostBridge";
import { createInitialDirectorState, useDirectorStore } from "../store/directorStore";

async function settle() {
  // Host messages run on a promise queue; let it drain before asserting.
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.theme;
  await useDirectorStore.getState().openScopedScene(null);
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
  });
});

afterEach(() => {
  clearDirectorDeskHostBridge();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("imports a host panorama message into the director store", async () => {
  initDirectorDeskHostBridge();
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-panorama",
        payload: {
          edgeId: "edge-image-director",
          sourceNodeId: "node_image",
          imageUrl: "data:image/png;base64,panorama",
          fileName: "画布图片.png",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  const state = useDirectorStore.getState();
  const panoramaAsset = state.project.assets.find(
    (asset) => asset.id === state.project.panoramaAssetId
  );

  expect(panoramaAsset).toMatchObject({
    kind: "panorama",
    sourceType: "image",
    fileName: "画布图片.png",
    name: "画布图片.png",
    url: "data:image/png;base64,panorama",
  });
});

it("switches director store persistence when the host sends a card session", async () => {
  initDirectorDeskHostBridge();
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-session",
        payload: {
          instanceId: "node_director_a",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  useDirectorStore.getState().updateScene({ backgroundColor: "#151515" });

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-session",
        payload: {
          instanceId: "node_director_b",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  expect(useDirectorStore.getState().project.scene.backgroundColor).toBe("#000000");

  useDirectorStore.getState().updateScene({ backgroundColor: "#303640" });

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-session",
        payload: {
          instanceId: "node_director_a",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  expect(useDirectorStore.getState().project.scene.backgroundColor).toBe("#151515");
});

it("applies the light theme sent by the host session to the director desk document", async () => {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
  initDirectorDeskHostBridge();
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-session",
        payload: {
          instanceId: "node_director_light",
          theme: "light",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

it("applies the dark theme sent by the host session to the director desk document", async () => {
  document.documentElement.dataset.theme = "light";
  initDirectorDeskHostBridge();
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-session",
        payload: {
          instanceId: "node_director_dark",
          theme: "dark",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("ignores a host panorama message without an image url", async () => {
  initDirectorDeskHostBridge();
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-panorama",
        payload: {
          edgeId: "edge-image-director",
          sourceNodeId: "node_image",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  expect(useDirectorStore.getState().project.panoramaAssetId).toBeNull();
});

it("notifies the host canvas when a host-connected panorama is removed", async () => {
  const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
  initDirectorDeskHostBridge();
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-panorama",
        payload: {
          edgeId: "edge-image-director",
          sourceNodeId: "node_image",
          imageUrl: "data:image/png;base64,panorama",
          fileName: "画布图片.png",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  useDirectorStore.getState().removePanoramaAsset();

  expect(postMessage).toHaveBeenCalledWith(
    {
      type: "storyai:director-desk-panorama-removed",
      payload: {
        edgeId: "edge-image-director",
        sourceNodeId: "node_image",
      },
    },
    window.location.origin
  );
});

it("does not notify the host canvas when changing to a different card session clears the current panorama", async () => {
  const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
  initDirectorDeskHostBridge();
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-session",
        payload: {
          instanceId: "node_director_a",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-panorama",
        payload: {
          edgeId: "edge-image-director-a",
          sourceNodeId: "node_image_a",
          imageUrl: "data:image/png;base64,panorama-a",
          fileName: "画布图片A.png",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-session",
        payload: {
          instanceId: "node_director_b",
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  expect(postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({
      type: "storyai:director-desk-panorama-removed",
    }),
    window.location.origin
  );
});

it("imports a connected canvas model once per source node", async () => {
  initDirectorDeskHostBridge();
  await settle();

  for (const url of ["blob:model-a", "blob:model-b"]) {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "storyai:director-desk-model", payload: { sourceNodeId: "node_model", url, fileName: "chair.glb", name: "chair" } },
        origin: window.location.origin,
      })
    );
  }
  await settle();

  const hostAssets = useDirectorStore.getState().project.assets.filter((asset) => asset.hostSourceId === "node_model");
  expect(hostAssets).toHaveLength(1);
  expect(hostAssets[0]).toMatchObject({ kind: "prop", fileName: "chair.glb", url: "blob:model-b" });
});

it("lists canvas assets sent by the host without adding them to the scene", async () => {
  const { subscribeHostCanvasAssets } = await import("./hostBridge");
  initDirectorDeskHostBridge();
  await settle();
  let received: unknown[] = [];
  const unsubscribe = subscribeHostCanvasAssets((assets) => (received = assets));

  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "storyai:director-desk-assets",
        payload: {
          assets: [
            { sourceNodeId: "node_model", kind: "model", url: "blob:model", fileName: "chair.glb", name: "chair" },
            { sourceNodeId: "node_image", kind: "image", url: "blob:image", fileName: "sky.png", name: "sky" },
            { sourceNodeId: "", kind: "model", url: "blob:bad" },
          ],
        },
      },
      origin: window.location.origin,
    })
  );
  await settle();

  expect(received).toHaveLength(2);
  expect(received[0]).toMatchObject({ sourceNodeId: "node_model", kind: "model", url: "blob:model" });
  expect(useDirectorStore.getState().project.assets.some((asset) => asset.hostSourceId === "node_model")).toBe(false);
  unsubscribe();
});
