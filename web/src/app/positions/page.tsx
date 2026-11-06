"use client";

import { useAccount } from "wagmi";
import { Loading } from "@/components/Loading";
import { PositionCard } from "@/components/PositionCard";
import { usePools } from "@/lib/hooks";

export default function PositionsPage() {
  const { address } = useAccount();
  const { data: pools, isError } = usePools();
  if (!pools) return <Loading error={isError} />;

  const isMine = (owner: string) => owner.toLowerCase() === address?.toLowerCase();
  const all = Object.values(pools).flatMap((pool) => pool.positions.map((position) => ({ pool, position })));
  const mine = all.filter(({ position }) => isMine(position.owner));
  const shown = mine.length > 0 ? mine : all;
  const heading = mine.length > 0 ? "Your positions" : "All positions";
  const note =
    mine.length > 0
      ? null
      : address
        ? "This wallet has no positions yet. Open a market to create one. These belong to others."
        : "Connect a wallet to manage your own. These are open to view.";

  return (
    <div>
      <h1 className="text-lg font-semibold">{heading}</h1>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {shown.map(({ pool, position }) => (
          <PositionCard key={position.id.toString()} position={position} pool={pool} mine={isMine(position.owner)} />
        ))}
      </div>
    </div>
  );
}
