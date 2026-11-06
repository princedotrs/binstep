import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16">
      <h1 className="text-2xl font-semibold tracking-tight">No market here</h1>
      <p className="mt-2 text-muted">This page does not exist. A pool you just created can take a few seconds to appear.</p>
      <Link href="/" className="mt-4 inline-block text-sm underline hover:text-muted">
        See all markets
      </Link>
    </div>
  );
}
