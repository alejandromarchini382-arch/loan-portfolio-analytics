import { ApiError } from "../errors";
import { boundAuth } from "../auth";
import { apiBase, PortfolioClient } from "../portfolioClient";
import { validate } from "../validation";
import { groups, latest, loans, metadata } from "./fixtures";
const signal = (): AbortSignal => new AbortController().signal;
function response(data: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}
function setup(data: unknown = groups, status = 200): { api: PortfolioClient; fetcher: jest.Mock } {
    const fetcher = jest.fn().mockResolvedValue(response(data, status));
    return {
        api: new PortfolioClient("http://127.0.0.1:8081", boundAuth("test-token", "scope-a", false, false), fetcher),
        fetcher
    };
}
afterEach(() => {
    jest.useRealTimers();
});
describe("typed API boundary", () => {
    test.each([
        "http://public.example",
        "https://user:password@example.test",
        "https://example.test/?token=bad",
        "javascript:alert(1)"
    ])("rejects unsafe base %s", url => expect(() => apiBase(url)).toThrow());
    test("allows HTTPS proxies and development localhost", () => {
        expect(apiBase("https://example.test/proxy/")).toBe("https://example.test/proxy");
        expect(apiBase("http://localhost:8081/")).toBe("http://localhost:8081");
    });
    test("auth provider fails closed", () => {
        expect(() => boundAuth("", "scope", false, false)).toThrow();
        expect(() => boundAuth("token\r\nbad", "scope", false, false)).toThrow();
    });
    test("metadata path and verified bearer header", async () => {
        const { api, fetcher } = setup(metadata);
        await api.getMetadata(signal());
        expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8081/api/v1/portfolio/metadata");
        expect(fetcher.mock.calls[0][1]).toMatchObject({
            credentials: "omit",
            redirect: "error",
            headers: { Authorization: "Bearer test-token" }
        });
    });
    test.each([null, "null", "", "A & B", '\u00c9quipe "Nord"'])("encodes key distinctly: %s", async value => {
        const { api, fetcher } = setup();
        await api.getChildGroups({ groupBy: "division", subgroupBy: "loanOfficer", status: "ACTIVE" }, value, signal());
        const q = new URL(fetcher.mock.calls[0][0]).searchParams;
        expect(q.has("parentKeyIsNull")).toBe(value === null);
        expect(q.get("parentKey")).toBe(value === null ? null : value);
        expect(q.getAll("status")).toHaveLength(1);
    });
    test("loan path, filters and opaque cursor remain unchanged", async () => {
        const { api, fetcher } = setup(loans);
        const cursor = "opaque.+/==";
        await api.getLoans(
            {
                groupBy: "division",
                subgroupBy: "riskRating",
                status: "CLOSED",
                borrowerType: "CORPORATE",
                division: "A & B",
                riskRating: "HIGH",
                originationFrom: "2024-01-01",
                originationTo: "2026-01-01"
            },
            { key: null, subkey: null },
            50,
            cursor,
            signal()
        );
        const q = new URL(fetcher.mock.calls[0][0]).searchParams;
        expect(q.get("cursor")).toBe(cursor);
        expect(q.get("groupKeyIsNull")).toBe("true");
        expect(q.get("subgroupKeyIsNull")).toBe("true");
        expect(q.has("groupKey")).toBe(false);
        expect(q.get("division")).toBe("A & B");
        expect(q.get("limit")).toBe("50");
    });
    test.each([400, 401, 403, 404, 409, 503])("preserves sanitized error status %s", async status => {
        const { api } = setup(
            { error: { code: "TEST_ERROR", requestId: "safe-reference", message: "private backend detail" } },
            status
        );
        await expect(api.getGroups({ groupBy: "division", status: "ACTIVE" }, signal())).rejects.toMatchObject({
            status,
            code: "TEST_ERROR",
            requestId: "safe-reference"
        });
    });
    test("bounds 429 retries to one GET replay", async () => {
        jest.useFakeTimers();
        const { api, fetcher } = setup({}, 429);
        const promise = api.getMetadata(signal()).catch(e => e);
        await jest.advanceTimersByTimeAsync(1100);
        expect(await promise).toBeInstanceOf(ApiError);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    test("POST never retries automatically; same key is passed on explicit retry", async () => {
        const { api, fetcher } = setup({ error: { code: "FLASK_UNAVAILABLE" } }, 503);
        await expect(api.submitRiskRun("same-key", signal())).rejects.toMatchObject({ status: 503 });
        await expect(api.submitRiskRun("same-key", signal())).rejects.toMatchObject({ status: 503 });
        expect(fetcher).toHaveBeenCalledTimes(2);
        for (const call of fetcher.mock.calls) {
            expect(call[1]).toMatchObject({ method: "POST", body: "{}", headers: { "Idempotency-Key": "same-key" } });
        }
    });
    test("existing latest status has no manufactured job identifier", async () => {
        const { api } = setup(latest);
        expect(await api.getLatestRiskRun(signal())).not.toHaveProperty("jobId");
    });
    test("caller cancellation fences token acquisition", async () => {
        const auth = {
            scopeKey: "a",
            canReadRisk: false,
            canRunRisk: false,
            getAccessToken: () => new Promise<string>(() => undefined)
        };
        const api = new PortfolioClient("http://localhost", auth, jest.fn());
        const ctrl = new AbortController();
        const promise = api.getMetadata(ctrl.signal);
        ctrl.abort();
        await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    });
    test("timeout bounds an unavailable token provider", async () => {
        jest.useFakeTimers();
        const api = new PortfolioClient(
            "http://localhost",
            {
                scopeKey: "a",
                canReadRisk: false,
                canRunRisk: false,
                getAccessToken: () => new Promise<string>(() => undefined)
            },
            jest.fn(),
            10
        );
        const promise = api.getMetadata(signal()).catch(e => e);
        await jest.advanceTimersByTimeAsync(11);
        expect(await promise).toMatchObject({ code: "REQUEST_TIMEOUT" });
    });
    test.each([
        ["groups", { ...groups, snapshotVersion: 9007199254740992 }],
        ["groups", { ...groups, groups: [{ ...groups.groups[0], totalBalance: 1.5 }] }],
        ["groups", { ...groups, groups: [{ ...groups.groups[0], averageInterestRate: "NaN" }] }],
        ["metadata", { ...metadata, dimensions: [] }],
        ["loans", { ...loans, loans: [{ ...loans.loans[0], loanRiskRating: "UNRATED" }] }]
    ])("rejects malformed %s response", (kind, value) =>
        expect(() => validate(kind as string, value)).toThrow("INVALID_RESPONSE")
    );
});
