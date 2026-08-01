import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Main Dashboard — YY Digital Growth",
  description: "YY Digital Growth — Main Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
