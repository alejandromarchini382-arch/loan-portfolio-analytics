export class ApiError extends Error {
    constructor(public readonly code: string, public readonly status = 0, public readonly requestId?: string) {
        super(code);
        this.name = "ApiError";
    }
}
export function errorText(error: unknown): string {
    if (!(error instanceof ApiError)) {
        return "The request could not be completed. Please retry.";
    }
    if (error.code === "INVALID_CURSOR") {
        return "This page link expired or is invalid. Restart the loan list.";
    }
    if (error.code === "SNAPSHOT_CHANGED") {
        return "Portfolio data changed. Refreshing the report.";
    }
    if (error.status === 401) {
        return "Your session must be renewed. Renew it before retrying.";
    }
    if (error.status === 403) {
        return "You do not have permission for this action, or this origin is not allowed.";
    }
    if (error.status === 404) {
        return "This resource is unavailable.";
    }
    if (error.status === 409) {
        return "Another risk run is active. Check its status before trying again.";
    }
    if (error.status === 429) {
        return "Request limit reached. Wait briefly before retrying.";
    }
    if (error.status === 400) {
        return "Check the request settings and try again.";
    }
    if (error.code === "INVALID_RESPONSE") {
        return "The service returned an unsupported response.";
    }
    return "The service is temporarily unavailable. Please retry.";
}
export function isSnapshotError(error: unknown): boolean {
    return error instanceof ApiError && error.code === "SNAPSHOT_CHANGED";
}
