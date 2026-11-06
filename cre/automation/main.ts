import {
  CronCapability,
  EVMClient,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  Runner,
  TxStatus,
  bytesToHex,
  consensusMedianAggregation,
  encodeCallMsg,
  getNetwork,
  handler,
  json,
  ok,
  prepareReportRequest,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { decide, type Action, type Pool, type PositionView } from "./decide";

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  managerAddress: z.string(),
  automationAddress: z.string(),
  /** Lists the pools users create. */
  registryAddress: z.string().optional(),
  /** Pools the deployment seeded. A pool with a price API must stay near that price. */
  markets: z.array(
    z.object({
      poolId: z.string(),
      baseIsToken0: z.boolean(),
      baseDecimals: z.number().int(),
      priceApiUrl: z.string().startsWith("https://").optional(),
    }),
  ),
  firstPositionId: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  gasLimit: z.string(),
  maxPriceDeviationBps: z.number().positive(),
  minCompoundUsd: z.number().nonnegative(),
  minDistanceBins: z.number().int().nonnegative(),
  maxTickDrift: z.number().int().positive(),
  maxActions: z.number().int().positive(),
});

export type Config = z.infer<typeof configSchema>;

const managerAbi = parseAbi([
  "struct PositionSnapshot { uint256 positionId; address owner; bytes32 poolId; int24 lowerBin; uint8 numBins; bool autoCompound; bool autoRebalance; bool inRange; int24 successorLowerBin; int24 liveTick; int24 stableTick; uint256 pending0; uint256 pending1; uint256 idle0; uint256 idle1; uint256 nextRebalanceAt; }",
  "function automationSnapshot(uint256 firstId, uint256 count) view returns (PositionSnapshot[])",
  "function lastPositionId() view returns (uint256)",
]);

const registryAbi = parseAbi([
  "struct Listing { address token; address creator; bytes32 poolId; bool baseIsToken0; uint256 priceE6; string name; string symbol; }",
  "function count() view returns (uint256)",
  "function page(uint256 offset, uint256 limit) view returns (Listing[])",
]);

/** Matches the newest community pools the app shows. */
const COMMUNITY_POOLS = 100n;
const COMMUNITY_DECIMALS = 18;

/** The SDK does not export this EVM enum from its package root. */
const RECEIVER_REVERTED = 1;

const priceSchema = z.object({ data: z.object({ amount: z.string() }) });

const fetchPriceUsd = (sender: HTTPSendRequester, url: string): number => {
  const response = sender.sendRequest({ url, method: "GET" }).result();
  if (!ok(response)) throw new Error(`price API returned ${response.statusCode}`);
  const price = Number(priceSchema.parse(json(response)).data.amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error("price API returned an invalid price");
  return price;
};

const evmClient = (config: Config): EVMClient => {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName });
  if (!network) throw new Error(`unknown chain: ${config.chainSelectorName}`);
  return new EVMClient(network.chainSelector.selector);
};

const read = (runtime: Runtime<Config>, client: EVMClient, to: string, data: Hex): Hex =>
  bytesToHex(
    client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: to as Address, data }),
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result().data,
  );

const readPositions = (runtime: Runtime<Config>, client: EVMClient): PositionView[] => {
  const { managerAddress, firstPositionId, pageSize } = runtime.config;
  const last = decodeFunctionResult({
    abi: managerAbi,
    functionName: "lastPositionId",
    data: read(runtime, client, managerAddress, encodeFunctionData({ abi: managerAbi, functionName: "lastPositionId" })),
  });

  const positions: PositionView[] = [];
  // Snapshots cost about 630k gas each, and RPCs cap the gas of a read.
  for (let first = BigInt(firstPositionId); first <= last; first += BigInt(pageSize)) {
    const data = encodeFunctionData({ abi: managerAbi, functionName: "automationSnapshot", args: [first, BigInt(pageSize)] });
    const snapshots = decodeFunctionResult({
      abi: managerAbi,
      functionName: "automationSnapshot",
      data: read(runtime, client, managerAddress, data),
    });
    for (const s of snapshots) {
      positions.push({
        positionId: s.positionId,
        poolId: s.poolId,
        lowerBin: s.lowerBin,
        numBins: s.numBins,
        autoCompound: s.autoCompound,
        autoRebalance: s.autoRebalance,
        inRange: s.inRange,
        successorLowerBin: s.successorLowerBin,
        liveTick: s.liveTick,
        stableTick: s.stableTick,
        pending0: s.pending0,
        pending1: s.pending1,
        idle0: s.idle0,
        idle1: s.idle1,
        nextRebalanceAt: s.nextRebalanceAt,
      });
    }
  }
  return positions;
};

