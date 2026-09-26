import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { describe, expect, it, vi } from "vitest";

// One HTTP owner for the document and warranty URLs that used to depend on
// registration order (bug 6). Lifecycle must not register the colliding paths.

const { legacyGenerate, legacyApprove, factoryGenerate, decideStage } = vi.hoisted(() => ({
  legacyGenerate: vi.fn(async (_bookingId: string, _family: string, _ctx: unknown) => ({ id: "legacy-doc" })),
  legacyApprove: vi.fn(async (_id: string, _ctx: unknown) => ({ id: "legacy-approved" })),
  factoryGenerate: vi.fn(async (_bookingId: string, _family: string, _input: unknown, _ctx: unknown) => ({ id: "factory-doc" })),
  decideStage: vi.fn(async (_id: string, _stage: string, _decision: string, _note: string | null, _ctx: unknown) => ({ id: "factory-approved" })),
}));

vi.mock("./legal-docs", () => ({
  listLegalQueue: vi.fn(),
  generateDocument: (bookingId: string, documentFamily: string, ctx: unknown) =>
    legacyGenerate(bookingId, documentFamily, ctx),
  approveDocument: (id: string, ctx: unknown) => legacyApprove(id, ctx),
  executeDocument: vi.fn(),
  completeRegistration: vi.fn(),
}));

vi.mock("./documents/generate", () => ({
  generateDocument: (bookingId: string, family: string, input: unknown, ctx: unknown) =>
    factoryGenerate(bookingId, family, input, ctx),
}));

vi.mock("./documents/store", () => ({
  loadDocument: vi.fn(),
  listDocuments: vi.fn(),
  listBookingsForDocuments: vi.fn(),
  withLabels: async (doc: unknown) => doc,
}));

vi.mock("./documents/workflow", () => ({
  submitForReview: vi.fn(),
  decideStage: (id: string, stage: string, decision: string, note: string | null, ctx: unknown) =>
    decideStage(id, stage, decision, note, ctx),
  sendForCustomerReview: vi.fn(),
  approveForExecution: vi.fn(),
  recordExecution: vi.fn(),
  archiveDocument: vi.fn(),
  listApprovals: vi.fn(),
}));

import { registerDocumentRoutes } from "./routes-documents";
import { registerLifecycleRoutes } from "./routes-lifecycle";
import { registerPostHandoverRoutes } from "./routes-post-handover";

type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean> };
};

function routeCount(app: Express, method: string, path: string): number {
  const stack = (app as unknown as { _router?: { stack: RouteLayer[] } })._router?.stack ?? [];
  return stack.filter((layer) => layer.route?.path === path && layer.route.methods[method]).length;
}

function postJson(app: Express, url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const server: Server = createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = JSON.stringify(body);
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: url,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            server.close();
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end(payload);
    });
  });
}

function documentApp(): Express {
  const app = express();
  app.use(express.json());
  registerDocumentRoutes(app);
  app.use((_req, res) => {
    res.status(599).json({ fell_through: true });
  });
  return app;
}

describe("one URL owner — documents", () => {
  it("lifecycle does not register generate or approve", () => {
    const app = express();
    registerLifecycleRoutes(app);
    expect(routeCount(app, "post", "/api/bookings/:id/documents/generate")).toBe(0);
    expect(routeCount(app, "post", "/api/documents/:id/approve")).toBe(0);
  });

  it("registering documents and lifecycle still leaves one handler each", () => {
    const app = express();
    registerDocumentRoutes(app);
    registerLifecycleRoutes(app);
    expect(routeCount(app, "post", "/api/bookings/:id/documents/generate")).toBe(1);
    expect(routeCount(app, "post", "/api/documents/:id/approve")).toBe(1);
  });

  it("owns the legacy generate body when family is absent", async () => {
    legacyGenerate.mockClear();
    factoryGenerate.mockClear();
    const res = await postJson(documentApp(), "/api/bookings/b1/documents/generate", { document_family: "AOS" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: { id: "legacy-doc" } });
    expect(legacyGenerate).toHaveBeenCalledTimes(1);
    expect(legacyGenerate).toHaveBeenCalledWith("b1", "AOS", expect.anything());
    expect(factoryGenerate).not.toHaveBeenCalled();
  });

  it("defaults a missing document_family to AOS on the same owner", async () => {
    legacyGenerate.mockClear();
    const res = await postJson(documentApp(), "/api/bookings/b1/documents/generate", {});
    expect(res.status).toBe(200);
    expect(legacyGenerate).toHaveBeenCalledWith("b1", "AOS", expect.anything());
  });

  it("keeps the legacy validation error array", async () => {
    legacyGenerate.mockClear();
    legacyGenerate.mockRejectedValueOnce(Object.assign(new Error("validation_failed"), { errors: [{ field: "name" }] }));
    const res = await postJson(documentApp(), "/api/bookings/b1/documents/generate", { document_family: "AOS" });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ errors: [{ field: "name" }] });
  });

  it("owns the factory generate body when family is present", async () => {
    legacyGenerate.mockClear();
    factoryGenerate.mockClear();
    const res = await postJson(documentApp(), "/api/bookings/b1/documents/generate", { family: "AGREEMENT" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: { id: "factory-doc" } });
    expect(factoryGenerate).toHaveBeenCalledTimes(1);
    expect(legacyGenerate).not.toHaveBeenCalled();
  });

  it("owns the legacy approve body when stage is absent", async () => {
    legacyApprove.mockClear();
    decideStage.mockClear();
    const res = await postJson(documentApp(), "/api/documents/doc1/approve", {});
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: { id: "legacy-approved" } });
    expect(legacyApprove).toHaveBeenCalledWith("doc1", expect.anything());
    expect(decideStage).not.toHaveBeenCalled();
  });

  it("maps a legacy not_found approve to 404", async () => {
    legacyApprove.mockRejectedValueOnce(new Error("not_found"));
    const res = await postJson(documentApp(), "/api/documents/missing/approve", {});
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ errors: [{ code: "not_found" }] });
  });

  it("owns the factory approve body when stage is present", async () => {
    legacyApprove.mockClear();
    decideStage.mockClear();
    const res = await postJson(documentApp(), "/api/documents/doc1/approve", { stage: "LEGAL", note: "ok" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: { id: "factory-approved" } });
    expect(decideStage).toHaveBeenCalledWith("doc1", "LEGAL", "APPROVED", "ok", expect.anything());
    expect(legacyApprove).not.toHaveBeenCalled();
  });
});

describe("one URL owner — warranty close", () => {
  it("lifecycle does not register POST /api/warranty-cases/:id/close", () => {
    const app = express();
    registerLifecycleRoutes(app);
    expect(routeCount(app, "post", "/api/warranty-cases/:id/close")).toBe(0);
  });

  it("post-handover is the only close handler even when lifecycle registers after it", () => {
    const app = express();
    registerPostHandoverRoutes(app);
    registerLifecycleRoutes(app);
    expect(routeCount(app, "post", "/api/warranty-cases/:id/close")).toBe(1);
  });
});
