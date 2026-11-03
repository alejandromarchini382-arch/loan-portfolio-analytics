import { ReactElement, useEffect, useRef, useState } from "react";
import { Job, JobStatus, LatestRisk } from "../api/contracts";
import { PortfolioClient } from "../api/portfolioClient";
import { ApiError } from "../api/errors";
import { utc } from "../utils/format";
import { Feedback } from "./Feedback";
export function RiskStatus({ client, onPublished }: { client: PortfolioClient; onPublished(): void }): ReactElement {
    const [latest, setLatest] = useState<LatestRisk>();
    const [job, setJob] = useState<Job>();
    const [jobId, setJobId] = useState<string>();
    const [error, setError] = useState<unknown>();
    const [submitting, setSubmitting] = useState(false);
    const [revision, setRevision] = useState(0);
    const [retrySubmission, setRetrySubmission] = useState(false);
    const key = useRef<string | undefined>(undefined);
    const post = useRef<AbortController | undefined>(undefined);
    const posting = useRef(false);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            post.current?.abort();
        };
    }, []);
    useEffect(() => {
        if (!client.auth.canReadRisk) {
            return;
        }
        const ctrl = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let sawRunning = false;
        let priorRun: string | null | undefined;
        async function poll(): Promise<void> {
            try {
                let status: JobStatus | null;
                if (jobId) {
                    const current = await client.getRiskRunStatus(jobId, ctrl.signal);
                    if (ctrl.signal.aborted) {
                        return;
                    }
                    setJob(current);
                    setError(undefined);
                    status = current.status;
                    if (status === "SUCCEEDED" || status === "FAILED") {
                        const published = await client.getLatestRiskRun(ctrl.signal);
                        if (ctrl.signal.aborted) {
                            return;
                        }
                        setLatest(published);
                        if (status === "SUCCEEDED") {
                            onPublished();
                        }
                        return;
                    }
                } else {
                    const current = await client.getLatestRiskRun(ctrl.signal);
                    if (ctrl.signal.aborted) {
                        return;
                    }
                    setLatest(current);
                    setError(undefined);
                    status = current.jobStatus;
                    if (sawRunning && status === "SUCCEEDED" && current.runId !== priorRun) {
                        onPublished();
                    }
                    priorRun = current.runId;
                }
                if (status === "RUNNING" || status === "QUEUED") {
                    sawRunning = true;
                    timer = setTimeout(() => {
                        poll();
                    }, 2000);
                }
            } catch (ex) {
                if (!ctrl.signal.aborted) {
                    setError(ex);
                }
            }
        }
        poll();
        return () => {
            ctrl.abort();
            clearTimeout(timer);
        };
    }, [client, jobId, revision, onPublished]);
    async function submit(): Promise<void> {
        if (posting.current) {
            return;
        }
        posting.current = true;
        setSubmitting(true);
        setError(undefined);
        key.current = key.current || crypto.randomUUID();
        const ctrl = new AbortController();
        post.current = ctrl;
        try {
            const created = await client.submitRiskRun(key.current, ctrl.signal);
            if (ctrl.signal.aborted || !alive.current) {
                return;
            }
            setJob({ ...created, processedLoans: 0, totalLoans: 0 });
            setJobId(created.jobId);
            key.current = undefined;
            setRetrySubmission(false);
        } catch (ex) {
            if (!ctrl.signal.aborted && alive.current) {
                setError(ex);
                setRetrySubmission(true);
                if (ex instanceof ApiError && ex.status > 0 && ex.status < 500) {
                    key.current = undefined;
                    setRetrySubmission(false);
                }
                if (ex instanceof ApiError && ex.status === 409 && client.auth.canReadRisk) {
                    setJob(undefined);
                    setJobId(undefined);
                    setRevision(v => v + 1);
                }
            }
        } finally {
            posting.current = false;
            if (alive.current) {
                setSubmitting(false);
            }
        }
    }
    const status = job?.status ?? latest?.jobStatus;
    const running = status === "QUEUED" || status === "RUNNING";
    return (
        <section className="axis-risk-status" aria-label="Risk calculation">
            <div>
                <h2>Published loan risk</h2>
                <p>
                    Last successful publication:{" "}
                    {latest ? utc(latest.publishedAtUtc) : "Status permission required or status unavailable"}
                </p>
                <p role="status">
                    {status === "FAILED"
                        ? "Risk calculation failed. Previous published results remain available."
                        : running
                        ? "Risk calculation in progress. Current published results remain available."
                        : status === "SUCCEEDED"
                        ? "Latest calculation completed successfully."
                        : "Risk ratings reflect the last complete publication."}
                </p>
                {client.auth.canReadRisk && job && job.totalLoans > 0 && (
                    <p>
                        {job.processedLoans.toLocaleString("en-US")} / {job.totalLoans.toLocaleString("en-US")} loans
                        processed
                    </p>
                )}
            </div>
            <div className="axis-risk-actions">
                {client.auth.canRunRisk && (
                    <button
                        type="button"
                        className="axis-button"
                        disabled={submitting || (client.auth.canReadRisk && running)}
                        onClick={() => {
                            submit();
                        }}
                    >
                        {submitting ? "Submitting..." : retrySubmission ? "Retry risk submission" : "Recalculate Risk"}
                    </button>
                )}
                {client.auth.canReadRisk && (
                    <button
                        type="button"
                        className="axis-button-secondary"
                        onClick={() => {
                            if (job?.status === "SUCCEEDED" || job?.status === "FAILED") {
                                setJob(undefined);
                                setJobId(undefined);
                            }
                            setRevision(v => v + 1);
                        }}
                    >
                        Refresh risk status
                    </button>
                )}
            </div>
            {Boolean(error) && <Feedback error={error} />}
        </section>
    );
}
