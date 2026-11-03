import { ReactElement } from "react";
import { ApiError, errorText } from "../api/errors";
export function Feedback({ error, retry }: { error: unknown; retry?: () => void }): ReactElement {
    return (
        <div className="axis-feedback" role="alert">
            <span>{errorText(error)}</span>
            {error instanceof ApiError && error.requestId && <small>Reference: {error.requestId}</small>}
            {retry && (
                <button type="button" className="axis-button axis-button-secondary" onClick={retry}>
                    Retry
                </button>
            )}
        </div>
    );
}
export function Loading({ text = "Loading portfolio..." }: { text?: string }): ReactElement {
    return (
        <div className="axis-loading" role="status">
            <span className="axis-spinner" aria-hidden="true" />
            {text}
        </div>
    );
}
