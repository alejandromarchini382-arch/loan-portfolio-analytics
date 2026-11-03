// Preserve the existing synthetic preview command; it never loads credentials or enables proxy routes.
const { createDemoServer } = require("./demo-server.cjs");
createDemoServer({ mode: "synthetic", port: 3099 }).listen(3099, "127.0.0.1", () =>
    console.log("Synthetic preview: http://127.0.0.1:3099")
);
