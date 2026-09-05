import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Login } from "./Login";
import { AuthProvider } from "../auth/AuthContext";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Login", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/auth/me") return Promise.resolve(jsonResponse(401, { errors: [{ code: "unauthenticated" }] }));
        return Promise.resolve(jsonResponse(200, { data: {} }));
      })
    );
  });

  it("renders one h1 and no marketing copy", async () => {
    render(
      <AuthProvider>
        <Login />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
  });

  it("shows an error state on invalid credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/auth/login") return Promise.resolve(jsonResponse(400, { errors: [{ code: "validation", message: "invalid" }] }));
        return Promise.resolve(jsonResponse(401, { errors: [{ code: "unauthenticated" }] }));
      })
    );
    render(
      <AuthProvider>
        <Login />
      </AuthProvider>
    );
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "sales@demo.pranava" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect email or password/i);
  });

  it("disables the form while submitting", async () => {
    let resolveLogin: (v: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/auth/login") return new Promise<Response>((resolve) => (resolveLogin = resolve));
        return Promise.resolve(jsonResponse(401, { errors: [{ code: "unauthenticated" }] }));
      })
    );
    render(
      <AuthProvider>
        <Login />
      </AuthProvider>
    );
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "sales@demo.pranava" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: /signing in/i })).toBeDisabled();
    resolveLogin(jsonResponse(200, { data: { actor: {} } }));
  });

  it("the forgot-password flow always shows the same confirmation (no enumeration)", async () => {
    render(
      <AuthProvider>
        <Login />
      </AuthProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nobody@demo.pranava" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    expect(await screen.findByText(/reset link is on its way/i)).toBeInTheDocument();
  });
});
