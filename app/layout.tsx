import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Lighting Discovery",
  description:
    "Discover smart switch panels on the local network and review their status.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

