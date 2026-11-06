"use client";

import { useAnonStatus } from "@/lib/hooks";

export function Loading({ error }: { error?: boolean }) {
  const status = useAnonStatus();
  const failed = status.state === "failed";
  const title = failed
    ? "Waiting for your choice above"
    : error
      ? "This read failed. Trying again shortly."
      : "Connecting privately";
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-16 text-center">
      <p className="font-medium">{title}</p>
      {!failed && (
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          The first read goes through a mixnet and can take up to a minute. After that, updates are quick.
        </p>
      )}
    </div>
  );
}
