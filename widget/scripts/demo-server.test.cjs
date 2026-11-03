const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { createDemoServer } = require("./demo-server.cjs");
async function fixture(t, mode = "real", allowRisk = false) {
    let now = Date.now();
    const observed = [];
    const upstream = http.createServer((req, res) => {
        observed.push({ url: req.url, auth: req.headers.authorization, origin: req.headers.origin });
        res.setHeader("Content-Type", "application/json");
        res.end('{"upstream":true}');
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const server = createDemoServer(
        {
            mode,
            allowRisk,
            upstream: `http://127.0.0.1:${upstream.address().port}`,
            sessionSeconds: 2,
            profiles: [
                {
                    id: "tenant-a",
                    label: "A",
                    code: "a".repeat(43),
                    token: "server-only-jwt-a",
                    expiresAt: now + 800000,
                    canReadRisk: true,
                    canRunRisk: allowRisk
                },
                {
                    id: "tenant-b",
                    label: "B",
                    code: "b".repeat(43),
                    token: "server-only-jwt-b",
                    expiresAt: now + 800000,
                    canReadRisk: false,
                    canRunRisk: false
                }
            ]
        },
        () => now
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port,
        base = `http://127.0.0.1:${port}`;
    t.after(() => {
        server.closeAllConnections();
        upstream.closeAllConnections();
        server.close();
        upstream.close();
    });
    async function call(path, options = {}) {
        const data = options.raw || (options.body === undefined ? undefined : JSON.stringify(options.body));
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: "127.0.0.1",
                    port,
                    path,
                    method: options.method || "GET",
                    headers: {
                        Host: `127.0.0.1:${port}`,
                        Origin: base,
                        "X-Demo-Request": "1",
                        ...(data
                            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
                            : {}),
                        ...(options.cookie ? { Cookie: options.cookie } : {}),
                        ...(options.csrf ? { "X-Demo-CSRF": options.csrf } : {}),
                        ...options.headers
                    }
                },
                res => {
                    let body = "";
                    res.on("data", c => (body += c));
                    res.on("end", () => {
                        let json;
                        try {
                            json = JSON.parse(body);
                        } catch {
                            json = {};
                        }
                        resolve({
                            status: res.statusCode,
                            body,
                            json,
                            cookie: res.headers["set-cookie"]?.[0]?.split(";")[0],
                            headers: res.headers
                        });
                    });
                }
            );
            req.on("error", reject);
            req.end(data);
        });
    }
    async function login(id = "tenant-a", cookie) {
        return call("/demo/login", {
            method: "POST",
            body: { profile: id, code: (id === "tenant-a" ? "a" : "b").repeat(43) },
            cookie
        });
    }
    return {
        call,
        login,
        observed,
        stopUpstream: () =>
            new Promise(resolve => {
                upstream.closeAllConnections();
                upstream.close(resolve);
            }),
        advance: ms => (now += ms)
    };
}
test("login exposes only opaque session metadata and protected cookie", async t => {
    const f = await fixture(t);
    const r = await f.login();
    assert.equal(r.status, 200);
    assert.match(r.headers["set-cookie"][0], /HttpOnly; SameSite=Strict/);
    assert.equal(r.body.includes("server-only-jwt"), false);
    assert.equal(r.body.includes('"token"'), false);
    assert.equal(r.json.csrf.length, 64);
    assert.equal(r.json.canRunRisk, false);
});
test("proxy forwards the session-bound JWT, never browser auth/cookies/origin", async t => {
    const f = await fixture(t);
    const r = await f.login();
    const out = await f.call("/api/v1/portfolio/groups?groupBy=division", { cookie: r.cookie, csrf: r.json.csrf });
    assert.equal(out.status, 200);
    assert.equal(f.observed[0].auth, "Bearer server-only-jwt-a");
    assert.equal(f.observed[0].origin, undefined);
});
test("rejects Host/Origin forgery and missing CSRF", async t => {
    const f = await fixture(t);
    assert.equal((await f.call("/", { headers: { Host: "evil.example" } })).status, 403);
    assert.equal(
        (await f.call("/demo/login", { method: "POST", headers: { Origin: "http://evil.example" }, body: {} })).status,
        403
    );
    const r = await f.login();
    assert.equal((await f.call("/api/v1/portfolio/metadata", { cookie: r.cookie })).status, 403);
    assert.equal(f.observed.length, 0);
});
test("rejects unsupported paths/methods, supplied bearer and oversized bodies", async t => {
    const f = await fixture(t);
    const r = await f.login();
    const proof = { cookie: r.cookie, csrf: r.json.csrf };
    for (const route of ["/.env", "/http://evil.example", "/api/v1/portfolio/metadata/extra", "/demo/access.json"])
        assert.notEqual((await f.call(route, proof)).status, 200);
    assert.equal((await f.call("/api/v1/portfolio/metadata", { ...proof, method: "DELETE" })).status, 404);
    assert.equal(
        (await f.call("/api/v1/portfolio/metadata", { ...proof, headers: { Authorization: "Bearer client-value" } }))
            .status,
        400
    );
    assert.equal((await f.call("/demo/login", { method: "POST", raw: '"' + "x".repeat(2000) + '"' })).status, 413);
    assert.equal(f.observed.length, 0);
});
test("risk mutation is disabled without startup opt-in and correct profile", async t => {
    const f = await fixture(t);
    const r = await f.login();
    assert.equal(
        (await f.call("/api/v1/portfolio/risk-runs", { method: "POST", body: {}, cookie: r.cookie, csrf: r.json.csrf }))
            .status,
        403
    );
    assert.equal(f.observed.length, 0);
});
test("opt-in still restricts risk to the configured operator and validates body", async t => {
    const f = await fixture(t, "real", true);
    const a = await f.login(),
        b = await f.login("tenant-b");
    assert.equal(
        (await f.call("/api/v1/portfolio/risk-runs", { method: "POST", body: {}, cookie: b.cookie, csrf: b.json.csrf }))
            .status,
        403
    );
    assert.equal(
        (
            await f.call("/api/v1/portfolio/risk-runs", {
                method: "POST",
                body: { tenantId: "forged" },
                cookie: a.cookie,
                csrf: a.json.csrf
            })
        ).status,
        400
    );
    assert.equal(
        (
            await f.call("/api/v1/portfolio/risk-runs", {
                method: "POST",
                body: {},
                cookie: a.cookie,
                csrf: a.json.csrf,
                headers: { "Idempotency-Key": "test-intent" }
            })
        ).status,
        200
    );
});
test("logout invalidates the old session; switching profile changes bound scope", async t => {
    const f = await fixture(t);
    const a = await f.login();
    const b = await f.login("tenant-b", a.cookie);
    assert.notEqual(a.json.scopeKey, b.json.scopeKey);
    assert.equal((await f.call("/demo/session", { cookie: a.cookie })).status, 401);
    assert.equal((await f.call("/api/v1/portfolio/metadata", { cookie: b.cookie, csrf: b.json.csrf })).status, 200);
    assert.equal(f.observed[0].auth, "Bearer server-only-jwt-b");
    assert.equal(
        (await f.call("/demo/logout", { method: "POST", body: {}, cookie: b.cookie, csrf: b.json.csrf })).status,
        200
    );
    assert.equal((await f.call("/demo/session", { cookie: b.cookie })).status, 401);
});
test("session expiration is enforced server-side", async t => {
    const f = await fixture(t);
    const a = await f.login();
    f.advance(2001);
    assert.equal((await f.call("/demo/session", { cookie: a.cookie })).status, 401);
});
test("login rejects caller-selected claims and throttles failures", async t => {
    const f = await fixture(t);
    for (let i = 0; i < 8; i++)
        assert.equal(
            (
                await f.call("/demo/login", {
                    method: "POST",
                    body: { profile: "tenant-a", code: "a".repeat(43), permissions: ["risk:run"] }
                })
            ).status,
            401
        );
    assert.equal((await f.login()).status, 429);
    f.advance(60001);
    assert.equal((await f.login()).status, 200);
});
test("synthetic mode has no session/proxy and no connection permission", async t => {
    const f = await fixture(t, "synthetic");
    const r = await f.call("/");
    assert.match(r.body, /SYNTHETIC PREVIEW/);
    assert.match(r.headers["content-security-policy"], /connect-src 'none'/);
    assert.equal((await f.call("/demo/info")).status, 404);
    assert.equal((await f.call("/api/v1/portfolio/metadata")).status, 404);
});

test("upstream failure produces a safe 503 and never fixture data", async t => {
    const f = await fixture(t);
    const a = await f.login();
    await f.stopUpstream();
    const r = await f.call("/api/v1/portfolio/groups", { cookie: a.cookie, csrf: a.json.csrf });
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, "DEMO_UPSTREAM_UNAVAILABLE");
    assert.equal(r.body.includes("server-only-jwt"), false);
    assert.equal("groups" in r.json, false);
});

test("expired sessions release capacity and current sessions can rotate at the limit", async t => {
    const f = await fixture(t);
    let last;
    for (let i = 0; i < 64; i++) {
        last = await f.login();
        assert.equal(last.status, 200);
    }
    assert.equal((await f.login()).status, 503);
    assert.equal((await f.login("tenant-b", last.cookie)).status, 200);
    f.advance(2001);
    assert.equal((await f.login()).status, 200);
});
