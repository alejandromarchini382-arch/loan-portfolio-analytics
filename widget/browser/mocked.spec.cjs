const { test, expect } = require("@playwright/test");
const { login, roots, mockApi, evidence, credentials } = require("./helpers.cjs");
test("mocked: rendering, exact formatting and metadata dimensions", async ({ page }) => {
    await mockApi(page);
    await login(page);
    await expect(page.getByLabel("Group by").locator("option")).toHaveCount(4);
    await expect(page.getByText("$1,001.00", { exact: true })).toBeVisible();
    await expect(page.getByText("8.25%", { exact: true })).toBeVisible();
});
test("mocked: nested expansion, cursor Next/Previous and collapse cache", async ({ page }) => {
    const requests = await mockApi(page);
    await login(page);
    expect(requests.filter(u => u.pathname.endsWith("groups/children")).length).toBe(0);
    await roots(page).filter({ hasText: "Commercial" }).click();
    await page.getByRole("button", { name: /Officer A/ }).click();
    await expect(page.getByText("LN-001")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("LN-002")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    expect(requests.find(u => u.searchParams.has("cursor")).searchParams.get("cursor")).toBe("opaque.mock.cursor");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page.getByText("LN-001")).toBeVisible();
    await roots(page).filter({ hasText: "Commercial" }).click();
    await roots(page).filter({ hasText: "Commercial" }).click();
    expect(requests.filter(u => u.pathname.endsWith("groups/children")).length).toBe(1);
});
test("mocked: SQL NULL flags and primary-only leaf expansion", async ({ page }) => {
    const requests = await mockApi(page);
    await login(page);
    await page.getByLabel("Secondary grouping").selectOption("");
    await roots(page).filter({ hasText: "Unassigned" }).click();
    await expect(page.getByText("LN-001")).toBeVisible();
    expect(requests.find(u => u.pathname.endsWith("loans")).searchParams.get("groupKeyIsNull")).toBe("true");
});
test("mocked: date validation and filters preserve request scope", async ({ page }) => {
    const requests = await mockApi(page);
    await login(page);
    await page.getByText("Portfolio filters", { exact: true }).click();
    await page.getByLabel("Originated from").fill("2026-01-02");
    await page.getByLabel("Originated through").fill("2026-01-01");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("alert")).toContainText("end date");
    await page.getByLabel("Originated through").fill("2026-02-01");
    await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("CLOSED");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect.poll(() => requests.some(u => u.searchParams.get("status") === "CLOSED")).toBe(true);
});
test("mocked: late old grouping response cannot overwrite the current grouping", async ({ page }) => {
    await mockApi(page, async (url, data) => {
        if (url.pathname.endsWith("groups") && url.searchParams.get("groupBy") === "riskRating") {
            await new Promise(r => setTimeout(r, 500));
            return { data: { ...data, groups: [{ ...data.groups[0], label: "Obsolete risk" }] } };
        }
        if (url.pathname.endsWith("groups") && url.searchParams.get("groupBy") === "borrowerType")
            return { data: { ...data, groups: [{ ...data.groups[0], label: "Current borrower group" }] } };
    });
    await login(page);
    await page.getByLabel("Group by").selectOption("riskRating");
    await page.getByLabel("Group by").selectOption("borrowerType");
    await expect(page.getByRole("button", { name: /Current borrower group/ })).toBeVisible();
    await page.waitForTimeout(650);
    await expect(page.getByRole("button", { name: /Obsolete risk/ })).toHaveCount(0);
});
test("mocked: source version mismatch refreshes rather than combines child data", async ({ page }) => {
    let changed = false;
    await mockApi(page, (url, data) => {
        if (url.pathname.endsWith("groups/children")) {
            changed = true;
            return { data: { ...data, snapshotVersion: 2 } };
        }
        if (changed && url.pathname.endsWith("groups")) return { data: { ...data, snapshotVersion: 2 } };
    });
    await login(page);
    await roots(page).first().click();
    await expect(page.getByText(/Expanded data was cleared/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Officer A/ })).toHaveCount(0);
});
test("mocked: loading and explicit upstream error, with retry and no fixture fallback", async ({ page }) => {
    let fail = false;
    await mockApi(page, async url => {
        if (url.pathname.endsWith("groups") && fail) {
            fail = false;
            await new Promise(r => setTimeout(r, 400));
            return { status: 503, data: { error: { code: "DEMO_UPSTREAM_UNAVAILABLE", requestId: "safe-error" } } };
        }
    });
    await login(page);
    fail = true;
    await page.getByRole("button", { name: "Refresh report" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Refreshing published report" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
    await page
        .locator(".axis-demo-banner")
        .evaluate(
            el => (el.textContent = "MOCKED BROWSER TEST - controlled upstream error; not real backend evidence")
        );
    await evidence(page, "mocked-error");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
});
test("mocked: empty groups are explicit", async ({ page }) => {
    await mockApi(page, (url, data) =>
        url.pathname.endsWith("groups") ? { data: { ...data, groups: [] } } : undefined
    );
    await login(page);
    await expect(page.getByText("No loans match the selected filters.")).toBeVisible();
});
test("mocked: keyboard expansion and responsive layout", async ({ page }) => {
    await mockApi(page);
    await login(page);
    const parent = roots(page).first();
    await parent.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Officer A/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
test("mocked: invalid access code is rejected by the real local authentication boundary", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Local access code").fill("invalid-test-code");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("rejected");
    await expect(page.getByRole("heading", { name: "Portfolio breakdown" })).toHaveCount(0);
});
test("mocked: expiration clears visible cached data", async ({ page }) => {
    await mockApi(page);
    await login(page);
    await page.route("**/demo/session", async route => {
        const r = await route.fetch();
        const data = await r.json();
        await route.fulfill({ json: { ...data, expiresAt: Date.now() + 500 } });
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Connect to the real portfolio" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("expired");
});

test("mocked: delayed bootstrap cannot erase a newly authenticated form session", async ({ page }) => {
    await mockApi(page);
    await page.route("**/demo/session", async route => {
        await new Promise(r => setTimeout(r, 600));
        try {
            await route.fulfill({ status: 401, json: { error: { code: "DEMO_SESSION_EXPIRED" } } });
        } catch {
            /* The page may have canceled its bootstrap request. */
        }
    });
    await page.goto("/");
    await expect(page.getByLabel("Authorized demo identity")).toBeEnabled();
    await page.evaluate(values => {
        document.querySelector('select[name="profile"]').value = values.profile;
        document.querySelector('input[name="code"]').value = values.code;
        document.querySelector("form").requestSubmit();
    }, credentials());
    await expect(page.getByRole("heading", { name: "Portfolio breakdown" })).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.getByRole("heading", { name: "Portfolio breakdown" })).toBeVisible();
});

test("mocked: running then failed risk status retains the published report without fabricated job IDs", async ({
    page
}) => {
    let state = "RUNNING";
    const requests = await mockApi(page, (url, data) =>
        url.pathname.endsWith("risk-runs/latest")
            ? {
                  data: {
                      ...data,
                      runId: "11111111-1111-1111-1111-111111111111",
                      publishedAtUtc: "2026-10-30T03:00:00Z",
                      jobStatus: state,
                      lastRequestedAtUtc: "2026-11-03T03:00:00Z"
                  }
              }
            : undefined
    );
    const mutations = [];
    page.on("request", r => {
        if (r.method() === "POST" && r.url().includes("risk-runs")) mutations.push(r.url());
    });
    await login(page);
    await expect(
        page.getByText("Risk calculation in progress. Current published results remain available.")
    ).toBeVisible();
    await expect(page.getByText("$1,001.00", { exact: true })).toBeVisible();
    state = "FAILED";
    await expect(page.getByText("Risk calculation failed. Previous published results remain available.")).toBeVisible();
    await expect(page.getByText("$1,001.00", { exact: true })).toBeVisible();
    expect(mutations).toHaveLength(0);
    expect(requests.filter(u => /risk-runs\/[a-f0-9-]{36}$/i.test(u.pathname))).toHaveLength(0);
});
test("mocked: backend 401 clears the current reporting session", async ({ page }) => {
    let rejected = false;
    await mockApi(page, url =>
        rejected && url.pathname.endsWith("groups")
            ? { status: 401, data: { error: { code: "UNAUTHORIZED" } } }
            : undefined
    );
    await login(page);
    rejected = true;
    await page.getByRole("button", { name: "Refresh report" }).click();
    await expect(page.getByRole("heading", { name: "Connect to the real portfolio" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Portfolio breakdown" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("expired or was rejected");
});
