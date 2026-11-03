import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RiskStatus } from "../RiskStatus";
import { ApiError } from "../../api/errors";
import { client, latest } from "../../api/__tests__/fixtures";
const jobId = "11111111-1111-1111-1111-111111111111";
const submitted = { jobId, requestId: "test", status: "QUEUED" as const };
beforeEach(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: jest.fn(() => jobId) });
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});
describe("risk permissions and lifecycle", () => {
    test("read-only status never exposes a submission action", async () => {
        const api = client(true, false);
        jest.spyOn(api, "getLatestRiskRun").mockResolvedValue(latest);
        render(<RiskStatus client={api} onPublished={jest.fn()} />);
        expect(screen.queryByRole("button", { name: "Recalculate Risk" })).not.toBeInTheDocument();
        await waitFor(() => expect(api.getLatestRiskRun).toHaveBeenCalledTimes(1));
    });
    test("existing RUNNING job uses only latest polling and no invented jobId", async () => {
        jest.useFakeTimers();
        const api = client(true, true);
        const published = jest.fn();
        jest.spyOn(api, "getLatestRiskRun")
            .mockResolvedValueOnce({ ...latest, jobStatus: "RUNNING" })
            .mockResolvedValueOnce({ ...latest, runId: jobId, jobStatus: "SUCCEEDED" });
        jest.spyOn(api, "getRiskRunStatus");
        const view = render(<RiskStatus client={api} onPublished={published} />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByRole("button", { name: "Recalculate Risk" })).toBeDisabled();
        await act(async () => {
            await jest.advanceTimersByTimeAsync(2000);
        });
        expect(published).toHaveBeenCalledTimes(1);
        expect(api.getRiskRunStatus).not.toHaveBeenCalled();
        await act(async () => {
            await jest.advanceTimersByTimeAsync(10000);
        });
        expect(api.getLatestRiskRun).toHaveBeenCalledTimes(2);
        view.unmount();
    });
    test.each(["SUCCEEDED", "FAILED"] as const)("submitted job stops polling on %s", async final => {
        jest.useFakeTimers();
        const api = client(true, true);
        const published = jest.fn();
        jest.spyOn(api, "getLatestRiskRun").mockResolvedValue(latest);
        jest.spyOn(api, "submitRiskRun").mockResolvedValue(submitted);
        jest.spyOn(api, "getRiskRunStatus")
            .mockResolvedValueOnce({ ...submitted, status: "RUNNING", processedLoans: 1, totalLoans: 2 })
            .mockResolvedValueOnce({ ...submitted, status: final, processedLoans: 2, totalLoans: 2 });
        const view = render(<RiskStatus client={api} onPublished={published} />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByRole("button", { name: "Recalculate Risk" }));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(api.getRiskRunStatus).toHaveBeenCalledWith(jobId, expect.any(AbortSignal));
        expect(screen.getByText("1 / 2 loans processed")).toBeInTheDocument();
        await act(async () => {
            await jest.advanceTimersByTimeAsync(2000);
        });
        expect(published).toHaveBeenCalledTimes(final === "SUCCEEDED" ? 1 : 0);
        if (final === "FAILED") {
            expect(screen.getByText(/Previous published results remain available/)).toBeInTheDocument();
        }
        await act(async () => {
            await jest.advanceTimersByTimeAsync(10000);
        });
        expect(api.getRiskRunStatus).toHaveBeenCalledTimes(2);
        view.unmount();
    });
    test("uncertain POST retry reuses the original idempotency key", async () => {
        const api = client(false, true);
        jest.spyOn(api, "submitRiskRun")
            .mockRejectedValueOnce(new ApiError("NETWORK_ERROR"))
            .mockResolvedValueOnce(submitted);
        render(<RiskStatus client={api} onPublished={jest.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Recalculate Risk" }));
        fireEvent.click(await screen.findByRole("button", { name: "Retry risk submission" }));
        await waitFor(() => expect(api.submitRiskRun).toHaveBeenCalledTimes(2));
        expect(jest.mocked(api.submitRiskRun).mock.calls.map(c => c[0])).toEqual([jobId, jobId]);
        expect(screen.getByText(/Status permission required/)).toBeInTheDocument();
    });
    test("poll cancellation and unauthorized failures never become infinite retries", async () => {
        const api = client(true, false);
        jest.spyOn(api, "getLatestRiskRun").mockRejectedValue(new ApiError("FORBIDDEN", 403));
        const view = render(<RiskStatus client={api} onPublished={jest.fn()} />);
        await screen.findByRole("alert");
        expect(api.getLatestRiskRun).toHaveBeenCalledTimes(1);
        const signal = jest.mocked(api.getLatestRiskRun).mock.calls[0][0];
        view.unmount();
        expect(signal.aborted).toBe(true);
    });
});

test("active-run conflict switches to latest monitoring without inventing a jobId", async () => {
    const api = client(true, true);
    jest.spyOn(api, "getLatestRiskRun")
        .mockResolvedValueOnce(latest)
        .mockResolvedValue({ ...latest, jobStatus: "RUNNING" });
    jest.spyOn(api, "getRiskRunStatus");
    jest.spyOn(api, "submitRiskRun").mockRejectedValue(new ApiError("ACTIVE_RUN_EXISTS", 409));
    render(<RiskStatus client={api} onPublished={jest.fn()} />);
    await waitFor(() => expect(api.getLatestRiskRun).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Recalculate Risk" }));
    await screen.findByText(/Risk calculation in progress/);
    expect(api.getRiskRunStatus).not.toHaveBeenCalled();
});

test("refresh after a completed own job discovers a later external run via latest", async () => {
    const api = client(true, true);
    jest.spyOn(api, "getLatestRiskRun")
        .mockResolvedValueOnce(latest)
        .mockResolvedValueOnce({ ...latest, jobStatus: "SUCCEEDED" })
        .mockResolvedValue({ ...latest, jobStatus: "RUNNING" });
    jest.spyOn(api, "submitRiskRun").mockResolvedValue(submitted);
    jest.spyOn(api, "getRiskRunStatus").mockResolvedValue({
        ...submitted,
        status: "SUCCEEDED",
        processedLoans: 2,
        totalLoans: 2
    });
    render(<RiskStatus client={api} onPublished={jest.fn()} />);
    await waitFor(() => expect(api.getLatestRiskRun).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Recalculate Risk" }));
    await screen.findByText("Latest calculation completed successfully.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh risk status" }));
    await screen.findByText(/Risk calculation in progress/);
    expect(api.getRiskRunStatus).toHaveBeenCalledTimes(1);
});
