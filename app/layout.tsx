import AppShell from "@/components/AppShell";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobPilot — AI-Powered Job Hunting Automation",
  description:
    "Automate your job search with AI-powered ATS scoring, recruiter research, and cold email generation. Track applications from LinkedIn and Indeed in one dashboard.",
  keywords: ["job search", "ATS", "resume", "recruiter", "automation"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full bg-[var(--background)] text-[var(--foreground)]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
