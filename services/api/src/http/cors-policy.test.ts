import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { apiCors, isCredentialedOriginAllowed } from "./cors-policy";

describe("CORS allow-list", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          })
      )
    );
  });

  it("allows the local workspace and portal origins, and no other origin", () => {
    const dev = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    expect(isCredentialedOriginAllowed("http://localhost:5173", dev)).toBe(true);
    expect(isCredentialedOriginAllowed("http://localhost:5174", dev)).toBe(true);
    expect(isCredentialedOriginAllowed("https://evil.example", dev)).toBe(false);
    expect(isCredentialedOriginAllowed(undefined, dev)).toBe(false);
  });

  it("production reads ALLOWED_ORIGINS and does not fall back when that env is empty", () => {
    const empty = { NODE_ENV: "production", ALLOWED_ORIGINS: "" } as NodeJS.ProcessEnv;
    expect(isCredentialedOriginAllowed("http://localhost:5173", empty)).toBe(false);
    expect(isCredentialedOriginAllowed("https://evil.example", empty)).toBe(false);
    expect(isCredentialedOriginAllowed("https://app.example", empty)).toBe(false);

    const set = { NODE_ENV: "production", ALLOWED_ORIGINS: "https://app.example, https://home.example" } as NodeJS.ProcessEnv;
    expect(isCredentialedOriginAllowed("https://app.example", set)).toBe(true);
    expect(isCredentialedOriginAllowed("https://home.example", set)).toBe(true);
    expect(isCredentialedOriginAllowed("http://localhost:5173", set)).toBe(false);
    expect(isCredentialedOriginAllowed("https://evil.example", set)).toBe(false);
  });

  it("an unknown origin gets no credentialed CORS headers", async () => {
    const app = express();
    app.use(apiCors({ NODE_ENV: "development" } as NodeJS.ProcessEnv));
    app.get("/api/health", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    servers.push(server);
    const port = (server.address() as AddressInfo).port;

    const denied = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    expect(denied.headers.get("access-control-allow-credentials")).toBeNull();

    const allowed = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
