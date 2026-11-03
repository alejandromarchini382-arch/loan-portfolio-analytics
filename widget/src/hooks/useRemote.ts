import { useCallback, useEffect, useRef, useState } from "react";
export interface Remote<T> {
    data?: T;
    loading: boolean;
    error?: unknown;
}
/** Scope/key are part of ownership. Both AbortSignal and an alive guard fence late completions. */
export function useRemote<T>(
    load: (signal: AbortSignal) => Promise<T>,
    key: string,
    enabled = true,
    cache = false
): Remote<T> & { retry(): void } {
    const [state, setState] = useState<Remote<T> & { key: string }>({ key, loading: enabled });
    const [attempt, setAttempt] = useState(0);
    const saved = useRef<{ key: string; data: T } | undefined>(undefined);
    const retry = useCallback(() => {
        saved.current = undefined;
        setAttempt(v => v + 1);
    }, []);
    useEffect(() => {
        if (!enabled || (cache && saved.current?.key === key)) {
            return;
        }
        const controller = new AbortController();
        let alive = true;
        setState(old => ({ key, loading: true, data: !cache && old.key === key ? old.data : undefined }));
        load(controller.signal)
            .then(data => {
                if (alive) {
                    saved.current = { key, data };
                    setState({ key, data, loading: false });
                }
            })
            .catch(error => {
                if (alive && !controller.signal.aborted) {
                    setState(old => ({
                        key,
                        loading: false,
                        error,
                        data: !cache && old.key === key ? old.data : undefined
                    }));
                }
            });
        return () => {
            alive = false;
            controller.abort();
        };
    }, [load, key, enabled, cache, attempt]);
    return { ...(state.key === key ? state : { loading: enabled }), retry };
}
