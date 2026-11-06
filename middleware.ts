import {createServerClient,type SetAllCookies} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';

export async function middleware(request:NextRequest){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return NextResponse.next({request});
  let response=NextResponse.next({request});
  const supabase=createServerClient(url,key,{cookies:{
    getAll(){return request.cookies.getAll();},
    setAll:((cookies)=>{cookies.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});cookies.forEach(({name,value,options})=>response.cookies.set(name,value,options));}) as SetAllCookies
  }});
  await supabase.auth.getUser();
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)']};
