import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Kalam, Newsreader } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", style: ["normal", "italic"], display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const hand = Kalam({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-hand", display: "swap" });

export const metadata: Metadata = {
  title: "Paper Tutor",
  description: "Pick any research paper and watch a tutor explain it on a whiteboard, out loud.",
};

export const viewport: Viewport = { themeColor: "#eef1ec" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
