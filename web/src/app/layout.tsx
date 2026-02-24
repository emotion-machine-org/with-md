import type { Metadata } from 'next';

import '@/app/globals.css';

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://with.md';
const enablePrivateFonts = process.env.WITHMD_ENABLE_PRIVATE_FONTS === '1';
const privateFontsStylesheetUrl = process.env.WITHMD_PRIVATE_FONTS_STYLESHEET_URL?.trim() || '/private-fonts.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'with.md',
  description: 'Filesystem-first markdown collaboration for humans and agents.',
  openGraph: {
    type: 'website',
    title: 'with.md',
    description: 'Filesystem-first markdown collaboration for humans and agents.',
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
    title: 'with.md',
    description: 'Filesystem-first markdown collaboration for humans and agents.',
    images: ['/with-md.jpg'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-bg="1" suppressHydrationWarning>
      <head>
        {enablePrivateFonts ? <link rel="stylesheet" href={privateFontsStylesheetUrl} /> : null}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('withmd-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var raw=localStorage.getItem('withmd-bg');var n=raw==null?NaN:parseInt(raw,10);if(!Number.isFinite(n)||n<0||n>10){if(raw==null){n=Math.floor(Math.random()*11);try{localStorage.setItem('withmd-bg',String(n));}catch(e){}}else{n=1;}}document.documentElement.setAttribute('data-bg',String(n));}catch(e){document.documentElement.setAttribute('data-bg','1');}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
