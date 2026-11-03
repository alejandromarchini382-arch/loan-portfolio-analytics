const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const equal = (a, b) =>
    crypto.timingSafeEqual(
        crypto.createHash("sha256").update(String(a)).digest(),
        crypto.createHash("sha256").update(String(b)).digest()
    );
const nonce = () => crypto.randomBytes(32).toString("hex");
function createDemoServer(config, clock = Date.now) {
    if (!["synthetic", "real"].includes(config.mode)) throw new Error("INVALID_DEMO_CONFIG");
    const profiles = new Map((config.profiles || []).map(p => [p.id, p]));
    if (config.mode === "real") {
        const u = new URL(config.upstream);
        if (
            u.protocol !== "http:" ||
            u.hostname !== "127.0.0.1" ||
            u.pathname !== "/" ||
            u.search ||
            u.hash ||
            u.username ||
            u.password ||
            !u.port ||
            profiles.size < 1 ||
            profiles.size > 4
        )
            throw new Error("INVALID_DEMO_CONFIG");
        for (const p of profiles.values()) {
            if (
                !/^[a-z-]{1,30}$/.test(p.id) ||
                typeof p.code !== "string" ||
                p.code.length < 32 ||
                typeof p.token !== "string" ||
                p.token.length > 8192 ||
                !Number.isFinite(p.expiresAt) ||
                p.expiresAt > clock() + 901000 ||
                p.expiresAt <= clock()
            )
                throw new Error("INVALID_DEMO_CONFIG");
        }
    }
    const sessions = new Map();
    let failures = { since: 0, count: 0 };
    const sessionSeconds = Math.max(1, Math.min(900, config.sessionSeconds || 900));
    function session(req) {
        for (const [id, s] of sessions) if (s.expiresAt <= clock()) sessions.delete(id);
        const id = /(?:^|;\s*)axis_demo=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
        const s = id && sessions.get(id);
        return s ? { ...s, id } : undefined;
    }
    const json = (res, status, value) => {
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(value));
    };
    const error = (res, status, code) =>
        json(res, status, {
            error: { code, message: code.toLowerCase().replaceAll("_", " "), requestId: crypto.randomUUID() }
        });
    function body(req) {
        return new Promise((resolve, reject) => {
            if ((req.headers["content-type"] || "").split(";")[0] !== "application/json")
                return reject({ status: 415, code: "JSON_REQUIRED" });
            let size = 0;
            const chunks = [];
            let exceeded = false;
            req.on("data", chunk => {
                size += chunk.length;
                if (size > 1024) {
                    exceeded = true;
                    reject({ status: 413, code: "REQUEST_TOO_LARGE" });
                } else if (!exceeded) chunks.push(chunk);
            });
            req.on("end", () => {
                if (exceeded) return;
                try {
                    const v = JSON.parse(Buffer.concat(chunks).toString());
                    if (!v || Array.isArray(v) || typeof v !== "object") throw new Error();
                    resolve(v);
                } catch {
                    reject({ status: 400, code: "INVALID_REQUEST" });
                }
            });
            req.on("error", () => reject({ status: 400, code: "INVALID_REQUEST" }));
        });
    }
    let server;
    async function handle(req, res) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader(
            "Content-Security-Policy",
            `default-src 'self'; script-src 'self'; style-src 'self'; connect-src ${
                config.mode === "real" ? "'self'" : "'none'"
            }; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        if (
            req.headers.host !== new URL(origin).host ||
            (req.headers.origin && req.headers.origin !== origin) ||
            (req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
        )
            return error(res, 403, "DEMO_ORIGIN_DENIED");
        if (!req.url.startsWith("/") || req.url.startsWith("//") || req.url.length > 8192)
            return error(res, 400, "INVALID_REQUEST");
        const url = new URL(req.url, origin),
            name = url.pathname;
        if (req.method === "GET" && ["/", "/bundle.js", "/style.css", "/demo.css"].includes(name)) {
            if (name === "/") {
                const label =
                    config.mode === "real"
                        ? "REAL BACKEND DEMONSTRATION - SQL-backed assessment data"
                        : "SYNTHETIC PREVIEW - MOCK DATA, NO BACKEND REQUESTS";
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                return res.end(
                    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AXIS ${config.mode} browser demonstration</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/demo.css"></head><body><p class="axis-demo-banner">${label}. This is not Mendix runtime.</p><main id="root"></main><script src="/bundle.js"></script></body></html>`
                );
            }
            const asset =
                name === "/bundle.js"
                    ? `.preview/${config.mode === "real" ? "real" : "bundle"}.js`
                    : name === "/style.css"
                    ? "src/ui/AxisLoanPortfolio.css"
                    : "preview/demo.css";
            res.setHeader("Content-Type", name.endsWith(".css") ? "text/css" : "text/javascript");
            return fs
                .createReadStream(path.join(root, asset))
                .on("error", () => {
                    if (!res.headersSent) res.statusCode = 404;
                    res.end();
                })
                .pipe(res);
        }
        if (config.mode !== "real") return error(res, 404, "NOT_FOUND");
        if (req.headers["x-demo-request"] !== "1" || (req.method !== "GET" && req.headers.origin !== origin))
            return error(res, 403, "DEMO_REQUEST_DENIED");
        if (name.startsWith("/demo/") && url.search) return error(res, 400, "INVALID_REQUEST");
        if (name === "/demo/info" && req.method === "GET")
            return json(res, 200, {
                mode: "real",
                profiles: [...profiles.values()].map(p => ({ id: p.id, label: p.label }))
            });
        if (name === "/demo/login" && req.method === "POST") {
            if (clock() - failures.since > 60000) failures = { since: clock(), count: 0 };
            if (failures.count >= 8) return error(res, 429, "DEMO_LOGIN_THROTTLED");
            const v = await body(req);
            const p = profiles.get(v.profile);
            if (
                Object.keys(v).sort().join(",") !== "code,profile" ||
                typeof v.code !== "string" ||
                !p ||
                !equal(v.code, p.code)
            ) {
                failures.count++;
                return error(res, 401, "DEMO_LOGIN_FAILED");
            }
            if (p.expiresAt <= clock()) return error(res, 401, "DEMO_CREDENTIALS_EXPIRED");
            const old = session(req);
            if (old) sessions.delete(old.id);
            if (sessions.size >= 64) return error(res, 503, "DEMO_SESSION_LIMIT");
            const id = nonce(),
                s = {
                    profile: p.id,
                    csrf: nonce(),
                    scopeKey: nonce(),
                    expiresAt: Math.min(p.expiresAt, clock() + sessionSeconds * 1000)
                };
            sessions.set(id, s);
            res.setHeader(
                "Set-Cookie",
                `axis_demo=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(
                    1,
                    Math.floor((s.expiresAt - clock()) / 1000)
                )}`
            );
            return json(res, 200, publicSession(s));
        }
        const s = session(req);
        if (!s) return error(res, 401, "DEMO_SESSION_EXPIRED");
        if (name === "/demo/session" && req.method === "GET") return json(res, 200, publicSession(s));
        if (!equal(req.headers["x-demo-csrf"] || "", s.csrf)) return error(res, 403, "DEMO_CSRF_DENIED");
        if (name === "/demo/logout" && req.method === "POST") {
            sessions.delete(s.id);
            res.setHeader("Set-Cookie", "axis_demo=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
            return json(res, 200, { signedOut: true });
        }
        const reads = [
            "/api/v1/portfolio/metadata",
            "/api/v1/portfolio/groups",
            "/api/v1/portfolio/groups/children",
            "/api/v1/portfolio/loans",
            "/api/v1/portfolio/risk-runs/latest"
        ];
        const isRead =
            req.method === "GET" &&
            (reads.includes(name) || /^\/api\/v1\/portfolio\/risk-runs\/[a-f0-9-]{36}$/i.test(name));
        const isPost = req.method === "POST" && name === "/api/v1/portfolio/risk-runs";
        if (!isRead && !isPost) return error(res, 404, "DEMO_ROUTE_DENIED");
        if (req.headers.authorization) return error(res, 400, "DEMO_BEARER_NOT_ACCEPTED");
        const p = profiles.get(s.profile);
        if (isPost && (!config.allowRisk || !p.canRunRisk)) return error(res, 403, "DEMO_RISK_DISABLED");
        const headers = { Accept: "application/json", Authorization: `Bearer ${p.token}` };
        let data;
        if (isPost) {
            const v = await body(req);
            if (Object.keys(v).length) return error(res, 400, "INVALID_REQUEST");
            headers["Content-Type"] = "application/json";
            headers["Idempotency-Key"] = req.headers["idempotency-key"] || "";
            data = "{}";
        }
        const ctrl = new AbortController(),
            timer = setTimeout(() => ctrl.abort(), 10000);
        res.on("close", () => {
            if (!res.writableEnded) ctrl.abort();
        });
        try {
            const upstream = await fetch(new URL(name + url.search, config.upstream), {
                method: req.method,
                headers,
                body: data,
                redirect: "error",
                signal: ctrl.signal
            });
            const chunks = [];
            let bytes = 0;
            for await (const chunk of upstream.body) {
                bytes += chunk.length;
                if (bytes > 1024 * 1024) throw new Error();
                chunks.push(chunk);
            }
            if (res.destroyed) return;
            res.writeHead(upstream.status, {
                "Content-Type": "application/json",
                ...(upstream.headers.get("x-request-id")
                    ? { "X-Request-Id": upstream.headers.get("x-request-id") }
                    : {})
            });
            res.end(Buffer.concat(chunks));
        } catch {
            if (!res.destroyed && !res.headersSent) error(res, 503, "DEMO_UPSTREAM_UNAVAILABLE");
        } finally {
            clearTimeout(timer);
        }
    }
    function publicSession(s) {
        const p = profiles.get(s.profile);
        return {
            profile: p.id,
            label: p.label,
            scopeKey: s.scopeKey,
            csrf: s.csrf,
            expiresAt: s.expiresAt,
            canReadRisk: !!p.canReadRisk,
            canRunRisk: !!config.allowRisk && !!p.canRunRisk
        };
    }
    server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000 }, (req, res) => {
        handle(req, res).catch(ex => {
            if (!res.headersSent && !res.destroyed) error(res, ex.status || 500, ex.code || "DEMO_ERROR");
        });
    });
    return server;
}
module.exports = { createDemoServer };
if (require.main === module) {
    (async () => {
        let input = "";
        for await (const c of process.stdin) {
            input += c;
            if (input.length > 50000) throw new Error();
        }
        const config = JSON.parse(input);
        const s = createDemoServer(config);
        await new Promise((resolve, reject) => {
            s.once("error", reject);
            s.listen(config.port, "127.0.0.1", resolve);
        });
        console.log(`AXIS ${config.mode} demonstration: http://127.0.0.1:${s.address().port}`);
    })().catch(() => {
        console.error("Demonstration startup failed; check private local configuration.");
        process.exitCode = 1;
    });
}
