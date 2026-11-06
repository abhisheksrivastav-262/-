import {NextResponse} from 'next/server';
import {createClient} from '../../supabase';

export async function POST(req:Request){
  try{
    const body=await req.json();
    if(body.kind!=='join'&&body.kind!=='contact')return NextResponse.json({error:'अमान्य अनुरोध'},{status:400});
    const name=String(body.name||'').trim(),phone=String(body.phone||'').trim(),email=String(body.email||'').trim(),message=String(body.message||'').trim();
    if(name.length<2||name.length>120||!/^[0-9+ ()-]{8,20}$/.test(phone)||email.length>254||message.length>3000)return NextResponse.json({error:'कृपया सही विवरण भरें।'},{status:400});
    const db=createClient();
    if(!db)return NextResponse.json({error:'आवेदन सेवा कॉन्फ़िगर नहीं है। कृपया प्रशासक से संपर्क करें।'},{status:503});
    if(body.kind==='join'){
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:'सदस्यता आवेदन के लिए सही ईमेल आवश्यक है।'},{status:400});
      const assigned=String(body.assigned_unit_id||'').trim()||null;
      if(assigned&&!/^[0-9a-f-]{36}$/i.test(assigned))return NextResponse.json({error:'संगठन इकाई मान्य नहीं है।'},{status:400});
      if(assigned){const {data:unit}=await db.from('organizational_units').select('id').eq('id',assigned).eq('active',true).maybeSingle();if(!unit)return NextResponse.json({error:'यह संगठन इकाई उपलब्ध नहीं है।'},{status:400});}
      const result=await db.from('membership_applications').insert({full_name:name,mobile:phone,email,state:String(body.state||'').slice(0,80)||null,message,status:'pending',assigned_unit_id:assigned,approval_stage:assigned?'pending_coordinator':'pending_admin'});
      if(result.error){if(result.error.code==='23505')return NextResponse.json({error:'इस ईमेल या मोबाइल से एक आवेदन पहले से समीक्षा में है।'},{status:409});console.error('Membership submission failed:',result.error.code);return NextResponse.json({error:'आवेदन जमा नहीं हो सका। कृपया बाद में प्रयास करें।'},{status:503});}
    }else{
      const result=await db.from('contact_enquiries').insert({name,mobile:phone,email:email||null,subject:String(body.subject||'').slice(0,160),message,status:'new'});
      if(result.error){console.error('Contact submission failed:',result.error.code);return NextResponse.json({error:'संदेश जमा नहीं हो सका। कृपया बाद में प्रयास करें।'},{status:503});}
    }
    return NextResponse.json({ok:true},{status:201});
  }catch{return NextResponse.json({error:'अमान्य अनुरोध।'},{status:400});}
}
