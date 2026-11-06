import {NextResponse} from 'next/server';
import {createClient} from '../../../supabase';
export async function GET(){const db=createClient();if(!db)return NextResponse.json({units:[]});const {data,error}=await db.from('organizational_units').select('id,parent_id,level,name,state,district,locality').eq('active',true).order('level').order('name').limit(1000);if(error)return NextResponse.json({error:'इकाइयाँ उपलब्ध नहीं हैं।'},{status:503});return NextResponse.json({units:data||[]},{headers:{'Cache-Control':'public,max-age=60'}});}
