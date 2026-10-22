'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fitText, makeMeasure, useDisplayFont } from '@/lib/fit';
import { Msg, BASE_BUBBLE, emojiCount, emojiScale, pastelFor } from '@/lib/room';

const GAP = 6;
type Circle = { id: string; x: number; y: number; r: number };

// A bubble that holds ONLY an emoji, a GIF, a sticker or a photo (no text) is "bare":
// half the size, no background, content fills it edge to edge.
const isBare = (m: Msg) => (m.media_url ? !m.body.trim() : emojiCount(m.body) > 0);
const baseOf = (m: Msg) => (isBare(m) ? BASE_BUBBLE / 2 : BASE_BUBBLE);

// Finds a free spot for a NEW bubble, spiralling out from the middle.
function place(c: Circle, others: Circle[], W: number, cy: number, stretch: number) {
  const r = c.r;
  if (!others.length) return { x: W / 2, y: Math.max(r, cy) };
  for (let t = 0; t < 3000; t += 0.12) {
    const rad = 2.4 * t, x = W / 2 + rad * Math.cos(t) * stretch, y = Math.max(r, cy) + rad * Math.sin(t);
    if (x - r < 0 || x + r > W || y - r < 0) continue;
    if (others.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + r + GAP)) return { x, y };
  }
  const bottom = Math.max(...others.map(p => p.y + p.r));
  return { x: Math.min(Math.max(r, W / 2), W - r), y: bottom + r + GAP };
}

// When a bubble grows it keeps its place and shoves its neighbours outward (smaller ones move more).
function relax(cs: Circle[], W: number) {
  for (let it = 0; it < 140; it++) {
    let moved = false;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j];
        const min = a.r + b.r + GAP;
        let dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        let dist = Math.hypot(dx, dy);
        if (dist >= min) continue;
        if (dist < 0.01) { const ang = (i * 2.399 + j) % 6.283; dx = Math.cos(ang); dy = Math.sin(ang); dist = 1; }
        const push = min - dist, nx = dx / dist, ny = dy / dist;
        const wa = (b.r * b.r) / (a.r * a.r + b.r * b.r);       // share of the move that `a` takes
        a.x -= nx * push * wa; a.y -= ny * push * wa;
        b.x += nx * push * (1 - wa); b.y += ny * push * (1 - wa);
        moved = true;
      }
    }
    for (const c of cs) { c.x = Math.min(Math.max(c.x, c.r), W - c.r); c.y = Math.max(c.y, c.r); }
    if (!moved) break;
  }
}

type Props = { messages: Msg[]; onOpen: (m: Msg) => void; onLike: (m: Msg) => void };

