import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader, SiteFooter, FloatingContactButtons } from './ui';
export const metadata: Metadata = { title: 'अखिल भारतीय वैदिक धर्म संरक्षक समिति', description: 'सत्यं वद। धर्मं चर। ॐ वेदो खिलो धर्ममूलम्। — संस्कृति संरक्षण, जनकल्याण और सामाजिक सेवा।' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="hi" data-scroll-behavior="smooth"><body><SiteHeader/><main>{children}</main><SiteFooter/><FloatingContactButtons/></body></html>; }
