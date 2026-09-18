#!/usr/bin/env node
import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { Readable } from "node:stream";

const pkg = createRequire(import.meta.url)("./package.json");

const CORS_HEADERS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
    "access-control-max-age": "86400",
};

/** Headers that describe the hop to this proxy rather than the upstream request. */
const SKIP_REQUEST_HEADERS = new Set(["host", "connection", "content-length", "accept-encoding", "origin", "referer", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"]);
/** fetch() already decoded and re-framed the body, so the upstream framing headers no longer apply. */
const SKIP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export function readArg(args, name, fallback) {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

export function readTarget(url) {
    const raw = url.slice(1);
    // decodeURI undoes the escaping browsers apply to the path while keeping intentional encodeURIComponent escapes.
    let target = raw;
    try {
        target = decodeURI(raw);
    } catch {
        // Malformed escape sequence: forward the raw form instead of failing.
    }
    // Some clients collapse the "//" in the embedded target URL, so restore it before parsing.
    target = target.replace(/^(https?:)\/*/i, "$1//");
    return /^https?:\/\/[^/]/i.test(target) ? target : "";
}

/**
 * Hosts the proxy will forward to. `null` means any public host (local npx default). A list is suffix-matched
 * (`tripo3d.com` covers `openapi.tripo3d.com` and `tripo-data.*.data.tripo3d.com`). Private and loopback
 * addresses are always rejected, even with no list, so an exposed proxy cannot be used to scan an intranet.
 */
export function parseAllowHosts(value) {
    if (value === undefined || !String(value).trim()) return null;
    const hosts = String(value)
        .split(/[,\s]+/)
        .map((host) => host.trim().toLowerCase().replace(/^\*\./, "").replace(/^\./, ""))
        .filter(Boolean);
    return hosts.length ? hosts : null;
}

export function isHostAllowed(hostname, allowHosts) {
    const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (!host) return false;
    if (!allowHosts) return true;
    return allowHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function isPrivateIp(ip) {
    const value = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
    if (!value) return true;
    const mappedDotted = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateIp(mappedDotted[1]);
    const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        return isPrivateIp(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    if (value.includes(":")) {
        if (value === "::1" || value === "::") return true;
        if (value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
        return false;
    }
    const parts = value.split(".");
    // Hostnames are not IPs; only dotted quads are classified here. Invalid quads are refused.
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
    const nums = parts.map(Number);
    if (nums.some((part) => part > 255)) return true;
    const [a, b] = nums;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

function isBlockedHostname(hostname) {
    const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
    if (host === "metadata.google.internal") return true;
    if (isPrivateIp(host)) return true;
    return false;
}

export async function assertSafeTarget(target, allowHosts, resolver = lookup) {
    let url;
    try {
        url = new URL(target);
    } catch {
        throw new Error("invalid target");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    if (url.username || url.password) throw new Error("userinfo is not allowed");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isBlockedHostname(hostname)) throw new Error("private address is not allowed");
    if (!isHostAllowed(hostname, allowHosts)) throw new Error("host is not allowed");
    // Literal IPs have already passed the private-address check; skip DNS.
    if (hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return;
    const records = await resolver(hostname, { all: true, verbatim: true });
    if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error("private address is not allowed");
}

function requestHeaders(req) {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (SKIP_REQUEST_HEADERS.has(key) || value === undefined) continue;
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    return headers;
}

function responseHeaders(upstream) {
    const headers = { ...CORS_HEADERS };
    upstream.headers.forEach((value, key) => {
        if (SKIP_RESPONSE_HEADERS.has(key) || key.startsWith("access-control-")) return;
        headers[key] = value;
    });
    return headers;
}

function sendJson(res, status, payload) {
    res.writeHead(status, { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function logForward(method, target, outcome, startedAt) {
    console.log(`${new Date().toLocaleTimeString()} ${method} ${target} -> ${outcome} ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

async function forward(req, res, target) {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const upstream = await fetch(target, { method: req.method, headers: requestHeaders(req), body, redirect: "follow" });
    // Logged as soon as the status line arrives, so a long SSE stream still shows up immediately.
    res.writeHead(upstream.status, responseHeaders(upstream));
    if (!upstream.body) {
        res.end();
        return upstream.status;
    }
    // Streamed so that SSE responses (text generation) reach the browser chunk by chunk.
    const stream = Readable.fromWeb(upstream.body);
    res.on("close", () => stream.destroy());
    stream.pipe(res);
    return upstream.status;
}

export function createProxyServer(options = {}) {
    const allowHosts = options.allowHosts !== undefined ? options.allowHosts : parseAllowHosts(process.env.PROXY_ALLOW_HOSTS);
    const resolver = options.resolver || lookup;
    return createServer((req, res) => {
        if (req.method === "OPTIONS") {
            res.writeHead(204, CORS_HEADERS);
            res.end();
            return;
        }
        const target = readTarget(req.url || "/");
        if (!target) {
            sendJson(res, 200, { app: "infinite-canvas", proxy: pkg.name, version: pkg.version, usage: "/<full-target-url>" });
            return;
        }
        const startedAt = Date.now();
        const method = req.method || "GET";
        assertSafeTarget(target, allowHosts, resolver)
            .then(() => forward(req, res, target))
            .then((status) => logForward(method, target, status, startedAt))
            .catch((error) => {
                const reason = error instanceof Error ? error.message : String(error);
                logForward(method, target, `blocked (${reason})`, startedAt);
                if (res.headersSent) {
                    res.destroy();
                    return;
                }
                const blocked = /not allowed|unsupported protocol|invalid target|userinfo/.test(reason);
                sendJson(res, blocked ? 403 : 502, { error: reason });
            });
    });
}

const isDirectRun = process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        console.log(`${pkg.name} v${pkg.version}\n\nUsage: npx ${pkg.name}@latest [--port 23210] [--host 127.0.0.1]\n\nForwards http://<host>:<port>/<full-target-url> to <full-target-url> with permissive CORS headers.\nSet PROXY_ALLOW_HOSTS to a comma-separated suffix list (e.g. openai.com,tripo3d.com) to refuse other hosts.\nPrivate and loopback addresses are always rejected.`);
        process.exit(0);
    }

    const port = Number(readArg(args, "port", process.env.PORT || 23210));
    const host = readArg(args, "host", process.env.HOST || "127.0.0.1");

    createProxyServer().listen(port, host, () => {
        console.log(`${pkg.name} v${pkg.version} listening on http://${host}:${port}`);
        console.log(`Fill this address into Infinite Canvas → 配置 → 本地代理: http://${host}:${port}`);
        const allowHosts = parseAllowHosts(process.env.PROXY_ALLOW_HOSTS);
        if (allowHosts) console.log(`Allowing hosts: ${allowHosts.join(", ")}`);
    });
}
