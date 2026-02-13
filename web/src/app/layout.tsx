import type { Metadata } from 'next';

import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'with.md',
  description: 'Filesystem-first markdown collaboration',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('withmd-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var b=localStorage.getItem('withmd-bg');if(b)document.documentElement.style.setProperty('--withmd-bg-url',"url('/with-md/backgrounds/background_"+b+".webp')")}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
