"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";

export type SwitcherItem = {
  id: string;
  name: string;
  blurb: string;
  href?: string;
  /** In the client's plan. Others show greyed out with "Not in your plan". */
  enabled: boolean;
  current?: boolean;
  /** Opens in a new tab (other tools, via hub single sign-on). */
  external?: boolean;
};

export type HeaderLink = { href: string; label: string; external?: boolean };

/**
 * Loopdesk AI top bar: the same in all 7 tools (see the Loopdesk AI design system → AppHeader).
 * Crimson bar, logo tile + wordmark, current tool name, tool switcher, the tool's own pages as pills,
 * business name and Log out on the right.
 */
export function AppHeader({
  wordmark,
  showLogo = true,
  toolName,
  homeHref,
  links,
  activeHref,
  switcher,
  right,
}: {
  wordmark: string;
  showLogo?: boolean;
  toolName?: string;
  homeHref: string;
  links: HeaderLink[];
  activeHref: string;
  switcher?: SwitcherItem[];
  right: React.ReactNode;
}) {
  return (
    <header className="bg-brand-700 text-white print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6 lg:flex-nowrap">
        <div className="flex shrink-0 items-center gap-2">
          <Link href={homeHref} className="flex items-center gap-2.5 text-base font-bold tracking-tight text-white">
            {showLogo && (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-input bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/icon-512.png" alt="" width={30} height={30} className="h-[30px] w-[30px] object-contain" />
              </span>
            )}
            {wordmark}
          </Link>
          {toolName && (
            <>
              <span className="text-lg text-brand-200" aria-hidden>/</span>
              <span className="text-base font-medium">{toolName}</span>
            </>
          )}
          {switcher && switcher.length > 0 && <ToolSwitcher items={switcher} />}
        </div>

        <PriorityNav links={links} activeHref={activeHref} />

        <div className="ml-auto flex shrink-0 items-center gap-4 text-sm text-brand-200">{right}</div>
      </div>
    </header>
  );
}

/** Open/close state for a small popup menu: closes on a click outside it or on Escape. */
function useDismissable() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// useLayoutEffect warns during server rendering; the nav measures only in the browser.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const PILL = "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition";
const PILL_IDLE = "text-brand-200 hover:text-white hover:ring-1 hover:ring-inset hover:ring-brand-200";
const PILL_ACTIVE = "bg-white text-brand-800";
const GAP = 4; // gap-1

/**
 * The tool's pages as pills on ONE line. Pills that don't fit go under "More",
 * measured live, so nothing wraps to a second line or pushes the business
 * name off the bar at any screen width (Loopdesk bug: 14 items broke into two
 * lines on a normal laptop and cut "Wayne E S…").
 */
function PriorityNav({ links, activeHref }: { links: HeaderLink[]; activeHref: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(links.length);
  const more = useDismissable();
  const signature = links.map((l) => `${l.href}|${l.label}`).join("\n");

  useBrowserLayoutEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;
    const fit = () => {
      const available = wrap.clientWidth;
      const els = Array.from(measure.children) as HTMLElement[];
      const widths = els.slice(0, links.length).map((el) => el.offsetWidth);
      const moreWidth = els[links.length]?.offsetWidth ?? 90;
      const all = widths.reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, widths.length - 1);
      if (all <= available) return setVisible(links.length);
      let used = moreWidth;
      let n = 0;
      for (const w of widths) {
        if (used + GAP + w > available) break;
        used += GAP + w;
        n += 1;
      }
      setVisible(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    ro.observe(measure); // web fonts arriving change pill widths
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const shown = links.slice(0, visible);
  const hidden = links.slice(visible);
  const isActive = (l: HeaderLink) => !l.external && activeHref === l.href;
  const activeHidden = hidden.some(isActive);

  const pill = (l: HeaderLink, extra?: string, onClick?: () => void) => {
    const active = isActive(l);
    const cls = clsx(extra ?? clsx(PILL, active ? PILL_ACTIVE : PILL_IDLE));
    return l.external ? (
      <a key={l.href} href={l.href} target="_blank" rel="noopener" className={cls} onClick={onClick}>{l.label}</a>
    ) : (
      <Link key={l.href} href={l.href} className={cls} aria-current={active ? "page" : undefined} onClick={onClick}>{l.label}</Link>
    );
  };

  return (
    <nav
      ref={wrapRef}
      aria-label="Pages"
      className="relative order-last flex w-full min-w-0 items-center gap-1 lg:order-none lg:w-auto lg:flex-1"
    >
      {/* Off-screen copy of every pill + "More", used only to measure widths. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex h-0 gap-1 overflow-hidden whitespace-nowrap">
        {links.map((l) => <span key={l.href} className={clsx(PILL, PILL_IDLE)}>{l.label}</span>)}
        <span className={clsx(PILL, PILL_IDLE)}>More ▾</span>
      </div>

      <div className="flex min-w-0 gap-1 overflow-hidden whitespace-nowrap">{shown.map((l) => pill(l))}</div>

      {hidden.length > 0 && (
        <div ref={more.ref} className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={more.open}
            onClick={() => more.setOpen((o) => !o)}
            className={clsx(PILL, "whitespace-nowrap", activeHidden ? PILL_ACTIVE : PILL_IDLE, more.open && !activeHidden && "text-white ring-1 ring-inset ring-brand-200")}
          >
            More ▾
          </button>
          {more.open && (
            <div role="menu" aria-label="More pages" className="absolute right-0 top-10 z-30 max-h-[70vh] w-56 overflow-y-auto rounded-modal border border-gray-200 bg-white p-1.5 text-gray-900 shadow-pop">
              {hidden.map((l) =>
                pill(
                  l,
                  clsx("block rounded-input px-3 py-2 text-sm", isActive(l) ? "bg-brand-100 font-semibold text-brand-900" : "hover:bg-gray-100"),
                  () => more.setOpen(false),
                ),
              )}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

function ToolSwitcher({ items }: { items: SwitcherItem[] }) {
  const { open, setOpen, ref } = useDismissable();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Switch tool"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx("grid h-8 w-8 place-items-center rounded-full text-white transition hover:bg-brand-800", open && "bg-brand-800 ring-1 ring-inset ring-brand-200")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label="Loopdesk AI tools" className="fixed inset-x-4 top-14 z-30 rounded-modal sm:absolute sm:inset-x-auto sm:left-0 sm:top-10 sm:w-[340px] border border-gray-200 bg-white p-3 text-gray-900 shadow-pop">
          <p className="px-2 pb-2 text-xs font-medium text-gray-500">Loopdesk AI</p>
          <div className="grid grid-cols-2 gap-1">
            {items.map((t) => {
              const body = (
                <>
                  <span className={clsx("block text-sm font-semibold", t.current && "text-brand-900")}>{t.name}</span>
                  <span className="block text-xs text-gray-500">{t.enabled ? t.blurb : "Not in your plan"}</span>
                </>
              );
              const cls = clsx("block rounded-input px-3 py-2", t.current ? "bg-brand-100" : t.enabled ? "hover:bg-gray-100" : "cursor-default text-gray-500");
              if (!t.enabled || !t.href) return <div key={t.id} role="menuitem" aria-disabled className={cls}>{body}</div>;
              return t.external ? (
                <a key={t.id} role="menuitem" href={t.href} target="_blank" rel="noopener" className={cls} onClick={() => setOpen(false)}>{body}</a>
              ) : (
                <Link key={t.id} role="menuitem" href={t.href} className={cls} aria-current={t.current ? "page" : undefined} onClick={() => setOpen(false)}>{body}</Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
