import { redirect } from "next/navigation";

// Loopdesk's marketing site is loopdeskai.wayneesolutions.com; the app address opens on log-in.
export default function HomePage() {
  redirect("/login");
}
