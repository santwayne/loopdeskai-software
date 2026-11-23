"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type InboxReview = {
  id: string; googleId: string | null; source: "GOOGLE" | "ZOMATO" | "SWIGGY" | "OTHER";
  reviewerName: string | null; rating: number | null; text: string | null; url: string | null;
  postedAt: string | null; replyDraft: string; status: string;
};

const LABEL = { GOOGLE: "Google", ZOMATO: "Zomato", SWIGGY: "Swiggy", OTHER: "Other" } as const;

export function ReviewsInbox({ items }: { items: InboxReview[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"OPEN" | "LOW" | "ALL">("OPEN");
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.replyDraft])));
  const [note, setNote] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  const shown = useMemo(() => items.filter((i) =>
    filter === "ALL" ? true : filter === "LOW" ? (i.rating ?? 5) <= 3 && i.status === "NEW" : i.status === "NEW"), [items, filter]);

  async function send(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { ok: true as const, d } : { ok: false as const, error: d.error || "Something went wrong." };
  }

  async function replyGoogle(i: InboxReview) {
    const r = await send("/api/reviews", "POST", { action: "google-reply", reviewId: i.googleId, text: drafts[i.id] });
    setNote({ ...note, [i.id]: r.ok ? "Posted on Google." : r.error });
    if (r.ok) router.refresh();
  }
  async function mark(i: InboxReview, status: "REPLIED" | "IGNORED") {
    const r = await send("/api/reviews", "PATCH", { id: i.id, status, replyDraft: drafts[i.id] });
    setNote({ ...note, [i.id]: r.ok ? (status === "REPLIED" ? "Marked replied." : "Hidden.") : r.error });
    if (r.ok) router.refresh();
  }
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const rating = Number(f.get("rating"));
    const r = await send("/api/reviews", "POST", {
      action: "add", source: f.get("source"), reviewerName: String(f.get("name") || "") || undefined,
      rating: rating || undefined, text: String(f.get("text") || "") || undefined, url: String(f.get("url") || "") || undefined,
    });
    if (r.ok) { setAdding(false); router.refresh(); } else window.alert(r.error);
  }

  const stars = (n: number | null) => (n == null ? "" : "★".repeat(n) + "☆".repeat(5 - n));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["OPEN", "LOW", "ALL"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 ${filter === f ? "border-brand-600 bg-brand-50 font-medium" : "border-control hover:bg-gray-50"}`}>
            {f === "OPEN" ? "Needs a reply" : f === "LOW" ? "1–3 stars" : "All"}
          </button>
        ))}
        <button onClick={() => setAdding(!adding)} className="ml-auto rounded-full border border-control px-3 py-1 hover:bg-gray-50">+ Add a Zomato / Swiggy review</button>
      </div>
      {adding && (
        <form onSubmit={add} className="grid gap-2 rounded-card border border-gray-200 bg-white p-4 text-sm md:grid-cols-4">
          <select name="source" className="rounded-input border border-control px-2 py-2"><option value="ZOMATO">Zomato</option><option value="SWIGGY">Swiggy</option><option value="OTHER">Other</option></select>
          <input name="name" placeholder="Reviewer name" className="rounded-input border border-control px-3 py-2" />
          <select name="rating" className="rounded-input border border-control px-2 py-2" defaultValue=""><option value="">Stars</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}</select>
          <input name="url" type="url" placeholder="Link (optional)" className="rounded-input border border-control px-3 py-2" />
          <textarea name="text" rows={2} placeholder="Paste the review" className="rounded-input border border-control px-3 py-2 md:col-span-4" />
          <button className="rounded-full bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-800 md:col-span-1">Add and draft a reply</button>
        </form>
      )}
      {shown.length === 0 && <p className="rounded-card border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Nothing here.</p>}
      {shown.map((i) => (
        <article key={i.id} className="space-y-2 rounded-card border border-gray-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{LABEL[i.source]}</span>
            <span className={(i.rating ?? 5) <= 3 ? "text-red-600" : "text-amber-500"} aria-label={`${i.rating ?? "?"} stars`}>{stars(i.rating)}</span>
            <span className="font-medium">{i.reviewerName ?? "Customer"}</span>
            {i.postedAt && <span className="text-xs text-gray-500">{new Date(i.postedAt).toLocaleDateString("en-IN")}</span>}
            {i.status !== "NEW" && <span className="text-xs text-gray-500">· {i.status.toLowerCase()}</span>}
            {i.url && <a href={i.url} target="_blank" rel="noopener" className="ml-auto text-xs text-brand-700 underline">Open ↗</a>}
          </div>
          {i.text && <p className="text-gray-700">{i.text}</p>}
          <textarea value={drafts[i.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [i.id]: e.target.value })} rows={3} className="w-full rounded-input border border-control px-3 py-2" aria-label="Reply" />
          <div className="flex flex-wrap items-center gap-2">
            {i.googleId ? (
              <button onClick={() => replyGoogle(i)} className="rounded-full bg-brand-600 px-4 py-1.5 font-medium text-white hover:bg-brand-800">Post reply on Google</button>
            ) : (
              <>
                <button onClick={() => navigator.clipboard?.writeText(drafts[i.id] ?? "")} className="rounded-full border border-control px-3 py-1.5 hover:bg-gray-50">Copy reply</button>
                {i.status === "NEW" && <button onClick={() => mark(i, "REPLIED")} className="rounded-full bg-brand-600 px-4 py-1.5 font-medium text-white hover:bg-brand-800">I posted it — mark replied</button>}
                {i.status === "NEW" && <button onClick={() => mark(i, "IGNORED")} className="rounded-full border border-control px-3 py-1.5 hover:bg-gray-50">Hide</button>}
              </>
            )}
            {note[i.id] && <span className="text-gray-500">{note[i.id]}</span>}
          </div>
        </article>
      ))}
    </div>
  );
}
