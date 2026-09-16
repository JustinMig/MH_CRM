import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bogusfmvdrlvxscopgaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0g4-uBS_I8wJnBdLbtbriA_vFngXi46';
export const initialAuthUrl = typeof location === 'undefined' ? '' : location.href;
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

