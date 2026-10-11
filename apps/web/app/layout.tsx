import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// DM Sans: geometric and friendly with open numerals, legible for money. Mono stays for addresses and links, which people copy.
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Opaq Pay", template: "%s | Opaq Pay" },
  description: "Get paid in USDC without showing your wallet or balance to the people who pay you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
