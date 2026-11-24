import { PublicShell } from "@/components/site-chrome";

// Same header and footer as the website (components/site-chrome.tsx).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
