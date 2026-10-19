'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { MEDIA_FILES_WARN, MESSAGE_WARN, STORAGE_LIMIT_MB, WARN_RATIO } from './limits';

export type Usage = { messages: number; media_files: number; media_bytes: number };
export const mb = (bytes: number) => Math.round(bytes / 1048576);

// Host only: how much space the GIFs/messages use. Checked once a minute.
export function useUsage(sessionId?: string, adminKey?: string | null) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const reload = useCallback(async () => {
    if (!sessionId || !adminKey) return;
    const { data } = await supabase.rpc('admin_usage', { p_session: sessionId, p_key: adminKey });
    if (data) setUsage(data as Usage);
  }, [sessionId, adminKey]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, 60000);
    return () => clearInterval(t);
  }, [reload]);
  return { usage, reload };
}

export function usageWarnings(u: Usage | null): string[] {
  if (!u) return [];
  const w: string[] = [];
  const used = mb(u.media_bytes);
  if (used >= STORAGE_LIMIT_MB * WARN_RATIO)
    w.push('GIF storage is ' + Math.round((used / STORAGE_LIMIT_MB) * 100) + '% full (' + used + ' of ' + STORAGE_LIMIT_MB + ' MB). Delete old GIFs in Supabase → Storage → media.');
  if (u.media_files >= MEDIA_FILES_WARN)
    w.push(u.media_files + ' GIF/photo files are stored. Delete old ones in Supabase → Storage → media.');
  if (u.messages >= MESSAGE_WARN)
    w.push(u.messages + ' messages are stored. Use “Delete all” (Chat tab) or clear old sessions.');
  return w;
}
