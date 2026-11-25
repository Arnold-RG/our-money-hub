import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/providers/app-provider";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Our Money Hub", template: "%s · Our Money Hub" },
  description: "Everything you earn, spend, budget and subscribe to. Created by Arnold Rurangwa / Arnova Group.",
  authors: [{ name: "Arnold Rurangwa / Arnova Group" }],
  icons: { icon: "/icon.svg" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07100C" },
    { media: "(prefers-color-scheme: light)", color: "#F2F6F3" },
  ],
};

const themeScript = `(function(){try{var t=localStorage.getItem('omh.theme');if(!t){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-app="omh" data-theme="dark" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
