"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BUNDLE_PLANS, BUNDLE_PLAN_IDS } from "@/lib/hub/plans";
import { SECTORS } from "@/lib/types";

type ToolResult = { tool: string; ok: boolean; error?: string; skipped?: string };

/**
 * Admin → Clients → "+ New client" (H3): owner login + business + bundle in
 * one go, for demos, pilots and offline sales. Same account as /signup.
 */
export function NewClientForm({ customBundles }: { customBundles: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; password?: string; tools: ToolResult[] } | null>(null);
  const [f, setF] = useState({
    businessName: "", name: "", email: "", phone: "", password: "",
    sector: "RETAIL", country: "IN", bundle: customBundles[0] ? `custom:${customBundles[0].id}` : "", days: 30, note: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: k === "days" ? Number(e.target.value) : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    const res = await fetch("/api/admin/businesses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...f, phone: f.phone || undefined, password: f.password || undefined, note: f.note || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof d.error === "string" ? d.error : "Please check the form: every field except phone, password and note is needed.");
      return;
    }
    setDone({ email: d.owner?.email, password: d.password, tools: d.activation?.tools ?? [] });
    setF((p) => ({ ...p, businessName: "", name: "", email: "", phone: "", password: "", note: "" }));
    router.refresh();
  }

  const input = "w-full rounded-input border border-control px-3 py-2 text-sm";
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
        + New client
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-card border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">New client</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">Close</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Business name<input required value={f.businessName} onChange={set("businessName")} className={input} placeholder="Sharma Auto Parts (Demo)" /></label>
        <label className="text-sm">Owner name<input required value={f.name} onChange={set("name")} className={input} /></label>
        <label className="text-sm">Owner email (login)<input required type="email" value={f.email} onChange={set("email")} className={input} /></label>
        <label className="text-sm">Owner mobile (optional)<input value={f.phone} onChange={set("phone")} className={input} placeholder="+91 98765 43210" /></label>
        <label className="text-sm">Password (blank = random, shown once)<input type="text" minLength={8} value={f.password} onChange={set("password")} className={input} autoComplete="new-password" /></label>
        <label className="text-sm">Sector
          <select value={f.sector} onChange={set("sector")} className={input}>{SECTORS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</select>
        </label>
        <label className="text-sm">Country
          <select value={f.country} onChange={set("country")} className={input}><option value="IN">India</option><option value="CA">Canada</option></select>
        </label>
        <label className="text-sm">Bundle
          <select value={f.bundle} onChange={set("bundle")} className={input}>
            <option value="">None yet (client pays on Billing)</option>
            {customBundles.length > 0 && <optgroup label="Our bundles">{customBundles.map((b) => <option key={b.id} value={`custom:${b.id}`}>{b.name}</option>)}</optgroup>}
            <optgroup label="Built-in plans">{BUNDLE_PLAN_IDS.map((p) => <option key={p} value={p}>{BUNDLE_PLANS[p].name}</option>)}</optgroup>
          </select>
        </label>
        {f.bundle && <label className="text-sm">Days active<input type="number" min={1} max={366} value={f.days} onChange={set("days")} className={input} /></label>}
        <label className="text-sm">Note (optional)<input value={f.note} onChange={set("note")} className={input} placeholder="Monday demo" /></label>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {done && (
        <div className="rounded-card border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <p>Client created. Login: <strong>{done.email}</strong>{done.password && <> · password <code className="rounded bg-white px-1">{done.password}</code> (copy it now, it is not shown again)</>}</p>
          {done.tools.length > 0 && <p className="mt-1">Set-up: {done.tools.map((t) => `${t.tool} ${t.ok ? "ok" : t.skipped ?? t.error}`).join(" · ")}</p>}
        </div>
      )}
      <button disabled={busy} className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Creating…" : "Create client"}</button>
    </form>
  );
}
