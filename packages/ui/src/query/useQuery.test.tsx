import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, invalidate, useQuery } from "./useQuery";

beforeEach(() => clearCache());

describe("useQuery", () => {
  it("fetches once and serves the cached value to the next caller", async () => {
    const fetcher = vi.fn().mockResolvedValue(["A-1204"]);
    const first = renderHook(() => useQuery("units:east-crest", fetcher));
    await waitFor(() => expect(first.result.current.data).toEqual(["A-1204"]));

    const second = renderHook(() => useQuery("units:east-crest", fetcher));
    expect(second.result.current.data).toEqual(["A-1204"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches by key prefix when the data is invalidated", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(["one"]).mockResolvedValueOnce(["two"]);
    const { result } = renderHook(() => useQuery("units:east-crest", fetcher));
    await waitFor(() => expect(result.current.data).toEqual(["one"]));
    act(() => invalidate("units:"));
    await waitFor(() => expect(result.current.data).toEqual(["two"]));
  });

  it("surfaces the failure instead of swallowing it", async () => {
    const { result } = renderHook(() => useQuery("units:boom", () => Promise.reject(new Error("nope"))));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.loading).toBe(false);
  });

  it("does nothing at all for a null key", () => {
    const fetcher = vi.fn();
    renderHook(() => useQuery(null, fetcher));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
