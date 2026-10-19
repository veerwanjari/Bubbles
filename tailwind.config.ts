import type { Config } from 'tailwindcss';
export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.ts'],
  theme: { extend: {
    colors: {
      // colours come from CSS variables (globals.css) so dark mode can swap them
      pastel: {
        mint: 'rgb(var(--pastel-mint) / <alpha-value>)', lavender: 'rgb(var(--pastel-lavender) / <alpha-value>)',
        pink: 'rgb(var(--pastel-pink) / <alpha-value>)', sky: 'rgb(var(--pastel-sky) / <alpha-value>)',
        butter: 'rgb(var(--pastel-butter) / <alpha-value>)',
      },
      ink: 'rgb(var(--ink) / <alpha-value>)',
      accent: 'rgb(var(--accent) / <alpha-value>)',
      canvas: 'rgb(var(--canvas) / <alpha-value>)',
      'bubble-ink': '#1D1B2E',            // text on pastel bubbles stays dark in both themes
    },
    fontFamily: {
      display: ['var(--font-display)', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'sans-serif'],
      sans: ['var(--font-text)', 'system-ui', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'sans-serif'],
    },
    boxShadow: {
      glass: '0 8px 32px rgba(80,60,140,.12), inset 0 1px 0 rgba(255,255,255,.7)',
      lift: '0 4px 14px rgba(80,60,140,.18)',
      bubble: 'inset 0 2px 6px rgba(255,255,255,.8), 0 8px 20px rgba(80,60,140,.14)',
    },
    keyframes: { float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } } },
    animation: { float: 'float 5s ease-in-out infinite' },
  } },
  plugins: [],
} satisfies Config;
