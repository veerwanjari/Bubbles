'use client';
import { useEffect, useState } from 'react';

// Fits text inside a circle: finds the biggest font size whose wrapped lines all stay
// inside the circle (lines near the top/bottom are narrower than the middle ones).
export type Measure = (s: string, f: number) => number;
export type Fit = { fs: number; lines: string[] };

const approx: Measure = (s, f) => { let w = 0; for (const ch of s) w += (ch === ' ' ? 0.22 : 0.47) * f; return w; };

let ctx: CanvasRenderingContext2D | null = null;
let family = '';
function getFamily() {
  if (!family && typeof document !== 'undefined') family = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  return family;
}
export function makeMeasure(): Measure {
  if (typeof document === 'undefined') return approx;
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  const fam = getFamily();
  if (!ctx || !fam) return approx;
  const c = ctx;
  return (s, f) => { c.font = '700 ' + f + 'px ' + fam; return c.measureText(s).width * 1.03; };
}

// Re-fit once the display font has really loaded (canvas needs it to measure correctly).
export function useDisplayFont() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const fam = getFamily();
    if (!fam || !document.fonts) return;
    document.fonts.load('700 20px ' + fam).then(() => setT(1)).catch(() => {});
  }, []);
  return t;
}

const LH = 1.05;

export function fitText(text: string, d: number, measure: Measure): Fit {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length || d < 20) return { fs: 0, lines: [] };
  const R = (d / 2) * 0.9;
  const chord = (y: number) => (y >= R ? 0 : 2 * Math.sqrt(R * R - y * y));
  const room = (i: number, n: number, lh: number) => {
    const H = n * lh;
    return chord(Math.max(Math.abs(i * lh - H / 2), Math.abs((i + 1) * lh - H / 2)));
  };

  const tryLayout = (f: number): string[] | null => {
    const lh = f * LH, maxN = Math.floor((2 * R) / lh);
    for (let n = 1; n <= maxN; n++) {
      const lines: string[] = [];
      let cur = '', ok = true;
      for (const w of words) {
        const trial = cur ? cur + ' ' + w : w;
        if (lines.length < n && measure(trial, f) <= room(lines.length, n, lh)) cur = trial;
        else {
          if (cur) lines.push(cur);
          if (lines.length >= n || measure(w, f) > room(lines.length, n, lh)) { ok = false; break; }
          cur = w;
        }
      }
      if (!ok) continue;
      lines.push(cur);
      if (lines.length > n) continue;
      const m = lines.length;
      if (lines.every((l, i) => measure(l, f) <= room(i, m, lh))) return lines;
    }
    return null;
  };

  let lo = 8, hi = Math.max(9, d * 0.45);
  let best = tryLayout(lo);
  if (!best) {                                    // absurdly long text in a tiny bubble: char-wrap + ellipsis
    const f = 8, lh = f * LH, n = Math.max(1, Math.floor((2 * R) / lh));
    const chars = Array.from(words.join(' '));
    const lines: string[] = [];
    let i = 0;
    while (i < chars.length && lines.length < n) {
      let cur = '';
      while (i < chars.length && measure(cur + chars[i], f) <= room(lines.length, n, lh)) cur += chars[i++];
      if (!cur.trim()) break;
      lines.push(cur.trim());
    }
    if (i < chars.length && lines.length) {
      const last = Array.from(lines[lines.length - 1]);
      while (last.length > 1 && measure(last.join('') + '…', f) > room(lines.length - 1, n, lh)) last.pop();
      lines[lines.length - 1] = last.join('') + '…';
    }
    return { fs: f, lines };
  }
  let bestF = lo;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2, r = tryLayout(mid);
    if (r) { best = r; bestF = mid; lo = mid; } else hi = mid;
  }
  return { fs: Math.floor(bestF), lines: best };
}
