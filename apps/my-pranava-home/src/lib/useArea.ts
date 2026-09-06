import { useCallback, useEffect, useState } from "react";

/** Every portal area screen fetches one thing on mount and needs the same
 *  loading/error/reload states (CLAUDE.md "every list has loading/empty/error states") —
 *  shared here instead of repeating it in 10 screens. */
export function useArea<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(false);
    fetcher()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(reload, [reload]);

  return { data, loading, error, reload };
}
