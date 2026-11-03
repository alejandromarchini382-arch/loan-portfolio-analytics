export const dimensions = ["division", "loanOfficer", "borrowerType", "riskRating"] as const;
export type Dimension = (typeof dimensions)[number];
export type LoanStatus = "ACTIVE" | "CLOSED" | "DEFAULTED";
export type RiskRating = "HIGH" | "MEDIUM" | "LOW";
export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
export interface Metadata {
    dimensions: Array<{ value: Dimension; label: string }>;
    maxDepth: number;
    defaultStatus: LoanStatus;
    defaultLimit: number;
    maxLimit: number;
    currency: "USD";
    rateUnit: "fractionPerYear";
}
export interface Version {
    snapshotVersion: number;
    riskRunId: string | null;
    asOfUtc: string | null;
}
export interface Report extends Version {
    currency: "USD";
    rateUnit: "fractionPerYear";
    requestId: string;
}
export interface Group {
    key: string | null;
    label: string;
    loanCount: number;
    totalBalance: string;
    averageInterestRate: string | null;
    hasChildren: boolean;
}
export interface GroupResponse extends Report {
    groupBy: Dimension;
    subgroupBy: Dimension | null;
    parent?: { dimension: Dimension; key: string | null };
    groups: Group[];
}
export interface Loan {
    loanId: string;
    loanNumber: string;
    borrowerName: string;
    borrowerType: "INDIVIDUAL" | "CORPORATE";
    industry: string | null;
    division: string | null;
    loanOfficer: string | null;
    principalAmount: string;
    currentBalance: string;
    interestRate: string | null;
    status: LoanStatus;
    originationDate: string;
    maturityDate: string;
    daysPastDue: number;
    lastPaymentDate: string | null;
    borrowerRiskRating: RiskRating | null;
    loanRiskRating: RiskRating | null;
}
export interface LoanResponse extends Report {
    loans: Loan[];
    nextCursor: string | null;
}
export interface Filters {
    status: LoanStatus;
    division?: string;
    borrowerType?: "INDIVIDUAL" | "CORPORATE";
    riskRating?: RiskRating;
    originationFrom?: string;
    originationTo?: string;
}
export interface Query extends Filters {
    groupBy: Dimension;
    subgroupBy?: Dimension;
}
export interface Path {
    key: string | null;
    subkey?: string | null;
}
export interface SubmittedJob {
    jobId: string;
    status: JobStatus;
    requestId: string;
}
export interface Job extends SubmittedJob {
    processedLoans: number;
    totalLoans: number;
}
export interface LatestRisk {
    runId: string | null;
    policyVersion: "risk-demo-v1";
    publishedAtUtc: string | null;
    jobStatus: JobStatus | null;
    lastRequestedAtUtc: string | null;
}
