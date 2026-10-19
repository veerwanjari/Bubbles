'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { MAX_UPLOAD, MAX_UPLOAD_MB } from './limits';

export type Msg = { id: string; guest_id: string; alias: string; body: string; media_url: string | null; created_at: string; likes: number };
export type Session = { id: string; code: string; title: string; status: 'lobby' | 'live' | 'paused' | 'ended'; multi_like: boolean };
export type Poll = {
  id: string; question: string; options: string[]; is_active: boolean; hidden: boolean;
  multi_option: boolean; multi_vote: boolean; created_at: string;
  counts: Record<string, number>;      // option index -> votes
  mine: number[];                      // option index of each vote I cast
};
type Snap = { session: Session | null; messages: Msg[]; myLikes: string[]; polls: Poll[] };
const EMPTY: Snap = { session: null, messages: [], myLikes: [], polls: [] };

export const MIN_BUBBLE = 76;
export const ALLOWED_MEDIA = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'];
const EXT: Record<string, string> = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const bubbleSize = (likes: number, maxSize: number) => Math.max(MIN_BUBBLE, Math.min(maxSize, 80 + 12 * likes));
const PASTELS = ['bg-pastel-mint', 'bg-pastel-lavender', 'bg-pastel-pink', 'bg-pastel-sky', 'bg-pastel-butter'];
export const pastelFor = (id: string) => {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return PASTELS[sum % 5];
};

// ---- text safety: never corrupt emoji ----
export const clean = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\r/g, '');
export const limitWords = (s: string, n: number) => { const w = s.trim().split(/\s+/); return w.length > n ? w.slice(0, n).join(' ') : s; };
export const sliceChars = (s: string, n: number) => Array.from(s).slice(0, n).join(''); // by code point, never splits an emoji
const EMO = new RegExp('(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)', 'gu');
// number of emoji if the text is ONLY emoji (so we can render them big), else 0
export function emojiCount(body: string) {
  const t = body.trim();
  if (!t) return 0;
  const m = t.match(EMO);
  if (!m) return 0;
  return t.replace(EMO, '').replace(/[\s\uFE0F\u200D]/g, '') ? 0 : m.length;
}
export const emojiScale = (n: number) => (n === 1 ? 0.52 : n === 2 ? 0.36 : n <= 4 ? 0.28 : 0.2);

// ---- GIF links (Giphy / Tenor keyboards often paste a link instead of a file) ----
// Must stay in sync with messages_media_url_check in the SQL.
export const HOTLINK = /^https:\/\/(media[0-9]*\.giphy\.com|i\.giphy\.com|media[0-9]*\.tenor\.com|c\.tenor\.com)\//i;
export function mediaFromText(text: string): string | null {
  let s = text.trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return null;
  s = s.replace(/^http:/i, 'https:');
  if (HOTLINK.test(s)) return s;
  try {
    const u = new URL(s);
    if (/(^|\.)giphy\.com$/i.test(u.hostname)) {          // a giphy.com/gifs/some-title-ID page link
      const m = u.pathname.match(/\/gifs\/(?:.*-)?([A-Za-z0-9]+)\/?$/);
      if (m) return 'https://media.giphy.com/media/' + m[1] + '/giphy.gif';
    }
  } catch { /* not a URL */ }
  return null;
}

// Friendlier text for database rejections
export function friendly(msg: string) {
  if (/row-level security|violates/i.test(msg)) return 'Not allowed right now (the session may be paused, or you hit a limit).';
  if (/too large|exceeded|size/i.test(msg)) return 'That file is too large.';
  return msg;
}

export const ANIMALS = [
  'Otter', 'Panda', 'Koala', 'Fox', 'Falcon', 'Heron', 'Lynx', 'Gecko', 'Parrot', 'Dolphin',
  'Penguin', 'Owl', 'Eagle', 'Sparrow', 'Robin', 'Finch', 'Swan', 'Crane', 'Pelican', 'Puffin',
  'Toucan', 'Flamingo', 'Peacock', 'Raven', 'Magpie', 'Kiwi', 'Lark', 'Wren', 'Hawk', 'Osprey',
  'Condor', 'Albatross', 'Stork', 'Ibis', 'Kingfisher', 'Hummingbird', 'Macaw', 'Starling', 'Swift', 'Cuckoo',
  'Tiger', 'Lion', 'Leopard', 'Cheetah', 'Jaguar', 'Panther', 'Wolf', 'Bear', 'Moose', 'Elk',
  'Deer', 'Bison', 'Zebra', 'Giraffe', 'Rhino', 'Hippo', 'Elephant', 'Camel', 'Llama', 'Alpaca',
  'Goat', 'Rabbit', 'Hare', 'Squirrel', 'Chipmunk', 'Hedgehog', 'Badger', 'Beaver', 'Raccoon', 'Meerkat',
  'Lemur', 'Monkey', 'Gibbon', 'Orangutan', 'Sloth', 'Armadillo', 'Platypus', 'Wombat', 'Kangaroo', 'Wallaby',
  'Turtle', 'Tortoise', 'Iguana', 'Chameleon', 'Frog', 'Newt', 'Salamander', 'Seal', 'Walrus', 'Narwhal',
  'Orca', 'Whale', 'Manatee', 'Octopus', 'Seahorse', 'Starfish', 'Pangolin', 'Capybara', 'Quokka', 'Ocelot',
];

