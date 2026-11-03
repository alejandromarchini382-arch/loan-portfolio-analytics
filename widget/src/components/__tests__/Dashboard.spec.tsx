import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { PortfolioDashboard } from "../PortfolioDashboard";
import { GroupResponse } from "../../api/contracts";
import { ApiError } from "../../api/errors";
import { client, metadata, groups, child, loans } from "../../api/__tests__/fixtures";
function setup(secondary?: "loanOfficer"): ReturnType<typeof client> {
    const api = client();
    jest.spyOn(api, "getMetadata").mockResolvedValue(metadata);
    jest.spyOn(api, "getGroups").mockResolvedValue(groups);
    jest.spyOn(api, "getChildGroups").mockResolvedValue(child);
    jest.spyOn(api, "getLoans").mockResolvedValue(loans);
    render(<PortfolioDashboard client={api} secondary={secondary} pageSize={1} />);
    return api;
}
afterEach(() => jest.restoreAllMocks());
describe("portfolio exploration", () => {
    test("metadata drives four dimensions and exact complete-root summary", async () => {
        setup();
        const primary = await screen.findByRole("combobox", { name: "Group by" });
        expect(within(primary).getAllByRole("option")).toHaveLength(4);
        expect(await screen.findByText("$9,007,199,254,740,994.00")).toBeInTheDocument();
        expect(screen.getByText("Overall average is unavailable.", { exact: false })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Secondary grouping" })).toHaveValue("");
    });
    test("two-level expansion is lazy, keyboard accessible, and collapse reuses cached children", async () => {
        const api = setup("loanOfficer");
        const parent = await screen.findByRole("button", { name: /Commercial/ });
        expect(api.getChildGroups).not.toHaveBeenCalled();
        expect(api.getLoans).not.toHaveBeenCalled();
        parent.focus();
        expect(parent).toHaveFocus();
        fireEvent.click(parent);
        expect(parent).toHaveAttribute("aria-expanded", "true");
        const officer = await screen.findByRole("button", { name: /Officer Smith/ });
        expect(api.getLoans).not.toHaveBeenCalled();
        fireEvent.click(officer);
        expect(await screen.findByText("LN-0001")).toBeInTheDocument();
        expect(api.getLoans).toHaveBeenCalledWith(
            expect.objectContaining({ groupBy: "division", subgroupBy: "loanOfficer" }),
            { key: "Commercial", subkey: "Officer Smith" },
            1,
            null,
            expect.any(AbortSignal)
        );
        fireEvent.click(parent);
        expect(parent).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(parent);
        expect(api.getChildGroups).toHaveBeenCalledTimes(1);
    });
    test("primary-only leaf pages use opaque cursors and cached previous pages", async () => {
        const api = setup();
        const parent = await screen.findByRole("button", { name: /Commercial/ });
        fireEvent.click(parent);
        await screen.findByText("LN-0001");
        jest.mocked(api.getLoans).mockResolvedValueOnce({
            ...loans,
            nextCursor: null,
            loans: [{ ...loans.loans[0], loanId: "22222222-2222-2222-2222-222222222222", loanNumber: "LN-0002" }]
        });
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByText("LN-0002");
        expect(api.getLoans).toHaveBeenLastCalledWith(
            expect.anything(),
            { key: "Commercial" },
            1,
            "opaque.signed",
            expect.any(AbortSignal)
        );
        expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Previous" }));
        expect(screen.getByText("LN-0001")).toBeInTheDocument();
        expect(api.getLoans).toHaveBeenCalledTimes(2);
    });
    test("SQL NULL paths are preserved and an empty leaf is explicit", async () => {
        const api = setup();
        jest.mocked(api.getLoans).mockResolvedValueOnce({ ...loans, loans: [], nextCursor: null });
        fireEvent.click(await screen.findByRole("button", { name: /Unassigned/ }));
        await screen.findByText("No loans match the selected filters.");
        expect(api.getLoans).toHaveBeenCalledWith(expect.anything(), { key: null }, 1, null, expect.any(AbortSignal));
    });
    test("filter validation avoids invalid requests and preserves selected filters for loans", async () => {
        const api = setup();
        await screen.findByRole("button", { name: /Commercial/ });
        fireEvent.change(screen.getByLabelText("Originated from"), { target: { value: "2026-01-02" } });
        fireEvent.change(screen.getByLabelText("Originated through"), { target: { value: "2026-01-01" } });
        fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
        expect(screen.getByRole("alert")).toHaveTextContent("end date");
        expect(api.getGroups).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByLabelText("Originated through"), { target: { value: "2026-02-01" } });
        fireEvent.change(screen.getByLabelText("Status"), { target: { value: "CLOSED" } });
        fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
        await waitFor(() => expect(api.getGroups).toHaveBeenCalledTimes(2));
        fireEvent.click(await screen.findByRole("button", { name: /Commercial/ }));
        await screen.findByText("LN-0001");
        expect(api.getLoans).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: "CLOSED", originationFrom: "2026-01-02", originationTo: "2026-02-01" }),
            expect.anything(),
            1,
            null,
            expect.any(AbortSignal)
        );
    });
    test("grouping changes cancel obsolete responses and reset expansions", async () => {
        const api = setup();
        await screen.findByRole("button", { name: /Commercial/ });
        let finish: (value: GroupResponse) => void = () => undefined;
        jest.mocked(api.getGroups)
            .mockImplementationOnce(
                () =>
                    new Promise(resolve => {
                        finish = resolve;
                    })
            )
            .mockResolvedValueOnce({
                ...groups,
                groupBy: "borrowerType",
                groups: [{ ...groups.groups[0], key: "CORPORATE", label: "Corporate" }]
            });
        fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "riskRating" } });
        await waitFor(() => expect(api.getGroups).toHaveBeenCalledTimes(2));
        const abandoned = jest.mocked(api.getGroups).mock.calls[1][1];
        fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "borrowerType" } });
        await screen.findByRole("button", { name: /Corporate/ });
        expect(abandoned.aborted).toBe(true);
        await act(async () => finish(groups));
        expect(screen.queryByRole("button", { name: /Commercial/ })).not.toBeInTheDocument();
    });
    test("changing primary prevents duplicate secondary dimensions", async () => {
        setup("loanOfficer");
        await screen.findByRole("button", { name: /Commercial/ });
        fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "loanOfficer" } });
        expect(screen.getByLabelText("Secondary grouping")).toHaveValue("");
        expect(
            within(screen.getByLabelText("Secondary grouping")).queryByRole("option", { name: "Loan officer" })
        ).not.toBeInTheDocument();
    });
    test("mismatched child version never appears and refreshes root", async () => {
        const api = setup("loanOfficer");
        jest.mocked(api.getChildGroups).mockResolvedValueOnce({ ...child, snapshotVersion: 2 });
        fireEvent.click(await screen.findByRole("button", { name: /Commercial/ }));
        await screen.findByText(/Expanded data was cleared/);
        expect(screen.queryByRole("button", { name: /Officer Smith/ })).not.toBeInTheDocument();
        await waitFor(() => expect(api.getGroups).toHaveBeenCalledTimes(2));
    });
    test("invalid cursor restarts only the affected loan list", async () => {
        const api = setup();
        fireEvent.click(await screen.findByRole("button", { name: /Commercial/ }));
        await screen.findByText("LN-0001");
        jest.mocked(api.getLoans).mockRejectedValueOnce(new ApiError("INVALID_CURSOR", 400));
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
        await screen.findByText(/page link expired/);
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(api.getLoans).toHaveBeenCalledTimes(3));
        expect(api.getLoans).toHaveBeenLastCalledWith(
            expect.anything(),
            { key: "Commercial" },
            1,
            null,
            expect.any(AbortSignal)
        );
        expect(api.getGroups).toHaveBeenCalledTimes(1);
    });
    test("failed refresh retains the last valid published report", async () => {
        const api = setup();
        await screen.findByRole("button", { name: /Commercial/ });
        jest.mocked(api.getGroups).mockRejectedValueOnce(new ApiError("DATABASE_UNAVAILABLE", 503, "safe-id"));
        fireEvent.click(screen.getByRole("button", { name: "Refresh report" }));
        await screen.findByRole("alert");
        expect(screen.getByText("Reference: safe-id")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Commercial/ })).toBeInTheDocument();
    });
    test("empty root result and retryable initial error are explicit", async () => {
        const api = setup();
        await screen.findByRole("button", { name: /Commercial/ });
        jest.mocked(api.getGroups).mockResolvedValueOnce({ ...groups, groups: [] });
        fireEvent.click(screen.getByRole("button", { name: "Refresh report" }));
        await screen.findByText("No loans match the selected filters.");
    });
    test("unmount aborts pending loan requests", async () => {
        const api = client();
        jest.spyOn(api, "getMetadata").mockResolvedValue(metadata);
        jest.spyOn(api, "getGroups").mockResolvedValue(groups);
        jest.spyOn(api, "getLoans").mockImplementation(() => new Promise(() => undefined));
        const view = render(<PortfolioDashboard client={api} />);
        fireEvent.click(await screen.findByRole("button", { name: /Commercial/ }));
        await waitFor(() => expect(api.getLoans).toHaveBeenCalledTimes(1));
        const s = jest.mocked(api.getLoans).mock.calls[0][4];
        view.unmount();
        expect(s.aborted).toBe(true);
    });
});

test("a changed loan snapshot clears expansions and reloads the root", async () => {
    const api = setup();
    fireEvent.click(await screen.findByRole("button", { name: /Commercial/ }));
    await screen.findByText("LN-0001");
    jest.mocked(api.getLoans).mockRejectedValueOnce(new ApiError("SNAPSHOT_CHANGED", 409));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/Expanded data was cleared/);
    await waitFor(() => expect(api.getGroups).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("LN-0001")).not.toBeInTheDocument();
});

test("keyboard Enter expands the focused group button", async () => {
    const user = userEvent.setup();
    setup("loanOfficer");
    const parent = await screen.findByRole("button", { name: /Commercial/ });
    parent.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: /Officer Smith/ });
    expect(parent).toHaveAttribute("aria-expanded", "true");
});
