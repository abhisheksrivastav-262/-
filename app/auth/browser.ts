'use client';
import {createBrowserClient} from '@supabase/ssr';
export function createBrowserSupabaseClient(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;return url&&key?createBrowserClient(url,key):null;}
