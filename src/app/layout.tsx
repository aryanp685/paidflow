import type { Metadata } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/noto-sans-devanagari/400.css";
import "./globals.css";
export const metadata: Metadata = { title: "PAIDFLOW — A clearer path to getting paid", description: "A thoughtfully designed receivables workspace for Indian businesses. Explore the PAIDFLOW product preview." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
