-- ============================================================================
-- Bubbles · FULL SETUP for a brand-new Supabase project.
-- Paste the whole file into Supabase -> SQL Editor and click Run (once).
-- Already ran the older SQL files?  Use 02_upgrade_existing.sql instead.
-- ============================================================================


-- >>>>>>>>>> schema.sql: tables, security rules, host functions (original)
create extension if not exists pgcrypto;

-- ───────── Tables ─────────
create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null default 'Untitled session',
  status text not null default 'lobby' check (status in ('lobby','live','paused','ended')),
  created_at timestamptz not null default now()
);
create table session_secrets (          -- never readable by clients
  session_id uuid primary key references sessions on delete cascade,
  admin_key text not null
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  guest_id text not null,
  alias text not null,
  body text not null check (char_length(body) between 1 and 400
        and cardinality(regexp_split_to_array(trim(body), '\s+')) <= 30),   -- 30-word cap, enforced in DB
  media_url text,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index on messages (session_id, created_at);
create table likes (
  session_id uuid not null references sessions on delete cascade,
  message_id uuid not null references messages on delete cascade,
  guest_id text not null,
  primary key (message_id, guest_id)
);
create table polls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  question text not null,
  options jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table poll_votes (
  poll_id uuid not null references polls on delete cascade,
  session_id uuid not null references sessions on delete cascade,
  guest_id text not null,
  option_idx int not null,
  primary key (poll_id, guest_id)
);
create table private_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  guest_id text not null,
  alias text not null,
  body text not null check (char_length(body) between 1 and 500),
  about_message_id uuid references messages on delete set null,
  created_at timestamptz not null default now()
);
create table bans (
  session_id uuid not null references sessions on delete cascade,
  guest_id text not null,
  primary key (session_id, guest_id)
);

-- ───────── Row Level Security ─────────
alter table sessions enable row level security;
alter table session_secrets enable row level security;
alter table messages enable row level security;
alter table likes enable row level security;
alter table polls enable row level security;
alter table poll_votes enable row level security;
alter table private_messages enable row level security;
alter table bans enable row level security;

do $$ declare t text; begin
  foreach t in array array['sessions','messages','likes','polls','poll_votes','bans'] loop
    execute format('create policy "read %1$s" on %1$I for select using (true)', t);
  end loop;
end $$;

create function can_post(sid uuid, gid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sessions where id = sid and status = 'live')
     and not exists (select 1 from bans where session_id = sid and guest_id = gid)
$$;

create policy "guest post" on messages for insert with check (can_post(session_id, guest_id) and deleted = false);
create policy "guest like" on likes for insert with check (can_post(session_id, guest_id));
create policy "guest vote" on poll_votes for insert with check (can_post(session_id, guest_id));
create policy "guest private" on private_messages for insert
  with check (not exists (select 1 from bans b where b.session_id = private_messages.session_id and b.guest_id = private_messages.guest_id));
-- private_messages / session_secrets have no SELECT policy: only the RPCs below can read them.

