import { MarketTable } from "@/components/MarketTable";

export default function SwapPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold">Swap</h1>
      <p className="mt-1 mb-4 text-sm text-muted">Pick a market to trade.</p>
      <MarketTable link="swap" />
    </div>
  );
}
