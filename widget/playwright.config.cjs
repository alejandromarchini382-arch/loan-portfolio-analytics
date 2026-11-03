const { defineConfig } = require("@playwright/test");
const path = require("node:path");
module.exports = defineConfig({
    testDir: "./browser",
    timeout: 30000,
    expect: { timeout: 10000 },
    workers: 1,
    retries: 0,
    outputDir: ".demo/test-results",
    reporter: [["list"], ["json", { outputFile: ".demo/playwright-results.json" }]],
    use: {
        channel: process.env.DEMO_BROWSER || "chrome",
        headless: true,
        viewport: { width: 1280, height: 960 },
        locale: "en-US",
        timezoneId: "UTC",
        serviceWorkers: "block",
        trace: "off",
        video: "off",
        screenshot: "off"
    },
    projects: [
        {
            name: "mocked-browser",
            testMatch: "mocked.spec.cjs",
            use: { baseURL: process.env.DEMO_TEST_URL || "http://127.0.0.1:3099" }
        },
        {
            name: "real-backend-browser",
            testMatch: "real.spec.cjs",
            use: { baseURL: process.env.DEMO_TEST_URL || "http://127.0.0.1:3099" }
        },
        { name: "synthetic-browser", testMatch: "synthetic.spec.cjs", use: { baseURL: "http://127.0.0.1:3101" } }
    ],
    webServer: {
        command: `"${path.resolve(
            __dirname,
            "../analytics-flask/.venv/Scripts/python.exe"
        )}" -B scripts/demo.py --mode synthetic --port 3101`,
        url: "http://127.0.0.1:3101",
        reuseExistingServer: true,
        stdout: "ignore",
        stderr: "pipe",
        timeout: 15000
    }
});
