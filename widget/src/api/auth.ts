/** Supplied by a trusted host integration. Hints control UI only; the API authorizes every request. */
export interface PortfolioAuthProvider {
    readonly scopeKey: string;
    readonly canReadRisk: boolean;
    readonly canRunRisk: boolean;
    getAccessToken(): Promise<string>;
}
export function boundAuth(
    token: string,
    scopeKey: string,
    canReadRisk: boolean,
    canRunRisk: boolean
): PortfolioAuthProvider {
    if (!token || !scopeKey || /[\r\n]/.test(token)) {
        throw new Error("Authentication context is unavailable.");
    }
    return { scopeKey, canReadRisk, canRunRisk, getAccessToken: async () => token };
}

/** Mutable token holder for same-session renewal; the owning widget replaces it on scope changes. */
export class MendixAuthProvider implements PortfolioAuthProvider {
    private token = "";
    constructor(
        public readonly scopeKey: string,
        public readonly canReadRisk: boolean,
        public readonly canRunRisk: boolean
    ) {}
    updateToken(value: string): void {
        this.token = /[\r\n]/.test(value) ? "" : value;
    }
    async getAccessToken(): Promise<string> {
        return this.token;
    }
}
