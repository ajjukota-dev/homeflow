import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Eye,
  FileCheck,
  FileSignature,
  FileText,
  HardHat,
  Home,
  IndianRupee,
  Scale,
  Target,
  Users,
  Users2,
  Wrench,
} from "lucide-react";

const SANS = "'DM Sans', ui-sans-serif, system-ui, sans-serif";
const SCRIPT = "'Caveat', 'Segoe Script', cursive";

const NAV = [
  { label: "PEOPLE", href: "#" },
  { label: "HOMES", href: "#" },
  { label: "A STRONGER TOMORROW", href: "#" },
];

const JOURNEY = [
  { icon: FileCheck, color: "#2A7A55", label: ["Booking", "Confirmed"] },
  { icon: Users, color: "#159C8B", label: ["CRM", "Handover"] },
  { icon: FileText, color: "#2F6DBF", label: ["Documentation"] },
  { icon: Scale, color: "#5B4EDB", label: ["Legal", "Agreement"] },
  { icon: IndianRupee, color: "#8B4EDB", label: ["Payments &", "Collections"] },
  { icon: Building2, color: "#D9463C", label: ["Home Loan", "Banking"] },
  { icon: FileSignature, color: "#E39A1C", label: ["Registration"] },
  { icon: HardHat, color: "#22A5B0", label: ["Unit", "Readiness"] },
  { icon: Wrench, color: "#2E9B57", label: ["Snagging & QA"] },
  { icon: Home, color: "#0FA2C4", label: ["Handover"] },
  { icon: Users2, color: "#7B54C8", label: ["Facilities", "Transition"] },
];

const PILLARS = [
  {
    icon: Users,
    label: "CUSTOMER FIRST",
    sub: "Every action. A better experience.",
  },
  {
    icon: Eye,
    label: "TRANSPARENCY",
    sub: "Clear information. Greater trust.",
  },
  {
    icon: Target,
    label: "ACCOUNTABILITY",
    sub: "Right ownership. Timely delivery.",
  },
  {
    icon: BarChart3,
    label: "A STRONGER TOMORROW",
    sub: "Better systems. Stronger communities.",
  },
];