export function getGuest() {
  let id = localStorage.getItem('guest_id');
  let alias = localStorage.getItem('alias_v2');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('guest_id', id); }
  if (!alias || !ANIMALS.includes(alias)) {          // also replaces old two-word aliases
    alias = ANIMALS[(Math.random() * ANIMALS.length) | 0];
    localStorage.setItem('alias_v2', alias);
  }
  return { id, alias };
}

// State that only changes when the data really changed -> no re-render, no flicker.
function useStable<T>(init: T) {
  const [v, setV] = useState<T>(init);
  const cur = useRef<T>(init);
  const sig = useRef(JSON.stringify(init));
  const set = useCallback((n: T | ((p: T) => T)) => {
    const nv = typeof n === 'function' ? (n as (p: T) => T)(cur.current) : n;
    const s = JSON.stringify(nv);
    if (s !== sig.current) { sig.current = s; cur.current = nv; setV(nv); }
  }, []);
  return [v, set] as const;
}

const BASE_MS = 2500, MAX_MS = 10000;   // polling speed: starts at 2.5 s and backs off if the server is slow

type RawPoll = Partial<Poll> & { id: string };
const normPoll = (p: RawPoll): Poll => ({
  id: p.id, question: p.question ?? '', options: Array.isArray(p.options) ? p.options : [],
  is_active: !!p.is_active, hidden: !!p.hidden, multi_option: !!p.multi_option, multi_vote: !!p.multi_vote,
  created_at: p.created_at ?? '', counts: p.counts ?? {}, mine: Array.isArray(p.mine) ? p.mine : [],
});

