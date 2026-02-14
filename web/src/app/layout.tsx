import type { Metadata } from 'next';

import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'with.md',
  description: 'Filesystem-first markdown collaboration',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-bg="1" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('withmd-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var raw=localStorage.getItem('withmd-bg');var n=raw==null?1:parseInt(raw,10);if(!Number.isFinite(n)||n<0||n>11)n=1;document.documentElement.setAttribute('data-bg',String(n));}catch(e){document.documentElement.setAttribute('data-bg','1');}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
