"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CustomerPlan } from "@/lib/hub/customer-plans";
import { PlanPicker } from "@/components/forms/bundle-signup-form";

/** The owner picks a plan; our team activates it (no online payment). */
export function PlanRequest({ plans, current, currency, label }: { plans: CustomerPlan[]; current: string; currency: "CAD" | "INR"; label: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/billing/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Sent. Our team will call you and activate it." } : { ok: false, text: d.error || "Couldn't send the request." });
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-card border border-gray-200 bg-white p-5">
      <PlanPicker plans={plans} value={plan} onChange={setPlan} currency={currency} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={send} className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60">
          {busy ? "Sending…" : label}
        </button>
        {msg && <p className={`text-sm ${msg.ok ? "text-gray-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
