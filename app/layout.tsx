import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "載耶 2026｜搖搖耶誕樹",
  description: "一張 NFC 小卡，收藏一晚的相遇。聽聖誕音樂、搖手機養大六階段耶誕樹，從活動邀請、分組到照片回憶。2026 載物書院耶誕晚會，11 月 21 日清華大學教育館見。",
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
