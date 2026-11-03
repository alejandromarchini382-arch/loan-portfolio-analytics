import { PortfolioAuthProvider } from "./auth";
import { ApiError } from "./errors";
import { GroupResponse, Job, LatestRisk, LoanResponse, Metadata, Path, Query, SubmittedJob } from "./contracts";
import { validate } from "./validation";
export function apiBase(value: string): string {
    const u = new URL(value);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
    if (
        (u.protocol !== "https:" && !(local && u.protocol === "http:")) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
    ) {
        throw new Error("Use an HTTPS API URL, or HTTP localhost for development.");
    }
    return u.href.replace(/\/$/, "");
}
function key(params: URLSearchParams, name: string, value: string | null): void {
    if (value === null) {
        params.set(`${name}IsNull`, "true");
    } else {
        params.set(name, value);
    }
}
function params(query: Query): URLSearchParams {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) {
            p.set(k, v);
        }
    }
    return p;
}
export class PortfolioClient {
    readonly base: string;
    constructor(
        base: string,
        public readonly auth: PortfolioAuthProvider,
        private readonly fetcher: typeof fetch = globalThis.fetch,
        private readonly timeoutMs = 10000
    ) {
        this.base = apiBase(base);
    }
    private async request<T>(
        path: string,
        kind: string,
        signal: AbortSignal,
        p?: URLSearchParams,
        idempotencyKey?: string
    ): Promise<T> {
        const ctrl = new AbortController();
        const abort = (): void => ctrl.abort();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) {
            ctrl.abort();
        }
        const timer = setTimeout(abort, this.timeoutMs);
        try {
            const token = await new Promise<string>((resolve, reject) => {
                const cancelled = (): void => reject(new DOMException("Aborted", "AbortError"));
                ctrl.signal.addEventListener("abort", cancelled, { once: true });
                if (ctrl.signal.aborted) {
                    cancelled();
                }
                Promise.resolve()
                    .then(() => this.auth.getAccessToken())
                    .then(resolve, reject)
                    .finally(() => ctrl.signal.removeEventListener("abort", cancelled));
            });
            if (!token || /[\r\n]/.test(token)) {
                throw new ApiError("UNAUTHENTICATED", 401);
            }
            if (ctrl.signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            for (let attempt = 0; ; attempt++) {
                const response = await this.fetcher(`${this.base}/api/v1/portfolio${path}${p ? `?${p}` : ""}`, {
                    method: idempotencyKey ? "POST" : "GET",
                    signal: ctrl.signal,
                    credentials: "omit",
                    redirect: "error",
                    cache: "no-store",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "application/json",
                        ...(idempotencyKey
                            ? { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }
                            : {})
                    },
                    ...(idempotencyKey ? { body: "{}" } : {})
                });
                if (response.status === 429 && !idempotencyKey && attempt === 0) {
                    await new Promise<void>((resolve, reject) => {
                        const done = (): void => {
                            clearTimeout(wait);
                            ctrl.signal.removeEventListener("abort", cancel);
                        };
                        const cancel = (): void => {
                            done();
                            reject(new DOMException("Aborted", "AbortError"));
                        };
                        const wait = setTimeout(() => {
                            done();
                            resolve();
                        }, 1000);
                        ctrl.signal.addEventListener("abort", cancel, { once: true });
                        if (ctrl.signal.aborted) {
                            cancel();
                        }
                    });
                    continue;
                }
                let body;
                try {
                    body = await response.json();
                } catch {
                    throw new ApiError(response.ok ? "INVALID_RESPONSE" : "SERVICE_UNAVAILABLE", response.status);
                }
                if (!response.ok) {
                    const offered = body?.error?.code;
                    const code =
                        typeof offered === "string" && /^[A-Z_]{1,80}$/.test(offered) ? offered : "SERVICE_UNAVAILABLE";
                    const id = body?.error?.requestId;
                    throw new ApiError(
                        code,
                        response.status,
                        typeof id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : undefined
                    );
                }
                validate(kind, body);
                return body as T;
            }
        } catch (error) {
            if (signal.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError(ctrl.signal.aborted ? "REQUEST_TIMEOUT" : "NETWORK_ERROR");
        } finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
        }
    }
    getMetadata(signal: AbortSignal): Promise<Metadata> {
        return this.request("/metadata", "metadata", signal);
    }
    getGroups(query: Query, signal: AbortSignal): Promise<GroupResponse> {
        return this.request("/groups", "groups", signal, params(query));
    }
    getChildGroups(query: Query, parent: string | null, signal: AbortSignal): Promise<GroupResponse> {
        const p = params(query);
        key(p, "parentKey", parent);
        return this.request("/groups/children", "groups", signal, p);
    }
    getLoans(
        query: Query,
        path: Path,
        limit: number,
        cursor: string | null,
        signal: AbortSignal
    ): Promise<LoanResponse> {
        const p = params(query);
        key(p, "groupKey", path.key);
        if (path.subkey !== undefined) {
            key(p, "subgroupKey", path.subkey);
        }
        p.set("limit", String(limit));
        if (cursor !== null) {
            p.set("cursor", cursor);
        }
        return this.request("/loans", "loans", signal, p);
    }
    submitRiskRun(idempotencyKey: string, signal: AbortSignal): Promise<SubmittedJob> {
        return this.request("/risk-runs", "submitted", signal, undefined, idempotencyKey);
    }
    getRiskRunStatus(jobId: string, signal: AbortSignal): Promise<Job> {
        if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
            return Promise.reject(new ApiError("INVALID_JOB_ID", 400));
        }
        return this.request(`/risk-runs/${encodeURIComponent(jobId)}`, "job", signal);
    }
    getLatestRiskRun(signal: AbortSignal): Promise<LatestRisk> {
        return this.request("/risk-runs/latest", "latest", signal);
    }
}
