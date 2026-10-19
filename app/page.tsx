'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, MessageCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Msg, getGuest, useRoom } from '@/lib/room';
import { useUsage, usageWarnings } from '@/lib/usage';
import MoodboardView from '@/components/MoodboardView';
import BubbleModal from '@/components/BubbleModal';
import ComposeBar from '@/components/ComposeBar';
import AdminPanel from '@/components/AdminPanel';
import PollCard from '@/components/PollCard';

export default function Page() {
  return <Suspense><Home /></Suspense>;
}

function Home() {
  const code = useSearchParams().get('s');
  return code ? <Room code={code} /> : <Landing />;
}

function Landing() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const create = async () => {
    const { data, error } = await supabase.rpc('create_session', { p_title: title });
    if (error || !data) { setErr(error?.message ?? 'Could not create session'); return; }
    localStorage.setItem('admin:' + data.code, data.admin_key);
    router.push('/?s=' + data.code);
  };
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="glass-strong w-full max-w-sm space-y-4 rounded-[32px] p-6 text-center">
        <h1 className="font-display text-5xl font-bold uppercase">Bubbles</h1>
        <p className="text-sm text-ink/60">Anonymous, live, and a little floaty.</p>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Session title" className="w-full rounded-2xl bg-white/70 px-4 py-3 outline-none" />
        <button onClick={create} className="w-full rounded-2xl bg-accent py-3 font-semibold text-white">Create session</button>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </main>
  );
}

function Room({ code }: { code: string }) {
  const [guest, setGuest] = useState<{ id: string; alias: string } | null>(null);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [tab, setTab] = useState<'mood' | 'chat'>('mood');
  const [openId, setOpenId] = useState<string | null>(null);

  const adminParam = useSearchParams().get('admin');
  useEffect(() => {
    setGuest(getGuest());
    if (adminParam) {                       // host login link: /?s=CODE&admin=KEY
      localStorage.setItem('admin:' + code, adminParam);
      window.history.replaceState(null, '', '/?s=' + code);
    }
    setAdminKey(localStorage.getItem('admin:' + code));
  }, [code, adminParam]);
  const room = useRoom(code, guest?.id ?? '');
  const { usage, reload: reloadUsage } = useUsage(room.session?.id, adminKey);
  const warnings = usageWarnings(usage);

  // Stable callbacks (so bubbles never re-render needlessly) that always see fresh state.
  const likeRef = useRef<(id: string) => void>(() => {});
  likeRef.current = (id: string) => {
    if (adminKey) room.adminLike(id, adminKey);      // host: unlimited likes
    else if (room.live) room.like(id);               // guest: once per bubble unless the host allows more
  };
  const onLike = useCallback((m: Msg) => likeRef.current(m.id), []);
  const onOpen = useCallback((m: Msg) => setOpenId(m.id), []);

  const session = room.session;
  if (room.banned) return <main className="grid min-h-screen place-items-center p-6 text-center font-display text-3xl uppercase">You were removed from this session.</main>;
  if (room.missing) return <main className="grid min-h-screen place-items-center p-6 text-center"><div><p className="font-display text-3xl uppercase">Session not found</p><a href="/" className="mt-3 inline-block font-semibold text-accent">Start a new one</a></div></main>;
  if (!session || !guest) return <main className="grid min-h-screen place-items-center text-ink/40">Loading…</main>;

  const isAdmin = !!adminKey;
  const openMsg = room.messages.find(m => m.id === openId) ?? null;
  const hint = session.status === 'paused' ? 'Host paused sending' : session.status === 'ended' ? 'Session ended' : 'Waiting for host to start…';
  const tabs = [{ id: 'mood', label: 'Moodboard', Icon: Sparkles }, { id: 'chat', label: 'Chat', Icon: MessageCircle }] as const;
  const showMood = !isAdmin || tab === 'mood';
  const boardPolls = room.polls.filter(p => !p.hidden);      // "removed from board" polls stay in the host's Chat tab only

  return (
    <main className="min-h-screen">
      <header className="fixed inset-x-0 top-0 z-30 px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
        <div className="glass mr-[88px] flex items-center gap-2 rounded-full px-4 py-2">
          <span className="truncate font-semibold">{session.title}</span>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold uppercase text-accent">{session.status}</span>
        </div>
        {isAdmin && warnings.length > 0 && (
          <button onClick={() => setTab('chat')} className="mt-2 flex w-full items-start gap-2 rounded-2xl bg-red-100 p-2.5 text-left text-xs font-semibold text-red-700 shadow-lift">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{warnings[0]}</span>
          </button>
        )}
      </header>

      {showMood ? (
        <div className="pb-48">
          <div className={boardPolls.length ? 'min-h-[85vh]' : ''}>
            <MoodboardView messages={room.messages} onOpen={onOpen} onLike={onLike} />
          </div>
          {boardPolls.length > 0 && (
            <section className="mx-auto w-full max-w-md space-y-3 px-3 pt-2">
              {boardPolls.map(p => <PollCard key={p.id} poll={p} canVote={p.is_active && room.live} onVote={room.vote} />)}
            </section>
          )}
        </div>
      ) : (
        <AdminPanel session={session} adminKey={adminKey!} messages={room.messages} polls={room.polls} refresh={room.refresh} onLike={onLike}
          usage={usage} warnings={warnings} reloadUsage={reloadUsage} />
      )}

      {showMood && <ComposeBar canSend={room.live} hint={hint} lift={isAdmin} onSend={(b, media) => room.send(guest.alias, b, media)} onUpload={room.upload} />}

      <BubbleModal msg={openMsg} canPrivate={!isAdmin && session.status !== 'ended'} onClose={() => setOpenId(null)}
        onPrivate={(body, about) => room.privateMsg(guest.alias, body, about)} />

      {/* Liquid Glass pill nav: host only. Guests get the text bar instead. */}
      {isAdmin && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(env(safe-area-inset-bottom),16px)]">
          <div className="glass flex rounded-full p-1.5">
            {tabs.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={'relative flex w-28 flex-col items-center gap-0.5 rounded-full py-2 text-xs font-semibold ' + (tab === id ? 'text-accent' : 'text-ink')}>
                {tab === id && <motion.span layoutId="pill" className="absolute inset-0 rounded-full bg-white/80 shadow-lift" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
                <Icon size={24} className="relative" /><span className="relative">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </main>
  );
}
