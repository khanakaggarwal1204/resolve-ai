import { useCallback, useEffect, useState } from 'react';

// Small data-loading hook: { data, error, loading, reload }.
// `fn` receives an AbortSignal so in-flight requests are cancelled on unmount.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(ctrl.signal)
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return;
        setState({ data: null, error, loading: false });
      });
    return () => {
      active = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
