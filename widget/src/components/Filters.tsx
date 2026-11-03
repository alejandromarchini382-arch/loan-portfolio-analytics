import { FormEvent, ReactElement, useState } from "react";
import { Filters as FilterValues, LoanStatus } from "../api/contracts";
export function Filters({ value, apply }: { value: FilterValues; apply(value: FilterValues): void }): ReactElement {
    const [error, setError] = useState("");
    function submit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const from = String(form.get("from") || "");
        const to = String(form.get("to") || "");
        if (from && to && from > to) {
            setError("Origination end date must be on or after the start date.");
            return;
        }
        setError("");
        apply({
            status: String(form.get("status")) as LoanStatus,
            division: String(form.get("division") || "") || undefined,
            borrowerType: (String(form.get("borrowerType") || "") || undefined) as FilterValues["borrowerType"],
            riskRating: (String(form.get("riskRating") || "") || undefined) as FilterValues["riskRating"],
            originationFrom: from || undefined,
            originationTo: to || undefined
        });
    }
    return (
        <details className="axis-filters">
            <summary>Portfolio filters</summary>
            <form onSubmit={submit}>
                <div className="axis-filter-grid">
                    <label>
                        Status
                        <select name="status" defaultValue={value.status}>
                            <option value="ACTIVE">Active</option>
                            <option value="CLOSED">Closed</option>
                            <option value="DEFAULTED">Defaulted</option>
                        </select>
                    </label>
                    <label>
                        Division
                        <input
                            name="division"
                            defaultValue={value.division}
                            maxLength={100}
                            placeholder="Exact division name"
                        />
                    </label>
                    <label>
                        Borrower type
                        <select name="borrowerType" defaultValue={value.borrowerType || ""}>
                            <option value="">All borrower types</option>
                            <option value="INDIVIDUAL">Individual</option>
                            <option value="CORPORATE">Corporate</option>
                        </select>
                    </label>
                    <label>
                        Published loan risk
                        <select name="riskRating" defaultValue={value.riskRating || ""}>
                            <option value="">All ratings, including Unrated</option>
                            <option value="HIGH">High</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="LOW">Low</option>
                        </select>
                    </label>
                    <label>
                        Originated from
                        <input
                            type="date"
                            name="from"
                            defaultValue={value.originationFrom}
                            min="0001-01-01"
                            max="9999-12-31"
                        />
                    </label>
                    <label>
                        Originated through
                        <input
                            type="date"
                            name="to"
                            defaultValue={value.originationTo}
                            min="0001-01-01"
                            max="9999-12-31"
                        />
                    </label>
                </div>
                {error && <p role="alert">{error}</p>}
                <button type="submit" className="axis-button">
                    Apply filters
                </button>
            </form>
        </details>
    );
}
