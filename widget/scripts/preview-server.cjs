/* Isolated visual harness: synthetic data, no backend connection or token acquisition. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AXIS widget - synthetic visual harness</title><link rel="stylesheet" href="/style.css"></head><body><p>ISOLATED VISUAL HARNESS - SYNTHETIC FIXTURES. This is not Mendix runtime or authenticated backend evidence.</p><main id="root"></main><script src="/bundle.js"></script></body></html>';
const server = http.createServer((req, res) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'"
    );
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(html);
    }
    const file =
        name === "/bundle.js"
            ? "../.preview/bundle.js"
            : name === "/style.css"
            ? "../src/ui/AxisLoanPortfolio.css"
            : null;
    if (!file) {
        res.statusCode = 404;
        return res.end();
    }
    res.setHeader("Content-Type", name.endsWith(".css") ? "text/css" : "text/javascript");
    fs.createReadStream(path.resolve(__dirname, file))
        .on("error", () => {
            res.statusCode = 404;
            res.end();
        })
        .pipe(res);
});
server.listen(3099, "127.0.0.1", () => console.log("Synthetic widget harness: http://127.0.0.1:3099"));
