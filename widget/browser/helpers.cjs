const fs = require("node:fs");
const path = require("node:path");
const { expect } = require("@playwright/test");
function credentials(profile = "tenant-a") {
    const base = process.env.DEMO_TEST_URL || "http://127.0.0.1:3099",
        port = new URL(base).port;
    const folder = path.resolve(__dirname, "../.demo");
    const files = fs
        .readdirSync(folder)
        .filter(n => n.startsWith(`access-${port}-`) && n.endsWith(".json"))
        .sort((a, b) => fs.statSync(path.join(folder, b)).mtimeMs - fs.statSync(path.join(folder, a)).mtimeMs);
    if (!files.length) throw new Error("Start the protected real demo before browser tests");
    const access = JSON.parse(fs.readFileSync(path.join(folder, files[0]), "utf8"));
    const code = access.profiles.find(p => p.id === profile)?.code;
    if (!code) throw new Error("Authorized demo profile unavailable");
    return { profile, code };
}
async function login(page, profile = "tenant-a") {
    const access = credentials(profile);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Connect to the real portfolio" })).toBeVisible();
    const status = await page.evaluate(
        async credentials =>
            (
                await fetch("/demo/login", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "X-Demo-Request": "1" },
                    body: JSON.stringify(credentials)
                })
            ).status,
        access
    );
    expect(status).toBe(200);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Portfolio breakdown" })).toBeVisible();
}
function roots(page) {
    return page.locator(".axis-groups > tbody > tr > th > button");
}
async function evidence(page, name) {
    const directory = path.resolve(__dirname, "../evidence/browser-demo");
    fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({
        path: path.join(directory, name + ".png"),
        fullPage: true,
        mask: [page.locator('input[type="password"]'), page.locator(".axis-loans tbody th")]
    });
}
const version = {
    snapshotVersion: 1,
    riskRunId: null,
    asOfUtc: "2026-10-30T03:00:00Z",
    currency: "USD",
    rateUnit: "fractionPerYear",
    requestId: "mock-browser"
};
const groups = [
    {
        key: "Commercial",
        label: "Commercial",
        loanCount: 2,
        totalBalance: "1000.01",
        averageInterestRate: "0.08250000",
        hasChildren: true
    },
    { key: null, label: "Unassigned", loanCount: 1, totalBalance: "0.99", averageInterestRate: null, hasChildren: true }
];
const meta = {
    dimensions: [
        { value: "division", label: "Division" },
        { value: "loanOfficer", label: "Loan officer" },
        { value: "borrowerType", label: "Borrower type" },
        { value: "riskRating", label: "Loan risk rating" }
    ],
    maxDepth: 2,
    defaultStatus: "ACTIVE",
    defaultLimit: 50,
    maxLimit: 100,
    currency: "USD",
    rateUnit: "fractionPerYear"
};
function payload(url) {
    const q = url.searchParams,
        name = url.pathname;
    if (name.endsWith("metadata")) return meta;
    if (name.endsWith("risk-runs/latest"))
        return {
            runId: null,
            policyVersion: "risk-demo-v1",
            publishedAtUtc: null,
            jobStatus: null,
            lastRequestedAtUtc: null
        };
    if (name.endsWith("groups/children"))
        return {
            ...version,
            groupBy: q.get("groupBy"),
            subgroupBy: q.get("subgroupBy"),
            parent: { dimension: q.get("groupBy"), key: q.get("parentKey") },
            groups: [{ ...groups[0], key: "Officer A", label: "Officer A", hasChildren: false }]
        };
    if (name.endsWith("groups"))
        return {
            ...version,
            groupBy: q.get("groupBy"),
            subgroupBy: q.get("subgroupBy"),
            groups: groups.map(g => ({ ...g, hasChildren: !!q.get("subgroupBy") }))
        };
    if (name.endsWith("loans"))
        return {
            ...version,
            nextCursor: q.has("cursor") ? null : "opaque.mock.cursor",
            loans: [
                {
                    loanId: q.has("cursor")
                        ? "22222222-2222-2222-2222-222222222222"
                        : "11111111-1111-1111-1111-111111111111",
                    loanNumber: q.has("cursor") ? "LN-002" : "LN-001",
                    borrowerName: "Fictional test borrower",
                    borrowerType: "CORPORATE",
                    industry: null,
                    division: q.get("groupKey"),
                    loanOfficer: "Officer A",
                    principalAmount: "1000.00",
                    currentBalance: "500.01",
                    interestRate: "0.08250000",
                    status: "ACTIVE",
                    originationDate: "2024-01-01",
                    maturityDate: "2029-01-01",
                    daysPastDue: 0,
                    lastPaymentDate: null,
                    borrowerRiskRating: "HIGH",
                    loanRiskRating: null
                }
            ]
        };
    throw new Error("Unexpected mocked route");
}
async function mockApi(page, change) {
    const requests = [];
    await page.route("**/api/v1/portfolio/**", async route => {
        const url = new URL(route.request().url());
        requests.push(url);
        let data = payload(url),
            status = 200;
        if (change) {
            const result = await change(url, data, requests);
            if (result?.abort) return route.abort();
            if (result?.status) status = result.status;
            if (result?.data) data = result.data;
        }
        try {
            await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
        } catch {
            /* An intentionally canceled request may have lost its page ownership. */
        }
    });
    return requests;
}
module.exports = { login, roots, evidence, mockApi, payload, version, credentials };
