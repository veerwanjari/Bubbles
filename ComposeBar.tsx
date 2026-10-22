'use client';
import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, ImagePlus, Send, X, Loader2, Film } from 'lucide-react';
import { ALLOWED_MEDIA, clean, limitWords, mediaFromText, wordCount } from '@/lib/room';
import { MAX_UPLOAD, MAX_UPLOAD_MB } from '@/lib/limits';

const LIMIT = 30;
const GIPHY = process.env.NEXT_PUBLIC_GIPHY_KEY;

type Props = {
  canSend: boolean; hint: string; lift?: boolean;
  onSend: (body: string, media: string | null) => Promise<string | null>;
  onUpload: (file: File) => Promise<{ url: string | null; error: string | null }>;
};

type Gif = { id: string; url: string; thumb: string };

// Keyboards sometimes give no mime type: look at the first bytes instead.
async function sniff(b: Blob): Promise<string> {
  if (ALLOWED_MEDIA.includes(b.type)) return b.type;
  try {
    const u = new Uint8Array(await b.slice(0, 12).arrayBuffer());
    const s = String.fromCharCode(...Array.from(u));
    if (s.startsWith('GIF8')) return 'image/gif';
    if (u[0] === 0x89 && s.slice(1, 4) === 'PNG') return 'image/png';
    if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';
    if (s.slice(0, 4) === 'RIFF' && s.slice(8, 12) === 'WEBP') return 'image/webp';
  } catch { /* ignore */ }
  return b.type;
}

// Pull an image (file, <img> src or link) out of any DataTransfer: paste, drop or keyboard commit.
function imageFrom(dt: DataTransfer | null | undefined): { file?: Blob; src?: string } {
  if (!dt) return {};
  const f = Array.from(dt.files || []).find(x => x.type.startsWith('image/') || x.type === '' );
  if (f) return { file: f };
  for (const it of Array.from(dt.items || [])) {
    if (it.kind === 'file' && (it.type.startsWith('image/') || it.type === '')) { const g = it.getAsFile(); if (g) return { file: g }; }
  }
  const html = dt.getData('text/html');
  const m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) return { src: m[1] };
  const uri = (dt.getData('text/uri-list') || '').split('\n').find(x => /^https?:/i.test(x.trim()));
  if (uri) return { src: uri.trim() };
  return {};
}

