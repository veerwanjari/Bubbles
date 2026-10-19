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
