import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pkm Fever",
  description: "A monster-collecting RPG where nothing is rolled at the moment it is needed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
