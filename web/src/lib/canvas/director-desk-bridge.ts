// Relays Agent commands to a director desk iframe. The desk only exists while its overlay is open, so the canvas page
// registers an opener and each mounted overlay registers a sender; a command opens the desk first when needed.

export type DirectorDeskCommand = Record<string, unknown> & { action: string };
type Sender = (command: DirectorDeskCommand) => Promise<unknown>;

const OPEN_TIMEOUT_MS = 20000;
const senders = new Map<string, Sender>();
const waiters = new Map<string, Array<() => void>>();
let opener: ((nodeId: string) => void) | null = null;

export function setDirectorDeskOpener(open: ((nodeId: string) => void) | null) {
    opener = open;
}

export function registerDirectorDeskSender(nodeId: string, sender: Sender) {
    senders.set(nodeId, sender);
    waiters.get(nodeId)?.forEach((resolve) => resolve());
    waiters.delete(nodeId);
    return () => {
        if (senders.get(nodeId) === sender) senders.delete(nodeId);
    };
}

export function openDirectorDeskIds() {
    return [...senders.keys()];
}

async function waitForSender(nodeId: string) {
    const ready = senders.get(nodeId);
    if (ready) return ready;
    if (!opener) throw new Error("当前不在画布页，无法打开导演台");
    opener(nodeId);
    await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("导演台打开超时，请确认导演台服务已启动")), OPEN_TIMEOUT_MS);
        waiters.set(nodeId, [
            ...(waiters.get(nodeId) || []),
            () => {
                window.clearTimeout(timer);
                resolve();
            },
        ]);
    });
    return senders.get(nodeId)!;
}

export async function sendDirectorDeskCommand(nodeId: string, command: DirectorDeskCommand) {
    return (await waitForSender(nodeId))(command);
}
