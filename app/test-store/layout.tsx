import { CrownleyTestProvider } from '@/components/commerce/test-store/crownley/test-provider';
import '@/components/commerce/test-store/crownley/crownley.css';
export const metadata={title:'Crownley · Local Test Store',robots:{index:false,follow:false}};
export default function TestStoreLayout({children}:{children:React.ReactNode}){return <CrownleyTestProvider><div className="crownley-test-store">{children}</div></CrownleyTestProvider>;}
