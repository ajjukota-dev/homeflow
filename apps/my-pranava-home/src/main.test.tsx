import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, SessionProvider, SignInGate, api } from "@homeflow/ui";

afterEach(() => vi.restoreAllMocks());

describe("My Pranava Home sign-in", () => {
  it("asks for the mobile number when there is no session — never a booking id", async () => {
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue.", status: 401 }),
    );
    render(
      <SessionProvider>
        <SignInGate realm="customer">
          <p>home</p>
        </SignInGate>
      </SessionProvider>,
    );
    expect(await screen.findByLabelText("Mobile number")).toBeInTheDocument();
    expect(screen.queryByText("home")).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("booking_id");
  });

  it("renders the home once the session identifies the customer", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      realm: "customer",
      display_name: "Meera Nair",
      role_ids: [],
      project_ids: ["p1"],
      all_projects: false,
    } as never);
    render(
      <SessionProvider>
        <SignInGate realm="customer">
          <p>home</p>
        </SignInGate>
      </SessionProvider>,
    );
    expect(await screen.findByText("home")).toBeInTheDocument();
  });
});
