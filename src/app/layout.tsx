import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '测试用例生成助手',
  description: '测试用例生成与脑图编辑',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
