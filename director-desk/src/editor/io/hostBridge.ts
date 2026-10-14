import { useDirectorStore } from "../store/directorStore";

interface HostPanoramaPayload {
  edgeId?: unknown;
  sourceNodeId?: unknown;
  imageUrl?: unknown;
  fileName?: unknown;
}

interface HostModelPayload {
  sourceNodeId?: unknown;
  url?: unknown;
  fileName?: unknown;
  name?: unknown;
}

interface HostSessionPayload {
  instanceId?: unknown;
  theme?: unknown;
}

export interface HostCaptureItemPayload {
  dataUrl?: unknown;
  fileName?: unknown;
}

export interface HostCaptureBatchPayload {
  captures?: HostCaptureItemPayload[];
}

interface HostConnectedPanorama {
  edgeId: string;
  sourceNodeId: string;
}


let initialized = false;
let hostConnectedPanorama: HostConnectedPanorama | null = null;
let removeUnsubscribe: (() => void) | null = null;
let suppressNextPanoramaRemovalNotice = false;

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getHostOrigin() {
  return window.location.origin;
}

function normalizeTheme(value: unknown): "dark" | "light" | null {
  return value === "light" || value === "dark" ? value : null;
}

function applyDirectorDeskTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getInitialHostTheme() {
  try {
    return normalizeTheme(new URLSearchParams(window.location.search).get("theme"));
  } catch {
    return null;
  }
}

function notifyPanoramaRemoved() {
  if (!hostConnectedPanorama) {
    return;
  }

  window.parent?.postMessage(
    {
      type: "storyai:director-desk-panorama-removed",
      payload: hostConnectedPanorama,
    },
    getHostOrigin()
  );
  hostConnectedPanorama = null;
}


function subscribeToPanoramaRemoval() {
  if (removeUnsubscribe) {
    return;
  }

  let previousPanoramaAssetId = useDirectorStore.getState().project.panoramaAssetId;
  removeUnsubscribe = useDirectorStore.subscribe((state) => {
    const nextPanoramaAssetId = state.project.panoramaAssetId;

    if (previousPanoramaAssetId && !nextPanoramaAssetId) {
      if (suppressNextPanoramaRemovalNotice) {
        suppressNextPanoramaRemovalNotice = false;
        hostConnectedPanorama = null;
      } else {
        notifyPanoramaRemoved();
      }
    }

    previousPanoramaAssetId = nextPanoramaAssetId;
  });
}

function importHostPanorama(payload: HostPanoramaPayload) {
  const imageUrl = normalizeString(payload.imageUrl);
  if (!imageUrl) {
    return;
  }

  const fileName = normalizeString(payload.fileName) || "画布全景图.png";
  const edgeId = normalizeString(payload.edgeId);
  const sourceNodeId = normalizeString(payload.sourceNodeId);

  hostConnectedPanorama = edgeId && sourceNodeId ? { edgeId, sourceNodeId } : null;
  useDirectorStore.getState().addImportedAsset({
    kind: "panorama",
    name: fileName,
    fileName,
    url: imageUrl,
    projectionMode: "backdrop",
  });
}

function importHostModel(payload: HostModelPayload) {
  const url = normalizeString(payload.url);
  if (!url) return;

  const fileName = normalizeString(payload.fileName) || "画布模型.glb";
  const name = normalizeString(payload.name) || fileName;
  const sourceNodeId = normalizeString(payload.sourceNodeId);
  if (!sourceNodeId) return;

  useDirectorStore.getState().upsertHostModelAsset({ hostSourceId: sourceNodeId, name, fileName, url });
}

// Host messages are applied in order; a session switch reads storage, so later imports wait for it.
let hostMessageQueue: Promise<void> = Promise.resolve();

async function openHostSession(payload: HostSessionPayload) {
  const instanceId = normalizeString(payload.instanceId);
  const theme = normalizeTheme(payload.theme);
  if (theme) {
    applyDirectorDeskTheme(theme);
  }
  suppressNextPanoramaRemovalNotice = true;
  await useDirectorStore.getState().openScopedScene(instanceId || null);
  suppressNextPanoramaRemovalNotice = false;
  hostConnectedPanorama = null;
}

export function postDirectorDeskCapturesToHost(
  captures: Array<{
    dataUrl: string;
    fileName?: string;
  }>
) {
  const normalizedCaptures = captures
    .map((capture, index) => {
      const dataUrl = normalizeString(capture.dataUrl);
      if (!dataUrl) {
        return null;
      }

      return {
        dataUrl,
        fileName: normalizeString(capture.fileName) || `director-desk-capture-${index + 1}.png`,
      };
    })
    .filter((capture): capture is { dataUrl: string; fileName: string } => Boolean(capture));

  if (normalizedCaptures.length === 0) {
    return;
  }

  window.parent?.postMessage(
    {
      type: "storyai:director-desk-captures-sent",
      payload: {
        captures: normalizedCaptures,
      },
    },
    getHostOrigin()
  );
}

function handleHostMessage(event: MessageEvent) {
  if (event.origin !== getHostOrigin()) {
    return;
  }

  const payload = event.data?.payload || {};

  if (event.data?.type === "storyai:director-desk-session") {
    hostMessageQueue = hostMessageQueue.then(() => openHostSession(payload as HostSessionPayload));
    return;
  }

  if (event.data?.type === "storyai:director-desk-panorama") {
    hostMessageQueue = hostMessageQueue.then(() => importHostPanorama(payload as HostPanoramaPayload));
    return;
  }

  if (event.data?.type === "storyai:director-desk-model") {
    hostMessageQueue = hostMessageQueue.then(() => importHostModel(payload as HostModelPayload));
  }
}

export function initDirectorDeskHostBridge() {
  if (initialized) {
    return;
  }

  initialized = true;
  applyDirectorDeskTheme(getInitialHostTheme() ?? "dark");
  // Load the scene named in the URL first; host messages queue behind it.
  const initialScope = new URLSearchParams(window.location.search).get("instanceId");
  hostMessageQueue = hostMessageQueue.then(() => useDirectorStore.getState().openScopedScene(initialScope));
  window.addEventListener("message", handleHostMessage);
  subscribeToPanoramaRemoval();
}

export function clearDirectorDeskHostBridge() {
  if (!initialized) {
    return;
  }

  initialized = false;
  hostMessageQueue = Promise.resolve();
  hostConnectedPanorama = null;
  suppressNextPanoramaRemovalNotice = false;
  window.removeEventListener("message", handleHostMessage);
  removeUnsubscribe?.();
  removeUnsubscribe = null;
}
