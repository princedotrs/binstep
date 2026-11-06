import type { Fetch, WorkerHandle, WorkerName } from "./anon";

const SPECIFIERS: Record<WorkerName, { address: `0x${string}`; bootstrapRpc: string }> = {
  nox: {
    address: "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A",
    bootstrapRpc: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  nym: {
    address: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0",
    bootstrapRpc: "https://ethereum-rpc.publicnode.com",
  },
};

/** Only reads the worker's specifier contract, so a wallet address never touches it. */
const bootstrapProvider = (url: string) => ({
  request: async ({ method, params }: { method: string; params?: unknown }) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  },
});

/** Imported on demand because the harness only runs in a browser. */
export async function makeBrowserWorker(name: WorkerName): Promise<WorkerHandle> {
  const { AnonRpcWorker } = await import("@anon-rpc/browser-harness");
  const { address, bootstrapRpc } = SPECIFIERS[name];
  const worker = new AnonRpcWorker({
    address,
    preExisting: { rpcProvider: bootstrapProvider(bootstrapRpc) as never },
  });
  return { fetch: worker.fetch as unknown as Fetch, close: () => worker.close() };
}

export const plainFetch: Fetch = (url, init) => fetch(url, init);
