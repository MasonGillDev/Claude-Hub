import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { AttentionBell } from "@/components/AttentionBell";
import { ApprovalsTray } from "@/components/ApprovalsTray";

export const metadata: Metadata = {
  title: "Claude Hub",
  description: "Manage your Claude Code sessions across projects",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-20 glass border-b border-white/60">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
            <Link href="/" className="flex items-center gap-3 group">
              <span
                className="grid h-9 w-9 place-items-center rounded-2xl text-white text-lg font-bold shadow-soft transition-transform group-hover:scale-105"
                style={{
                  background:
                    "linear-gradient(135deg,#a18cd1 0%,#fbc2eb 60%,#fad0c4 100%)",
                }}
              >
                ✦
              </span>
              <div className="leading-tight">
                <div className="font-semibold tracking-tight">Claude Hub</div>
                <div className="text-xs text-ink-faint">session manager</div>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <ApprovalsTray />
              <AttentionBell />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
