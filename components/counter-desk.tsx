"use client";

import { useState } from "react";

type Summary = { id: string; name: string | null; phone: string; visits: number; points: number; pointsValue: number; walletRupees: number; tier: string; referralCode: string | null };

/**
 * Counter screen: the cashier types the customer's number and the bill, and
 * uses points or wallet money with a WhatsApp code. For outlets without a
 * POS link (and redeeming everywhere).
 */
export function CounterDesk({ locations, loyalty, currency }: { locations: { id: string; name: string }[]; loyalty: boolean; currency: string }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [billNo, setBillNo] = useState("");
  const [customer, setCustomer] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [redeem, setRedeem] = useState<{ kind: "POINTS" | "WALLET"; amount: string; requestId?: string; code: string }>({ kind: "POINTS", amount: "", code: "" });
  const [topup, setTopup] = useState("");

  const money = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);

  async function call(body: Record<string, unknown>) {
    setBusy(true); setMsg(null); setNotes([]);
    const res = await fetch("/api/counter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationId, ...body }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMsg({ ok: false, text: d.error || "Something went wrong." });
    return res.ok ? d : null;
  }

  async function lookup() {
    if (!phone.trim()) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/counter?locationId=${locationId}&phone=${encodeURIComponent(phone)}`);
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: d.error || "Couldn't look that up." }); return; }
    setCustomer(d.customer);
    if (d.customer?.name) setName(d.customer.name);
    if (!d.customer) setMsg({ ok: true, text: "New customer — record the bill to add them." });
  }

  async function recordBill(e: React.FormEvent) {
    e.preventDefault();
    const d = await call({ action: "bill", phone, name: name || undefined, amount: Number(amount), billNo: billNo || undefined, key: crypto.randomUUID() });
    if (!d) return;
    setCustomer(d.customer);
    setMsg({ ok: true, text: d.status === "duplicate" ? "This bill number was already recorded." : `Bill recorded${loyalty && d.earned > 0 ? ` · +${d.earned} points` : ""}.` });
    setNotes(d.status === "duplicate" ? [] : Array.isArray(d.notes) ? d.notes : []);
    setAmount(""); setBillNo("");
  }

  async function sendCode() {
    const d = await call({ action: "redeem", phone, kind: redeem.kind, amount: Number(redeem.amount) });
    if (d) { setRedeem({ ...redeem, requestId: d.requestId, code: "" }); setMsg({ ok: true, text: "Code sent to the customer's WhatsApp. Ask them to read it out." }); }
  }

  async function confirm() {
    const d = await call({ action: "confirm", requestId: redeem.requestId, code: redeem.code.trim() });
    if (!d) return;
    setMsg({ ok: true, text: redeem.kind === "POINTS" ? `Done — ${redeem.amount} points used. Take the discount off the bill.` : `Done — ${money(Number(redeem.amount))} taken from the wallet.` });
    setRedeem({ kind: redeem.kind, amount: "", code: "" });
    await lookup();
  }

  async function addMoney() {
    const d = await call({ action: "topup", phone, amount: Number(topup) });
    if (d) { setCustomer(d.customer); setTopup(""); setMsg({ ok: true, text: "Money added to the wallet." }); }
  }

  const input = "w-full rounded-input border border-control px-3 py-2 text-sm";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={recordBill} className="min-w-0 space-y-3 rounded-card border border-gray-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Customer and bill</h2>
        {locations.length > 1 && (
          <select className={input} value={locationId} onChange={(e) => { setLocationId(e.target.value); setCustomer(null); }}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <input className={`${input} min-w-0`} inputMode="tel" placeholder="Customer mobile, e.g. 98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={lookup} required />
          <button type="button" onClick={lookup} className="shrink-0 rounded-full border border-control px-3 hover:bg-gray-50">Find</button>
        </div>
        <input className={input} placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={input} type="number" min={0} step="0.01" placeholder="Bill amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <input className={input} placeholder="Bill no. (optional)" value={billNo} onChange={(e) => setBillNo(e.target.value)} maxLength={40} />
        </div>
        <button disabled={busy} className="rounded-full bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-800 disabled:opacity-50">Record bill</button>
        {msg && <p role="status" className={msg.ok ? "text-green-700" : "text-red-600"}>{msg.text}</p>}
        {notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </form>

      <section className="min-w-0 space-y-3 rounded-card border border-gray-200 bg-white p-4 text-sm">
        <h2 className="font-medium">Points and wallet</h2>
        {!customer ? <p className="text-gray-500">Find a customer to see their points.</p> : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
              <div className="min-w-0 rounded-card bg-gray-50 p-3"><p className="text-xs text-gray-500">Tier</p><p className="break-words text-lg font-semibold">{customer.tier}</p></div>
              <div className="min-w-0 rounded-card bg-gray-50 p-3"><p className="text-xs text-gray-500">Points</p><p className="break-words text-lg font-semibold">{customer.points}</p><p className="text-xs text-gray-500">worth {money(customer.pointsValue)}</p></div>
              <div className="min-w-0 rounded-card bg-gray-50 p-3"><p className="text-xs text-gray-500">Wallet</p><p className="break-words text-lg font-semibold">{money(customer.walletRupees)}</p></div>
            </div>
            <p className="break-words text-gray-600">{customer.name ?? "No name"} · {customer.visits} bills{customer.referralCode ? <> · friend code <b>{customer.referralCode}</b></> : null}</p>
            {loyalty ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="rounded-input border border-control px-2 py-2" value={redeem.kind} onChange={(e) => setRedeem({ kind: e.target.value as "POINTS" | "WALLET", amount: "", code: "" })}>
                    <option value="POINTS">Use points</option>
                    <option value="WALLET">Use wallet (₹)</option>
                  </select>
                  <input className="w-32 min-w-0 rounded-input border border-control px-3 py-2" type="number" min={1} placeholder={redeem.kind === "POINTS" ? "Points" : "₹"} value={redeem.amount} onChange={(e) => setRedeem({ ...redeem, amount: e.target.value })} />
                  <button type="button" disabled={busy || !redeem.amount} onClick={sendCode} className="rounded-full border border-control px-3 py-2 hover:bg-gray-50 disabled:opacity-50">Send code</button>
                </div>
                {redeem.requestId && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="w-32 rounded-input border border-control px-3 py-2 tracking-widest" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={redeem.code} onChange={(e) => setRedeem({ ...redeem, code: e.target.value })} />
                    <button type="button" disabled={busy || redeem.code.length !== 6} onClick={confirm} className="rounded-full bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-800 disabled:opacity-50">Confirm</button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <input className="w-32 rounded-input border border-control px-3 py-2" type="number" min={1} placeholder="₹" value={topup} onChange={(e) => setTopup(e.target.value)} />
                  <button type="button" disabled={busy || !topup} onClick={addMoney} className="rounded-full border border-control px-3 py-2 hover:bg-gray-50 disabled:opacity-50">Add money to wallet</button>
                  <span className="text-xs text-gray-500">after the customer pays you</span>
                </div>
              </>
            ) : <p className="text-gray-500">Points and wallet are off. The owner can switch them on in Settings → Loyalty.</p>}
          </>
        )}
      </section>
    </div>
  );
}
