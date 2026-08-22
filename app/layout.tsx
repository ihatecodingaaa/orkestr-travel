import type { ReactNode } from "react";
import "./globals.css";
import "./product.css";

export const metadata = {
  title: "Orkestr — plan together without doing the planning together",
  description:
    "Orkestr coordinates a group trip around everyone's different dates, budgets and needs, and repairs only what changes.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          One shell for every page. Previously each route wrapped itself, which
          meant a new page could quietly ship with different margins and a
          different maximum width -- the sort of drift nobody notices until the
          product looks like it was built by two teams.
        */}
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
