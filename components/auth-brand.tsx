import { BUNDLE_NAME } from "@/lib/brand";

/**
 * Logo above every sign-in page, with the product name.
 */
export function AuthBrand() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center">
      <span className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-gray-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-small.png" alt="" width={60} height={40} className="h-10 w-auto" />
        {BUNDLE_NAME}
      </span>
    </div>
  );
}
