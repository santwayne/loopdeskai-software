"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OfferTemplate } from "@/lib/restaurant";

const SEGMENTS = [
  { id: "REGULAR", label: "Regulars" },
  { id: "HIGH_SPENDER", label: "High spenders" },
  { id: "NEW", label: "New" },
  { id: "AT_RISK", label: "At risk" },
  { id: "DORMANT", label: "Dormant" },
];

type Limits = { approvalMaxDiscount: number; approvalMaxAudience: number; approvalAutoFreebie: boolean };

export function OfferComposer({ isOwner, limits, templates = [] }: { isOwner: boolean; limits: Limits; templates?: OfferTemplate[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [discount, setDiscount] = useState("");
  const [freebie, setFreebie] = useState(false);
  const [segments, setSegments] = useState<string[]>([]);
  const [sendAt, setSendAt] = useState("");
  const [audience, setAudience] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // B6: shown once when the message's % differs from the discount box; the next Save keeps it.
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/offers/audience?segments=${segments.join(",")}`).then((r) => r.json()).then((d) => { if (live) setAudience(typeof d.count === "number" ? d.count : null); }).catch(() => {});
    return () => { live = false; };
  }, [segments]);

  function applyTemplate(t: OfferTemplate) {
    setTitle(t.title); setMessage(t.message);
    setDiscount(t.discountPercent != null ? String(t.discountPercent) : ""); setFreebie(t.freebie); setSegments(t.segments);
  }

  const pct = discount ? Number(discount) : 0;
  const needsOwner = !isOwner && (pct > limits.approvalMaxDiscount || (audience ?? 0) > limits.approvalMaxAudience || (freebie && !limits.approvalAutoFreebie));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/offers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, message, discountPercent: discount ? Number(discount) : null, freebie, segments, confirmMismatch: !!mismatch, sendAt: sendAt ? new Date(sendAt).toISOString() : null }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409 && d.code === "DISCOUNT_MISMATCH") { setMismatch(d.error); setResult({ ok: false, text: d.error }); return; }
    if (!res.ok) { setResult({ ok: false, text: d.error || "Couldn't save the offer." }); return; }
    setMismatch(null);
    setResult({
      ok: true,
      text: d.auto
        ? `Offer #${d.offer.approvalNo} is approved and goes to ${d.offer.audienceCount} customers in contact hours.`
        : `Offer #${d.offer.approvalNo} was sent to the owner's WhatsApp for approval (${d.reasons.join("; ")}).`,
    });
    setTitle(""); setMessage(""); setDiscount(""); setFreebie(false); setSendAt("");
    router.refresh();
  }

  const input = "w-full rounded-input border border-control px-3 py-2 text-sm";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-card border border-gray-200 bg-white p-4 text-sm">
      <h2 className="font-medium">New offer</h2>
      {templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-600">Start from:</span>
          {templates.map((t) => (
            <button type="button" key={t.id} onClick={() => applyTemplate(t)}
              className="rounded-full border border-control px-3 py-1 hover:bg-gray-50">{t.title}</button>
          ))}
        </div>
      )}
      <input className={input} placeholder="Title, e.g. Weekend hair spa offer" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
      <textarea className={input} rows={3} placeholder="What customers read, e.g. 20% off any hair spa this Saturday and Sunday. Show this message at the counter." value={message} onChange={(e) => { setMessage(e.target.value); setMismatch(null); }} maxLength={500} required />
      <p className="text-xs text-gray-500">It goes out as: &quot;Hi Priya, a special offer from your business: <i>your message</i> Reply STOP to stop these messages.&quot;</p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">Discount
          <input className="w-20 rounded-input border border-control px-2 py-1" type="number" min={0} max={100} value={discount} onChange={(e) => { setDiscount(e.target.value); setMismatch(null); }} placeholder="0" /> %
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={freebie} onChange={(e) => setFreebie(e.target.checked)} /> Free item or bonus points</label>
        <label className="flex items-center gap-2">Send after
          <input className="rounded-input border border-control px-2 py-1" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-600">Who:</span>
        {SEGMENTS.map((s) => (
          <label key={s.id} className="flex items-center gap-1 rounded-full border border-gray-300 px-2 py-0.5">
            <input type="checkbox" checked={segments.includes(s.id)} onChange={(e) => setSegments(e.target.checked ? [...segments, s.id] : segments.filter((x) => x !== s.id))} /> {s.label}
          </label>
        ))}
        <span className="text-gray-500">{segments.length ? "" : "(all customers)"} {audience != null && `· ${audience} can get it`}</span>
      </div>
      {needsOwner && <p className="text-amber-700">This is above the owner&apos;s limits, so it will go to the owner&apos;s WhatsApp for approval first.</p>}
      {result && <p className={result.ok ? "text-gray-700" : "text-red-600"}>{result.text}</p>}
      <button disabled={busy} className="rounded-full bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-800 disabled:opacity-60">
        {busy ? "Saving…" : needsOwner ? "Send for approval" : "Save offer"}
      </button>
    </form>
  );
}
