import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'TinyTasks',
  description: 'A simple, reliable way to organize daily tasks.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
