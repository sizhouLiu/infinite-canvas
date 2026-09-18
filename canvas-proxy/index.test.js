import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseAllowHosts,
    isHostAllowed,
    isPrivateIp,
    readTarget,
    assertSafeTarget,
    createProxyServer,
} from "./index.js";

test("parseAllowHosts: empty is any public host", () => {
    assert.equal(parseAllowHosts(undefined), null);
    assert.equal(parseAllowHosts(""), null);
    assert.equal(parseAllowHosts("  "), null);
    assert.deepEqual(parseAllowHosts("openai.com, tripo3d.com"), ["openai.com", "tripo3d.com"]);
    assert.deepEqual(parseAllowHosts("*.googleapis.com .tripo3d.ai"), ["googleapis.com", "tripo3d.ai"]);
});

test("isHostAllowed: suffix match", () => {
    const allow = ["openai.com", "tripo3d.com", "googleapis.com"];
    assert.equal(isHostAllowed("api.openai.com", allow), true);
    assert.equal(isHostAllowed("openai.com", allow), true);
    assert.equal(isHostAllowed("openapi.tripo3d.com", allow), true);
    assert.equal(isHostAllowed("tripo-data.cdn.data.tripo3d.com", allow), true);
    assert.equal(isHostAllowed("generativelanguage.googleapis.com", allow), true);
    assert.equal(isHostAllowed("evil.com", allow), false);
    assert.equal(isHostAllowed("openai.com.evil.com", allow), false);
    assert.equal(isHostAllowed("api.openai.com", null), true);
    assert.equal(isHostAllowed("", allow), false);
});

test("isPrivateIp", () => {
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("10.1.2.3"), true);
    assert.equal(isPrivateIp("192.168.0.1"), true);
    assert.equal(isPrivateIp("172.16.0.1"), true);
    assert.equal(isPrivateIp("172.31.255.255"), true);
    assert.equal(isPrivateIp("172.15.0.1"), false);
    assert.equal(isPrivateIp("169.254.1.1"), true);
    assert.equal(isPrivateIp("100.64.0.1"), true);
    assert.equal(isPrivateIp("0.0.0.0"), true);
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("::1"), true);
    assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateIp("::ffff:7f00:1"), true);
    assert.equal(isPrivateIp("[::ffff:7f00:1]"), true);
    assert.equal(isPrivateIp("fe80::1"), true);
    assert.equal(isPrivateIp("fd12::1"), true);
    assert.equal(isPrivateIp("2001:4860:4860::8888"), false);
    // Hostnames must not be classified as IPs.
    assert.equal(isPrivateIp("openapi.tripo3d.com"), false);
    assert.equal(isPrivateIp("localhost"), false);
});

test("readTarget", () => {
    assert.equal(readTarget("/https://api.openai.com/v1/models"), "https://api.openai.com/v1/models");
    assert.equal(readTarget("/http:/api.openai.com/v1"), "http://api.openai.com/v1");
    assert.equal(readTarget("/"), "");
    assert.equal(readTarget("/not-a-url"), "");
    assert.equal(readTarget("/ftp://example.com"), "");
});

async function expectBlocked(target, allowHosts, message, resolver) {
    await assert.rejects(() => assertSafeTarget(target, allowHosts, resolver), { message });
}

test("assertSafeTarget: always blocks private and loopback", async () => {
    await expectBlocked("http://127.0.0.1/", null, "private address is not allowed");
    await expectBlocked("http://localhost/v1", null, "private address is not allowed");
    await expectBlocked("http://foo.localhost/v1", null, "private address is not allowed");
    await expectBlocked("http://printer.local/", null, "private address is not allowed");
    await expectBlocked("http://metadata.google.internal/", null, "private address is not allowed");
    await expectBlocked("http://192.168.1.1/", null, "private address is not allowed");
    await expectBlocked("http://10.0.0.8/", ["10.0.0.8"], "private address is not allowed");
    await expectBlocked("http://169.254.169.254/latest/meta-data", null, "private address is not allowed");
    await expectBlocked("http://[::1]/", null, "private address is not allowed");
    await expectBlocked("http://[::ffff:127.0.0.1]/", null, "private address is not allowed");
    await expectBlocked("http://2130706433/", null, "private address is not allowed");
    await expectBlocked("http://127.1/", null, "private address is not allowed");
});

test("assertSafeTarget: userinfo, protocol, allowlist, DNS", async () => {
    await expectBlocked("https://user:pass@api.openai.com/v1", null, "userinfo is not allowed");
    await expectBlocked("ftp://api.openai.com/file", null, "unsupported protocol");
    await expectBlocked("https://evil.example/v1", ["openai.com"], "host is not allowed");
    await assertSafeTarget("https://8.8.8.8/", null);
    await expectBlocked("https://8.8.8.8/", ["openai.com"], "host is not allowed");
    await assertSafeTarget("https://api.openai.com/v1/models", ["openai.com"], async () => [{ address: "1.1.1.1", family: 4 }]);
    await expectBlocked(
        "https://api.openai.com/v1/models",
        ["openai.com"],
        "private address is not allowed",
        async () => [{ address: "127.0.0.1", family: 4 }],
    );
});

test("createProxyServer: identity, OPTIONS, blocked targets", async () => {
    const server = createProxyServer({ allowHosts: ["openai.com"] });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
        const identity = await fetch(`${base}/`);
        assert.equal(identity.status, 200);
        const body = await identity.json();
        assert.equal(body.proxy, "@basketikun/canvas-proxy");
        assert.ok(body.version);

        const options = await fetch(`${base}/https://api.openai.com/v1`, { method: "OPTIONS" });
        assert.equal(options.status, 204);

        const loopback = await fetch(`${base}/http://127.0.0.1:9/`);
        assert.equal(loopback.status, 403);
        assert.match((await loopback.json()).error, /private address/);

        const denied = await fetch(`${base}/https://evil.example/v1`);
        assert.equal(denied.status, 403);
        assert.match((await denied.json()).error, /host is not allowed/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("createProxyServer: forwards allowed host and keeps Authorization", async () => {
    const originalFetch = globalThis.fetch;
    const server = createProxyServer({
        allowHosts: ["openai.com"],
        resolver: async () => [{ address: "1.1.1.1", family: 4 }],
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        globalThis.fetch = async (url, init) => {
            assert.equal(String(url), "https://api.openai.com/v1/models");
            assert.equal(init.method, "GET");
            assert.equal(init.headers.authorization, "Bearer sk-test");
            return new Response(JSON.stringify({ data: [] }), {
                status: 200,
                headers: { "content-type": "application/json", authorization: "should-not-leak" },
            });
        };
        const response = await originalFetch(`http://127.0.0.1:${port}/https://api.openai.com/v1/models`, {
            headers: { authorization: "Bearer sk-test" },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { data: [] });
    } finally {
        globalThis.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
    }
});
