import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Orkestr Travel",
  description:
    "A coordination agent that turns the changing needs of several travellers into one feasible group journey.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
