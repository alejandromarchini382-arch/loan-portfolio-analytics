/* Runs the actual TypeScript client in Node, with authorized test tokens only in process memory. */
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "CommonJS", moduleResolution: "node" } });
const { PortfolioClient } = require("../src/api/portfolioClient.ts");
const { totals, sameVersion } = require("../src/utils/format.ts");
const assert = require("node:assert/strict");
(async () => {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const config = JSON.parse(input);
    let passed = 0;
    const summaries = [];
    const signal = () => new AbortController().signal;
    async function check(name, run) {
        await run();
        passed++;
        console.log("PASS " + name);
    }
    const clients = config.tokens.map(
        (token, i) =>
            new PortfolioClient(config.base, {
                scopeKey: "authorized-fixture-" + i,
                canReadRisk: true,
                canRunRisk: false,
                getAccessToken: async () => token
            })
    );
    const a = clients[0],
        b = clients[1];
    await check("metadata matches the four supported dimensions", async () =>
        assert.equal((await a.getMetadata(signal())).dimensions.length, 4)
    );
    for (let i = 0; i < clients.length; i++) {
        const api = clients[i],
            roots = {};
        for (const dim of ["division", "loanOfficer", "borrowerType", "riskRating"]) {
            await check(`tenant ${i + 1}: ${dim}`, async () => {
                roots[dim] = await api.getGroups({ groupBy: dim, status: "ACTIVE" }, signal());
            });
        }
        await check(`tenant ${i + 1}: complete populations reconcile`, async () => {
            const sum = totals(roots.division.groups);
            for (const result of Object.values(roots)) {
                assert.deepEqual(totals(result.groups), sum);
                assert(sameVersion(result, roots.division));
            }
            summaries.push({ tenant: i + 1, activeLoans: sum.count, totalBalance: sum.balance });
        });
        const parent = roots.division.groups.find(g => g.key !== null && g.loanCount > 2);
        const query = { groupBy: "division", subgroupBy: "loanOfficer", status: "ACTIVE" };
        await check(`tenant ${i + 1}: nested groups reconcile`, async () => {
            const children = await api.getChildGroups(query, parent.key, signal());
            const sum = totals(children.groups);
            assert.equal(sum.count, parent.loanCount);
            assert.equal(sum.balance, parent.totalBalance);
            assert(sameVersion(children, roots.division));
        });
        await check(`tenant ${i + 1}: signed loan cursor advances uniquely`, async () => {
            const q = { groupBy: "division", status: "ACTIVE" };
            const first = await api.getLoans(q, { key: parent.key }, 1, null, signal());
            assert(first.nextCursor);
            const second = await api.getLoans(q, { key: parent.key }, 1, first.nextCursor, signal());
            assert.notEqual(first.loans[0].loanId, second.loans[0].loanId);
            assert(sameVersion(first, second));
        });
        await check(`tenant ${i + 1}: SQL NULL group path`, async () => {
            const nullable = roots.division.groups.find(g => g.key === null);
            assert(nullable);
            const page = await api.getLoans(
                { groupBy: "division", status: "ACTIVE" },
                { key: null },
                50,
                null,
                signal()
            );
            assert(page.loans.length);
            assert(page.loans.every(l => l.division === null));
        });
    }
    await check("cross-tenant cursor is rejected", async () => {
        const path = { key: "Commercial" },
            q = { groupBy: "division", status: "ACTIVE" };
        // Use a key actually present, rather than assuming fixture labels.
        path.key = (await a.getGroups(q, signal())).groups.find(g => g.key !== null && g.loanCount > 1).key;
        const first = await a.getLoans(q, path, 1, null, signal());
        await assert.rejects(b.getLoans(q, path, 1, first.nextCursor, signal()), e => e.status === 400);
    });
    await check("latest risk status has no fabricated jobId", async () =>
        assert(!("jobId" in (await a.getLatestRiskRun(signal()))))
    );
    await check(
        "reporting UI hints cannot grant risk submission",
        async () => await assert.rejects(a.submitRiskRun(crypto.randomUUID(), signal()), e => e.status === 403)
    );
    await check("invalid token is rejected", async () => {
        const api = new PortfolioClient(config.base, {
            scopeKey: "invalid",
            canReadRisk: false,
            canRunRisk: false,
            getAccessToken: async () => "invalid"
        });
        await assert.rejects(api.getMetadata(signal()), e => e.status === 401);
    });
    if (config.jobId)
        await check("foreign tenant cannot retrieve the existing job", async () => {
            assert.equal(
                (await a.getRiskRunStatus(config.jobId, signal())).jobId.toLowerCase(),
                config.jobId.toLowerCase()
            );
            await assert.rejects(b.getRiskRunStatus(config.jobId, signal()), e => e.status === 404);
        });
    const result = {
        scenariosPassed: passed,
        failed: 0,
        authorizedRiskRunsSubmitted: 0,
        jobStatusChecks: config.jobId ? "PASS" : "NOT RUN: no successful tenant publication",
        summaries,
        mode: "Node HTTP requests using actual TypeScript client; browser CORS and Mendix runtime are separate checks"
    };
    require("node:fs").writeFileSync("integration-results.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
})().catch(error => {
    console.error("Integration failure:", error.code || error.name || "UNKNOWN");
    process.exitCode = 1;
});
