import Big from "big.js";
import { Group, Version } from "../api/contracts";
import { ApiError } from "../api/errors";
export function money(value: string | null | undefined): string {
    if (value === null || value === undefined || value === "") {
        return "\u2014";
    }
    const formatted = new Big(value).toFixed(2, Big.roundHalfUp);
    const negative = formatted.startsWith("-");
    const [whole, cents] = formatted.replace(/^-/, "").split(".");
    return `${negative ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}
export function rate(value: string | null | undefined): string {
    return value === null || value === undefined || value === ""
        ? "\u2014"
        : `${new Big(value).times(100).toFixed(2, Big.roundHalfUp)}%`;
}
export function totals(groups: Group[]): { count: number; balance: string } {
    const count = groups.reduce((n, g) => n + g.loanCount, 0);
    if (!Number.isSafeInteger(count)) {
        throw new ApiError("INVALID_RESPONSE");
    }
    return { count, balance: groups.reduce((n, g) => n.plus(g.totalBalance), new Big(0)).toFixed(2) };
}
export function sameVersion(a: Version, b: Version): boolean {
    return a.snapshotVersion === b.snapshotVersion && a.riskRunId === b.riskRunId && a.asOfUtc === b.asOfUtc;
}
export function requireVersion(a: Version, b: Version): void {
    if (!sameVersion(a, b)) {
        throw new ApiError("SNAPSHOT_CHANGED", 409);
    }
}
export function utc(value: string | null): string {
    if (!value) {
        return "Not available";
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? "Not available"
        : `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
              d
          )} UTC`;
}
