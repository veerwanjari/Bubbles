'use client';
import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Play, Pause, Square, Trash2, Ban, Heart, Plus, Share2, Download, Copy, MessageCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Msg, Poll, Session, pastelFor } from '@/lib/room';
import { MEDIA_FILES_WARN, MESSAGE_WARN, STORAGE_LIMIT_MB } from '@/lib/limits';
import { Usage, mb } from '@/lib/usage';
import PollCard from './PollCard';
import GlassToggle from './GlassToggle';

const Sec = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <section className="glass rounded-3xl p-4">
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink/50">{t}</h3>{children}
  </section>
);

type Inbox = { id: string; alias: string; body: string };
type Props = {
  session: Session; adminKey: string; messages: Msg[]; polls: Poll[];
  refresh: () => Promise<void>; onLike: (m: Msg) => void;
  usage: Usage | null; warnings: string[]; reloadUsage: () => void;
};

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const r = max ? value / max : 0;
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-xs"><span className="text-ink/60">{label}</span><span className="tabular-nums">{text}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-white/50">
        <div className={'h-full rounded-full ' + (r >= 0.95 ? 'bg-red-500' : r >= 0.8 ? 'bg-amber-400' : 'bg-accent')} style={{ width: Math.min(100, r * 100) + '%' }} />
      </div>
    </div>
  );
}

