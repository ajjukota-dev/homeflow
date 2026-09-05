import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "./session";
import { SignInGate } from "./SignInGate";
import { CustomerSignIn } from "./CustomerSignIn";
import { api, ApiError } from "../api/client";

afterEach(() => vi.restoreAllMocks());

function gate(realm: "staff" | "customer", devLogin = false) {
  return render(
    <SessionProvider>
      <SignInGate realm={realm} devLogin={devLogin}>
        <p>My Day</p>
      </SignInGate>
    </SessionProvider>,
  );
}

describe("SignInGate", () => {
  it("shows the staff sign-in when /me/session says 401", async () => {
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue.", status: 401 }),
    );
    gate("staff");
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.queryByText("My Day")).not.toBeInTheDocument();
  });

  it("lists the seeded staff only when dev login is on", async () => {
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue.", status: 401 }),
    );
    const { unmount } = gate("staff", false);
    await screen.findByRole("button", { name: /Continue with Google/ });
    expect(screen.queryByTestId("signin-devlist")).not.toBeInTheDocument();
    unmount();

    gate("staff", true);
    expect(await screen.findByTestId("signin-devlist")).toBeInTheDocument();
    expect(screen.getByText(/Aarti Rao/)).toBeInTheDocument();
  });

  it("shows the phone step for the customer realm", async () => {
    vi.spyOn(api, "get").mockRejectedValue(
      new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue.", status: 401 }),
    );
    gate("customer");
    expect(await screen.findByTestId("signin-step-phone")).toBeInTheDocument();
  });

  it("renders the app once the session resolves", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      realm: "staff",
      display_name: "Aarti Rao",
      role_ids: ["super_admin"],
      project_ids: [],
      all_projects: true,
    } as never);
    gate("staff");
    expect(await screen.findByText("My Day")).toBeInTheDocument();
  });

  it("shows an error state with a retry when /me/session breaks", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError({ code: "UNEXPECTED", message: "boom", status: 500 }));
    gate("staff");
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});

describe("CustomerSignIn", () => {
  it("moves to the code step after requesting an OTP", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ sent: true } as never);
    render(<CustomerSignIn onSignedIn={() => {}} />);
    await userEvent.type(screen.getByLabelText("Mobile number"), "9876543210");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(screen.getByTestId("signin-step-code")).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith("/auth/otp/request", { phone: "9876543210" });
  });

  it("keeps a wrong code on the same step and says so on the field", async () => {
    vi.spyOn(api, "post")
      .mockResolvedValueOnce({ sent: true } as never)
      .mockRejectedValueOnce(new ApiError({ code: "OTP_INVALID", message: "That code did not match.", status: 401 }));
    render(<CustomerSignIn onSignedIn={() => {}} />);
    await userEvent.type(screen.getByLabelText("Mobile number"), "9876543210");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByTestId("signin-step-code");
    await userEvent.type(screen.getByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code did not match.");
  });
});
