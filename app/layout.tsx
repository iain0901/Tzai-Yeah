import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "載耶小屋 2026｜搖搖耶誕樹",
  description: "一張 NFC 小卡，一間專屬耶誕小屋。聽聖誕音樂、搖手機養大自己的耶誕樹、看看誰的小樹最高。2026 載物書院耶誕晚會，11 月 21 日清華大學教育館見。",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#123d32" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body>{children}</body>
    </html>
  );
}