const readCommunityPools = (runtime: Runtime<Config>, client: EVMClient): Pool[] => {
  const { registryAddress } = runtime.config;
  if (!registryAddress) return [];
  const count = decodeFunctionResult({
    abi: registryAbi,
    functionName: "count",
    data: read(runtime, client, registryAddress, encodeFunctionData({ abi: registryAbi, functionName: "count" })),
  });
  const offset = count > COMMUNITY_POOLS ? count - COMMUNITY_POOLS : 0n;
  const listings = decodeFunctionResult({
    abi: registryAbi,
    functionName: "page",
    data: read(
      runtime,
      client,
      registryAddress,
      encodeFunctionData({ abi: registryAbi, functionName: "page", args: [offset, COMMUNITY_POOLS] }),
    ),
  });
  return listings.map(({ poolId, baseIsToken0 }) => ({ poolId, baseIsToken0, baseDecimals: COMMUNITY_DECIMALS, marketUsd: null }));
};

const sendActions = (runtime: Runtime<Config>, client: EVMClient, actions: Action[], now: number): string => {
  const encoded = encodeAbiParameters(parseAbiParameters("uint64, (uint8 kind, uint256 positionId)[]"), [
    BigInt(now),
    actions,
  ]);
  const report = runtime.report(prepareReportRequest(encoded)).result();
  const result = client
    .writeReport(runtime, {
      receiver: runtime.config.automationAddress,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  if (result.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`report failed with status ${result.txStatus}: ${result.errorMessage ?? "no message"}`);
  }
  if (result.receiverContractExecutionStatus === RECEIVER_REVERTED) {
    throw new Error("onReport reverted");
  }
  return bytesToHex(result.txHash ?? new Uint8Array(32));
};

export const onCron = (runtime: Runtime<Config>): string => {
  const config = configSchema.parse(runtime.config);
  const client = evmClient(config);

  const http = new HTTPClient();
  const seeded = config.markets.map(({ priceApiUrl, ...market }): Pool => ({
    ...market,
    marketUsd: priceApiUrl
      ? http.sendRequest(runtime, fetchPriceUsd, consensusMedianAggregation<number>())(priceApiUrl).result()
      : null,
  }));
  const pools = [...seeded, ...readCommunityPools(runtime, client)];

  const positions = readPositions(runtime, client);
  const now = Math.floor(runtime.now().getTime() / 1000);
  const decision = decide(positions, pools, now, config);

  for (const c of decision.checks) {
    runtime.log(`${c.poolId}: market $${c.marketUsd} | pool $${c.poolPriceUsd} | ${c.deviationBps} bps apart`);
  }
  for (const s of decision.skipped) runtime.log(`skip #${s.positionId}: ${s.reason}`);
  for (const a of decision.actions) runtime.log(`act #${a.positionId}: ${a.kind === 0 ? "compound" : "rebalance"}`);

  const txHash = decision.actions.length > 0 ? sendActions(runtime, client, decision.actions, now) : null;
  return JSON.stringify({
    checks: decision.checks,
    actions: decision.actions.map((a) => ({ kind: a.kind, positionId: a.positionId.toString() })),
    skipped: decision.skipped.map((s) => ({ positionId: s.positionId.toString(), reason: s.reason })),
    txHash,
  });
};

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCron),
];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
