// ================================================================
// config.js — Supabase connection
//
// SETUP: Replace the two values below with your project's details.
// Find them at: Supabase Dashboard → Settings → API
//
//   SUPABASE_URL      → "Project URL"
//   SUPABASE_ANON_KEY → "anon / public" key
//
// The anon key is safe to include here — access is protected
// by Row Level Security (RLS) in Supabase.
// ================================================================
export const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
