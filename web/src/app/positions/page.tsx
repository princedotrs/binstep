"use client";

import { useAccount } from "wagmi";
import { Loading } from "@/components/Loading";
import { PositionCard } from "@/components/PositionCard";
import { usePool } from "@/lib/hooks";

export default function PositionsPage() {
  const { address } = useAccount();
  const { data: pool, isError } = usePool();
  if (!pool) return <Loading error={isError} />;

  const mine = pool.positions.filter((p) => p.owner.toLowerCase() === address?.toLowerCase());
  const shown = mine.length > 0 ? mine : pool.positions;
  const heading = mine.length > 0 ? "Your positions" : "All positions";
  const note =
    mine.length > 0
      ? null
      : address
        ? "This wallet has no positions yet. Create one on the Pool page. These belong to others."
        : "Connect a wallet to manage your own. These are open to view.";

  return (
    <div>
      <h1 className="text-lg font-semibold">{heading}</h1>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {shown.map((p) => (
          <PositionCard
            key={p.id.toString()}
            position={p}
            pool={pool}
            mine={p.owner.toLowerCase() === address?.toLowerCase()}
          />
        ))}
      </div>
    </div>
  );
}
