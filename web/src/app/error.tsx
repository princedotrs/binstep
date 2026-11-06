"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="py-16">
      <h1 className="text-2xl font-semibold tracking-tight">This page failed to load</h1>
      <p className="mt-2 text-muted">Your funds are not affected. They stay in the contracts.</p>
      <button className="mt-4 text-sm underline hover:text-muted" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
