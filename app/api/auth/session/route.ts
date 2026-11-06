import {NextResponse} from 'next/server';
import {getVerifiedRole,roleLabels} from '../../../auth/server';
export async function GET(){
  const {user,role,active}=await getVerifiedRole();
  if(!user)return NextResponse.json({error:'साइन इन आवश्यक है।'},{status:401});
  if(!active)return NextResponse.json({error:'खाता सक्रिय नहीं है। प्रशासक से संपर्क करें।'},{status:403});
  if(!role)return NextResponse.json({error:'इस खाते के लिए कोई भूमिका निर्धारित नहीं है।'},{status:403});
  return NextResponse.json({role,label:roleLabels[role],redirect:`/dashboard/${role}`});
}
