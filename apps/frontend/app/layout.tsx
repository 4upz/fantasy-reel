import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Providers } from "./providers";

const bricolage = localFont({
  src: "./fonts/bricolage.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  style: "normal",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "75% 100%" }],
});

const dmSans = localFont({
  src: "./fonts/dm-sans.woff2",
  variable: "--font-dm-sans",
  weight: "100 1000",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fantasy Reel",
  description: "Fantasy leagues for movies",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable}`}>
      <body className="antialiased">
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
