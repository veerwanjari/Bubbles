'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, X } from 'lucide-react';
import { fitText, makeMeasure, useDisplayFont } from '@/lib/fit';
import { Msg, emojiCount, emojiScale, pastelFor, sliceChars } from '@/lib/room';

type Props = {
  msg: Msg | null; canPrivate: boolean;
  onClose: () => void;
  onPrivate: (body: string, aboutMessageId: string) => Promise<string | null>;
};

// Hold a bubble -> it fills the screen. Tap it -> closes.
export default function BubbleModal({ msg, canPrivate, onClose, onPrivate }: Props) {
  const [drawer, setDrawer] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sent' | string>('idle');
  const openedAt = useRef(0);
  useEffect(() => { openedAt.current = Date.now(); }, [msg?.id]);

  const close = () => {
    if (Date.now() - openedAt.current < 450) return;        // ignore the finger lifting after the long-press
    setDrawer(false); setState('idle'); setText(''); onClose();
  };
  const send = async () => {
    if (!text.trim() || !msg) return;
    const err = await onPrivate(text.trim(), msg.id);
    if (err) setState(err); else { setState('sent'); setText(''); }
  };
  const size = 'min(92vw, 78vh, 640px)';
  const body = msg ? msg.body.trim() : '';
  const ec = msg ? emojiCount(msg.body) : 0;
  const ft = useDisplayFont();
  const fit = useMemo(() => {
    if (!msg || msg.media_url || ec > 0 || !body || typeof window === 'undefined') return null;
    const px = Math.min(window.innerWidth * 0.92, window.innerHeight * 0.78, 640);
    return fitText(body, px * 0.74, makeMeasure());   // leave room for the likes / buttons below
  }, [msg, body, ec, ft]);

  return (
    <AnimatePresence>
      {msg && (
        <motion.div key="o" className="no-select fixed inset-0 z-50 grid place-items-center bg-white/30 backdrop-blur-2xl"
          onClick={drawer ? undefined : close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {!drawer ? (
            <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 220 }}
              className={'flex cursor-pointer flex-col items-center justify-center rounded-full border border-white/60 p-[4%] text-center shadow-bubble ' + pastelFor(msg.id)}
              style={{ width: size, height: size }}>
              {msg.media_url && <img src={msg.media_url} alt="" draggable={false} className="pointer-events-none rounded-2xl object-contain" style={{ maxWidth: '72%', maxHeight: body ? '42%' : '68%' }} />}
              {!msg.media_url && ec > 0
                ? <p style={{ fontSize: 'calc(' + size + ' * ' + emojiScale(ec) * 1.15 + ')', lineHeight: 1.05, wordBreak: 'break-all' }}>{body}</p>
                : fit
                  ? <p className="font-display font-bold uppercase text-bubble-ink" style={{ fontSize: fit.fs, lineHeight: 1.05, whiteSpace: 'pre', textAlign: 'center' }}>{fit.lines.join('\n')}</p>
                  : body && <p className="font-display font-bold uppercase leading-tight text-bubble-ink" style={{ fontSize: msg.media_url ? '1.2rem' : '1.8rem', wordBreak: 'break-word' }}>{body}</p>}
              <p className="mt-3 text-sm font-semibold text-bubble-ink/70">♥ {msg.likes} · {msg.alias}</p>
              {canPrivate && (
                <button onClick={e => { e.stopPropagation(); setDrawer(true); }}
                  className="mt-3 flex items-center gap-1.5 rounded-full bg-white/70 px-4 py-2 text-xs font-semibold text-bubble-ink"><Lock size={14} />Message host privately</button>
              )}
              <p className="mt-2 text-[11px] text-bubble-ink/50">Tap to close</p>
            </motion.div>
          ) : (
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={e => e.stopPropagation()}
              className="glass-strong mx-4 w-full max-w-md rounded-[32px] p-5">
              <div className="mb-2 flex items-center gap-2"><Lock size={16} className="text-accent" /><h3 className="flex-1 font-semibold">Private message to host</h3>
                <button onClick={() => { setDrawer(false); setState('idle'); setText(''); onClose(); }} className="rounded-full bg-white/60 p-1.5"><X size={18} /></button></div>
              <p className="mb-3 text-xs text-ink/50">Only the host can read this.</p>
              {state === 'sent' ? <p className="py-6 text-center font-semibold text-accent">Sent ✓</p> : (
                <>
                  <textarea value={text} onChange={e => setText(sliceChars(e.target.value, 500))} rows={4} placeholder="Write privately…"
                    className="w-full resize-none rounded-2xl bg-white/70 p-3 outline-none" />
                  {state !== 'idle' && <p className="mt-2 text-xs text-red-600">{state}</p>}
                  <button onClick={send} disabled={!text.trim()} className="mt-3 w-full rounded-2xl bg-accent py-3 font-semibold text-white disabled:opacity-30">Send privately</button>
                </>
              )}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
