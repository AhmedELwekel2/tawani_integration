"use client";

import Link from "next/link";
import AuthButtons from "./AuthButtons";

export default function Header() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-white/10 bg-brand-primary/95 backdrop-blur-md transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* The logo is a two-line wordmark that already carries the name, and
            its map symbol wraps around the text — it cannot be reduced to an
            icon, and at header height the lettering is unreadable. So the
            header is a text lockup; the full logo appears where it has room
            (auth pages, PDF covers). */}
        <Link href="/" className="flex flex-col leading-none">
          <span className="text-xl font-black tracking-tight text-white">
            منصة التعاونية
          </span>
          <span className="mt-1 text-[11px] font-medium tracking-wide text-white/70">
            تعاونية المرشدين السياحيين
          </span>
        </Link>
        
        <div className="flex items-center gap-4">
          <AuthButtons />
        </div>
      </div>
    </header>
  );
}