-- ───────── Admin RPCs (key-checked, security definer) ─────────
create function create_session(p_title text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s sessions; k text := encode(gen_random_bytes(16), 'hex');
begin
  insert into sessions (code, title)
  values (substr(md5(random()::text || clock_timestamp()::text), 1, 6), coalesce(nullif(trim(p_title), ''), 'Untitled session'))
  returning * into s;
  insert into session_secrets values (s.id, k);
  return json_build_object('code', s.code, 'admin_key', k);
end $$;

create function admin_verify(p_session uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from session_secrets where session_id = p_session and admin_key = p_key)
$$;

create function admin_set_status(p_session uuid, p_key text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  update sessions set status = p_status where id = p_session;
end $$;

create function admin_delete_message(p_session uuid, p_key text, p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  update messages set deleted = true where id = p_message and session_id = p_session;
end $$;

create function admin_kick(p_session uuid, p_key text, p_guest text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  insert into bans values (p_session, p_guest) on conflict do nothing;
  update messages set deleted = true where session_id = p_session and guest_id = p_guest;
end $$;

create function admin_create_poll(p_session uuid, p_key text, p_question text, p_options jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  update polls set is_active = false where session_id = p_session and is_active;
  insert into polls (session_id, question, options) values (p_session, p_question, p_options);
end $$;

create function admin_close_poll(p_session uuid, p_key text, p_poll uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  update polls set is_active = false where id = p_poll and session_id = p_session;
end $$;

create function admin_private_inbox(p_session uuid, p_key text) returns setof private_messages
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  return query select * from private_messages where session_id = p_session order by created_at desc;
end $$;

-- ───────── Realtime ─────────
alter publication supabase_realtime add table sessions, messages, likes, polls, poll_votes, bans;


-- >>>>>>>>>> patch.sql: multiple polls, end poll, host likes
-- Run once in Supabase → SQL Editor. Safe to re-run.

-- Multiple polls can now be active at once (no longer deactivates the others)
create or replace function admin_create_poll(p_session uuid, p_key text, p_question text, p_options jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  insert into polls (session_id, question, options) values (p_session, p_question, p_options);
end $$;

-- End one specific poll
create or replace function admin_close_poll(p_session uuid, p_key text, p_poll uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  update polls set is_active = false where id = p_poll and session_id = p_session;
end $$;

-- Unlimited host likes
create or replace function admin_like(p_session uuid, p_key text, p_message uuid) returns text
language plpgsql security definer set search_path = public as $$
declare g text := 'admin-' || gen_random_uuid()::text;
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  insert into likes (session_id, message_id, guest_id) values (p_session, p_message, g);
  return g;
end $$;

-- Make sure realtime is on (ignore "already member" errors)
do $$ begin
  begin alter publication supabase_realtime add table sessions; exception when others then null; end;
  begin alter publication supabase_realtime add table messages; exception when others then null; end;
  begin alter publication supabase_realtime add table likes; exception when others then null; end;
  begin alter publication supabase_realtime add table polls; exception when others then null; end;
  begin alter publication supabase_realtime add table poll_votes; exception when others then null; end;
  begin alter publication supabase_realtime add table bans; exception when others then null; end;
end $$;


-- >>>>>>>>>> patch2.sql: media bucket + GIF uploads
-- Run once in Supabase → SQL Editor (after patch.sql). Safe to re-run.

-- 1) Messages can be media-only (empty text + a GIF/photo)
alter table messages drop constraint if exists messages_body_check;
alter table messages add constraint messages_body_check
  check (char_length(body) <= 400 and cardinality(regexp_split_to_array(trim(body), '\s+')) <= 30);
alter table messages drop constraint if exists messages_has_content;
alter table messages add constraint messages_has_content
  check (char_length(trim(body)) > 0 or media_url is not null);
-- media must come from our own storage bucket (applies to new rows only)
alter table messages drop constraint if exists messages_media_url_check;
alter table messages add constraint messages_media_url_check
  check (media_url is null or media_url like '%/storage/v1/object/public/media/%') not valid;

-- 2) Public storage bucket for GIFs / photos (3 MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 3145728, array['image/gif','image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 3145728, allowed_mime_types = excluded.allowed_mime_types;

-- Guests may upload only into the folder of a LIVE session
drop policy if exists "media upload" on storage.objects;
create policy "media upload" on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'media'
  and exists (select 1 from public.sessions s
              where s.id::text = (storage.foldername(name))[1] and s.status = 'live')
);


-- >>>>>>>>>> patch4.sql: repeat votes
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- Lets a guest vote repeatedly (every tap is a vote) by replacing the
-- one-vote-per-guest primary key with a row id.

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'poll_votes' and column_name = 'id') then
    alter table public.poll_votes add column id uuid not null default gen_random_uuid();
  end if;
end $$;

alter table public.poll_votes drop constraint if exists poll_votes_pkey;
alter table public.poll_votes add primary key (id);
create index if not exists poll_votes_poll_idx on public.poll_votes (poll_id);


-- >>>>>>>>>> 02_upgrade_existing.sql: all newer features
-- ============================================================================
-- Bubbles · UPGRADE for a project that already ran schema.sql + patch.sql +
-- patch2.sql + patch4.sql.  Run once in Supabase -> SQL Editor.  Safe to re-run.
-- (Starting from an empty project?  Run 01_full_setup.sql instead.)
-- ============================================================================

-- ── new columns ─────────────────────────────────────────────────────────────
alter table public.sessions add column if not exists multi_like   boolean not null default false;
alter table public.polls    add column if not exists multi_option boolean not null default false;
alter table public.polls    add column if not exists multi_vote   boolean not null default false;
alter table public.polls    add column if not exists hidden       boolean not null default false;

-- likes may repeat when the host switches "multiple likes" on
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'likes' and column_name = 'id') then
    alter table public.likes add column id uuid not null default gen_random_uuid();
  end if;
end $$;
alter table public.likes drop constraint if exists likes_pkey;
alter table public.likes add primary key (id);

create index if not exists likes_message_idx          on public.likes (message_id);
create index if not exists likes_session_guest_idx    on public.likes (session_id, guest_id);
create index if not exists poll_votes_poll_guest_idx  on public.poll_votes (poll_id, guest_id);
create index if not exists polls_session_idx          on public.polls (session_id);

-- ── GIFs: our own bucket (25 MB) or hot-linked Giphy / Tenor ────────────────
alter table public.messages drop constraint if exists messages_media_url_check;
alter table public.messages add constraint messages_media_url_check check (
  media_url is null
  or media_url like '%/storage/v1/object/public/media/%'
  or media_url ~* '^https://(media[0-9]*\.giphy\.com|i\.giphy\.com|media[0-9]*\.tenor\.com|c\.tenor\.com)/'
) not valid;

update storage.buckets set file_size_limit = 26214400 where id = 'media';   -- 25 MB

-- ── like rules: one per guest unless the host allows more ───────────────────
create or replace function public.can_like(sid uuid, mid uuid, gid text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_post(sid, gid) then return false; end if;
  if not exists (select 1 from messages where id = mid and session_id = sid) then return false; end if;
  perform pg_advisory_xact_lock(hashtext(mid::text || gid));          -- stops double-tap races
  if (select multi_like from sessions where id = sid) then return true; end if;
  return not exists (select 1 from likes where message_id = mid and guest_id = gid);
end $$;

drop policy if exists "guest like" on public.likes;
create policy "guest like" on public.likes for insert
  with check (public.can_like(session_id, message_id, guest_id));

-- ── vote rules: depends on the two poll toggles ─────────────────────────────
--   multi_option = false, multi_vote = false : one vote, one option
--   multi_option = true,  multi_vote = false : one vote per option, several options
--   multi_option = true,  multi_vote = true  : any number of votes on any options
--   multi_option = false, multi_vote = true  : one option, repeated votes
create or replace function public.can_vote(pid uuid, sid uuid, gid text, idx int) returns boolean
language plpgsql security definer set search_path = public as $$
declare p polls; on_opt int; opts int;
begin
  select * into p from polls where id = pid and session_id = sid and is_active;
  if not found then return false; end if;
  if idx < 0 or idx >= jsonb_array_length(p.options) then return false; end if;
  if not public.can_post(sid, gid) then return false; end if;
  perform pg_advisory_xact_lock(hashtext(pid::text || gid));
  select count(*) filter (where option_idx = idx), count(distinct option_idx)
    into on_opt, opts from poll_votes where poll_id = pid and guest_id = gid;
  if not p.multi_vote and on_opt > 0 then return false; end if;
  if not p.multi_option and opts > 0 and on_opt = 0 then return false; end if;
  return true;
end $$;

drop policy if exists "guest vote" on public.poll_votes;
create policy "guest vote" on public.poll_votes for insert
  with check (public.can_vote(poll_id, session_id, guest_id, option_idx));

-- ── take a vote back (the guest taps their vote again / the "−" button) ─────
create or replace function public.remove_vote(p_poll uuid, p_guest text, p_option int) returns void
language plpgsql security definer set search_path = public as $$
declare sid uuid; vid uuid;
begin
  select session_id into sid from polls where id = p_poll and is_active;
  if sid is null then raise exception 'This poll has ended'; end if;
  if not public.can_post(sid, p_guest) then raise exception 'not allowed'; end if;   -- session live, guest not kicked
  perform pg_advisory_xact_lock(hashtext(p_poll::text || p_guest));
  select id into vid from poll_votes where poll_id = p_poll and guest_id = p_guest and option_idx = p_option limit 1;
  if vid is not null then delete from poll_votes where id = vid; end if;
end $$;

-- ── host tools ──────────────────────────────────────────────────────────────
drop function if exists public.admin_create_poll(uuid, text, text, jsonb);
create or replace function public.admin_create_poll(
  p_session uuid, p_key text, p_question text, p_options jsonb,
  p_multi_option boolean default false, p_multi_vote boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  insert into polls (session_id, question, options, multi_option, multi_vote)
  values (p_session, p_question, p_options, coalesce(p_multi_option, false), coalesce(p_multi_vote, false));
end $$;

create or replace function public.admin_set_poll_hidden(p_session uuid, p_key text, p_poll uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  update polls set hidden = p_hidden where id = p_poll and session_id = p_session;
end $$;

create or replace function public.admin_set_multi_like(p_session uuid, p_key text, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  update sessions set multi_like = p_value where id = p_session;
end $$;

-- delete one message for good (its likes go with it)
create or replace function public.admin_delete_message(p_session uuid, p_key text, p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  delete from messages where id = p_message and session_id = p_session;
end $$;

-- p_mode = 'last' (newest p_n messages) or 'all'
create or replace function public.admin_delete_messages(p_session uuid, p_key text, p_mode text, p_n int default 5) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  if p_mode = 'all' then
    delete from messages where session_id = p_session;
  elsif p_mode = 'last' then
    delete from messages where id in (
      select id from messages where session_id = p_session order by created_at desc limit greatest(coalesce(p_n, 5), 0));
  else
    raise exception 'bad mode';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- storage / message counters for the host's "running out of space" alert
create or replace function public.admin_usage(p_session uuid, p_key text) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not admin_verify(p_session, p_key) then raise exception 'forbidden'; end if;
  return json_build_object(
    'messages',    (select count(*) from messages),
    'media_files', (select count(*) from storage.objects where bucket_id = 'media'),
    'media_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'media'));
end $$;

create index if not exists poll_votes_session_idx on public.poll_votes (session_id);

-- ── ONE request that returns everything a client needs ──────────────────────
-- p_etag: the token the client got last time. If nothing changed we answer with
-- a ~60-byte {"unchanged":true} instead of the whole room -> much less load.
drop function if exists public.room_snapshot(text, text);
create or replace function public.room_snapshot(p_code text, p_guest text, p_etag text default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare s sessions; tag text;
begin
  select * into s from sessions where code = p_code;
  if not found then return null; end if;
  tag := md5(concat_ws('|', s.status, s.multi_like::text, s.title,
    (select count(*)::text || ':' || coalesce(max(created_at)::text, '') from messages where session_id = s.id and not deleted),
    (select count(*)::text from likes where session_id = s.id),
    (select coalesce(md5(string_agg(id::text || is_active::text || hidden::text || multi_option::text || multi_vote::text, ',' order by id)), '') from polls where session_id = s.id),
    (select count(*)::text from poll_votes where session_id = s.id),
    (select count(*)::text from bans where session_id = s.id and guest_id = p_guest)));
  if p_etag is not null and p_etag = tag then
    return json_build_object('etag', tag, 'unchanged', true);
  end if;
  return json_build_object(
    'etag', tag,
    'session', to_json(s),
    'banned',  exists (select 1 from bans where session_id = s.id and guest_id = p_guest),
    'messages', coalesce((
      select json_agg(x order by x.created_at)
      from (select m.id, m.guest_id, m.alias, m.body, m.media_url, m.created_at,
                   (select count(*) from likes l where l.message_id = m.id)::int as likes
            from messages m
            where m.session_id = s.id and not m.deleted
            order by m.created_at desc limit 200) x), '[]'::json),
    'my_likes', coalesce((select json_agg(distinct l.message_id) from likes l
                          where l.session_id = s.id and l.guest_id = p_guest), '[]'::json),
    'polls', coalesce((
      select json_agg(y order by y.created_at)
      from (select p.id, p.question, p.options, p.is_active, p.hidden, p.multi_option, p.multi_vote, p.created_at,
                   coalesce((select json_object_agg(t.option_idx::text, t.c)
                             from (select option_idx, count(*)::int as c from poll_votes v
                                   where v.poll_id = p.id group by option_idx) t), '{}'::json) as counts,
                   coalesce((select json_agg(v.option_idx) from poll_votes v
                             where v.poll_id = p.id and v.guest_id = p_guest), '[]'::json) as mine
            from polls p where p.session_id = s.id order by p.created_at) y), '[]'::json));
end $$;

