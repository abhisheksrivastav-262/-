import { createClient as createSupabaseClient } from '@supabase/supabase-js';
export function createClient(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;return url&&key?createSupabaseClient(url,key):null;}
