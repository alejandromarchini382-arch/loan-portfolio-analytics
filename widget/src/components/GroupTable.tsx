import { Fragment, ReactElement, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Group, GroupResponse, Query } from "../api/contracts";
import { PortfolioClient } from "../api/portfolioClient";
import { isSnapshotError } from "../api/errors";
import { useRemote } from "../hooks/useRemote";
import { money, rate, requireVersion } from "../utils/format";
import { Feedback, Loading } from "./Feedback";
import { LoanDetails } from "./LoanDetails";
interface Props {
    client: PortfolioClient;
    query: Query;
    root: GroupResponse;
    pageSize: number;
    onStale(): void;
}
interface RowProps extends Props {
    group: Group;
    parent?: Group;
    active: boolean;
}
function GroupRow({ client, query, root, pageSize, onStale, group, parent, active }: RowProps): ReactElement {
    const [expanded, setExpanded] = useState(false);
    const [visited, setVisited] = useState(false);
    const id = useId();
    const hasGroups = !parent && !!query.subgroupBy;
    const load = useCallback(
        async (signal: AbortSignal) => {
            const result = await client.getChildGroups(query, group.key, signal);
            requireVersion(root, result);
            return result;
        },
        [client, query, group.key, root]
    );
    const remote = useRemote(
        load,
        JSON.stringify([query, group.key, root.snapshotVersion, root.riskRunId, root.asOfUtc]),
        active && expanded && hasGroups,
        true
    );
    useEffect(() => {
        if (isSnapshotError(remote.error)) {
            onStale();
        }
    }, [remote.error, onStale]);
    const path = useMemo(
        () => (parent ? { key: parent.key, subkey: group.key } : { key: group.key }),
        [parent, group.key]
    );
    return (
        <Fragment>
            <tr className={parent ? "axis-child-row" : ""}>
                <th scope="row">
                    <button
                        type="button"
                        className="axis-expand"
                        aria-expanded={expanded}
                        aria-controls={id}
                        onClick={() => {
                            setVisited(true);
                            setExpanded(v => !v);
                        }}
                    >
                        <span aria-hidden="true">{expanded ? "\u2212" : "+"}</span>
                        {group.label === "" ? "(Empty label)" : group.label}
                    </button>
                </th>
                <td className="axis-number">{group.loanCount.toLocaleString("en-US")}</td>
                <td className="axis-number">{money(group.totalBalance)}</td>
                <td className="axis-number">{rate(group.averageInterestRate)}</td>
            </tr>
            <tr hidden={!expanded} id={id} className="axis-expansion">
                <td colSpan={4}>
                    {visited && hasGroups && (
                        <div className="axis-children">
                            {remote.loading && <Loading text="Loading child groups..." />}
                            {Boolean(remote.error) && <Feedback error={remote.error} retry={remote.retry} />}
                            {remote.data &&
                                (remote.data.groups.length ? (
                                    <table>
                                        <caption className="axis-sr-only">Secondary groups for {group.label}</caption>
                                        <GroupHeaders />
                                        <tbody>
                                            {remote.data.groups.map(child => (
                                                <GroupRow
                                                    key={JSON.stringify(child.key)}
                                                    client={client}
                                                    query={query}
                                                    root={root}
                                                    pageSize={pageSize}
                                                    onStale={onStale}
                                                    group={child}
                                                    parent={group}
                                                    active={active && expanded}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <p>No loans match the selected filters.</p>
                                ))}
                        </div>
                    )}
                    {visited && !hasGroups && (
                        <LoanDetails
                            client={client}
                            query={query}
                            path={path}
                            version={root}
                            pageSize={pageSize}
                            active={active && expanded}
                            onStale={onStale}
                        />
                    )}
                </td>
            </tr>
        </Fragment>
    );
}
function GroupHeaders(): ReactElement {
    return (
        <thead>
            <tr>
                <th scope="col">Group</th>
                <th scope="col" className="axis-number">
                    Loans
                </th>
                <th scope="col" className="axis-number">
                    Current balance
                </th>
                <th scope="col" className="axis-number">
                    Average interest
                </th>
            </tr>
        </thead>
    );
}
export function GroupTable(props: Props): ReactElement {
    return (
        <div className="axis-table-scroll" tabIndex={0} role="region" aria-label="Portfolio groups">
            <table className="axis-groups">
                <caption className="axis-sr-only">
                    Portfolio group aggregates. Expand a row for child groups or loans.
                </caption>
                <GroupHeaders />
                <tbody>
                    {props.root.groups.map(group => (
                        <GroupRow key={JSON.stringify(group.key)} {...props} group={group} active />
                    ))}
                </tbody>
            </table>
        </div>
    );
}
