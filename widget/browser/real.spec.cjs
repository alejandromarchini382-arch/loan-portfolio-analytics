const { test, expect } = require("@playwright/test");
const Big = require("big.js");
const { login, roots, evidence } = require("./helpers.cjs");
const dollars = value => {
    const [whole, cents] = new Big(value).toFixed(2).split(".");
    return "$" + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + cents;
};
function rootResponse(page, group = "division") {
    return page.waitForResponse(r => {
        const u = new URL(r.url());
        return (
            u.pathname === "/api/v1/portfolio/groups" && u.searchParams.get("groupBy") === group && r.status() === 200
        );
    });
}
async function api(page, path, method = "GET", body) {
    return page.evaluate(
        async ({ path, method, body }) => {
            const s = await (await fetch("/demo/session", { headers: { "X-Demo-Request": "1" } })).json();
            const r = await fetch(path, {
                method,
                headers: {
                    "X-Demo-Request": "1",
                    "X-Demo-CSRF": s.csrf,
                    ...(body ? { "Content-Type": "application/json" } : {})
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            return { status: r.status, data: await r.json() };
        },
        { path, method, body }
    );
}
test("real: SQL-backed rendering and exact financial totals", async ({ page }) => {
    const pending = rootResponse(page);
    await login(page);
    const response = await (await pending).json();
    const balance = response.groups.reduce((sum, g) => sum.plus(g.totalBalance), new Big(0)).toFixed(2);
    const count = response.groups.reduce((n, g) => n + g.loanCount, 0);
    expect(count > 0).toBe(true);
    await expect(page.getByText(dollars(balance), { exact: true })).toBeVisible();
    await expect(page.locator(".axis-summary article").first()).toContainText(count.toLocaleString("en-US"));
    await evidence(page, "real-dashboard");
});
test("real: four dynamic dimensions and current published risk groups", async ({ page }) => {
    await login(page);
    for (const dimension of ["loanOfficer", "borrowerType", "riskRating", "division"]) {
        const response = rootResponse(page, dimension);
        await page.getByLabel("Group by").selectOption(dimension);
        const data = await (await response).json();
        expect(data.groupBy).toBe(dimension);
        expect(data.groups.length > 0).toBe(true);
        await expect(roots(page).first()).toBeVisible();
        if (dimension === "riskRating") {
            expect(data.riskRunId !== null).toBe(true);
            expect(data.groups.every(g => ["HIGH", "MEDIUM", "LOW", null].includes(g.key))).toBe(true);
            await evidence(page, "real-published-risk");
        }
    }
});
test("real: nested officer expansion and signed loan pagination", async ({ page }) => {
    const pending = rootResponse(page);
    await login(page);
    const data = await (await pending).json();
    const parent = [...data.groups].filter(g => g.key !== null).sort((a, b) => b.loanCount - a.loanCount)[0];
    const childRequest = page.waitForResponse(
        r => new URL(r.url()).pathname.endsWith("groups/children") && r.status() === 200
    );
    await roots(page).filter({ hasText: parent.label }).click();
    const children = await (await childRequest).json();
    expect(children.groups.reduce((n, g) => n + g.loanCount, 0)).toBe(parent.loanCount);
    const officer = [...children.groups].sort((a, b) => b.loanCount - a.loanCount)[0];
    expect(officer.loanCount > 5).toBe(true);
    const firstRequest = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("loans") && r.status() === 200);
    await page.locator(".axis-children button").filter({ hasText: officer.label }).click();
    const first = await (await firstRequest).json();
    await expect(page.locator(".axis-loans tbody tr")).toHaveCount(5);
    expect(!!first.nextCursor).toBe(true);
    const nextRequest = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("loans") && r.status() === 200);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    const nextResponse = await nextRequest;
    const next = await nextResponse.json();
    expect(new URL(nextResponse.url()).searchParams.get("cursor")).toBe(first.nextCursor);
    expect(next.loans.some(l => first.loans.some(p => p.loanId === l.loanId))).toBe(false);
    await expect(page.locator(".axis-loans tbody tr")).toHaveCount(next.loans.length);
    await evidence(page, "real-nested-pagination");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page.locator(".axis-loans tbody tr")).toHaveCount(5);
});
test("real: filters, empty state and SQL NULL path", async ({ page }) => {
    const pending = rootResponse(page);
    await login(page);
    const initial = await (await pending).json();
    const nullable = initial.groups.find(g => g.key === null);
    expect(!!nullable).toBe(true);
    const regroup = rootResponse(page);
    await page.getByLabel("Secondary grouping").selectOption("");
    await regroup;
    const nullLoans = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("loans") && r.status() === 200);
    await roots(page).filter({ hasText: "Unassigned" }).click();
    const nr = await nullLoans;
    expect(new URL(nr.url()).searchParams.get("groupKeyIsNull")).toBe("true");
    expect((await nr.json()).loans.every(l => l.division === null)).toBe(true);
    await page.getByText("Portfolio filters", { exact: true }).click();
    await page.getByLabel("Division", { exact: true }).fill("DEMO_NO_MATCH");
    const empty = rootResponse(page);
    await page.getByRole("button", { name: "Apply filters" }).click();
    expect((await (await empty).json()).groups.length).toBe(0);
    await expect(page.getByText("No loans match the selected filters.")).toBeVisible();
    await evidence(page, "real-filter-empty");
    await page.getByLabel("Division", { exact: true }).fill("");
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("CLOSED");
    const filtered = rootResponse(page);
    await page.getByRole("button", { name: "Apply filters" }).click();
    expect((await (await filtered).json()).groups.length > 0).toBe(true);
});
test("real: browser session holds no JWT; logout and identity switch reject foreign cursors", async ({
    page,
    context
}) => {
    const outgoing = [];
    page.on("request", r => {
        if (r.url().includes("/api/v1/portfolio/")) outgoing.push(r.headers().authorization || "");
    });
    await login(page);
    const root = await api(page, "/api/v1/portfolio/groups?groupBy=division");
    const parent = root.data.groups.find(g => g.key !== null && g.loanCount > 1);
    const q = new URLSearchParams({ groupBy: "division", groupKey: parent.key, limit: "1" });
    const a = await api(page, "/api/v1/portfolio/loans?" + q);
    expect(!!a.data.nextCursor).toBe(true);
    const session = await page.request.get("/demo/session", { headers: { "X-Demo-Request": "1" } });
    const s = await session.json();
    expect("token" in s || "accessToken" in s || "jwt" in s).toBe(false);
    expect((await context.cookies()).every(c => c.name !== "axis_demo" || c.httpOnly)).toBe(true);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await page.getByRole("button", { name: "Sign out / change identity" }).click();
    await expect(page.getByRole("heading", { name: "Portfolio breakdown" })).toHaveCount(0);
    await login(page, "tenant-b");
    q.set("cursor", a.data.nextCursor);
    expect((await api(page, "/api/v1/portfolio/loans?" + q)).status).toBe(400);
    const b = await api(page, "/api/v1/portfolio/groups?groupBy=division");
    expect(
        b.data.groups.reduce((n, g) => n + g.loanCount, 0) !== root.data.groups.reduce((n, g) => n + g.loanCount, 0)
    ).toBe(true);
    expect(outgoing.every(v => !v)).toBe(true);
});
test("real: permission separation, CSRF enforcement and no automatic risk mutations", async ({ page }) => {
    await login(page, "viewer-a");
    await expect(page.getByRole("region", { name: "Risk calculation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recalculate Risk" })).toHaveCount(0);
    const status = await api(page, "/api/v1/portfolio/risk-runs/latest");
    expect(status.status).toBe(403);
    expect(status.data.error.code).toBe("FORBIDDEN");
    expect((await api(page, "/api/v1/portfolio/risk-runs", "POST", {})).status).toBe(403);
    expect(
        (await page.request.get("/api/v1/portfolio/metadata", { headers: { "X-Demo-Request": "1" } })).status()
    ).toBe(403);
});
test("real: keyboard expansion and responsive narrow layout", async ({ page }) => {
    await login(page);
    const first = roots(page).first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await evidence(page, "real-responsive");
});
