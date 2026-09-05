import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, api as v1Api, ApiError } from "@homeflow/ui";

import { AuthProvider, useAuth, isSuperAdmin } from "@/lib/auth";
import { api } from "@/lib/api";

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const { user } = useAuth();
  if (user === undefined) return <p>loading</p>;
  if (user === null) return <p>anonymous</p>;
  return (
    <p>
      {user.name} · {user.role.code} · {isSuperAdmin(user) ? "super" : "scoped"}
    </p>
  );
}

const tree = (
  <SessionProvider>
    <AuthProvider>
      <Probe />
    </AuthProvider>
  </SessionProvider>
);

describe("AuthProvider — the cookie-session adapter", () => {
  it("reports anonymous on a 401 instead of redirecting to /login", async () => {
    vi.spyOn(v1Api, "get").mockRejectedValue(
      new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue.", status: 401 }),
    );
    render(tree);
    expect(await screen.findByText("anonymous")).toBeInTheDocument();
  });

  it("builds v1's user shape from /me/session plus /me/permissions", async () => {
    vi.spyOn(v1Api, "get").mockResolvedValue({
      realm: "staff",
      display_name: "Sneha Reddy",
      role_ids: ["crm"],
      project_ids: ["p1"],
      all_projects: false,
    });
    vi.spyOn(api, "get").mockResolvedValue({
      data: { user_id: "u-9", role: "CRM", role_code: "CRM", is_super_admin: false, assigned_project_ids: ["p1"], modules: {} },
    });
    render(tree);
    await waitFor(() => expect(screen.getByText("Sneha Reddy · CRM · scoped")).toBeInTheDocument());
  });

  it("keeps no token anywhere in browser storage", async () => {
    vi.spyOn(v1Api, "get").mockRejectedValue(
      new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue.", status: 401 }),
    );
    render(tree);
    await screen.findByText("anonymous");
    expect(window.localStorage.length).toBe(0);
  });
});
