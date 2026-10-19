'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fitText, makeMeasure, useDisplayFont } from '@/lib/fit';
import { Msg, BASE_BUBBLE, bubbleSize, emojiCount, emojiScale, pastelFor } from '@/lib/room';

const GAP = 6;
type Spot = { x: number; y: number; r: number };

// Packs circles inside the full container width: most-liked in the middle, the rest spiral outward.
// `stretch` widens the spiral on landscape screens so bubbles reach the left/right edges.
function pack(sizes: number[], W: number, cy: number, stretch: number) {
  const out: Spot[] = [];
  let t0 = 0;                                     // resume the spiral near where the last bubble landed
  sizes.forEach((d, i) => {
    const r = d / 2;
    if (!i) { out.push({ x: W / 2, y: Math.max(r, cy), r }); return; }
    const c = out[0];
    let spot: { x: number; y: number } | null = null;
    for (let t = t0; t < 3000; t += 0.12) {
      const rad = 2.4 * t, x = c.x + rad * Math.cos(t) * stretch, y = c.y + rad * Math.sin(t);
      if (x - r < 0 || x + r > W || y - r < 0) continue;
      if (out.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + r + GAP)) { spot = { x, y }; t0 = Math.max(0, t - 10); break; }
    }
    if (!spot) {
      const bottom = Math.max(...out.map(p => p.y + p.r));
      spot = { x: Math.min(Math.max(r, W / 2), W - r), y: bottom + r + GAP };
    }
    out.push({ ...spot, r });
  });
  return out;
}

type Props = { messages: Msg[]; onOpen: (m: Msg) => void; onLike: (m: Msg) => void };

export default function MoodboardView({ messages, onOpen, onLike }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 340, vh: 700 });
  const ft = useDisplayFont();

  useEffect(() => {
    const upd = () => {
      const w = Math.round(ref.current?.clientWidth || 0);
      setDim(d => { const n = { w: w > 100 ? w : d.w, vh: window.innerHeight }; return n.w === d.w && n.vh === d.vh ? d : n; });
    };
    upd();
    const ro = new ResizeObserver(upd);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', upd);
    return () => { ro.disconnect(); window.removeEventListener('resize', upd); };
  }, []);

  const { items, h } = useMemo(() => {
    const maxSize = Math.max(BASE_BUBBLE + 24, Math.min(dim.w, dim.vh) * 0.8); // never bigger than 80 % of the screen
    const sorted = [...messages].sort((a, b) => b.likes - a.likes || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const sizes = sorted.map(m => Math.min(bubbleSize(m.likes, maxSize), dim.w - 4));
    const stretch = Math.min(2.6, Math.max(1.15, dim.w / (dim.vh * 0.9)));
    const cy = Math.max(0, dim.vh * 0.85 * 0.5 - 70);                       // start in the middle of the bubble area
    const P = pack(sizes, dim.w, cy, stretch);
    return {
      h: P.length ? Math.max(...P.map(p => p.y + p.r)) : 0,
      items: sorted.map((m, i) => ({ m, d: sizes[i], left: P[i].x - P[i].r, top: P[i].y - P[i].r })),
    };
  }, [messages, dim]);

  return (
    <div className="w-full px-3 pt-[68px]">
      <p className="no-select pb-2 text-center text-[11px] text-ink/40">Hold a bubble to expand · double-tap to like</p>
      <div ref={ref} className="relative w-full" style={{ height: Math.max(h, 160) }}>
        {!items.length && <p className="pt-16 text-center font-display text-2xl font-semibold uppercase text-ink/40">No bubbles yet. Say something!</p>}
        {items.map(it => <Bubble key={it.m.id} {...it} ft={ft} onOpen={onOpen} onLike={onLike} />)}
      </div>
    </div>
  );
}

type BP = { ft: number; m: Msg; d: number; left: number; top: number; onOpen: (m: Msg) => void; onLike: (m: Msg) => void };

const HOLD_MS = 420;       // press and hold this long to expand
const DOUBLE_MS = 320;     // two taps within this = like

