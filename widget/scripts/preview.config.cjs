const { resolve } = require("node:path");
module.exports = async () =>
    Promise.all(
        ["synthetic", "real"].map(async mode => ({
            input: resolve(__dirname, mode === "real" ? "../preview/real.tsx" : "../preview/main.mjs"),
            output: {
                file: resolve(__dirname, mode === "real" ? "../.preview/real.js" : "../.preview/bundle.js"),
                format: "iife",
                sourcemap: false
            },
            plugins: [
                {
                    name: "preview-environment",
                    transform(code) {
                        return { code: code.replace(/process\.env\.NODE_ENV/g, '"development"'), map: null };
                    }
                },
                (await import("@rollup/plugin-node-resolve")).nodeResolve({ browser: true }),
                (await import("@rollup/plugin-commonjs")).default(),
                (await import("@rollup/plugin-typescript")).default({
                    tsconfig: resolve(__dirname, "../tsconfig.preview.json"),
                    exclude: ["**/__tests__/**"],
                    sourceMap: false
                })
            ]
        }))
    );
