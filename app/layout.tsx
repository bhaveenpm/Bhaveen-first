import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Write — product photo to listing copy",
  description:
    "Upload a product photo and get merchant-ready listing copy, with every unverifiable claim quarantined instead of invented.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">{children}</body>
    </html>
  );
}
