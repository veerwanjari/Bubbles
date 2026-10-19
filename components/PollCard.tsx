'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Eye, EyeOff } from 'lucide-react';
import { Poll } from '@/lib/room';

type Props = {
  poll: Poll; canVote: boolean;
  onVote?: (pollId: string, idx: number) => Promise<string | null>;
  onEnd?: () => void;                // host: end the poll
  onToggleBoard?: () => void;        // host: remove an ended poll from everyone's board (or show it again)
};

const rule = (p: Poll) =>
  !p.multi_option && !p.multi_vote ? 'One vote only'
  : p.multi_option && !p.multi_vote ? 'One vote per option · pick as many options as you like'
  : p.multi_option && p.multi_vote ? 'Vote as many times, on as many options, as you like'
  : 'Pick one option · tap it as many times as you like';

export default function PollCard({ poll, canVote, onVote, onEnd, onToggleBoard }: Props) {
  const [err, setErr] = useState('');
  const total = Object.values(poll.counts).reduce((a, b) => a + b, 0);
  const mineAt = (i: number) => poll.mine.filter(x => x === i).length;
  const used = new Set(poll.mine);
  const open = canVote && poll.is_active;

  const vote = async (i: number) => {
    if (!onVote) return;
    if (!poll.is_active) { setErr('This poll has ended'); return; }
    if (!canVote) { setErr('Voting opens once the host starts the session'); return; }
    if (!poll.multi_vote && mineAt(i) > 0) { setErr(poll.multi_option ? 'You already voted for this option' : 'You already voted'); return; }
    if (!poll.multi_option && used.size > 0 && !used.has(i)) { setErr('This poll allows only one option'); return; }
    setErr('');
    const e = await onVote(poll.id, i);
    setErr(e ?? '');
  };

  return (
    <div className="glass-strong w-full rounded-3xl p-4">
      <div className="mb-3 flex items-start gap-2">
        <BarChart3 size={18} className="mt-0.5 shrink-0 text-accent" />
        <h3 className="flex-1 font-semibold leading-snug">{poll.question}</h3>
        {!poll.is_active && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold uppercase text-ink/50">Ended</span>}
        {poll.hidden && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold uppercase text-ink/50">Off board</span>}
        {poll.is_active && onEnd && <button onClick={onEnd} className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600">End poll</button>}
      </div>
      <div className="space-y-2">
        {poll.options.map((o, i) => {
          const c = poll.counts[i] ?? 0;
          const mine = mineAt(i);
          const pct = total ? Math.round((c / total) * 100) : 0;
          return (
            <motion.button key={i} onClick={() => vote(i)} whileTap={open ? { scale: 0.98 } : undefined}
              className={'no-select relative w-full overflow-hidden rounded-2xl bg-white/60 px-3 py-2.5 text-left text-sm ' + (open ? '' : 'opacity-70')}>
              <motion.span initial={false} animate={{ width: pct + '%' }} className="absolute inset-y-0 left-0 bg-pastel-lavender/70" />
              <span className="relative flex items-center justify-between gap-2 font-medium">
                <span className="min-w-0 break-words">{o}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {mine > 0 && <span className="rounded-full bg-white/80 px-1.5 text-[11px] font-semibold text-accent">you ×{mine}</span>}
                  <span className="tabular-nums">{c} · {pct}%</span>
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink/40">
        <span>{poll.is_active ? rule(poll) : ''}</span>
        <span className="shrink-0">{total} vote{total !== 1 && 's'}</span>
      </div>
      {!poll.is_active && onToggleBoard && (
        <button onClick={onToggleBoard} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/60 py-2 text-sm font-semibold">
          {poll.hidden ? <><Eye size={16} />Show on everyone&apos;s board again</> : <><EyeOff size={16} />Remove from everyone&apos;s board</>}
        </button>
      )}
    </div>
  );
}
