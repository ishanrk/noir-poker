import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";

import "./globals.css";
import "./pages.css";

export const metadata: Metadata = {
  title: "Noir Poker",
  description: "Six-max poker with auditable deals and private zero-knowledge bounties",
  icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" },
};

type LayoutProps = Readonly<{ children: ReactNode }>;

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
