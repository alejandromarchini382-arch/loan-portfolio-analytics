import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PortfolioDashboard } from "../src/components/PortfolioDashboard.tsx";
import { PortfolioClient } from "../src/api/portfolioClient.ts";
const version = {
    snapshotVersion: 1,
    riskRunId: "11111111-1111-1111-1111-111111111111",
    asOfUtc: "2026-11-03T09:00:00Z",
    currency: "USD",
    rateUnit: "fractionPerYear",
    requestId: "synthetic-preview"
};
const metadata = {
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
const root = [
    {
        key: "Commercial",
        label: "Commercial",
        loanCount: 120,
        totalBalance: "43482436.24",
        averageInterestRate: "0.08250000",
        hasChildren: true
    },
    {
        key: "Mortgage",
        label: "Mortgage",
        loanCount: 84,
        totalBalance: "29150000.00",
        averageInterestRate: "0.06920000",
        hasChildren: true
    },
    {
        key: "Retail",
        label: "Retail",
        loanCount: 62,
        totalBalance: "12641780.45",
        averageInterestRate: "0.10410000",
        hasChildren: true
    },
    {
        key: null,
        label: "Unassigned",
        loanCount: 4,
        totalBalance: "375000.00",
        averageInterestRate: null,
        hasChildren: true
    }
];
const delay = value => new Promise(resolve => setTimeout(() => resolve(value), 120));
const api = new PortfolioClient("http://localhost:8081", {
    scopeKey: "synthetic-preview-only",
    canReadRisk: true,
    canRunRisk: false,
    getAccessToken: async () => "unused-synthetic-preview"
});
api.getMetadata = () => delay(metadata);
api.getGroups = query =>
    delay({
        ...version,
        groupBy: query.groupBy,
        subgroupBy: query.subgroupBy || null,
        groups:
            new URLSearchParams(location.search).has("empty") || query.status !== "ACTIVE"
                ? []
                : root.map((g, i) => ({
                      ...g,
                      key:
                          query.groupBy === "division"
                              ? g.key
                              : query.groupBy === "riskRating"
                              ? ["HIGH", "MEDIUM", "LOW", null][i]
                              : query.groupBy === "borrowerType"
                              ? ["CORPORATE", "INDIVIDUAL", "", null][i]
                              : ["Officer A", "Officer B", "Officer C", null][i],
                      label:
                          query.groupBy === "division"
                              ? g.label
                              : query.groupBy === "riskRating"
                              ? ["High", "Medium", "Low", "Unrated"][i]
                              : ["Group A", "Group B", "Group C", "Unassigned"][i],
                      hasChildren: !!query.subgroupBy
                  }))
    });
api.getChildGroups = (query, parent) =>
    delay({
        ...version,
        groupBy: query.groupBy,
        subgroupBy: query.subgroupBy,
        parent: { dimension: query.groupBy, key: parent },
        groups: [
            {
                key: "Officer A",
                label: "Officer A",
                loanCount: 60,
                totalBalance: "21741218.12",
                averageInterestRate: "0.07900000",
                hasChildren: false
            },
            {
                key: "Officer B",
                label: "Officer B",
                loanCount: 60,
                totalBalance: "21741218.12",
                averageInterestRate: "0.08600000",
                hasChildren: false
            }
        ]
    });
api.getLoans = (_query, _path, _limit, cursor) =>
    delay({
        ...version,
        nextCursor: cursor ? null : "synthetic-next-page",
        loans: Array.from({ length: 3 }, (_, i) => ({
            loanId: `example-${cursor ? 4 + i : 1 + i}`,
            loanNumber: `LN-${cursor ? 1004 + i : 1001 + i}`,
            borrowerName: `Fictional Borrower ${cursor ? 4 + i : 1 + i}`,
            borrowerType: "CORPORATE",
            industry: "Manufacturing",
            division: "Commercial",
            loanOfficer: "Officer A",
            principalAmount: "1000000.00",
            currentBalance: "925000.00",
            interestRate: "0.08250000",
            status: "ACTIVE",
            originationDate: "2024-05-10",
            maturityDate: "2029-05-10",
            daysPastDue: 0,
            lastPaymentDate: "2026-10-01",
            borrowerRiskRating: "MEDIUM",
            loanRiskRating: "LOW"
        }))
    });
api.getLatestRiskRun = () =>
    delay({
        runId: version.riskRunId,
        policyVersion: "risk-demo-v1",
        publishedAtUtc: "2026-11-03T08:30:00Z",
        jobStatus: "SUCCEEDED",
        lastRequestedAtUtc: "2026-11-03T08:29:00Z"
    });
createRoot(document.getElementById("root")).render(
    createElement(PortfolioDashboard, { client: api, secondary: "loanOfficer", pageSize: 50 })
);
