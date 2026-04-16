import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'BugShot — Report Frontend Bugs Like a Developer',
    template: '%s | BugShot',
  },
  description:
    'Capture and share detailed frontend bug reports with automatic browser, OS, and screen metadata. No account needed.',
  keywords: ['bug report', 'frontend bugs', 'website bugs', 'browser debugging', 'bug tracker'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">
        {children}
      </body>
    </html>
  );
}
