import { notFound } from "next/navigation";
import { isAddress } from "viem";
import { CommunityMarket } from "@/components/CommunityMarket";
import { SwapView } from "@/components/SwapView";
import { MARKETS, findMarket } from "@/lib/markets";

export const generateStaticParams = () => MARKETS.map(({ id }) => ({ id }));

export default async function SwapMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = findMarket(id);
  if (market) return <SwapView market={market} />;
  if (!isAddress(id)) notFound();
  return <CommunityMarket id={id.toLowerCase()} view="swap" />;
}
