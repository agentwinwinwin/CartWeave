import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CommerceOS · AI 跨境电商运营中枢",
  description: "跨境电商 AI 运营工作台原型",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
