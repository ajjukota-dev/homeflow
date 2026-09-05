/**
 * A ~80-line stale-while-revalidate cache (technical/09 §2: "no data-fetching
 * library"). Revisit TanStack Query only if this grows past that.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Entry = { data: unknown; at: number; promise?: Promise<unknown> };

const cache = new Map<string, Entry>();
const subscribers = new Map<string, Set<() => void>>();

/** Invalidate every cached key starting with `prefix` and wake its subscribers. */
export function invalidate(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const [key, subs] of subscribers) {
    if (key.startsWith(prefix)) subs.forEach((fn) => fn());
  }
}

export function clearCache(): void {
  cache.clear();
  subscribers.forEach((subs) => subs.forEach((fn) => fn()));
}

function subscribe(key: string, fn: () => void): () => void {
  const set = subscribers.get(key) ?? new Set();
  set.add(fn);
  subscribers.set(key, set);
  return () => set.delete(fn);
}

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** True only while there is nothing to show; a background refresh is not loading. */
  loading: boolean;
  refreshing: boolean;
  refetch: () => void;
}

export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { staleMs?: number; pollMs?: number } = {},
): QueryResult<T> {
  const staleMs = opts.staleMs ?? 30_000;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const cached = key ? (cache.get(key)?.data as T | undefined) : undefined;
  const [data, setData] = useState<T | undefined>(cached);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(
    async (force: boolean) => {
      if (!key) return;
      const entry = cache.get(key);
      if (entry && !force && Date.now() - entry.at < staleMs) {
        setData(entry.data as T);
        return;
      }
      if (entry?.promise && !force) return;
      setRefreshing(true);
      const promise = fetcherRef.current();
      cache.set(key, { data: entry?.data, at: entry?.at ?? 0, promise });
      try {
        const result = await promise;
        cache.set(key, { data: result, at: Date.now() });
        setData(result);
        setError(null);
      } catch (e) {
        cache.delete(key);
        setError(e);
      } finally {
        setRefreshing(false);
      }
    },
    [key, staleMs],
  );

  useEffect(() => {
    if (!key) return;
    setData(cache.get(key)?.data as T | undefined);
    void run(false);
    return subscribe(key, () => void run(true));
  }, [key, run]);

  useEffect(() => {
    if (!key || !opts.pollMs) return;
    const id = setInterval(() => void run(true), opts.pollMs);
    return () => clearInterval(id);
  }, [key, opts.pollMs, run]);

  return { data, error, loading: data === undefined && error === null, refreshing, refetch: () => void run(true) };
}
