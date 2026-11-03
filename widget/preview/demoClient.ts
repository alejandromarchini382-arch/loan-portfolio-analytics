import { PortfolioClient } from "../src/api/portfolioClient";
export interface DemoSession {
    profile: string;
    label: string;
    scopeKey: string;
    csrf: string;
    expiresAt: number;
    canReadRisk: boolean;
    canRunRisk: boolean;
}
/** Demo-only transport. The compatibility auth value is a CSRF proof, never a JWT and never sent as Bearer. */
export class DemoPortfolioClient extends PortfolioClient {
    constructor(base: string, session: DemoSession, expired: () => void) {
        const transport: typeof fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.origin !== base || !url.pathname.startsWith("/api/v1/portfolio/"))
                throw new Error("Invalid demonstration target");
            const headers = new Headers(init?.headers);
            headers.delete("Authorization");
            headers.set("X-Demo-Request", "1");
            headers.set("X-Demo-CSRF", session.csrf);
            const response = await fetch(input, { ...init, headers, credentials: "same-origin", mode: "same-origin" });
            if (response.status === 401) expired();
            return response;
        };
        super(
            base,
            {
                scopeKey: session.scopeKey,
                canReadRisk: session.canReadRisk,
                canRunRisk: session.canRunRisk,
                getAccessToken: async () => session.csrf
            },
            transport
        );
    }
}
