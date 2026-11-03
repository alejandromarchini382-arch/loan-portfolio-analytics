import { ReactElement, useLayoutEffect, useMemo } from "react";
import { AxisLoanPortfolioContainerProps } from "../typings/AxisLoanPortfolioProps";
import { MendixAuthProvider } from "./api/auth";
import { PortfolioClient } from "./api/portfolioClient";
import { PortfolioDashboard } from "./components/PortfolioDashboard";
import "./ui/AxisLoanPortfolio.css";
export function AxisLoanPortfolio(props: AxisLoanPortfolioContainerProps): ReactElement {
    const token = props.accessToken.status === "available" ? props.accessToken.value : undefined;
    const hasToken = !!token;
    const scope = props.sessionScope.status === "available" ? props.sessionScope.value : undefined;
    const read = props.canReadRisk.status === "available" && props.canReadRisk.value === true;
    const run = props.canRunRisk.status === "available" && props.canRunRisk.value === true;
    const auth = useMemo(() => new MendixAuthProvider(scope || "", read, run), [scope, read, run]);
    useLayoutEffect(() => {
        auth.updateToken(token || "");
        return () => auth.updateToken("");
    }, [auth, token]);
    const context = useMemo(() => {
        if (!hasToken || !scope) {
            return {
                error: "A trusted API session is required. Configure the runtime token and session scope bindings."
            };
        }
        try {
            if (!Number.isInteger(props.pageSize) || props.pageSize < 1 || props.pageSize > 100) {
                throw new Error("Loan page size must be between 1 and 100.");
            }
            if (props.primary === props.secondary) {
                throw new Error("Primary and secondary grouping must be different.");
            }
            return {
                client: new PortfolioClient(props.apiBaseUrl, auth),
                key: crypto.randomUUID()
            };
        } catch {
            return { error: "Check the API URL, grouping configuration and loan page size (1-100)." };
        }
    }, [auth, hasToken, scope, props.apiBaseUrl, props.pageSize, props.primary, props.secondary]);
    return (
        <div className={props.class} style={props.style} tabIndex={props.tabIndex}>
            {context.client ? (
                <PortfolioDashboard
                    key={context.key}
                    client={context.client}
                    title={props.title}
                    primary={props.primary}
                    secondary={props.secondary === "none" ? undefined : props.secondary}
                    pageSize={props.pageSize}
                    showRisk={props.showRisk}
                    renew={
                        props.renewSession?.canExecute && !props.renewSession.isExecuting
                            ? () => props.renewSession?.execute()
                            : undefined
                    }
                />
            ) : (
                <section className="axis-portfolio">
                    <h1>{props.title}</h1>
                    <p role="alert">{context.error}</p>
                </section>
            )}
        </div>
    );
}