// Host-only "Chat" tab: session controls, sharing, polls, private inbox, moderation (most liked on top).
export default function AdminPanel({ session, adminKey, messages, polls, refresh, onLike, usage, warnings, reloadUsage }: Props) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multiOption, setMultiOption] = useState(false);
  const [multiVote, setMultiVote] = useState(false);
  const [inbox, setInbox] = useState<Inbox[]>([]);
  const [valid, setValid] = useState<boolean | null>(null);
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null);
  const qr = useRef<HTMLCanvasElement>(null);

  const call = async (fn: string, args: object = {}, okText = 'Done') => {
    const r = await supabase.rpc(fn, { p_session: session.id, p_key: adminKey, ...args });
    setNote(r.error ? { ok: false, t: fn + ': ' + r.error.message } : { ok: true, t: okText });
    if (!r.error) { await refresh(); reloadUsage(); }
    return r;
  };

  useEffect(() => {
    supabase.rpc('admin_verify', { p_session: session.id, p_key: adminKey }).then(r => setValid(r.error ? false : !!r.data));
    const load = async () => {
      const { data } = await supabase.rpc('admin_private_inbox', { p_session: session.id, p_key: adminKey });
      setInbox((data as Inbox[]) ?? []);
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [session.id, adminKey]);

  const fixKey = () => {
    const k = prompt('Paste the admin key for this session');
    if (!k) return;
    localStorage.setItem('admin:' + session.code, k.trim());
    location.reload();
  };

  // ---- sharing (the QR code and every share button use the GUEST link) ----
  const base = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? location.origin : '')).replace(/\/$/, '');
  const link = base + '/?s=' + session.code;
  const onLocalhost = typeof window !== 'undefined' && /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) && !process.env.NEXT_PUBLIC_SITE_URL;
  const msgText = 'Join “' + session.title + '” on Bubbles';
  const share = async () => {
    try {
      const c = qr.current;
      if (c && typeof navigator.canShare === 'function') {
        const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
        if (blob) {
          const file = new File([blob], 'bubbles-qr.png', { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: session.title, text: msgText + '\n' + link }); return; }
        }
      }
      if (navigator.share) { await navigator.share({ title: session.title, text: msgText, url: link }); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(msgText + '\n' + link), '_blank');
  };
  const saveQr = () => {
    const c = qr.current; if (!c) return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = 'bubbles-' + session.code + '.png'; a.click();
  };

  const addPoll = async () => {
    const o = opts.map(s => s.trim()).filter(Boolean);
    if (!q.trim() || o.length < 2) { setNote({ ok: false, t: 'Add a question and at least 2 options' }); return; }
    const r = await call('admin_create_poll', { p_question: q.trim(), p_options: o, p_multi_option: multiOption, p_multi_vote: multiVote }, 'Poll added');
    if (!r.error) { setQ(''); setOpts(['', '']); }
  };
  const delLast = () => { if (confirm('Delete the last 5 messages? This cannot be undone.')) call('admin_delete_messages', { p_mode: 'last', p_n: 5 }, 'Deleted the last 5 messages'); };
  const delAll = () => { if (confirm('Delete ALL ' + messages.length + ' messages in this session? This cannot be undone.')) call('admin_delete_messages', { p_mode: 'all', p_n: 0 }, 'All messages deleted'); };
  const sorted = [...messages].sort((a, b) => b.likes - a.likes || b.created_at.localeCompare(a.created_at));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-3 pb-32 pt-20">
      {valid === false && (
        <div className="rounded-2xl bg-red-100 p-3 text-sm text-red-700">
          This browser&apos;s host key doesn&apos;t match this session.
          <button onClick={fixKey} className="ml-2 font-semibold underline">Enter key</button>
        </div>
      )}
      {warnings.map(w => <div key={w} className="flex items-start gap-2 rounded-2xl bg-red-100 p-3 text-sm text-red-700"><AlertTriangle size={18} className="mt-0.5 shrink-0" />{w}</div>)}
      {note && <div className={'rounded-2xl p-3 text-sm ' + (note.ok ? 'bg-pastel-mint text-bubble-ink' : 'bg-red-100 text-red-700')}>{note.t}</div>}

      <Sec t={'Session · ' + session.status}>
        <div className="flex gap-2">
          {([['live', 'Start', Play], ['paused', 'Pause', Pause], ['ended', 'End', Square]] as const).map(([s, l, I]) => (
            <button key={s} onClick={() => call('admin_set_status', { p_status: s }, 'Session is now ' + s)}
              className={'flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-semibold ' + (session.status === s ? 'bg-accent text-white' : 'bg-white/60')}>
              <I size={16} />{l}</button>
          ))}
        </div>
        <div className="mt-3">
          <GlassToggle checked={session.multi_like} label="Guests can like a bubble many times"
            hint={session.multi_like ? 'ON: every double-tap adds a like' : 'OFF (default): one like per guest per bubble'}
            onChange={v => call('admin_set_multi_like', { p_value: v }, v ? 'Guests can now like repeatedly' : 'Guests can like once per bubble')} />
        </div>
      </Sec>

      <Sec t="Invite guests">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div className="shrink-0 text-center">
            <div className="keep-white rounded-2xl bg-white p-2"><QRCodeCanvas ref={qr} value={link} size={320} level="M" marginSize={1} style={{ width: 176, height: 176 }} /></div>
            <p className="mt-1 text-[11px] font-semibold text-ink/50">QR code for GUESTS</p>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="break-all text-xs text-ink/60">{link}</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={share} className="flex items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white"><Share2 size={15} />Share</button>
              <button onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent(msgText + '\n' + link), '_blank')} className="flex items-center justify-center gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold"><MessageCircle size={15} />WhatsApp</button>
              <button onClick={() => navigator.clipboard.writeText(link)} className="flex items-center justify-center gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold"><Copy size={15} />Copy link</button>
              <button onClick={saveQr} className="flex items-center justify-center gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold"><Download size={15} />Save QR</button>
            </div>
            {onLocalhost && <p className="rounded-xl bg-amber-100 p-2 text-[11px] text-amber-800">This link only works on this computer or network. Open the app from your deployed (vercel.app) address, or set NEXT_PUBLIC_SITE_URL, so phones anywhere can join.</p>}
            <button onClick={() => navigator.clipboard.writeText(link + '&admin=' + adminKey)} className="text-[11px] font-semibold text-red-600 underline">Copy HOST login link (private, not for guests)</button>
          </div>
        </div>
      </Sec>

      <Sec t={'Polls (' + polls.length + ')'}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Question" className="mb-2 w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none" />
        {opts.map((o, i) => (
          <input key={i} value={o} onChange={e => setOpts(opts.map((x, j) => j === i ? e.target.value : x))} placeholder={'Option ' + (i + 1)}
            className="mb-2 w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none" />
        ))}
        {opts.length < 6 && <button onClick={() => setOpts([...opts, ''])} className="mb-3 flex items-center gap-1 rounded-xl bg-white/70 px-3 py-2 text-sm"><Plus size={14} />Option</button>}
        <div className="mb-3 space-y-2">
          <GlassToggle checked={multiOption} onChange={setMultiOption} label="Allow multiple options"
            hint={multiOption ? 'ON: a guest can vote for several options' : 'OFF (default): a guest sticks to one option'} />
          <GlassToggle checked={multiVote} onChange={setMultiVote} label="Allow multiple votes"
            hint={multiVote ? 'ON: a guest can vote many times' : 'OFF (default): one vote per option'} />
        </div>
        <button onClick={addPoll} className="mb-4 w-full rounded-xl bg-accent py-2 text-sm font-semibold text-white">Add poll</button>
        <div className="space-y-3">
          {polls.map(p => (
            <PollCard key={p.id} poll={p} canVote={false}
              onEnd={() => call('admin_close_poll', { p_poll: p.id }, 'Poll ended')}
              onToggleBoard={() => call('admin_set_poll_hidden', { p_poll: p.id, p_hidden: !p.hidden }, p.hidden ? 'Poll is back on the board' : 'Poll removed from everyone’s board')} />
          ))}
        </div>
      </Sec>

      <Sec t={'Private inbox (' + inbox.length + ')'}>
        <ul className="space-y-2">
          {inbox.map(p => <li key={p.id} className="rounded-2xl bg-white/60 p-3 text-sm"><b>{p.alias}</b><p>{p.body}</p></li>)}
          {!inbox.length && <p className="text-sm text-ink/40">Nothing yet.</p>}
        </ul>
      </Sec>

      <Sec t="Storage">
        {usage ? (
          <>
            <Meter label="GIF / photo storage" value={mb(usage.media_bytes)} max={STORAGE_LIMIT_MB} text={mb(usage.media_bytes) + ' / ' + STORAGE_LIMIT_MB + ' MB'} />
            <Meter label="GIF / photo files" value={usage.media_files} max={MEDIA_FILES_WARN} text={usage.media_files + ' / ' + MEDIA_FILES_WARN} />
            <Meter label="Messages stored" value={usage.messages} max={MESSAGE_WARN} text={usage.messages + ' / ' + MESSAGE_WARN} />
            <p className="text-[11px] text-ink/40">You&apos;ll get a red alert at the top when one of these passes 80%. Delete old GIFs in Supabase → Storage → media.</p>
          </>
        ) : <p className="text-sm text-ink/40">Loading…</p>}
      </Sec>

      <Sec t={'Messages · most liked first (' + sorted.length + ')'}>
        <div className="mb-3 flex gap-2">
          <button onClick={delLast} disabled={!sorted.length} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-100 py-2 text-sm font-semibold text-red-600 disabled:opacity-40"><Trash2 size={15} />Delete last 5</button>
          <button onClick={delAll} disabled={!sorted.length} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-100 py-2 text-sm font-semibold text-red-600 disabled:opacity-40"><Trash2 size={15} />Delete all</button>
        </div>
        <ul className="space-y-2">
          {sorted.map(m => (
            <li key={m.id} className="flex items-center gap-2 rounded-2xl bg-white/60 p-3 text-sm">
              <span className={'grid h-9 w-9 shrink-0 place-items-center rounded-full font-semibold text-bubble-ink ' + pastelFor(m.id)}>{m.alias[0]}</span>
              <div className="min-w-0 flex-1"><b className="text-xs text-ink/50">{m.alias}</b>{m.body && <p className="break-words">{m.body}</p>}{m.media_url && <img src={m.media_url} alt="" className="mt-1 max-h-16 rounded-lg" />}</div>
              <button onClick={() => onLike(m)} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1.5 text-accent"><Heart size={15} />{m.likes}</button>
              <button onClick={() => call('admin_delete_message', { p_message: m.id }, 'Message deleted')} aria-label="Delete" className="rounded-full bg-white p-2 text-red-500"><Trash2 size={16} /></button>
              <button onClick={() => call('admin_kick', { p_guest: m.guest_id }, 'Guest kicked')} aria-label="Kick" className="rounded-full bg-white p-2 text-red-500"><Ban size={16} /></button>
            </li>
          ))}
          {!sorted.length && <p className="text-sm text-ink/40">No messages yet.</p>}
        </ul>
      </Sec>
    </div>
  );
}
