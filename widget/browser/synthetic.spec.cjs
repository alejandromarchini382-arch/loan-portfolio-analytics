const { test, expect } = require("@playwright/test");
test("synthetic mode is clearly labelled and makes no API/auth requests", async ({ page }) => {
    const calls = [];
    page.on("request", r => {
        if (r.url().includes("/api/") || r.url().includes("/demo/")) calls.push(r.url());
    });
    await page.goto("/");
    await expect(page.getByText(/SYNTHETIC PREVIEW/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Portfolio breakdown" })).toBeVisible();
    expect(calls.length).toBe(0);
    await page.goto("/?empty=1");
    await expect(page.getByText("No loans match the selected filters.")).toBeVisible();
    expect(calls.length).toBe(0);
});
