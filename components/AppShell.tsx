"use client";

import ErrorBoundary from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/ToastProvider";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/resume", label: "Resume" },
  { href: "/settings", label: "Settings" },
];

function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const hasDarkClass = document.documentElement.classList.contains("dark");
    const nextIsDark = hasDarkClass || prefersDark;
    const rafId = window.requestAnimationFrame(() => {
      setIsDark(nextIsDark);
      setMounted(true);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark, mounted]);

  const toggleTheme = () => {
    setIsDark((current) => !current);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {mounted ? (
        isDark ? (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05 5.636 5.636m12.728 0L16.95 7.05M7.05 16.95l-1.414 1.414M16 12a4 4 0 11-8 0 4 4 0 018 0Z" />
          </svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1 1 11.21 3c.5 0 .99.04 1.47.12a1 1 0 01.52 1.7A7 7 0 0 0 19.18 11c.39-.1.8.06 1.04.38.24.32.29.75.13 1.12-.11.25-.22.35-.35.29Z" />
          </svg>
        )
      ) : (
        <span className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1600px] grid-cols-1 md:grid-cols-[220px_1fr]">
        <aside className="border-b border-zinc-200/80 bg-zinc-50/70 px-4 py-4 backdrop-blur md:border-b-0 md:border-r md:px-3 dark:border-zinc-800/80 dark:bg-zinc-950/60">
          <div className="flex items-center justify-between md:mb-6 md:block">
            <div>
              <h1 className="text-sm font-semibold tracking-tight">JobPilot</h1>
              <p className="text-xs text-zinc-500">AI job hunt workflow</p>
            </div>
            <div className="md:hidden">
              <ThemeToggle />
            </div>
          </div>

          <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 md:mt-0 md:flex-col md:overflow-visible">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href ||
                (item.href === "/jobs" && pathname.startsWith("/jobs/"));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "whitespace-nowrap rounded-md px-3 py-2 text-sm transition",
                    active
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-4 hidden md:block">
            <ThemeToggle />
          </div>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <ShellContent>{children}</ShellContent>
      </ErrorBoundary>
    </ToastProvider>
  );
}
