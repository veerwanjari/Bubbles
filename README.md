# Bubbles

Anonymous live moodboard: guests join with a link / QR code, post short messages (30 words max,
emoji, GIFs, photos) that float as pastel bubbles. The host runs the session, polls and moderation.
Next.js 14 (App Router) · Tailwind · Framer Motion · Supabase.

## 1. Run it on your computer

```bash
npm install
# open .env.local and paste your Supabase anon key (the URL is already filled in)
npm run dev          # http://localhost:3000
```

## 2. Set up Supabase (one time)

In your Supabase project open **SQL Editor → New query**, paste a file, click **Run**:

| Your situation | Run this file |
|---|---|
| Brand-new Supabase project | `supabase/01_full_setup.sql` |
| You already ran the earlier SQL (schema + patches 1–4) | `supabase/02_upgrade_existing.sql` |

Both are safe to run twice. Then in **Project Settings → API** copy the **Project URL** and the
**anon public** key into `.env.local`. (URL only: `https://xxxx.supabase.co`, no `/rest/v1`.)

## 3. Put it online (Vercel) so anyone can join

1. Push this folder to a GitHub repo (`.env.local` is git-ignored, so your keys stay private).
2. vercel.com → **Add New → Project** → import the repo.
3. **Settings → Environment Variables**: add `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and `NEXT_PUBLIC_GIPHY_KEY` if you want GIF search). Deploy.
4. Open your `https://….vercel.app` address, **Create session**, then in the **Chat** tab press **Start**.
5. Share the guest link or QR (Chat tab → *Invite guests* → **Share** / **WhatsApp** / **Copy link** / **Save QR**).

The QR code and every share button are for **guests**. The red *host login link* is private: opening
it on another device logs you in as host.

## Using it

**Guests** – a text bar at the bottom. Hold a bubble to expand it (tap again to close),
double-tap to like. Polls appear below the bubbles.
**Host** – two tabs. *Moodboard* is the same as guests see. *Chat* has: Start / Pause / End,
the "guests can like many times" switch (off by default), invite QR + sharing, polls (with two switches:
*multiple options* and *multiple votes*, both off by default), private inbox, storage meters, and the
message list (most liked first) with delete / kick, **Delete last 5** and **Delete all**.
After a poll ends you can **remove it from everyone's board**; it stays in your Chat tab.
Dark / light mode: the sun-moon switch at the top right.

## Limits, alerts and capacity

* GIF/photo upload limit is **25 MB** (`lib/limits.ts` and the bucket in the SQL).
* The host gets a red alert when GIF storage passes 80 % of `STORAGE_LIMIT_MB` (default 1024 = Supabase Free),
  or messages / GIF files pass `MESSAGE_WARN` / `MEDIA_FILES_WARN`. Delete old GIFs yourself in
  **Supabase → Storage → media**. Edit the numbers in `lib/limits.ts` if you upgrade your plan.
* Guests sync with one small request every ~2.5 s (a 60-byte "nothing changed" reply most of the time),
  backing off automatically if the server is slow. No realtime connection cap applies.
* GIFs picked from the in-app Giphy search are linked, not stored: they use none of your storage.

## Troubleshooting

* Page stuck on "Loading…": wrong/missing keys in `.env.local` (restart `npm run dev`), or the SQL wasn't run.
* Guests can't type: the session must be **live** (Chat tab → Start).
* Host controls say *forbidden*: this browser doesn't hold the host key. Use the host login link.
* A GIF upload fails: check the file is under 25 MB. If you still see a size error, also raise
  Supabase → Storage → Settings → *Upload file size limit*.

## Files

`app/` pages & styles · `components/` UI · `lib/` data sync (`room.ts`), text fitting (`fit.ts`),
limits & usage · `supabase/` SQL
