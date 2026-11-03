import { ApiError } from "./errors";
import { dimensions } from "./contracts";
type Obj = Record<string, unknown>;
function obj(v: unknown): Obj {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
        fail();
    }
    return v as Obj;
}
function fail(): never {
    throw new ApiError("INVALID_RESPONSE");
}
function text(v: unknown, nullable = false): void {
    if (!(nullable && v === null) && typeof v !== "string") {
        fail();
    }
}
function integer(v: unknown): void {
    if (!Number.isSafeInteger(v) || (v as number) < 0) {
        fail();
    }
}
function decimal(v: unknown, scale: number, nullable = false): void {
    if (nullable && v === null) {
        return;
    }
    if (typeof v !== "string" || !new RegExp(`^-?\\d+\\.\\d{${scale}}$`).test(v)) {
        fail();
    }
}
function oneOf(v: unknown, options: readonly unknown[], nullable = false): void {
    if (!(nullable && v === null) && !options.includes(v)) {
        fail();
    }
}
const statuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"];
const risks = ["HIGH", "MEDIUM", "LOW"];
function report(o: Obj): void {
    integer(o.snapshotVersion);
    text(o.riskRunId, true);
    text(o.asOfUtc, true);
    text(o.requestId);
    if (o.currency !== "USD" || o.rateUnit !== "fractionPerYear") {
        fail();
    }
}
export function validate(kind: string, value: unknown): void {
    const o = obj(value);
    if (kind === "metadata") {
        if (!Array.isArray(o.dimensions) || o.dimensions.length !== 4) {
            fail();
        }
        const seen = new Set();
        for (const item of o.dimensions) {
            const d = obj(item);
            oneOf(d.value, dimensions);
            text(d.label);
            seen.add(d.value);
        }
        if (
            seen.size !== 4 ||
            o.maxDepth !== 2 ||
            o.defaultStatus !== "ACTIVE" ||
            o.defaultLimit !== 50 ||
            o.maxLimit !== 100 ||
            o.currency !== "USD" ||
            o.rateUnit !== "fractionPerYear"
        ) {
            fail();
        }
    } else if (kind === "groups") {
        report(o);
        oneOf(o.groupBy, dimensions);
        oneOf(o.subgroupBy, dimensions, true);
        if (!Array.isArray(o.groups) || o.groups.length > 100) {
            fail();
        }
        const seen = new Set();
        for (const item of o.groups) {
            const g = obj(item);
            text(g.key, true);
            text(g.label);
            integer(g.loanCount);
            decimal(g.totalBalance, 2);
            decimal(g.averageInterestRate, 8, true);
            if (typeof g.hasChildren !== "boolean" || seen.has(g.key)) {
                fail();
            }
            seen.add(g.key);
        }
    } else if (kind === "loans") {
        report(o);
        text(o.nextCursor, true);
        if (!Array.isArray(o.loans) || o.loans.length > 100) {
            fail();
        }
        for (const item of o.loans) {
            const l = obj(item);
            for (const key of ["loanId", "loanNumber", "borrowerName", "originationDate", "maturityDate"]) {
                text(l[key]);
            }
            for (const key of ["industry", "division", "loanOfficer", "lastPaymentDate"]) {
                text(l[key], true);
            }
            decimal(l.principalAmount, 2);
            decimal(l.currentBalance, 2);
            decimal(l.interestRate, 8, true);
            integer(l.daysPastDue);
            oneOf(l.status, ["ACTIVE", "CLOSED", "DEFAULTED"]);
            oneOf(l.borrowerType, ["INDIVIDUAL", "CORPORATE"]);
            oneOf(l.borrowerRiskRating, risks, true);
            oneOf(l.loanRiskRating, risks, true);
        }
    } else if (kind === "latest") {
        for (const key of ["runId", "publishedAtUtc", "lastRequestedAtUtc"]) {
            text(o[key], true);
        }
        if (o.policyVersion !== "risk-demo-v1") {
            fail();
        }
        oneOf(o.jobStatus, statuses, true);
    } else {
        text(o.jobId);
        text(o.requestId);
        oneOf(o.status, statuses);
        if (kind === "job") {
            integer(o.processedLoans);
            integer(o.totalLoans);
        }
    }
}
