import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Niv’s Tech & Telecoms Pulse",
  description: "A weekly look — hottest topics first.",
  metadataBase: new URL("https://nivstechpulse.com"),
  openGraph: {
    title: "Niv’s Tech & Telecoms Pulse",
    description: "A weekly look — hottest topics first.",
    url: "https://nivstechpulse.com",
    siteName: "Niv’s Tech & Telecoms Pulse",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Niv’s Tech & Telecoms Pulse",
    description: "A weekly look — hottest topics first.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
