import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Noir Poker",
  description: "A static six-max poker table",
};

type LayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: LayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
