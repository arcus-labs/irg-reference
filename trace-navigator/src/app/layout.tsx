import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AuthSessionProvider from '@/components/AuthSessionProvider';
import "./globals.css";
import "./arcus.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IRG Trace Navigator",
  description: "Visualize and explore IRG reasoning traces",
  icons: {
    icon: "/favicon.ico",
  },
};

const themeInitScript = `
  (() => {
    try {
      const stored = window.localStorage.getItem('trace-navigator-theme');
      const theme = stored === 'dark' || stored === 'light'
        ? stored
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (error) {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.style.colorScheme = 'light';
    }
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
    <head>
      <link
        href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&amp;family=JetBrains+Mono:wght@300;400;500&amp;family=DM+Sans:wght@300;400;500;600&amp;display=swap"
        rel="stylesheet"/>
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
    </head>
    <body
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
    <AuthSessionProvider>{children}</AuthSessionProvider>
    </body>
    </html>
  );
}
