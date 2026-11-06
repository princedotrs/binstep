import { notFound } from "next/navigation";
import { SwapView } from "@/components/SwapView";
import { MARKETS, findMarket } from "@/lib/markets";

export const generateStaticParams = () => MARKETS.map(({ id }) => ({ id }));

export default async function SwapPage({ params }: { params: Promise<{ id: string }> }) {
  const market = findMarket((await params).id);
  if (!market) notFound();
  return <SwapView market={market} />;
}
