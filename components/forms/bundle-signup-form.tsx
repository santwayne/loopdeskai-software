"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { formatPrice, currencyFor } from "@/lib/hub/plans";
import type { CustomerPlan } from "@/lib/hub/customer-plans";
import { BUNDLE_NAME } from "@/lib/brand";

const SECTOR_OPTIONS: [string, string][] = [
  ["HOME_SERVICES", "Home services (HVAC, plumbing, electrical…)"], ["CLINIC", "Clinic"], ["SALON", "Salon / spa"],
  ["RESTAURANT", "Restaurant"], ["GYM", "Gym / studio"], ["RETAIL", "Retail"], ["MANUFACTURER", "Manufacturer / brand (dealers, mechanics)"], ["OTHER", "Something else"],
];

/**
 * One signup for every plan: built-in plans and our bundles (Korvo, Loyvexa…).
 * The pick is a request: our team activates it (no online payment unless switched on).
 */
export function BundleSignupForm({ plans, initialPlan, initialCountry, onlinePayments = false }: {
  plans: CustomerPlan[]; initialPlan: string; initialCountry: "CA" | "IN"; onlinePayments?: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<string>(initialPlan);
  const [country, setCountry] = useState<"CA" | "IN">(initialCountry);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const currency = currencyFor(country);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"), email: f.get("email"), password: f.get("password"), businessName: f.get("businessName"),
        sector: f.get("sector"), phone: f.get("phone"), country, plan,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(typeof d?.error === "string" ? d.error : "Please check the form and try again.");
      return;
    }
    window.location.assign(d.next ?? "/dashboard/billing"); // full load: no cached pages from a previous login (bug B0)
  }

  const chosen = plans.find((p) => p.key === plan);
  const input = "w-full rounded-input border border-control px-3 py-2 text-sm";
  return (
    <form onSubmit={submit} className="w-full max-w-3xl space-y-6">
      <div className="flex justify-end gap-1 text-sm">
        {(["IN", "CA"] as const).map((c) => (
          <button type="button" key={c} onClick={() => setCountry(c)}
            className={clsx("rounded-full px-3 py-1", country === c ? "bg-brand-100 font-medium text-brand-700" : "text-gray-600 hover:bg-gray-100")}>
            {c === "CA" ? "Canada · CAD" : "India · INR"}
          </button>
        ))}
      </div>
      <PlanPicker plans={plans} value={plan} onChange={setPlan} currency={currency} />

      <div className="grid gap-4 rounded-card border border-gray-200 bg-white p-5 md:grid-cols-2">
        <label className="text-sm"><span className="mb-1 block font-medium text-gray-700">Your name</span><input name="name" required className={input} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-gray-700">Business name</span><input name="businessName" required className={input} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-gray-700">Type of business</span>
          {/* No preselected type: a silent "Home services" default made the Google posts about home maintenance for an agency (bug G8). */}
          <select name="sector" required className={input} defaultValue="">
            <option value="" disabled>Choose one</option>
            {SECTOR_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-gray-700">Your mobile (for call summaries and the morning plan)</span>
          <input name="phone" type="tel" required className={input} placeholder={country === "CA" ? "416 555 0123" : "98765 43210"} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-gray-700">Email</span><input name="email" type="email" required className={input} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium text-gray-700">Password</span><input name="password" type="password" required minLength={8} className={input} /></label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={loading} className="rounded-full bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-800 disabled:opacity-60">
          {loading ? "Creating your account…" : onlinePayments ? `Continue to payment · ${priceText(chosen, currency)}` : `Create my account · ${chosen?.name ?? "plan"}`}
        </button>
        <p className="text-xs text-gray-500">
          {onlinePayments
            ? `One account, one bill. Everything in ${BUNDLE_NAME} is set up for you after payment.`
            : `One account, one bill. Our team activates your plan and sets up every tool for you in ${BUNDLE_NAME}.`}
        </p>
      </div>
    </form>
  );
}

export function priceText(p: CustomerPlan | undefined, currency: "CAD" | "INR") {
  const amount = p?.price[currency];
  return amount == null ? "Price on request" : `${formatPrice(amount, currency)}/${p!.per}`;
}

/** Built-in plans, then our bundles (Korvo + Loyvexa and others), as cards to pick from. */
export function PlanPicker({ plans, value, onChange, currency }: { plans: CustomerPlan[]; value: string; onChange: (key: string) => void; currency: "CAD" | "INR" }) {
  const groups = [
    { title: "Plans", list: plans.filter((p) => !p.custom) },
    { title: "Bundles", list: plans.filter((p) => p.custom) },
  ].filter((g) => g.list.length);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.title} id={g.title === "Bundles" ? "bundles" : undefined}>
          {groups.length > 1 && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.title}</p>}
          <div className="grid gap-3 md:grid-cols-3">
            {g.list.map((p) => (
              <button type="button" key={p.key} onClick={() => onChange(p.key)} aria-pressed={value === p.key}
                className={clsx("rounded-card border p-4 text-left transition", value === p.key ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-gray-200 bg-white hover:border-gray-300")}>
                <p className="font-semibold">{p.name}</p>
                <p className="text-xs text-gray-500">{p.tagline}</p>
                <p className="mt-2 text-xl font-bold">{priceText(p, currency)}</p>
                <ul className="mt-2 space-y-1 text-xs text-gray-600">{p.features.map((x) => <li key={x}>· {x}</li>)}</ul>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