export function useRoom(code: string, guestId: string) {
  const [snap, setSnap] = useStable<Snap>(EMPTY);
  const [banned, setBanned] = useState(false);
  const [missing, setMissing] = useState(false);
  const etag = useRef<string | null>(null);
  const busy = useRef(false);
  const queued = useRef(false);
  const delay = useRef(BASE_MS);
  const refreshRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const later = useRef<ReturnType<typeof setTimeout>>();

  // One small request returns everything. If nothing changed the server answers "unchanged" (~60 bytes).
  const refresh = useCallback(async (force = false) => {
    if (!guestId) return;
    if (busy.current) { queued.current = queued.current || force; return; }
    busy.current = true;
    if (force) etag.current = null;
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.rpc('room_snapshot', { p_code: code, p_guest: guestId, p_etag: etag.current });
      if (error) throw error;
      if (!data) setMissing(true);
      else {
        setMissing(false);
        etag.current = data.etag;
        if (!data.unchanged) {
          setSnap({ session: data.session, messages: data.messages ?? [], myLikes: data.my_likes ?? [], polls: (data.polls ?? []).map(normPoll) });
          if (data.banned) localStorage.setItem('ban:' + code, '1');
          setBanned(!!data.banned || localStorage.getItem('ban:' + code) === '1');
        }
      }
      const took = performance.now() - t0;           // be gentle with a busy server
      delay.current = took > 700 ? Math.min(MAX_MS, delay.current * 1.5) : took < 250 ? Math.max(BASE_MS, delay.current / 1.2) : delay.current;
    } catch { delay.current = Math.min(MAX_MS, delay.current * 1.5); }
    finally {
      busy.current = false;
      if (queued.current) { queued.current = false; setTimeout(() => refreshRef.current(true), 0); }
    }
  }, [code, guestId, setSnap]);
  refreshRef.current = refresh;

  // after my own action: re-sync shortly (batches rapid taps into one request)
  const resync = () => { clearTimeout(later.current); later.current = setTimeout(() => refreshRef.current(true), 450); };

  useEffect(() => {
    if (!guestId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (!alive) return;
      if (!document.hidden) await refreshRef.current();
      if (alive) timer = setTimeout(loop, delay.current * (0.85 + Math.random() * 0.3));
    };
    loop();
    const vis = () => { if (!document.hidden) refreshRef.current(); };
    document.addEventListener('visibilitychange', vis);

    // Optional instant updates (NEXT_PUBLIC_REALTIME=1). Fine for small groups; on the Free plan
    // Supabase caps realtime at 200 connections / 100 messages per second, so it is OFF by default.
    let ch: ReturnType<typeof supabase.channel> | undefined;
    if (process.env.NEXT_PUBLIC_REALTIME === '1') {
      let pending = false;
      const kick = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; refreshRef.current(); }, 300 + Math.random() * 1200); };
      ch = supabase.channel('room-' + code).on('postgres_changes', { event: '*', schema: 'public' }, kick).subscribe();
    }
    return () => { alive = false; clearTimeout(timer); clearTimeout(later.current); document.removeEventListener('visibilitychange', vis); if (ch) supabase.removeChannel(ch); };
  }, [code, guestId]);

  const { session, messages, myLikes: likeIds, polls } = snap;
  const myLikes = useMemo(() => new Set(likeIds), [likeIds]);

  const bump = (id: string) => setSnap(p => ({
    ...p,
    messages: p.messages.map(m => (m.id === id ? { ...m, likes: m.likes + 1 } : m)),
    myLikes: p.myLikes.includes(id) ? p.myLikes : [...p.myLikes, id],
  }));

  const send = async (alias: string, body: string, media: string | null): Promise<string | null> => {
    if (!session) return 'Not ready yet';
    const r = await supabase.from('messages').insert({ session_id: session.id, guest_id: guestId, alias, body, media_url: media });
    refreshRef.current(true);
    return r.error ? friendly(r.error.message) : null;
  };
  const like = async (id: string) => {
    if (!session) return;
    if (!session.multi_like && myLikes.has(id)) return;           // host decides if repeat likes are allowed
    bump(id);
    const { error } = await supabase.from('likes').insert({ session_id: session.id, message_id: id, guest_id: guestId });
    if (error) refreshRef.current(true); else resync();
  };
  const adminLike = async (id: string, key: string): Promise<string | null> => {
    if (!session) return 'Not ready yet';
    bump(id);
    const { error } = await supabase.rpc('admin_like', { p_session: session.id, p_key: key, p_message: id });
    if (error) { refreshRef.current(true); return error.message; }
    resync();
    return null;
  };
  const vote = async (pollId: string, idx: number): Promise<string | null> => {
    if (!session) return 'Not ready yet';
    setSnap(p => ({
      ...p,
      polls: p.polls.map(x => (x.id !== pollId ? x : { ...x, counts: { ...x.counts, [idx]: (x.counts[idx] ?? 0) + 1 }, mine: [...x.mine, idx] })),
    }));
    const { error } = await supabase.from('poll_votes').insert({ poll_id: pollId, session_id: session.id, guest_id: guestId, option_idx: idx });
    if (error) { refreshRef.current(true); return friendly(error.message); }
    resync();
    return null;
  };
  const privateMsg = async (alias: string, body: string, about: string): Promise<string | null> => {
    if (!session) return 'Not ready yet';
    const r = await supabase.from('private_messages').insert({ session_id: session.id, guest_id: guestId, alias, body, about_message_id: about });
    return r.error ? friendly(r.error.message) : null;
  };
  const upload = async (file: File): Promise<{ url: string | null; error: string | null }> => {
    if (!session) return { url: null, error: 'Not ready yet' };
    if (!ALLOWED_MEDIA.includes(file.type)) return { url: null, error: 'Only GIF, PNG, JPG or WebP images' };
    if (file.size > MAX_UPLOAD) return { url: null, error: 'File too large (max ' + MAX_UPLOAD_MB + ' MB)' };
    const path = session.id + '/' + crypto.randomUUID() + '.' + EXT[file.type];
    const { error } = await supabase.storage.from('media').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) return { url: null, error: friendly(error.message) };
    return { url: supabase.storage.from('media').getPublicUrl(path).data.publicUrl, error: null };
  };

  return {
    session, messages, myLikes, polls, banned, missing, live: session?.status === 'live',
    refresh: () => refreshRef.current(true), send, like, adminLike, vote, privateMsg, upload,
  };
}
