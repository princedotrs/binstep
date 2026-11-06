import { notFound } from "next/navigation";
import { PoolView } from "@/components/PoolView";
import { MARKETS, findMarket } from "@/lib/markets";

export const generateStaticParams = () => MARKETS.map(({ id }) => ({ id }));

export default async function PoolPage({ params }: { params: Promise<{ id: string }> }) {
  const market = findMarket((await params).id);
  if (!market) notFound();
  return <PoolView market={market} />;
}
