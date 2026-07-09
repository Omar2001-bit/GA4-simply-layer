import Link from "next/link";
import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthed())) redirect("/login");
  return (
    <div className="min-h-screen bg-[#020601]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#020601]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-white">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#6ae499]" />
            GA4 Simply Layer
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/"
              className="rounded-lg px-3 py-1.5 text-[#c2d1d5] hover:bg-white/5 hover:text-white"
            >
              Mega dashboard
            </Link>
            <Link
              href="/builder"
              className="rounded-lg bg-[#6ae499] px-3 py-1.5 font-medium text-[#0e1c26] hover:bg-[#57cf86]"
            >
              + New report
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
