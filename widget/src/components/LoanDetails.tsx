import { ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { LoanResponse, Path, Query, Version } from "../api/contracts";
import { PortfolioClient } from "../api/portfolioClient";
import { ApiError, isSnapshotError } from "../api/errors";
import { money, rate, requireVersion } from "../utils/format";
import { Feedback, Loading } from "./Feedback";
export interface LoanDetailsProps {
    client: PortfolioClient;
    query: Query;
    path: Path;
    version: Version;
    pageSize: number;
    active: boolean;
    onStale(): void;
}
export function LoanDetails({
    client,
    query,
    path,
    version,
    pageSize,
    active,
    onStale
}: LoanDetailsProps): ReactElement {
    const [pages, setPages] = useState<LoanResponse[]>([]);
    const [index, setIndex] = useState(0);
    const [error, setError] = useState<unknown>();
    const [loading, setLoading] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const controller = useRef<AbortController | undefined>(undefined);
    const page = pages[index];
    const fetchPage = useCallback(
        (cursor: string | null, next: number) => {
            controller.current?.abort();
            const ctrl = new AbortController();
            controller.current = ctrl;
            setLoading(true);
            setError(undefined);
            client
                .getLoans(query, path, pageSize, cursor, ctrl.signal)
                .then(result => {
                    if (ctrl.signal.aborted) {
                        return;
                    }
                    requireVersion(version, result);
                    const prior = pages.slice(0, next).flatMap(p => p.loans.map(l => l.loanId));
                    const ids = result.loans.map(l => l.loanId);
                    if (new Set([...prior, ...ids]).size !== prior.length + ids.length) {
                        throw new ApiError("INVALID_RESPONSE");
                    }
                    setPages(old => [...old.slice(0, next), result]);
                    setIndex(next);
                })
                .catch(ex => {
                    if (!ctrl.signal.aborted) {
                        setError(ex);
                        if (isSnapshotError(ex)) {
                            onStale();
                        }
                    }
                })
                .finally(() => {
                    if (!ctrl.signal.aborted) {
                        setLoading(false);
                    }
                });
        },
        [client, query, path, pageSize, version, onStale, pages]
    );
    useEffect(() => {
        const timer = active && !pages.length ? setTimeout(() => fetchPage(null, 0), 0) : undefined;
        return () => {
            clearTimeout(timer);
            controller.current?.abort();
            setLoading(false);
        };
    }, [active, attempt, pages.length, fetchPage]);
    function next(): void {
        if (pages[index + 1]) {
            setIndex(index + 1);
        } else if (page?.nextCursor) {
            fetchPage(page.nextCursor, index + 1);
        }
    }
    function restart(): void {
        controller.current?.abort();
        setPages([]);
        setIndex(0);
        setError(undefined);
        setAttempt(v => v + 1);
    }
    return (
        <section className="axis-loans" aria-label="Loan details">
            <div className="axis-section-heading">
                <h3>Loan details</h3>
                <span>
                    Page {index + 1} &middot; {pageSize} per page
                </span>
            </div>
            {Boolean(error) && (
                <Feedback
                    error={error}
                    retry={
                        error instanceof ApiError && error.code === "INVALID_CURSOR"
                            ? restart
                            : () => fetchPage(index ? pages[index - 1].nextCursor : null, index)
                    }
                />
            )}
            {loading && <Loading text="Loading loan details..." />}
            {page && !page.loans.length && <p>No loans match the selected filters.</p>}
            {page && page.loans.length > 0 && (
                <div className="axis-table-scroll" tabIndex={0} role="region" aria-label="Loan details table">
                    <table>
                        <caption className="axis-sr-only">Loans in the selected group</caption>
                        <thead>
                            <tr>
                                <th scope="col">Loan / borrower</th>
                                <th scope="col">Borrower type</th>
                                <th scope="col">Principal</th>
                                <th scope="col">Current balance</th>
                                <th scope="col">Interest rate</th>
                                <th scope="col">Dates</th>
                                <th scope="col">Status / loan risk</th>
                            </tr>
                        </thead>
                        <tbody>
                            {page.loans.map(loan => (
                                <tr key={loan.loanId}>
                                    <th scope="row">
                                        {loan.loanNumber}
                                        <small>{loan.borrowerName}</small>
                                        <small>
                                            {loan.division ?? "Unassigned"} / {loan.loanOfficer ?? "Unassigned"}
                                        </small>
                                    </th>
                                    <td>{loan.borrowerType}</td>
                                    <td>{money(loan.principalAmount)}</td>
                                    <td>{money(loan.currentBalance)}</td>
                                    <td>{rate(loan.interestRate)}</td>
                                    <td>
                                        {loan.originationDate}
                                        <small>Due {loan.maturityDate}</small>
                                    </td>
                                    <td>
                                        {loan.status}
                                        <small className="axis-risk-label">{loan.loanRiskRating ?? "Unrated"}</small>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <nav className="axis-pagination" aria-label="Loan pagination">
                <button type="button" disabled={index === 0 || loading} onClick={() => setIndex(v => v - 1)}>
                    Previous
                </button>
                <span>{page?.loans.length ?? 0} loans on this page</span>
                <button type="button" disabled={!page?.nextCursor || loading} onClick={next}>
                    Next
                </button>
            </nav>
        </section>
    );
}
