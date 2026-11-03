const { spawnSync } = require("node:child_process");
const { resolve, dirname, delimiter } = require("node:path");
const root = resolve(__dirname, "..");
const env = { ...process.env, CI: "true", ESLINT_USE_FLAT_CONFIG: "false" };
const oldPath = process.env.Path || process.env.PATH || "";
for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
env[process.platform === "win32" ? "Path" : "PATH"] = dirname(process.execPath) + delimiter + oldPath;
function run(name, script, args) {
    console.log("\nCHECK: " + name);
    const result = spawnSync(process.execPath, [resolve(root, script), ...args], { cwd: root, env, stdio: "inherit" });
    if (result.error || result.status !== 0) {
        console.error("FAILED: " + name);
        process.exit(result.status || 1);
    }
}
run("formatting", "node_modules/prettier/bin-prettier.js", [
    "--check",
    "src",
    "typings",
    "scripts/*.cjs",
    "preview/*.mjs",
    "src/ui/*.css"
]);
run("ESLint (generated configuration)", "node_modules/eslint/bin/eslint.js", [
    "--config",
    ".eslintrc.js",
    "--ext",
    ".jsx,.js,.ts,.tsx",
    "src",
    "--max-warnings",
    "0"
]);
run("TypeScript", "node_modules/typescript/bin/tsc", ["--noEmit"]);
run("unit and component tests (official Jest configuration)", "node_modules/jest/bin/jest.js", [
    "--config",
    "node_modules/@mendix/pluggable-widgets-tools/test-config/jest.config.js",
    "--ci",
    "--runInBand",
    "--json",
    "--outputFile",
    "dist/test-results.json"
]);
run("official Mendix release packaging", "node_modules/@mendix/pluggable-widgets-tools/bin/mx-scripts.js", [
    "release:web"
]);
console.log("\nAll widget checks passed.");
