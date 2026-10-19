import { createClient } from '@supabase/supabase-js';

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  .trim().replace(/^["']|["']$/g, '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

// Placeholders keep the build from crashing if env vars are missing on a preview deploy.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder').trim()
);
