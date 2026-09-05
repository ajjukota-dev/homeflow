import { describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { ApiError, createClient, onUnauthenticated, toApiError } from "./client";

function axiosError(status: number, data: unknown): AxiosError {
  const err = new AxiosError("Request failed");
  err.response = { status, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } } as never;
  return err;
}

describe("api client", () => {
  it("sends the session cookie and the CSRF header on every request", () => {
    const client = createClient("/api/v1");
    expect(client.defaults.withCredentials).toBe(true);
    expect(client.defaults.headers["X-Requested-With"]).toBe("HomeFlow");
    expect(client.defaults.baseURL).toBe("/api/v1");
    expect(JSON.stringify(client.defaults.headers)).not.toContain("Authorization");
  });
});

describe("toApiError", () => {
  it("takes code, message, field and source_ref from the envelope", () => {
    const err = toApiError(
      axiosError(422, {
        errors: [{ code: "SOURCE_FIELD_INVALID", message: "Khata number is missing.", field: "khata_no", source_ref: "unit:abc" }],
        meta: { request_id: "req-1" },
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("SOURCE_FIELD_INVALID");
    expect(err.field).toBe("khata_no");
    expect(err.source_ref).toBe("unit:abc");
    expect(err.request_id).toBe("req-1");
    expect(err.status).toBe(422);
  });

  it("keeps every error in the envelope, not just the first", () => {
    const err = toApiError(
      axiosError(409, {
        errors: [
          { code: "GATE_FAILED", message: "Slab poured." },
          { code: "GATE_FAILED", message: "Plumbing rough-in done." },
        ],
      }),
    );
    expect(err.errors).toHaveLength(2);
  });

  it("reports an unreachable API as NETWORK rather than a blank message", () => {
    expect(toApiError(new AxiosError("Network Error")).code).toBe("NETWORK");
  });
});

describe("401 handling", () => {
  it("notifies the session store so the sign-in gate can take over", async () => {
    const listener = vi.fn();
    const off = onUnauthenticated(listener);
    const client = createClient("/api/v1");
    // Drive the interceptor directly: no network in a unit test.
    const rejected = client.interceptors.response as unknown as {
      handlers: { rejected: (e: unknown) => Promise<never> }[];
    };
    await expect(rejected.handlers[0].rejected(axiosError(401, { errors: [{ code: "UNAUTHENTICATED", message: "Sign in to continue." }] }))).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledOnce();
    off();
  });
});
