import { ChartLineUpIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthed())) redirect("/login");
  return (
    <div className="min-h-screen bg-[#020601]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#020601]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <Link
            href="/"
            className="focus-ring flex min-w-0 items-center gap-2 rounded font-semibold text-white transition-opacity duration-150 hover:opacity-80"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#6ae499]/15 text-[#6ae499]">
              <ChartLineUpIcon size={14} weight="bold" />
            </span>
            <span className="truncate">GA4 Simply Layer</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2 text-sm">
            <Link
              href="/"
              className="focus-ring hidden rounded-lg px-3 py-1.5 text-[#c2d1d5] transition-colors duration-150 hover:bg-white/5 hover:text-white sm:block"
            >
              Mega dashboard
            </Link>
            <Link
              href="/builder"
              className="focus-ring flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#6ae499] px-3 py-1.5 font-medium text-[#0e1c26] transition-all duration-150 hover:bg-[#57cf86] active:scale-[0.98]"
            >
              <PlusIcon size={13} weight="bold" />
              New report
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-5 sm:px-4 sm:py-6">{children}</main>
    </div>
  );
}
