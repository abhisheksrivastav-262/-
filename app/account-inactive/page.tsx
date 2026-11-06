import Link from 'next/link';
export default function Inactive(){return <section className="simplecontent"><div className="wrap"><h1>खाता निष्क्रिय है</h1><p>आपके खाते की पहुँच रोक दी गई है। सहायता के लिए संगठन के प्रशासक से संपर्क करें।</p><Link href="/login" className="textlink">लॉगिन पर लौटें →</Link></div></section>}
