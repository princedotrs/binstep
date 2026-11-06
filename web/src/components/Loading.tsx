export function Loading({ error }: { error?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-16 text-center">
      <p className="font-medium">{error ? "Market data failed to load. Trying again shortly." : "Loading the market"}</p>
    </div>
  );
}
