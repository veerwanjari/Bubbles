import './globals.css';
import { Inter, Barlow_Condensed } from 'next/font/google';
import ThemeToggle from '@/components/ThemeToggle';

const text = Inter({ subsets: ['latin'], variable: '--font-text' });
const display = Barlow_Condensed({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display' });

export const metadata = { title: 'Bubbles' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

// applies the saved theme before the first paint (no white flash in dark mode)
const themeScript = "try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={text.variable + ' ' + display.variable}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
