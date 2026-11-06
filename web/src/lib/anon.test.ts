import { describe, expect, test } from "bun:test";
import { createAnonRoute, type AnonStatus, type Fetch, type WorkerName, type WorkerHandle } from "./anon";

type Script = Partial<Record<WorkerName, "ok" | "fail">>;

function harness(script: Script) {
  const opened: WorkerName[] = [];
  const statuses: AnonStatus[] = [];
  let open = 0;
  let maxOpen = 0;
  let plainCalls = 0;
  const makeWorker = async (name: WorkerName): Promise<WorkerHandle> => {
    opened.push(name);
    open += 1;
    maxOpen = Math.max(maxOpen, open);
    return {
      fetch: async () => {
        if (script[name] !== "ok") throw new Error(`${name} failed`);
        return new Response('{"result":"0x14a34"}');
      },
      close: () => {
        open -= 1;
      },
    };
  };
  const route = createAnonRoute({
    makeWorker,
    plainFetch: async () => {
      plainCalls += 1;
      return new Response('{"result":"plain"}');
    },
    onStatus: (s) => statuses.push(s),
    probeTimeoutMs: 1000,
  });
  return { route, opened, statuses, maxOpen: () => maxOpen, plainCalls: () => plainCalls };
}

const call = (r: { fetch: Fetch }) => r.fetch("https://rpc.test", { method: "POST", body: "{}" });

describe("createAnonRoute", () => {
  test("uses Nox first", async () => {
    const h = harness({ nox: "ok" });
    expect(await (await call(h.route)).json()).toEqual({ result: "0x14a34" });
    expect(h.opened).toEqual(["nox"]);
    expect(h.statuses).toEqual([{ state: "connecting", worker: "nox" }, { state: "private", worker: "nox" }]);
  });

  test("falls to Nym when Nox fails, one at a time", async () => {
    const h = harness({ nox: "fail", nym: "ok" });
    await call(h.route);
    expect(h.opened).toEqual(["nox", "nym"]);
    expect(h.maxOpen()).toBe(1);
    expect(h.statuses.at(-1)).toEqual({ state: "private", worker: "nym" });
  });

  test("shares one connection across simultaneous calls", async () => {
    const h = harness({ nox: "ok" });
    await Promise.all([call(h.route), call(h.route), call(h.route)]);
    expect(h.opened).toEqual(["nox"]);
  });

  test("never sends plain traffic when both fail", async () => {
    const h = harness({ nox: "fail", nym: "fail" });
    await expect(call(h.route)).rejects.toThrow("no private route");
    expect(h.statuses.at(-1)).toEqual({ state: "failed" });
    expect(h.plainCalls()).toBe(0);
  });

  test("plain traffic needs an explicit choice", async () => {
    const h = harness({ nox: "fail", nym: "fail" });
    await call(h.route).catch(() => {});
    h.route.usePlainRpc();
    expect(await (await call(h.route)).json()).toEqual({ result: "plain" });
    expect(h.statuses.at(-1)).toEqual({ state: "plain" });
    expect(h.plainCalls()).toBe(1);
  });

  test("retry starts again from Nox", async () => {
    const h = harness({ nox: "fail", nym: "fail" });
    await call(h.route).catch(() => {});
    h.route.retry();
    await call(h.route).catch(() => {});
    expect(h.opened).toEqual(["nox", "nym", "nox", "nym"]);
  });

  test("a stuck worker counts as failed", async () => {
    const opened: string[] = [];
    const route = createAnonRoute({
      makeWorker: async (name) => {
        opened.push(name);
        return {
          fetch: name === "nox" ? () => new Promise<Response>(() => {}) : async () => new Response("{}"),
          close: () => {},
        };
      },
      plainFetch: fetch,
      onStatus: () => {},
      probeTimeoutMs: 20,
    });
    await call(route);
    expect(opened).toEqual(["nox", "nym"]);
  });

  test("reconnects once when a live route breaks", async () => {
    let healthy = true;
    const opened: string[] = [];
    const route = createAnonRoute({
      makeWorker: async (name) => {
        opened.push(name);
        const mine = name;
        let probes = 0;
        return {
          fetch: async () => {
            probes += 1;
            if (mine === "nox" && probes > 1 && !healthy) throw new Error("tunnel closed");
            return new Response('{"ok":true}');
          },
          close: () => {},
        };
      },
      plainFetch: fetch,
      onStatus: () => {},
      probeTimeoutMs: 1000,
    });
    await call(route);
    healthy = false;
    expect(await (await call(route)).json()).toEqual({ ok: true });
    expect(opened.length).toBe(2);
  });
});
