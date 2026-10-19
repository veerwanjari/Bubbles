'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

// Liquid-glass sun / moon switch, top right. Remembers the choice on this device.
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')); }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
  };
  return (
    <button onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="glass fixed right-3 top-[calc(env(safe-area-inset-top)+8px)] z-50 flex h-10 w-[76px] items-center rounded-full p-1">
      <span className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-between px-3 text-ink/40">
        <Sun size={15} /><Moon size={15} />
      </span>
      <span className={'keep-white relative grid h-8 w-8 place-items-center rounded-full bg-white shadow-lift transition-transform duration-300 ' + (dark ? 'translate-x-[36px]' : 'translate-x-0')}>
        {dark ? <Moon size={16} className="text-accent" /> : <Sun size={16} className="text-amber-500" />}
      </span>
    </button>
  );
}
