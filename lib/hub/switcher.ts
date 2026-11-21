import type { Tool } from "@/lib/hub/plans";
import type { SwitcherItem } from "@/components/app-header";

/**
 * The tool switcher in the top bar: always all seven Loopdesk AI tools, in this order,
 * so every tool's switcher looks the same. Tools outside the plan are greyed out.
 */
const ORDER: { id: string; tool?: Tool; name: string; blurb: string; slug?: string }[] = [
  { id: "home", name: "Home", blurb: "Customers, inbox, offers, growth" },
  { id: "calls", tool: "WAYNERING", name: "Calls", blurb: "AI phone agent", slug: "wayneRing" },
  { id: "jobs", tool: "FIELD_SERVICE", name: "Jobs", blurb: "Field service and staff", slug: "field-service" },
  { id: "google", tool: "GMB", name: "Google Profile", blurb: "Reviews and Google listing", slug: "gmb" },
  { id: "ads", tool: "VIDEO", name: "Ads", blurb: "AI video ads", slug: "video" },
  { id: "loyvexa", tool: "LOYVEXA", name: "Loyvexa", blurb: "Channel loyalty", slug: "loyvexa" },
  // Set up and opened by the hub since Nov 2026 (H9).
  { id: "korvo", tool: "KORVO", name: "Korvo", blurb: "Distributor app with Tally", slug: "korvo" },
];

export function switcherItems(tools: Tool[]): SwitcherItem[] {
  return ORDER.map((t) => {
    if (t.id === "home") return { id: t.id, name: t.name, blurb: t.blurb, href: "/dashboard", enabled: true, current: true };
    const enabled = !!t.tool && tools.includes(t.tool);
    return {
      id: t.id,
      name: t.name,
      blurb: t.blurb,
      enabled,
      external: true,
      href: enabled && t.slug ? `/api/hub/open/${t.slug}` : undefined,
    };
  });
}