export default function MoodboardView({ messages, onOpen, onLike }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 340, vh: 700 });
  const ft = useDisplayFont();
  const spots = useRef(new Map<string, { x: number; y: number }>());   // remembered positions: bubbles never jump
  const spotsW = useRef(0);

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
    const W = dim.w;
    const maxSize = Math.max(BASE_BUBBLE + 24, Math.min(W, dim.vh) * 0.8);   // never bigger than 80 % of the screen
    const memo = spots.current;
    if (spotsW.current !== W) { memo.clear(); spotsW.current = W; }          // screen width changed: lay out again
    const live = new Set(messages.map(m => m.id));
    Array.from(memo.keys()).forEach(k => { if (!live.has(k)) memo.delete(k); });

    const size = (m: Msg) => Math.min(Math.max(baseOf(m), Math.min(maxSize, baseOf(m) + 12 * m.likes)), W - 4);
    const all = messages.map(m => ({ m, c: { id: m.id, x: 0, y: 0, r: size(m) / 2 } as Circle }));
    const known: Circle[] = [];
    all.forEach(o => { const p = memo.get(o.m.id); if (p) { o.c.x = p.x; o.c.y = p.y; known.push(o.c); } });

    const stretch = Math.min(2.6, Math.max(1.15, W / (dim.vh * 0.9)));
    const cy = Math.max(0, dim.vh * 0.85 * 0.5 - 70);
    all.filter(o => !memo.has(o.m.id))                                       // newcomers: most liked first, then oldest first
      .sort((a, b) => b.m.likes - a.m.likes || a.m.created_at.localeCompare(b.m.created_at) || a.m.id.localeCompare(b.m.id))
      .forEach(o => { const p = place(o.c, known, W, cy, stretch); o.c.x = p.x; o.c.y = p.y; known.push(o.c); });

    relax(all.map(o => o.c), W);
    all.forEach(o => memo.set(o.m.id, { x: o.c.x, y: o.c.y }));

    const sorted = [...all].sort((a, b) => a.m.created_at.localeCompare(b.m.created_at) || a.m.id.localeCompare(b.m.id));
    return {
      h: all.length ? Math.max(...all.map(o => o.c.y + o.c.r)) : 0,
      items: sorted.map(o => ({ m: o.m, d: o.c.r * 2, left: o.c.x - o.c.r, top: o.c.y - o.c.r })),
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

// split text into whole emoji (never cuts a multi-part emoji in half)
function graphemes(s: string): string[] {
  const t = s.replace(/\s+/g, '');
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (x: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(t), x => x.segment);
  return Array.from(t);
}

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
  const bare = isBare(m);
  // text grows with the bubble and fills most of its inner space
  const fit = useMemo(() => (!m.media_url && ec === 0 && body ? fitText(body, d, makeMeasure()) : null), [body, d, ft, ec, m.media_url]);
  const emojis = useMemo(() => (!m.media_url && ec > 0 ? graphemes(body) : []), [body, ec, m.media_url]);
  const cols = Math.max(1, Math.ceil(Math.sqrt(emojis.length)));
  const emojiFs = d / (cols * 1.2);

  return (
    <motion.button
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(m); }}
      className={'no-select absolute select-none ' + (bare ? "before:absolute before:-inset-2 before:content-['']" : '')}
      initial={{ scale: 0, left, top, width: d, height: d }}
      animate={{ scale: 1, left, top, width: d, height: d }}
      transition={{ type: 'spring', stiffness: 120, damping: 18 }}>
      {/* CSS float animation: re-renders can never restart it, so no flicker */}
      <span className={'animate-float relative flex h-full w-full items-center justify-center text-center ' +
        (bare ? '' : 'rounded-full border border-white/60 p-[3%] shadow-bubble ' + pastelFor(m.id))}
        style={{ animationDuration: 4 + (seed % 30) / 10 + 's', animationDelay: '-' + (seed % 5) + 's' }}>
        {m.media_url && bare ? (
          <img src={m.media_url} alt="" draggable={false} className="pointer-events-none h-full w-full object-contain" />
        ) : m.media_url ? (
          <span className="flex flex-col items-center justify-center">
            <img src={m.media_url} alt="" draggable={false} className="pointer-events-none rounded-2xl object-contain"
              style={{ maxWidth: d * 0.72, maxHeight: body ? d * 0.44 : d * 0.72 }} />
            {body && <span className="mt-1 font-display font-bold uppercase leading-none text-bubble-ink"
              style={{ fontSize: Math.max(9, fs * 0.8), display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 1, overflow: 'hidden' }}>{body}</span>}
          </span>
        ) : ec > 0 ? (
          <span className="flex flex-wrap items-center justify-center" style={{ width: d, fontSize: emojiFs, lineHeight: 1 }}>
            {emojis.map((g, i) => <span key={i} style={{ display: 'inline-block', lineHeight: 1 }}>{g}</span>)}
          </span>
        ) : (
          <span className="font-display font-bold uppercase text-bubble-ink"
            style={{ fontSize: fit ? fit.fs : fs, lineHeight: 1.05, whiteSpace: 'pre', textAlign: 'center' }}>{fit ? fit.lines.join('\n') : body}</span>
        )}
        {m.likes > 0 && <span className="absolute bottom-[4%] rounded-full bg-white/70 px-1.5 text-[10px] font-semibold text-accent">♥ {m.likes}</span>}
      </span>
      <AnimatePresence>
        {hearts.map(hh => (
          <motion.span key={hh} initial={{ opacity: 1, y: 0, scale: 0.6 }} animate={{ opacity: 0, y: -90, scale: 1.6 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }} className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-3xl">❤️</motion.span>
        ))}
      </AnimatePresence>
    </motion.button>
  );
}, (a, b) => a.m.id === b.m.id && a.m.likes === b.m.likes && a.m.body === b.m.body && a.m.media_url === b.m.media_url && a.d === b.d && a.left === b.left && a.top === b.top && a.ft === b.ft && a.onOpen === b.onOpen && a.onLike === b.onLike);
