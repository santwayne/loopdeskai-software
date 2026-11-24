import Link from "next/link";
import { BUNDLE_NAME } from "@/lib/brand";

/**
 * The website's header and footer, on the app's public pages (log in, sign
 * up, password reset), so moving between loopdeskai.wayneesolutions.com and
 * the app feels like one site. Website links use NEXT_PUBLIC_WEBSITE_URL.
 */
const SITE = (process.env.NEXT_PUBLIC_WEBSITE_URL || "https://loopdeskai.wayneesolutions.com").replace(/\/+$/, "");
const page = (p: string) => `${SITE}/${p}`;

const NAV: [string, string][] = [
  ["How it works", "how-it-works.html"], ["AI Growth Manager", "growth-manager.html"], ["Features", "features.html"],
  ["Pricing", "pricing.html"], ["Industries", "industries.html"], ["FAQ", "faq.html"],
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-t-[3px] border-[#a3122a] border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a href={page("index.html")} className="flex items-center gap-2.5 font-bold tracking-tight text-gray-900" aria-label={`${BUNDLE_NAME} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-small.png" alt="" width={60} height={40} className="h-9 w-auto" />
          <span>{BUNDLE_NAME}</span>
        </a>
        <nav aria-label="Website" className="hidden items-center gap-5 text-sm text-gray-600 lg:flex">
          {NAV.map(([label, href]) => <a key={href} href={page(href)} className="hover:text-gray-900">{label}</a>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">Log in</Link>
          <Link href="/signup" className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">Start free trial</Link>
        </div>
      </div>
    </header>
  );
}

const COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: "Product", links: [["How it works", "how-it-works.html"], ["AI Growth Manager", "growth-manager.html"], ["Features", "features.html"], ["Pricing", "pricing.html"], ["Hear the demo", "demo.html"]] },
  { title: "Who it's for", links: [["Trades & home services", "industries.html#trades"], ["Salons & beauty", "industries.html#beauty"], ["Clinics", "industries.html#clinics"], ["Real estate & legal", "industries.html#realestate"], ["Restaurants", "industries.html#restaurants"]] },
  { title: "Company", links: [["About", "about.html"], ["Team", "team.html"], ["Contact", "contact.html"], ["FAQ", "faq.html"], ["Privacy", "privacy.html"], ["Terms", "terms.html"]] },
];

export function SiteFooter() {
  return (
    <footer className="bg-[#1b0509] pb-7 pt-14 text-sm text-white/70">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-small.png" alt={BUNDLE_NAME} width={84} height={56} className="h-14 w-auto" />
            <p className="mt-3 max-w-xs">{BUNDLE_NAME} answers every call in your business name, texts back the ones you miss and tells you each morning who to bring back.</p>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h4 className="mb-3 font-semibold text-white">{c.title}</h4>
              <ul className="space-y-2">{c.links.map(([label, href]) => <li key={href}><a href={page(href)} className="hover:text-white">{label}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-white/10 pt-5 text-xs">
          <span>© {new Date().getFullYear()} {BUNDLE_NAME} · by Wayne E Solutions</span>
          <span>Serving Ontario, Manitoba and the rest of Canada</span>
        </div>
      </div>
    </footer>
  );
}

/** Log in, sign up and password pages: website header, the page, website footer. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
