import { ReactElement, useCallback, useMemo, useState } from "react";
import { Dimension, Filters as FilterValues, Query } from "../api/contracts";
import { PortfolioClient } from "../api/portfolioClient";
import { useRemote } from "../hooks/useRemote";
import { money, totals, utc } from "../utils/format";
import { Feedback, Loading } from "./Feedback";
import { Filters } from "./Filters";
import { GroupTable } from "./GroupTable";
import { RiskStatus } from "./RiskStatus";
export interface DashboardProps {
    client: PortfolioClient;
    title?: string;
    primary?: Dimension;
    secondary?: Dimension;
    pageSize?: number;
    showRisk?: boolean;
    renew?: () => void;
}
export function PortfolioDashboard({
    client,
    title = "Loan Portfolio Analytics",
    primary = "division",
    secondary,
    pageSize = 50,
    showRisk = true,
    renew
}: DashboardProps): ReactElement {
    const [group, setGroup] = useState(primary);
    const [subgroup, setSubgroup] = useState<Dimension | undefined>(secondary === primary ? undefined : secondary);
    const [filters, setFilters] = useState<FilterValues>({ status: "ACTIVE" });
    const [epoch, setEpoch] = useState(0);
    const [notice, setNotice] = useState("");
    const query = useMemo<Query>(
        () => ({ ...filters, groupBy: group, subgroupBy: subgroup }),
        [filters, group, subgroup]
    );
    const context = JSON.stringify([client.auth.scopeKey, client.base, query]);
    const metadataLoad = useCallback((signal: AbortSignal) => client.getMetadata(signal), [client]);
    const metadata = useRemote(metadataLoad, client.auth.scopeKey);
    const rootLoad = useCallback((signal: AbortSignal) => client.getGroups(query, signal), [client, query]);
    const root = useRemote(rootLoad, context, !!metadata.data);
    const retryRoot = root.retry;
    const refresh = useCallback(() => {
        setEpoch(v => v + 1);
        retryRoot();
    }, [retryRoot]);
    const stale = useCallback(() => {
        setNotice("Portfolio data changed. Expanded data was cleared while the report refreshes.");
        refresh();
    }, [refresh]);
    const published = useCallback(() => {
        setNotice("New risk results were published. Refreshing the report.");
        refresh();
    }, [refresh]);
    const summary = root.data ? totals(root.data.groups) : undefined;
    const options = metadata.data?.dimensions || [];
    return (
        <section className="axis-portfolio" aria-label={title}>
            <header className="axis-header">
                <div className="axis-brand" aria-hidden="true">
                    AXIS
                </div>
                <div>
                    <p className="axis-eyebrow">PORTFOLIO INTELLIGENCE</p>
                    <h1>{title}</h1>
                    <p>Explore your loan portfolio by division, officer, borrower and published risk.</p>
                </div>
                <button type="button" className="axis-button-secondary" onClick={refresh} disabled={root.loading}>
                    Refresh report
                </button>
            </header>
            {renew && (
                <button type="button" className="axis-renew" onClick={renew}>
                    Renew API session
                </button>
            )}
            <div className="axis-controls">
                <label>
                    Group by
                    <select
                        value={group}
                        disabled={!metadata.data}
                        onChange={e => {
                            const value = e.target.value as Dimension;
                            setGroup(value);
                            if (subgroup === value) {
                                setSubgroup(undefined);
                            }
                            setNotice("");
                        }}
                    >
                        {options.map(o => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Secondary grouping
                    <select
                        value={subgroup || ""}
                        disabled={!metadata.data}
                        onChange={e => {
                            setSubgroup((e.target.value || undefined) as Dimension | undefined);
                            setNotice("");
                        }}
                    >
                        <option value="">None</option>
                        {options
                            .filter(o => o.value !== group)
                            .map(o => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                    </select>
                </label>
                <span className="axis-status-pill">{filters.status} loans</span>
            </div>
            <Filters
                value={filters}
                apply={value => {
                    setFilters(value);
                    setNotice("");
                }}
            />
            {notice && (
                <p className="axis-notice" role="status">
                    {notice}
                </p>
            )}
            {metadata.loading && <Loading />}
            {Boolean(metadata.error) && <Feedback error={metadata.error} retry={metadata.retry} />}
            {Boolean(root.error) && <Feedback error={root.error} retry={refresh} />}
            {root.loading && (
                <Loading text={root.data ? "Refreshing published report..." : "Loading portfolio groups..."} />
            )}
            {summary && root.data && (
                <>
                    <div className="axis-summary">
                        <article>
                            <h2>Loans in selected population</h2>
                            <strong>{summary.count.toLocaleString("en-US")}</strong>
                        </article>
                        <article>
                            <h2>Total current balance</h2>
                            <strong>{money(summary.balance)}</strong>
                            <small>USD</small>
                        </article>
                        <article>
                            <h2>Source synchronized</h2>
                            <strong className="axis-summary-date">{utc(root.data.asOfUtc)}</strong>
                            <small>
                                {root.data.riskRunId ? "Published loan risk available" : "Loan risk is Unrated"}
                            </small>
                        </article>
                    </div>
                    <div className="axis-report-heading">
                        <h2>Portfolio breakdown</h2>
                        <p>Average rates are unweighted API values per group. Overall average is unavailable.</p>
                    </div>
                    {root.data.groups.length ? (
                        <GroupTable
                            key={JSON.stringify([
                                context,
                                epoch,
                                root.data.snapshotVersion,
                                root.data.riskRunId,
                                root.data.asOfUtc
                            ])}
                            client={client}
                            query={query}
                            root={root.data}
                            pageSize={pageSize}
                            onStale={stale}
                        />
                    ) : (
                        <p className="axis-empty">No loans match the selected filters.</p>
                    )}
                </>
            )}
            {showRisk && (client.auth.canReadRisk || client.auth.canRunRisk) && (
                <RiskStatus client={client} onPublished={published} />
            )}
            <footer className="axis-footer">
                USD only &middot; Rates are annual fractions &middot; Source synchronization and risk publication are
                separate.
            </footer>
        </section>
    );
}