const RIGHT_STACK = ["REAL", "PROGRESS", "HAPPENS", "WHEN", "PEOPLE", "FEEL", "AT", "HOME"];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: "#FAFAF8", fontFamily: SANS, color: "#1F2937" }}
      data-testid="landing-page"
    >
      {/* -------- Section 1: Sticky transparent header -------- */}
      <header
        className="sticky top-0 z-30 w-full backdrop-blur-[2px]"
        style={{ height: 72, background: "rgba(250,250,248,0.72)" }}
        data-testid="landing-header"
      >
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-6 md:px-12">
          <Link to="/" aria-label="Pranava Group" data-testid="landing-logo-link">
            <img
              src="/assets/pranava-group-logo.png"
              alt="Pranava Group"
              className="object-contain"
              style={{ height: 48, width: "auto", display: "block" }}
            />
          </Link>
          <nav
            className="hidden items-center gap-3 md:flex"
            aria-label="Primary"
            data-testid="landing-nav"
          >
            {NAV.map((n, i) => (
              <span key={n.label} className="flex items-center gap-3">
                <a
                  href={n.href}
                  onClick={(e) => e.preventDefault()}
                  className="uppercase transition-colors duration-150 hover:text-[#2A7A55] focus:outline-none focus-visible:underline"
                  style={{
                    fontFamily: SANS,
                    fontSize: 12,
                    letterSpacing: "0.15em",
                    color: "#4B4640",
                    fontWeight: 500,
                  }}
                  data-testid={`landing-nav-${i}`}
                >
                  {n.label}
                </a>
                {i < NAV.length - 1 && (
                  <span
                    aria-hidden
                    style={{ color: "#C7BFB7", fontSize: 12 }}
                  >
                    |
                  </span>
                )}
              </span>
            ))}
          </nav>
        </div>
      </header>

      {/* -------- Section 2: Hero (60/40 split) -------- */}
      <section
        className="mx-auto grid max-w-[1440px] items-center gap-10 px-6 py-10 md:grid-cols-[3fr_2fr] md:gap-14 md:px-12 md:py-16 lg:gap-20"
        style={{ minHeight: 560 }}
        data-testid="landing-hero"
      >
        {/* Left column */}
        <div className="max-w-[560px]">
          <div
            className="uppercase"
            style={{
              fontFamily: SANS,
              fontSize: 12,
              letterSpacing: "0.24em",
              color: "#7A7268",
              fontWeight: 500,
            }}
          >
            Pranava
          </div>

          <div
            className="mt-3 leading-none"
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: "clamp(48px, 6vw, 68px)",
              letterSpacing: "-0.02em",
            }}
            data-testid="landing-wordmark"
          >
            <span style={{ color: "#1F2937" }}>Home</span>
            <span style={{ color: "#2A7A55" }}>Flow</span>
          </div>

          <div
            className="mt-6 uppercase"
            style={{
              fontFamily: SANS,
              fontSize: 12,
              letterSpacing: "0.14em",
              color: "#1F2937",
              fontWeight: 600,
            }}
            data-testid="landing-tagline"
          >
            Connecting every step.&nbsp;&nbsp;Building better experiences.
          </div>

          <p
            className="mt-6"
            style={{
              fontFamily: SANS,
              fontSize: 15,
              color: "#4B4640",
              lineHeight: 1.65,
              maxWidth: 480,
            }}
            data-testid="landing-description"
          >
            HomeFlow is our integrated platform for managing the complete
            post-sales customer journey — ensuring a smoother, more transparent
            and a more delightful experience for every Pranava customer.
          </p>

          <button
            type="button"
            onClick={() => navigate("/login")}
            aria-label="Sign in to HomeFlow"
            className="mt-8 inline-flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2A7A55]"
            style={{
              height: 48,
              minWidth: 180,
              padding: "0 22px",
              background: "#2A7A55",
              color: "#FFFFFF",
              borderRadius: 8,
              fontFamily: SANS,
              fontWeight: 500,
              fontSize: 15,
              letterSpacing: "0.01em",
              cursor: "pointer",
              transition:
                "background-color 150ms ease-out, transform 100ms ease-out",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#226245")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#2A7A55")}
            onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.99)")}
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            data-testid="landing-signin-button"
          >
            <span>Sign In</span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Right column */}
        <div className="relative">
          <div className="relative md:-mr-6 lg:-mr-12">
            <img
              src="/assets/landing-hero.jpeg"
              alt="A wooden house model and keys resting on a balcony rail, framed by garden light."
              className="block w-full object-cover md:rounded-l-3xl"
              style={{
                height: 560,
                maxHeight: "72vh",
                WebkitMaskImage:
                  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 78%, rgba(0,0,0,0) 100%)",
                maskImage:
                  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 78%, rgba(0,0,0,0) 100%)",
              }}
              data-testid="landing-hero-image"
            />
          </div>
          <div
            className="pointer-events-none absolute right-4 top-6 hidden md:block lg:right-8"
            aria-hidden
            data-testid="landing-vertical-stack"
          >
            <div
              className="flex flex-col items-end gap-1.5 rounded-lg px-3 py-3 backdrop-blur-sm"
              style={{ background: "rgba(250,250,248,0.55)" }}
            >
              {RIGHT_STACK.map((w, i) => (
                <div
                  key={w}
                  className="uppercase"
                  style={{
                    fontFamily: SANS,
                    fontSize: 11,
                    letterSpacing: "0.28em",
                    color: "#3F3A34",
                    fontWeight: 500,
                    textShadow: "0 1px 8px rgba(255,255,255,0.55)",
                  }}
                >
                  {w}
                  {i === RIGHT_STACK.length - 1 && (
                    <div
                      className="mt-1 ml-auto"
                      style={{
                        width: 28,
                        height: 2,
                        background: "#2A7A55",
                        borderRadius: 2,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* -------- Section 3: Journey timeline -------- */}
      <section
        className="w-full border-t border-b"
        style={{ borderColor: "#EAE4DE", background: "#FBFAF7" }}
        data-testid="landing-timeline"
      >
        <div
          className="mx-auto max-w-[1440px] snap-x snap-mandatory overflow-x-auto px-6 py-12 md:px-12 md:py-14"
          style={{ scrollbarWidth: "thin" }}
        >
          <ol className="flex min-w-max items-start gap-6 md:min-w-0">
            {JOURNEY.map((stage, i) => {
              const Icon = stage.icon;
              return (
                <li
                  key={stage.label.join("-")}
                  className="flex snap-start flex-col items-center"
                  style={{ minWidth: 96 }}
                  data-testid={`landing-stage-${i}`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="flex items-center justify-center rounded-full shadow-sm"
                      style={{
                        width: 56,
                        height: 56,
                        background: stage.color,
                      }}
                    >
                      <Icon
                        className="h-6 w-6 text-white"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    </div>
                    {i < JOURNEY.length - 1 && (
                      <span
                        className="hidden md:inline-flex items-center gap-1.5"
                        aria-hidden
                      >
                        {[0, 1, 2].map((d) => (
                          <span
                            key={d}
                            style={{
                              width: 4,
                              height: 4,
                              borderRadius: 999,
                              background: "#C7BFB7",
                              display: "inline-block",
                            }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-3 text-center uppercase"
                    style={{
                      fontFamily: SANS,
                      fontSize: 10.5,
                      letterSpacing: "0.14em",
                      color: "#3F3A34",
                      fontWeight: 600,
                      lineHeight: 1.35,
                      maxWidth: 96,
                    }}
                  >
                    {stage.label.map((l) => (
                      <div key={l}>{l}</div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* -------- Section 4: Value pillars -------- */}
      <section
        className="mx-auto max-w-[1440px] px-6 py-14 md:px-12 md:py-16"
        data-testid="landing-pillars"
      >
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div
                key={p.label}
                className="flex items-start gap-4"
                data-testid={`landing-pillar-${i}`}
              >
                <div
                  className="flex shrink-0 items-center justify-center rounded-md"
                  style={{
                    width: 44,
                    height: 44,
                    background: "rgba(42,122,85,0.08)",
                  }}
                  aria-hidden
                >
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={1.5}
                    style={{ color: "#2A7A55" }}
                  />
                </div>
                <div className="min-w-0">
                  <div
                    className="uppercase"
                    style={{
                      fontFamily: SANS,
                      fontSize: 12,
                      letterSpacing: "0.14em",
                      color: "#1F2937",
                      fontWeight: 600,
                    }}
                  >
                    {p.label}
                  </div>
                  <div
                    className="mt-1.5"
                    style={{
                      fontFamily: SANS,
                      fontSize: 13,
                      color: "#4B4640",
                      lineHeight: 1.55,
                    }}
                  >
                    {p.sub}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* -------- Section 5: Footer with green wave -------- */}
      <footer className="relative w-full" data-testid="landing-footer">
        {/* Wave */}
        <svg
          viewBox="0 0 1440 120"
          preserveAspectRatio="none"
          aria-hidden
          className="block w-full"
          style={{ height: 96, display: "block" }}
        >
          <path
            d="M0,64 C240,120 480,20 720,56 C960,92 1200,20 1440,72 L1440,120 L0,120 Z"
            fill="#8CBCA1"
            opacity="0.55"
          />
          <path
            d="M0,80 C240,110 480,44 720,72 C960,100 1200,44 1440,88 L1440,120 L0,120 Z"
            fill="#2A7A55"
            opacity="0.85"
          />
        </svg>

        <div
          className="relative"
          style={{
            background: "linear-gradient(180deg, #EAF3EC 0%, #DDEAE1 100%)",
            paddingTop: 28,
            paddingBottom: 44,
          }}
        >
          {/* Decorative leaves */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-4 top-6 hidden md:block"
            style={{ opacity: 0.35 }}
          >
            <svg width="120" height="60" viewBox="0 0 120 60" fill="none">
              <path
                d="M10 40 C 30 10, 60 10, 80 40"
                stroke="#2A7A55"
                strokeWidth="1.5"
                fill="none"
              />
              <path
                d="M20 50 C 40 25, 70 25, 100 50"
                stroke="#2A7A55"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
          </div>

          <div className="mx-auto max-w-[1440px] px-6 md:px-12">
            <div className="mx-auto max-w-[720px] text-center">
              <div
                className="uppercase"
                style={{
                  fontFamily: SANS,
                  fontSize: 14,
                  letterSpacing: "0.24em",
                  color: "#2A7A55",
                  fontWeight: 500,
                }}
                data-testid="landing-footer-title"
              >
                Pranava HomeFlow
              </div>
              <div
                className="mt-2 uppercase"
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  letterSpacing: "0.18em",
                  color: "#4B4640",
                  fontWeight: 500,
                }}
              >
                One customer.&nbsp;&nbsp;One journey.&nbsp;&nbsp;One source of truth.
              </div>
            </div>

            <div
              className="mt-8 flex justify-end pr-2 md:pr-6"
              data-testid="landing-footer-script"
            >
              <span
                style={{
                  fontFamily: SCRIPT,
                  fontSize: 26,
                  color: "#1F2937",
                  lineHeight: 1,
                }}
              >
                Building for a better tomorrow
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
