import { CrownleyPage } from '@/components/commerce/test-store/crownley/test-pages';
export default async function Page({params}:{params:Promise<{slug:string[]}>}){const {slug}=await params;return <CrownleyPage slug={slug}/>;}
