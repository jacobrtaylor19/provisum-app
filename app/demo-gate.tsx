"use client";

import { useState, useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export function DemoGate({ children }: { children: ReactNode }) {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");

  useEffect(() => {
    // Lead-capture gate temporarily bypassed — every visitor goes straight to the demo.
    // To restore the gate: setHasAccess(getCookie("provisum_demo_lead") === "1");
    // (and re-add the getCookie helper removed above).
    setHasAccess(true);
  }, []);

  // Show nothing during hydration check
  if (hasAccess === null) return null;

  if (hasAccess) return <>{children}</>;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/demo/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, role }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setCookie("provisum_demo_lead", "1", 30);
      setHasAccess(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0c1e1c]">
      {/* Background effects — matching login page */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[800px] w-[800px] rounded-full bg-teal-900/30 blur-3xl" />
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-64 w-[600px] rounded-full bg-teal-700/20 blur-3xl" />
        <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 h-40 w-[500px] rounded-full bg-teal-800/15 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-md px-4">
        {/* Brand header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-3">
            Provisum
          </h1>
          <p className="text-base font-medium text-slate-300">
            Intelligent Role Mapping for Enterprise Migrations
          </p>
        </div>

        {/* Glass card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-white text-center mb-1">
            Access the Live Demo
          </h2>
          <p className="text-sm text-slate-400 text-center mb-6">
            Enter your details to explore the live demo environment.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="demo-name" className="block text-sm font-medium text-slate-300 mb-1.5">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                id="demo-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="demo-email" className="block text-sm font-medium text-slate-300 mb-1.5">
                Work Email <span className="text-red-400">*</span>
              </label>
              <input
                id="demo-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
                className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="demo-company" className="block text-sm font-medium text-slate-300 mb-1.5">
                Company
              </label>
              <input
                id="demo-company"
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Corp"
                className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="demo-role" className="block text-sm font-medium text-slate-300 mb-1.5">
                Role / Title
              </label>
              <input
                id="demo-role"
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Security Lead"
                className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Access Demo"
              )}
            </button>
          </form>
        </div>

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-slate-500">
          Learn more at{" "}
          <a
            href="https://provisum.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal-400 hover:text-teal-300 underline underline-offset-2 transition-colors"
          >
            provisum.io
          </a>
        </p>
      </div>
    </div>
  );
}
