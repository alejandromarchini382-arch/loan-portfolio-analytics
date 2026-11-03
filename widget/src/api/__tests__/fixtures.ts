import { GroupResponse, LoanResponse, Metadata } from "../contracts";
import { PortfolioClient } from "../portfolioClient";
export const version = {
    snapshotVersion: 1,
    riskRunId: null,
    asOfUtc: "2026-10-30T03:00:00Z",
    currency: "USD" as const,
    rateUnit: "fractionPerYear" as const,
    requestId: "test-reference"
};
export const metadata: Metadata = {
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
export const groups: GroupResponse = {
    ...version,
    groupBy: "division",
    subgroupBy: null,
    groups: [
        {
            key: "Commercial",
            label: "Commercial",
            loanCount: 2,
            totalBalance: "9007199254740993.01",
            averageInterestRate: "0.08250000",
            hasChildren: false
        },
        {
            key: null,
            label: "Unassigned",
            loanCount: 1,
            totalBalance: "0.99",
            averageInterestRate: null,
            hasChildren: false
        }
    ]
};
export const child: GroupResponse = {
    ...groups,
    subgroupBy: "loanOfficer",
    parent: { dimension: "division", key: "Commercial" },
    groups: [
        {
            key: "Officer Smith",
            label: "Officer Smith",
            loanCount: 2,
            totalBalance: "9007199254740993.01",
            averageInterestRate: "0.08250000",
            hasChildren: false
        }
    ]
};
export const loans: LoanResponse = {
    ...version,
    nextCursor: "opaque.signed",
    loans: [
        {
            loanId: "11111111-1111-1111-1111-111111111111",
            loanNumber: "LN-0001",
            borrowerName: "Fictional Borrower",
            borrowerType: "CORPORATE",
            industry: null,
            division: "Commercial",
            loanOfficer: "Officer Smith",
            principalAmount: "1000.00",
            currentBalance: "500.01",
            interestRate: "0.08250000",
            status: "ACTIVE",
            originationDate: "2024-01-01",
            maturityDate: "2029-01-01",
            daysPastDue: 0,
            lastPaymentDate: null,
            borrowerRiskRating: "HIGH",
            loanRiskRating: null
        }
    ]
};
export const latest = {
    runId: null,
    policyVersion: "risk-demo-v1" as const,
    publishedAtUtc: null,
    jobStatus: null,
    lastRequestedAtUtc: null
};
export function client(read = false, run = false, scope = "verified-session-a"): PortfolioClient {
    return new PortfolioClient("http://localhost:8081", {
        scopeKey: scope,
        canReadRisk: read,
        canRunRisk: run,
        getAccessToken: async () => "test-only-token"
    });
}