// The input is a contenteditable (not a <textarea>): phone keyboards (Gboard, Samsung, Giphy, Tenor...) can
// only push GIFs/stickers into a contenteditable. We accept them as files, <img> tags, links or drag-drop.
export default function ComposeBar({ canSend, hint, lift, onSend, onUpload }: Props) {
  const ed = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picker, setPicker] = useState(false);
  const n = wordCount(text);

  const attach = async (blob: Blob) => {
    const type = await sniff(blob);
    if (!ALLOWED_MEDIA.includes(type)) { setErr('Only GIF, PNG, JPG or WebP images'); return; }
    if (blob.size > MAX_UPLOAD) { setErr('File too large (max ' + MAX_UPLOAD_MB + ' MB)'); return; }
    const file = blob instanceof File && blob.type === type ? blob : new File([blob], 'keyboard', { type });
    setBusy(true); setErr('');
    const r = await onUpload(file);
    setBusy(false);
    if (r.error) setErr(r.error); else setMedia(r.url);
  };
  const attachRef = useRef(attach);
  attachRef.current = attach;

  // an image source from a keyboard / clipboard: a GIF link is used directly, anything else is fetched and uploaded
  const fromSrc = async (src: string) => {
    const link = mediaFromText(src);
    if (link) { setMedia(link); setErr(''); return; }
    try {
      const b = await (await fetch(src)).blob();
      await attachRef.current(b);
    } catch { setErr('Could not read that GIF/sticker. Tap the image button to pick it from your gallery instead.'); }
  };
  const fromSrcRef = useRef(fromSrc);
  fromSrcRef.current = fromSrc;

  const takeDT = (dt: DataTransfer | null | undefined): boolean => {
    const got = imageFrom(dt);
    if (got.file) { attachRef.current(got.file); return true; }
    if (got.src) { fromSrcRef.current(got.src); return true; }
    return false;
  };

  // Keyboard GIF / sticker commits arrive in different ways depending on the keyboard + browser.
  // Catch every one of them: beforeinput (files), paste, drop, an <img> appearing in the box.
  useEffect(() => {
    const el = ed.current;
    if (!el) return;
    const sweep = () => {
      const imgs = Array.from(el.querySelectorAll('img'));
      if (!imgs.length) return false;
      const src = imgs[0].getAttribute('src') || '';
      imgs.forEach(i => i.remove());
      if (src) fromSrcRef.current(src);
      return true;
    };
    const before = (e: Event) => {
      const ie = e as InputEvent;
      if (ie.dataTransfer && takeDT(ie.dataTransfer)) e.preventDefault();
    };
    const paste = (e: Event) => {
      const ce = e as ClipboardEvent;
      if (takeDT(ce.clipboardData)) e.preventDefault();
    };
    const mo = new MutationObserver(() => { sweep(); });
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener('beforeinput', before);
    el.addEventListener('paste', paste, true);
    return () => { mo.disconnect(); el.removeEventListener('beforeinput', before); el.removeEventListener('paste', paste, true); };
  }, [canSend]);

  const caretEnd = (el: HTMLElement) => {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
  };

  const onInput = () => {
    const el = ed.current; if (!el) return;
    const imgs = Array.from(el.querySelectorAll('img'));      // a keyboard GIF/sticker can arrive as <img>
    if (imgs.length) {
      const src = imgs[0].getAttribute('src') || '';
      imgs.forEach(i => i.remove());
      if (src) fromSrcRef.current(src);
    }
    let t = clean(el.innerText);
    const link = mediaFromText(t);                            // Giphy/Tenor keyboards sometimes insert just a link
    if (link) { setMedia(link); setErr(''); el.innerHTML = ''; setText(''); return; }
    const lim = limitWords(t, LIMIT);                          // strict 30-word cap
    if (lim !== t) { el.innerText = lim; caretEnd(el); t = lim; }
    if (!t.trim()) el.innerHTML = '';
    setText(t);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const cd = e.clipboardData;
    if (takeDT(cd)) return;
    const txt = clean(cd.getData('text/plain'));
    const link = mediaFromText(txt);
    if (link) { setMedia(link); setErr(''); return; }
    document.execCommand('insertText', false, txt);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => { if (takeDT(e.dataTransfer)) e.preventDefault(); };

  // Button fallback: read whatever GIF/sticker/image is on the clipboard (e.g. copied from the keyboard's clipboard tab)
  const pasteBtn = async () => {
    setErr('');
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find(x => x.startsWith('image/'));
        if (t) { await attach(await it.getType(t)); return; }
      }
      const txt = await navigator.clipboard.readText();
      const link = mediaFromText(txt);
      if (link) { setMedia(link); return; }
      setErr('No GIF or sticker found on the clipboard.');
    } catch { setErr('Could not read the clipboard. Long-press the message box and choose Paste.'); }
  };

  const submit = async () => {
    const body = text.trim();
    if ((!body && !media) || !canSend || busy) return;
    const e = await onSend(body, media);
    if (e) { setErr(e); return; }
    setErr(''); setText(''); setMedia(null); setPicker(false);
    if (ed.current) ed.current.innerHTML = '';
  };

  return (
    <div className={'fixed inset-x-0 z-40 mx-auto max-w-2xl px-3 ' + (lift ? 'bottom-[calc(env(safe-area-inset-bottom)+92px)]' : 'bottom-[max(env(safe-area-inset-bottom),12px)]')}>
      {picker && GIPHY && <GifPicker onPick={url => { setMedia(url); setPicker(false); setErr(''); }} />}
      {(media || busy) && (
        <div className="relative mb-2 inline-block">
          {busy ? <div className="grid h-16 w-16 place-items-center rounded-xl bg-white/70"><Loader2 className="animate-spin" size={20} /></div>
            : <><img src={media!} alt="" className="h-20 rounded-xl" /><button onClick={() => setMedia(null)} aria-label="Remove" className="keep-white absolute -right-2 -top-2 rounded-full bg-white p-0.5 text-bubble-ink shadow"><X size={14} /></button></>}
        </div>
      )}
      {err && <p className="mb-1 rounded-xl bg-red-100 px-3 py-1 text-xs text-red-700">{err}</p>}
      <div className="glass-strong flex items-end gap-1 rounded-[28px] p-2">
        <button onClick={() => fileRef.current?.click()} aria-label="Attach a GIF or photo" className="p-2 text-ink/60"><ImagePlus size={22} /></button>
        <button onClick={pasteBtn} aria-label="Paste GIF or sticker from clipboard" className="p-2 text-ink/60"><ClipboardPaste size={22} /></button>
        {GIPHY && <button onClick={() => setPicker(p => !p)} aria-label="Search GIFs" className={'p-2 ' + (picker ? 'text-accent' : 'text-ink/60')}><Film size={22} /></button>}
        <input ref={fileRef} type="file" accept="image/gif,image/png,image/jpeg,image/webp" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ''; }} />
        <div ref={ed} contentEditable={canSend} suppressContentEditableWarning role="textbox" aria-label="Message" aria-multiline="true"
          data-placeholder={canSend ? 'Say something…' : hint}
          onInput={onInput} onPaste={onPaste} onDrop={onDrop} onDragOver={e => e.preventDefault()}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="editable max-h-28 min-h-[24px] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words py-2 text-[15px] outline-none" />
        <span className={'pb-3 text-xs tabular-nums ' + (n >= 28 ? 'text-red-500' : 'text-ink/40')}>{n}/{LIMIT}</span>
        <button onClick={submit} disabled={!canSend || busy || (!n && !media)} aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white disabled:opacity-30"><Send size={18} /></button>
      </div>
    </div>
  );
}

// In-app GIF search (Giphy). GIFs are linked, not stored, so they cost you no storage.
function GifPicker({ onPick }: { onPick: (url: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Gif[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const base = q.trim() ? 'https://api.giphy.com/v1/gifs/search?q=' + encodeURIComponent(q.trim()) + '&' : 'https://api.giphy.com/v1/gifs/trending?';
        const j = await (await fetch(base + 'api_key=' + GIPHY + '&limit=24&rating=g')).json();
        setItems((j.data || []).map((g: { id: string; images: Record<string, { url: string }> }) => ({
          id: g.id, url: (g.images.downsized_medium || g.images.fixed_height).url, thumb: g.images.fixed_height_small.url,
        })));
      } catch { setItems([]); }
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="glass mb-2 rounded-2xl p-2">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search GIFs…" className="mb-2 w-full rounded-xl bg-white/60 px-3 py-2 text-sm outline-none" />
      <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto">
        {items.map(g => <img key={g.id} src={g.thumb} alt="" onClick={() => onPick(g.url)} className="h-24 w-full cursor-pointer rounded-lg object-cover" />)}
        {!items.length && <p className="col-span-3 p-3 text-center text-xs text-ink/40">Loading…</p>}
      </div>
      <p className="mt-1 text-center text-[10px] text-ink/30">Powered by GIPHY</p>
    </div>
  );
}
