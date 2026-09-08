import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { UiSounds } from "@/components/ui-sounds";

import "./globals.css";
import "./pages.css";
import "./refine.css";
import "./finish.css";
import "./protocol-v2.css";
import "./semantic.css";
import "./visual-cleanup.css";
import "./clarity.css";
import "./chips.css";
import "./repair.css";
import "./story.css";
import "./proof-guides.css";
import "./aztec.css";
import "./table-polish.css";

export const metadata: Metadata = {
  title: "Noir Poker",
  description: "Six-max Texas Hold’em with auditable dealing and private zero-knowledge challenges",
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" } },
};

type LayoutProps = Readonly<{ children: ReactNode }>;

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <head><link rel="preload" href="/fonts/block-blueprint.ttf" as="font" type="font/ttf" crossOrigin="anonymous" /></head>
      <body>
        <UiSounds />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
