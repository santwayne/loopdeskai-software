"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Business, Location } from "@prisma/client";

/**
 * Settings → Texting & Front Desk: business channel defaults, per-location
 * SMS details (sender name, booking + review links, owner forward number),
 * customer CSV import and the win-back button.
 */
export function FrontDeskSettings({ business, locations }: { business: Business; locations: Location[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  async function patchBusiness(data: Record<string, unknown>) {
    const res = await fetch("/api/business", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    setMsg(res.ok ? "Saved." : "Couldn't save.");
    router.refresh();
  }

  return (
    <section className="space-y-5 rounded-card border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold">Texting &amp; calls</h2>
        <p className="text-sm text-gray-600">
          SMS for missed-call text-backs, review requests, win-backs and the two-way inbox.
          {business.frontDeskPlan && <> Plan: <b>{business.frontDeskPlan.replace("_", " + ")}</b>.</>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Default channel
          <select defaultValue={business.defaultChannel} onChange={(e) => patchBusiness({ defaultChannel: e.target.value })}
            className="rounded-input border border-control px-2 py-1">
            <option value="SMS">SMS (Canada)</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Country
          <select defaultValue={business.country} onChange={(e) => patchBusiness({ country: e.target.value })}
            className="rounded-input border border-control px-2 py-1">
            <option value="CA">Canada</option>
            <option value="US">United States</option>
            <option value="IN">India</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" defaultChecked={business.autoReviewRequest} onChange={(e) => patchBusiness({ autoReviewRequest: e.target.checked })} />
          Ask for a Google review after every visit
        </label>
        {msg && <span className="text-gray-500">{msg}</span>}
      </div>

      <div className="space-y-2 rounded-card border border-gray-100 p-4 text-sm">
        <h3 className="font-medium">Ratings and birthdays</h3>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" defaultChecked={business.autoFeedback} onChange={(e) => patchBusiness({ autoFeedback: e.target.checked })} />
          <span>Ask for a 1–5 rating 1–2 hours after each bill. 4–5 stars get your Google (and Zomato) review link; 1–3 stars come only to you on WhatsApp, never to a public page. Replaces the review request above.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" defaultChecked={business.autoBirthday} onChange={(e) => patchBusiness({ autoBirthday: e.target.checked })} />
          <span>Birthday offers: the welcome message asks for the birthday (customers reply like <code>BDAY 12/05</code>) and we send a treat 7 days before.</span>
        </label>
        <label className="block">
          <span className="text-gray-600">Birthday treat</span>
          <input defaultValue={business.birthdayOfferText ?? ""} maxLength={120} placeholder="a free dessert with any order on your birthday week"
            onBlur={(e) => patchBusiness({ birthdayOfferText: e.target.value.trim() || null })}
            className="mt-1 w-full rounded-input border border-control px-3 py-2" />
        </label>
      </div>

      <LoyaltySettings business={business} patch={patchBusiness} />

      {locations.map((l) => <LocationSms key={l.id} location={l} />)}

      <CsvImport locations={locations} country={business.country} />
      <Winback />
    </section>
  );
}

/** Points, tiers, wallet, referrals and the monthly ₹ report (Restaurant Bundle). */
function LoyaltySettings({ business, patch }: { business: Business; patch: (d: Record<string, unknown>) => Promise<void> }) {
  const num = (k: keyof Business, label: string, hint: string, scale = 1) => (
    <label className="block">
      <span className="text-gray-600">{label}</span>
      <input type="number" min={0} defaultValue={Number(business[k]) / scale}
        onBlur={(e) => { const v = Math.round(Number(e.target.value) * scale); if (Number.isFinite(v) && v !== business[k]) patch({ [k]: v }); }}
        className="mt-1 w-full rounded-input border border-control px-3 py-2" />
      <span className="text-xs text-gray-500">{hint}</span>
    </label>
  );
  return (
    <div className="space-y-3 rounded-card border border-gray-100 p-4 text-sm">
      <h3 className="font-medium">Loyalty</h3>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" defaultChecked={business.loyaltyEnabled} onChange={(e) => patch({ loyaltyEnabled: e.target.checked })} />
        <span>Points on every bill, Silver / Gold / VIP tiers, prepaid wallet and friend referrals. Points and wallet are used at the Counter with a WhatsApp code. Gold earns 1.25×, VIP 1.5×.</span>
      </label>
      <div className="grid gap-3 md:grid-cols-4">
        {num("pointsPer100", "Points per ₹100", "on each bill")}
        {num("pointValuePaise", "₹ value of 1 point", "e.g. 1 = ₹1", 100)}
        {num("minRedeemPoints", "Minimum points to use", "per redeem")}
        {num("pointsExpiryDays", "Points lapse after (days)", "with no bill; 0 = never")}
        {num("tierGoldSpend", "Gold from (₹ / year)", "spend in the last 365 days")}
        {num("tierVipSpend", "VIP from (₹ / year)", "spend in the last 365 days")}
        {num("referralRewardPoints", "Referral points", "each, on the friend's first bill")}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" defaultChecked={business.monthlyReport} onChange={(e) => patch({ monthlyReport: e.target.checked })} />
        Send me the monthly &quot;Loopdesk brought in ₹X&quot; report on WhatsApp on the 1st
      </label>
    </div>
  );
}

function LocationSms({ location }: { location: Location }) {
  const router = useRouter();
  const [form, setForm] = useState({
    smsSenderName: location.smsSenderName ?? "",
    bookingUrl: location.bookingUrl ?? "",
    googleReviewUrl: location.googleReviewUrl ?? "",
    zomatoUrl: location.zomatoUrl ?? "",
    ownerNotifyPhone: location.ownerNotifyPhone ?? "",
  });
  const [status, setStatus] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    const res = await fetch(`/api/locations/${location.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setStatus(res.ok ? "Saved." : `Check the fields: ${JSON.stringify(data.error?.fieldErrors ?? data.error)}`);
    router.refresh();
  }

  const field = (k: keyof typeof form, label: string, placeholder: string) => (
    <label className="block text-sm">
      <span className="text-gray-600">{label}</span>
      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={placeholder} autoComplete="off"
        className="mt-1 w-full rounded-input border border-control px-3 py-2" />
    </label>
  );

  return (
    <form onSubmit={save} autoComplete="off" className="space-y-3 rounded-card border border-gray-100 bg-gray-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{location.name}</h3>
        <span className="text-sm text-gray-600">
          Texting number: {location.smsFromNumber ? <b>{location.smsFromNumber}</b> : <span className="text-amber-700">not assigned yet (your admin sets this up)</span>}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {field("smsSenderName", "Sender name (starts every text)", "Maple HVAC")}
        {field("ownerNotifyPhone", "Forward customer replies to", "+14165550123")}
        {field("bookingUrl", "Booking link", "https://cal.com/maple-hvac")}
        {field("googleReviewUrl", "Google review link", "https://g.page/r/…/review")}
        {field("zomatoUrl", "Zomato page (restaurants, optional)", "https://www.zomato.com/ludhiana/…")}
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">Save</button>
        {status && <span className="text-sm text-gray-500">{status}</span>}
      </div>
      <PosSync location={location} />
    </form>
  );
}

/** POS sync for one outlet: bills arrive at /api/v1/pos/<provider>/<token>. */
function PosSync({ location }: { location: Location }) {
  const router = useRouter();
  const [restId, setRestId] = useState(location.posRestId ?? "");
  const [note, setNote] = useState<string | null>(null);
  async function patch(data: Record<string, unknown>) {
    const res = await fetch(`/api/locations/${location.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    setNote(res.ok ? "Saved." : "Couldn't save.");
    router.refresh();
  }
  const url = location.posToken && location.posProvider && typeof window !== "undefined" ? `${window.location.origin}/api/v1/pos/${location.posProvider}/${location.posToken}` : null;
  return (
    <div className="space-y-2 border-t border-gray-200 pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">POS sync</span>
        <select value={location.posProvider ?? ""} onChange={(e) => patch({ posProvider: e.target.value || null })} className="rounded-input border border-control px-2 py-1">
          <option value="">Off (use the Counter screen)</option>
          <option value="petpooja">Petpooja</option>
          <option value="generic">Other POS (our JSON format)</option>
        </select>
        {location.posProvider === "petpooja" && (
          <label className="flex items-center gap-2">Petpooja restaurant ID
            <input value={restId} onChange={(e) => setRestId(e.target.value)} onBlur={() => restId !== (location.posRestId ?? "") && patch({ posRestId: restId.trim() || null })} className="w-32 rounded-input border border-control px-2 py-1" />
          </label>
        )}
        {note && <span className="text-gray-500">{note}</span>}
      </div>
      {url && (
        <div className="space-y-1">
          <p className="text-gray-600">{location.posProvider === "petpooja" ? "Send this URL to Petpooja support and ask them to push every bill (order created/updated) to it:" : "Your POS should POST each bill as JSON to:"}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-white px-2 py-1 text-xs">{url}</code>
            <button type="button" onClick={() => navigator.clipboard?.writeText(url)} className="rounded-full border border-control px-3 py-1 hover:bg-gray-50">Copy</button>
            <button type="button" onClick={() => window.confirm("Make a new URL? The old one stops working right away.") && patch({ newPosToken: true })} className="rounded-full border border-control px-3 py-1 hover:bg-gray-50">New URL</button>
          </div>
          <p className="text-xs text-gray-500">Keep it private: anyone with it can add bills to this outlet. Bills without a customer phone are skipped.</p>
        </div>
      )}
    </div>
  );
}

/**
 * CSV import (Settings and Dashboard → Customers). New customers get a YES/NO
 * WhatsApp/SMS before any offer, unless the owner confirms the list already
 * agreed (in Canada, a purchase in the last 2 years is implied consent under
 * CASL, so that box starts ticked there).
 */
export function CsvImport({ locations, country }: { locations: Pick<Location, "id" | "name">[]; country?: string | null }) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [confirmed, setConfirmed] = useState(country === "CA");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true); setResult(null);
    const res = await fetch(`/api/customers/import?locationId=${locationId}${confirmed ? "&consent=confirmed" : ""}`, { method: "POST", headers: { "content-type": "text/csv" }, body: await file.text() });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setResult(res.ok ? `Imported ${d.rows} rows: ${d.created} new, ${d.updated} updated, ${d.skipped} skipped.${d.consentQueued ? ` ${d.consentQueued} will get a YES/NO request in contact hours.` : ""}${d.errors?.length ? " " + d.errors.slice(0, 3).join("; ") : ""}` : d.error || "Import failed.");
    router.refresh();
  }

  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">Import customer list (CSV)</h3>
      <p className="text-gray-600">Columns: <code>phone</code> (required), <code>name</code>, <code>last_visit</code>, <code>visits</code>, <code>total_spend</code>, <code>channel</code>. Only import people who&apos;ve been your customers.</p>
      <label className="flex items-start gap-2 text-gray-600">
        <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>These customers already agreed to get messages from us{country === "CA" ? " (or bought from us in the last 2 years)" : ""}. Untick to send each new customer a YES/NO request first.</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {locations.length > 1 && (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-input border border-control px-2 py-1">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {busy && <span className="text-gray-500">Importing…</span>}
      </div>
      {result && <p className="text-gray-700">{result}</p>}
    </div>
  );
}

function Winback() {
  const [preview, setPreview] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    const res = await fetch("/api/front-desk/winback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (dryRun) setPreview(d.eligible ?? 0);
    else { setResult(`Sent ${d.sent}, not sent ${d.failed}.`); setPreview(null); }
  }

  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-medium">Win back quiet customers</h3>
      <p className="text-gray-600">Texts at-risk and dormant customers who haven&apos;t had a win-back in 30 days. Runs daily for Answer + Return and Grow plans.</p>
      <div className="flex items-center gap-2">
        {preview === null ? (
          <button disabled={busy} onClick={() => run(true)} className="rounded-full border border-control px-3 py-1.5 font-medium hover:bg-gray-50">Preview</button>
        ) : (
          <>
            <span>{preview} customer{preview === 1 ? "" : "s"} would get a text.</span>
            {preview > 0 && <button disabled={busy} onClick={() => run(false)} className="rounded-full bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-800">Send now</button>}
          </>
        )}
        {result && <span className="text-gray-700">{result}</span>}
      </div>
    </div>
  );
}
