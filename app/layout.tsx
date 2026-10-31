import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "heihei达人工作台",
  description: "管理达人收样、月度推广、视频表现与合作分层。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