const Bubble = memo(function Bubble({ m, d, left, top, ft, onOpen, onLike }: BP) {
  const [hearts, setHearts] = useState<number[]>([]);
  const last = useRef(0);
  const press = useRef<ReturnType<typeof setTimeout>>();
  const held = useRef(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const seed = useMemo(() => { let s = 0; for (let i = 0; i < m.id.length; i++) s += m.id.charCodeAt(i); return s; }, [m.id]);
  useEffect(() => () => clearTimeout(press.current), []);

  const down = (e: React.PointerEvent) => {
    held.current = false; moved.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    clearTimeout(press.current);
    press.current = setTimeout(() => {             // long press = expand
      held.current = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
      onOpen(m);
    }, HOLD_MS);
  };
  const move = (e: React.PointerEvent) => {        // finger travelled = it is a scroll, not a press
    if (!moved.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) { moved.current = true; clearTimeout(press.current); }
  };
  const up = () => {
    clearTimeout(press.current);
    if (held.current || moved.current) return;
    const now = Date.now();
    if (now - last.current < DOUBLE_MS) {          // double tap = like
      last.current = 0;
      onLike(m);
      setHearts(h => [...h, now]);
      setTimeout(() => setHearts(h => h.filter(x => x !== now)), 900);
    } else last.current = now;
  };
  const cancel = () => clearTimeout(press.current);

  const fs = Math.max(10, d * 0.13);
  const body = m.body.trim();
  const ec = emojiCount(m.body);
  // text grows with the bubble and fills most of its inner space
  const fit = useMemo(() => (!m.media_url && ec === 0 && body ? fitText(body, d, makeMeasure()) : null), [body, d, ft, ec, m.media_url]);

  return (
    <motion.button
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(m); }}
      className="no-select absolute select-none"
      initial={{ scale: 0, left, top, width: d, height: d }}
      animate={{ scale: 1, left, top, width: d, height: d }}
      transition={{ type: 'spring', stiffness: 120, damping: 18 }}>
      {/* CSS float animation: re-renders can never restart it, so no flicker */}
      <span className={'animate-float relative flex h-full w-full items-center justify-center rounded-full border border-white/60 p-[3%] text-center shadow-bubble ' + pastelFor(m.id)}
        style={{ animationDuration: 4 + (seed % 30) / 10 + 's', animationDelay: '-' + (seed % 5) + 's' }}>
        {m.media_url ? (
          <span className="flex flex-col items-center justify-center">
            <img src={m.media_url} alt="" draggable={false} className="pointer-events-none rounded-2xl object-contain"
              style={{ maxWidth: d * 0.72, maxHeight: body ? d * 0.44 : d * 0.72 }} />
            {body && <span className="mt-1 font-display font-bold uppercase leading-none text-bubble-ink"
              style={{ fontSize: Math.max(9, fs * 0.8), display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 1, overflow: 'hidden' }}>{body}</span>}
          </span>
        ) : ec > 0 ? (
          <span style={{ fontSize: d * emojiScale(ec), lineHeight: 1.05, wordBreak: 'break-all' }}>{body}</span>
        ) : (
          <span className="font-display font-bold uppercase text-bubble-ink"
            style={{ fontSize: fit ? fit.fs : fs, lineHeight: 1.05, whiteSpace: 'pre', textAlign: 'center' }}>{fit ? fit.lines.join('\n') : body}</span>
        )}
        {m.likes > 0 && <span className="absolute bottom-[4%] rounded-full bg-white/70 px-1.5 text-[10px] font-semibold text-accent">♥ {m.likes}</span>}
      </span>
      <AnimatePresence>
        {hearts.map(h => (
          <motion.span key={h} initial={{ opacity: 1, y: 0, scale: 0.6 }} animate={{ opacity: 0, y: -90, scale: 1.6 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }} className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-3xl">❤️</motion.span>
        ))}
      </AnimatePresence>
    </motion.button>
  );
}, (a, b) => a.m.id === b.m.id && a.m.likes === b.m.likes && a.m.body === b.m.body && a.m.media_url === b.m.media_url && a.d === b.d && a.left === b.left && a.top === b.top && a.ft === b.ft && a.onOpen === b.onOpen && a.onLike === b.onLike);
