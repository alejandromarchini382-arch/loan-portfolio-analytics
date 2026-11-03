import { FormEvent, ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PortfolioDashboard } from "../src/components/PortfolioDashboard";
import { DemoPortfolioClient, DemoSession } from "./demoClient";
interface Info {
    profiles: Array<{ id: string; label: string }>;
}
async function request(path: string, body?: unknown, csrf?: string): Promise<Response> {
    return fetch(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
            "X-Demo-Request": "1",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(csrf ? { "X-Demo-CSRF": csrf } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}
function RealDemo(): ReactElement {
    const authVersion = useRef(0);
    const [info, setInfo] = useState<Info>();
    const [session, setSession] = useState<DemoSession>();
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [pageSize, setPageSize] = useState(5);
    const expired = useCallback(() => {
        setSession(undefined);
        setMessage("Session expired or was rejected. Sign in again; relaunch the demo if startup credentials expired.");
    }, []);
    const client = useMemo(
        () => (session ? new DemoPortfolioClient(location.origin, session, expired) : undefined),
        [session, expired]
    );
    useEffect(() => {
        let alive = true;
        const generation = authVersion.current;
        request("/demo/info")
            .then(async r => {
                if (!r.ok) throw new Error();
                const details = await r.json();
                if (alive) setInfo(details);
            })
            .catch(() => {
                if (alive) setMessage("The local demonstration server is unavailable. No synthetic fallback is used.");
            });
        request("/demo/session")
            .then(async r => {
                const current = r.ok ? await r.json() : undefined;
                if (alive && authVersion.current === generation) setSession(current);
            })
            .catch(() => {
                if (alive && authVersion.current === generation)
                    setMessage("The local demonstration server is unavailable. No synthetic fallback is used.");
            });
        return () => {
            alive = false;
        };
    }, []);
    useEffect(() => {
        if (!session) return;
        const timer = setTimeout(expired, Math.max(0, session.expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [session, expired]);
    async function login(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        authVersion.current++;
        setBusy(true);
        setMessage("");
        const form = event.currentTarget;
        const data = new FormData(form);
        try {
            const r = await request("/demo/login", { profile: data.get("profile"), code: data.get("code") });
            form.reset();
            if (!r.ok) {
                setMessage(
                    r.status === 429
                        ? "Too many sign-in attempts. Wait one minute."
                        : "Sign-in was rejected or startup credentials expired. Check the private access-code file or relaunch."
                );
                return;
            }
            const value = await r.json();
            setSession(value);
        } catch {
            setMessage("The local demonstration server is unavailable. No synthetic fallback is used.");
        } finally {
            setBusy(false);
        }
    }
    async function logout(): Promise<void> {
        authVersion.current++;
        setBusy(true);
        const csrf = session?.csrf;
        setSession(undefined);
        setMessage("Signed out. Cached portfolio data was cleared.");
        try {
            await request("/demo/logout", {}, csrf);
        } catch {
            setMessage("Local data was cleared. Close this tab if the demonstration server is unavailable.");
        } finally {
            setBusy(false);
        }
    }
    return (
        <div className="axis-demo-shell">
            {message && (
                <p className="axis-demo-message" role="alert">
                    {message}
                </p>
            )}
            {session && client ? (
                <>
                    <div className="axis-demo-toolbar">
                        <strong>{session.label}</strong>
                        <span>Session ends {new Date(session.expiresAt).toLocaleTimeString()}</span>
                        <label>
                            Demo page size
                            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                                <option value={5}>5</option>
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                            </select>
                        </label>
                        <button
                            type="button"
                            onClick={() => {
                                logout();
                            }}
                        >
                            Sign out / change identity
                        </button>
                    </div>
                    <PortfolioDashboard
                        key={session.scopeKey + ":" + pageSize}
                        client={client}
                        secondary="loanOfficer"
                        pageSize={pageSize}
                    />
                </>
            ) : (
                <section className="axis-portfolio axis-demo-login">
                    <p className="axis-eyebrow">LOCAL ASSESSMENT ACCESS</p>
                    <h1>Connect to the real portfolio</h1>
                    <p>
                        Use the private access code created by the operator launcher. JWTs stay on this localhost
                        server.
                    </p>
                    <form onSubmit={login}>
                        <label>
                            Authorized demo identity
                            <select name="profile" disabled={!info || busy}>
                                {info?.profiles.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Local access code
                            <input name="code" type="password" autoComplete="off" required disabled={busy} />
                        </label>
                        <button type="submit" disabled={!info || busy}>
                            {busy ? "Signing in..." : "Sign in"}
                        </button>
                    </form>
                    <p>
                        Reporting and risk permissions are separate. No risk jobs run automatically. This is not a
                        Mendix application.
                    </p>
                </section>
            )}
        </div>
    );
}
createRoot(document.getElementById("root")!).render(<RealDemo />);
