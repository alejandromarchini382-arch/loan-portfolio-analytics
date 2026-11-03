import { ReactElement } from "react";
import { AxisLoanPortfolioPreviewProps } from "../typings/AxisLoanPortfolioProps";
export function preview(props: AxisLoanPortfolioPreviewProps): ReactElement {
    return (
        <section className="axis-portfolio">
            <header className="axis-header">
                <strong className="axis-brand">AXIS</strong>
                <h1>{props.title || "Loan Portfolio Analytics"}</h1>
            </header>
            <p>Portfolio groups and loan details load from the reporting API at runtime.</p>
            <p>Configure a trusted runtime session before connecting. Design preview makes no API requests.</p>
        </section>
    );
}
export function getPreviewCss(): string {
    return require("./ui/AxisLoanPortfolio.css");
}
