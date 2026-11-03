import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AxisLoanPortfolio } from "../../AxisLoanPortfolio";
import { AxisLoanPortfolioContainerProps } from "../../../typings/AxisLoanPortfolioProps";
import { PortfolioClient } from "../../api/portfolioClient";
import { groups, metadata } from "../../api/__tests__/fixtures";
function props(scope: string, token = "test-token"): AxisLoanPortfolioContainerProps {
    return {
        name: "portfolio",
        class: "",
        apiBaseUrl: "http://localhost:8081",
        title: "Loan Portfolio Analytics",
        pageSize: 50,
        primary: "division",
        secondary: "none",
        showRisk: true,
        accessToken: { status: "available", value: token },
        sessionScope: { status: "available", value: scope },
        canReadRisk: { status: "available", value: false },
        canRunRisk: { status: "available", value: false }
    } as unknown as AxisLoanPortfolioContainerProps;
}
afterEach(() => jest.restoreAllMocks());
test("missing trusted session fails closed without network calls", () => {
    const spy = jest.spyOn(PortfolioClient.prototype, "getMetadata");
    render(<AxisLoanPortfolio {...props("", "")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("trusted API session");
    expect(spy).not.toHaveBeenCalled();
});
test("identity change removes old cached data and fences late old-identity responses", async () => {
    let i = 0;
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => String(++i) });
    jest.spyOn(PortfolioClient.prototype, "getMetadata").mockResolvedValue(metadata);
    let finish: (value: typeof groups) => void = () => undefined;
    const roots = jest
        .spyOn(PortfolioClient.prototype, "getGroups")
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                })
        )
        .mockResolvedValueOnce({ ...groups, groups: [{ ...groups.groups[0], label: "Tenant B only" }] });
    const view = render(<AxisLoanPortfolio {...props("verified-a")} />);
    await waitFor(() => expect(roots).toHaveBeenCalledTimes(1));
    const oldSignal = roots.mock.calls[0][1];
    view.rerender(<AxisLoanPortfolio {...props("verified-b", "different-test-token")} />);
    await screen.findByRole("button", { name: /Tenant B only/ });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => finish(groups));
    expect(screen.queryByRole("button", { name: /Commercial/ })).not.toBeInTheDocument();
});

test("same-session token renewal preserves context while using the new token", async () => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "context-key" });
    jest.spyOn(PortfolioClient.prototype, "getMetadata").mockResolvedValue(metadata);
    let provider: PortfolioClient["auth"] | undefined;
    const roots = jest
        .spyOn(PortfolioClient.prototype, "getGroups")
        .mockImplementation(function (this: PortfolioClient) {
            provider = this.auth;
            return Promise.resolve(groups);
        });
    const view = render(<AxisLoanPortfolio {...props("same-scope", "first-test-token")} />);
    await screen.findByRole("button", { name: /Commercial/ });
    view.rerender(<AxisLoanPortfolio {...props("same-scope", "renewed-test-token")} />);
    expect(roots).toHaveBeenCalledTimes(1);
    expect(await provider?.getAccessToken()).toBe("renewed-test-token");
});
test("identity change immediately clears already cached financial data", async () => {
    let id = 0;
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => String(++id) });
    jest.spyOn(PortfolioClient.prototype, "getMetadata").mockResolvedValue(metadata);
    jest.spyOn(PortfolioClient.prototype, "getGroups")
        .mockResolvedValueOnce(groups)
        .mockImplementationOnce(() => new Promise(() => undefined));
    const view = render(<AxisLoanPortfolio {...props("tenant-a")} />);
    await screen.findByRole("button", { name: /Commercial/ });
    view.rerender(<AxisLoanPortfolio {...props("tenant-b", "other-test-token")} />);
    expect(screen.queryByRole("button", { name: /Commercial/ })).not.toBeInTheDocument();
});
