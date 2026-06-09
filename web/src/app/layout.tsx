import type { Metadata } from 'next';

import '@/app/globals.css';
import { siteUrl } from '@/lib/with-md/site';

const enablePrivateFonts = process.env.WITHMD_ENABLE_PRIVATE_FONTS === '1';
const privateFontsStylesheetUrl = process.env.WITHMD_PRIVATE_FONTS_STYLESHEET_URL?.trim() || '/private-fonts.css';
const siteTitle = 'with.md - Markdown collaboration for developers and agents';
const siteDescription = 'Create read and edit links for markdown files without moving the source file.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    type: 'website',
    title: siteTitle,
    description: siteDescription,
    url: '/',
    images: [
      {
        url: '/with-md.jpg',
        width: 1174,
        height: 654,
        alt: 'with.md',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: ['/with-md.jpg'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-bg="1" data-bg-hidden="0" suppressHydrationWarning>
      <head>
        {enablePrivateFonts ? <link rel="stylesheet" href={privateFontsStylesheetUrl} /> : null}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('withmd-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var raw=localStorage.getItem('withmd-bg');var n=raw==null?NaN:parseInt(raw,10);if(!Number.isFinite(n)||n<0||n>10){if(raw==null){n=Math.floor(Math.random()*11);try{localStorage.setItem('withmd-bg',String(n));}catch(e){}}else{n=1;}}document.documentElement.setAttribute('data-bg',String(n));var hidden=localStorage.getItem('withmd-bg-hidden');document.documentElement.setAttribute('data-bg-hidden',hidden==='1'?'1':'0');}catch(e){document.documentElement.setAttribute('data-bg','1');document.documentElement.setAttribute('data-bg-hidden','0');}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
