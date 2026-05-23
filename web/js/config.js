// Public Supabase config. SAFE to commit / expose — the anon key only works
// through Row-Level Security (which scopes every row to the signed-in user).
// Fill these in from your Supabase project: Settings → API.
//
// Until real values are set, the app runs in local-only mode (no login,
// progress stays in localStorage) — nothing breaks.

export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
