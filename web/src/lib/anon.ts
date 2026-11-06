/**
 * Routes RPC reads through one anonymizing worker at a time. Workers failed when
 * run in parallel, so a failed worker closes before the next one opens.
 *
 * Plain RPC is never automatic. It needs an explicit usePlainRpc().
 */

export type WorkerName = "nox" | "nym";

export type AnonStatus =
  | { state: "connecting"; worker: WorkerName }
  | { state: "private"; worker: WorkerName }
  | { state: "failed" }
  | { state: "plain" };

export type Fetch = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type WorkerHandle = { fetch: Fetch; close: () => void };

type Options = {
  makeWorker: (name: WorkerName) => Promise<WorkerHandle>;
  plainFetch: Fetch;
  onStatus: (status: AnonStatus) => void;
  probeTimeoutMs: number;
  probeUrl?: string;
};

const ORDER: WorkerName[] = ["nox", "nym"];
const SAME_WORKER_RETRIES = 2;
const PROBE_BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createAnonRoute({ makeWorker, plainFetch, onStatus, probeTimeoutMs, probeUrl }: Options) {
  type Live = { name: WorkerName; handle: WorkerHandle };
  let live: Live | null = null;
  let connecting: Promise<Live> | null = null;
  let failed = false;
  let plain = false;

  async function tryWorker(name: WorkerName): Promise<Live | null> {
    onStatus({ state: "connecting", worker: name });
    let handle: WorkerHandle | null = null;
    try {
      handle = await makeWorker(name);
      const init = { method: "POST", headers: { "content-type": "application/json" }, body: PROBE_BODY };
      await within(handle.fetch(probeUrl ?? "https://sepolia.base.org", init), probeTimeoutMs);
      return { name, handle };
    } catch {
      handle?.close();
      return null;
    }
  }

  async function connectInOrder(order: WorkerName[]): Promise<Live> {
    for (const name of order) {
      const worker = await tryWorker(name);
      if (worker) {
        live = worker;
        onStatus({ state: "private", worker: name });
        return worker;
      }
    }
    failed = true;
    onStatus({ state: "failed" });
    throw new Error("no private route");
  }

  function connect(order: WorkerName[] = ORDER): Promise<Live> {
    if (live) return Promise.resolve(live);
    connecting ??= connectInOrder(order).finally(() => {
      connecting = null;
    });
    return connecting;
  }

  /** Drops a broken worker and tries the other one first. */
  function replace(broken: Live): Promise<Live> {
    if (live === broken) {
      broken.handle.close();
      live = null;
    }
    return connect([...ORDER.filter((n) => n !== broken.name), broken.name]);
  }

  const routedFetch: Fetch = async (url, init) => {
    if (plain) return plainFetch(url, init);
    if (failed) throw new Error("no private route");
    const worker = await connect();
    for (let attempt = 0; attempt <= SAME_WORKER_RETRIES; attempt += 1) {
      try {
        return await within(worker.handle.fetch(url, init), probeTimeoutMs);
      } catch {
        // A tunnel can drop and reopen, which is far cheaper than a new worker.
      }
    }
    const next = await replace(worker);
    return within(next.handle.fetch(url, init), probeTimeoutMs);
  };

  return {
    fetch: routedFetch,
    /** Opens the route ahead of the first read, so the badge reflects it. */
    connect() {
      if (!plain && !failed) connect().catch(() => {});
    },
    retry() {
      failed = false;
      plain = false;
    },
    usePlainRpc() {
      live?.handle.close();
      live = null;
      plain = true;
      onStatus({ state: "plain" });
    },
  };
}
