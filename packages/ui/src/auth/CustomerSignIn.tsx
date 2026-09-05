/**
 * Customer sign-in (technical/03 §2): a code to the mobile already on the
 * booking. Two steps, one screen. The request step answers `{sent: true}` for
 * any number — a wrong one must not reveal whether it belongs to a customer —
 * so the code step is always reached and the copy says so plainly.
 */
import { useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { ApiError, api } from "../api/client";
import { Button } from "../components/Button";
import { Field } from "../components/Field";

export interface CustomerSignInProps {
  onSignedIn: () => void;
}

const PHONE_HINT = "The mobile number on your booking. Indian numbers may be typed without +91.";

export function CustomerSignIn({ onSignedIn }: CustomerSignInProps) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/otp/request", { phone: phone.trim() });
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We could not send the code. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/otp/verify", { phone: phone.trim(), code: code.trim() });
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That code did not work. Check it and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hf-signin" data-testid="customer-signin">
      <main className="hf-signin__card">
        <div className="hf-signin__brand">
          <span className="hf-signin__mark" aria-hidden>
            P
          </span>
          <span className="hf-signin__wordmark">My Pranava Home</span>
        </div>

        {step === "phone" ? (
          <form onSubmit={requestCode} data-testid="signin-step-phone">
            <h1>Sign in to your home</h1>
            <p className="hf-signin__lede">We will send a 6-digit code to the mobile number on your booking.</p>
            <Field
              label="Mobile number"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              hint={PHONE_HINT}
              error={error ?? undefined}
              data-testid="signin-phone"
            />
            <Button block type="submit" loading={busy} data-testid="signin-send-code">
              Send code
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyCode} data-testid="signin-step-code">
            <h1>Enter your code</h1>
            <p className="hf-signin__lede">
              If <strong>{phone}</strong> is the number on a Pranava booking, a code is on its way. It expires in five
              minutes.
            </p>
            <Field
              label="6-digit code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={error ?? undefined}
              data-testid="signin-code"
            />
            <Button block type="submit" loading={busy} data-testid="signin-verify">
              Sign in
            </Button>
            <div className="hf-signin__divider">or</div>
            <Button
              block
              variant="ghost"
              onClick={() => {
                setStep("phone");
                setCode("");
                setError(null);
              }}
              data-testid="signin-back"
            >
              <ArrowLeft aria-hidden width={16} height={16} />
              Use a different number
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
