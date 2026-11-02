"use client";

import { Icon } from "./Icon";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** The internal-tool nav ("Mega dashboard", "+ New report") — hidden when a
 *  report is opened in client-share mode (?mode=view), so a client scrolling
 *  through their own dashboard never sees the builder's own navigation
 *  chrome. Split out from the server-rendered layout because that's the only
 *  place lockView's query param is knowable. */
export default function HeaderNav() {
  const pathname = usePathname();
  const search = useSearchParams();
  const lockView = pathname?.startsWith("/report/") && search.get("mode") === "view";
  if (lockView) return null;
  return (
    <nav className="flex shrink-0 items-center gap-2 text-sm">
      <Link
        href="/"
        className="focus-ring hidden rounded-lg px-3 py-1.5 text-[#c2d1d5] transition-colors duration-150 hover:bg-white/5 hover:text-white sm:block"
      >
        Mega dashboard
      </Link>
      <Link
        href="/builder"
        className="focus-ring flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#6ae499] px-3 py-1.5 font-medium text-[#020202] transition-all duration-150 hover:bg-[#57cf86] active:scale-[0.98]"
      >
        <Icon name="plus" size={13} />
        New report
      </Link>
    </nav>
  );
}
