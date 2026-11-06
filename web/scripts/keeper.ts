/**
 * The automation job. Each run reads every position, picks the actions worth paying gas for
 * and sends them to BinStepAutomation, which accepts reports only from its forwarder.
 * The contracts work out each new range and enforce the stability checks and cooldown.
 */
import { concat, encodeAbiParameters, pad, parseAbi, parseAbiParameters, parseEventLogs, toHex } from "viem";
import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import { addresses } from "../src/lib/addresses";
import type { Market } from "../src/lib/markets";
import { readMarkets } from "../src/lib/read";
import { ActionKind, decide, type Action, type Pool, type PositionView, type Rules } from "./decide";

const RULES: Rules = {
  maxPriceDeviationBps: 300,
  minCompoundUsd: 1,
  minDistanceBins: 2,
  maxTickDrift: 50,
  maxActions: 2,
};

const FIRST_POSITION_ID = 1n;
/** Snapshots cost about 630k gas each, and RPCs cap the gas of a read. */
const PAGE_SIZE = 25n;
const GAS_LIMIT = 9_500_000n;

/** The only market with a real price to compare against. */
const PRICED_SYMBOL = "tWETH";
const ETH_PRICE_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";

const REPORT_VERSION = "0x01";
const REPORT_ID = "0x0001";
/** The forwarder reads these fields, and the deployed automation does not check them. */
const UNUSED_HEADER_BYTES = 4 + 4 + 32 + 10 + 20;

const managerAbi = parseAbi([
  "struct PositionSnapshot { uint256 positionId; address owner; bytes32 poolId; int24 lowerBin; uint8 numBins; bool autoCompound; bool autoRebalance; bool inRange; int24 successorLowerBin; int24 liveTick; int24 stableTick; uint256 pending0; uint256 pending1; uint256 idle0; uint256 idle1; uint256 nextRebalanceAt; }",
  "function automationSnapshot(uint256 firstId, uint256 count) view returns (PositionSnapshot[])",
  "function lastPositionId() view returns (uint256)",
]);

const automationAbi = parseAbi([
  "function forwarder() view returns (address)",
  "event ActionExecuted(uint256 indexed positionId, uint8 kind)",
  "event ActionSkipped(uint256 indexed positionId, bytes reason)",
]);

const forwarderAbi = parseAbi([
  "function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)",
  "event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

/** The forwarder hands the receiver everything after the first 45 bytes as metadata and report. */
export function rawReport(actions: Action[], observedAt: number, executionId: Hex): Hex {
  const report = encodeAbiParameters(parseAbiParameters("uint64, (uint8 kind, uint256 positionId)[]"), [
    BigInt(observedAt),
    actions,
  ]);
  const timestamp = toHex(observedAt, { size: 4 });
  return concat([REPORT_VERSION, executionId, timestamp, pad("0x", { size: UNUSED_HEADER_BYTES }), REPORT_ID, report]);
}

export async function ethPriceUsd() {
  const res = await fetch(ETH_PRICE_URL);
  if (!res.ok) throw new Error(`price API returned ${res.status}`);
  const { data } = (await res.json()) as { data: { amount: string } };
  const price = Number(data.amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error("price API returned an invalid price");
  return price;
}

async function readPositions(client: PublicClient) {
  const last = await client.readContract({ address: addresses.manager, abi: managerAbi, functionName: "lastPositionId" });
  const positions: PositionView[] = [];
  for (let first = FIRST_POSITION_ID; first <= last; first += PAGE_SIZE) {
    const page = await client.readContract({
      address: addresses.manager,
      abi: managerAbi,
      functionName: "automationSnapshot",
      args: [first, PAGE_SIZE],
    });
    positions.push(...page);
  }
  return positions;
}

const toPool = (market: Market, ethUsd: number): Pool => ({
  poolId: market.poolId,
  baseIsToken0: market.baseIsToken0,
  baseDecimals: market.baseDecimals,
  marketUsd: market.symbol === PRICED_SYMBOL ? ethUsd : null,
});

const randomHash = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

async function send(
  client: PublicClient,
  wallet: WalletClient<Transport, Chain, Account>,
  actions: Action[],
  observedAt: number,
) {
  const forwarder: Address = await client.readContract({
    address: addresses.automation,
    abi: automationAbi,
    functionName: "forwarder",
  });
  const hash = await wallet.writeContract({
    address: forwarder,
    abi: forwarderAbi,
    functionName: "report",
    // A forwarder delivers each execution id once, so every report needs a new one.
    args: [addresses.automation, rawReport(actions, observedAt, randomHash()), "0x", []],
    gas: GAS_LIMIT,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`report reverted: ${hash}`);

  // The forwarder catches a revert in the receiver, so a mined report can still have done nothing.
  const [processed] = parseEventLogs({ abi: forwarderAbi, eventName: "ReportProcessed", logs: receipt.logs });
  if (!processed?.args.result) throw new Error(`report refused: ${hash}`);
  return { hash, logs: parseEventLogs({ abi: automationAbi, logs: receipt.logs }) };
}

/** Returns one line saying what happened on chain. */
export async function runKeeper(client: PublicClient, wallet: WalletClient<Transport, Chain, Account>) {
  const [markets, ethUsd, block] = await Promise.all([readMarkets(client), ethPriceUsd(), client.getBlock()]);
  const positions = await readPositions(client);
  const pools = markets.map((market) => toPool(market, ethUsd));
  // The contract refuses a report dated after its block, so this uses chain time.
  const now = Number(block.timestamp);
  const { actions, skipped } = decide(positions, pools, now, RULES);
  if (actions.length === 0) return `nothing to do across ${positions.length} positions, ${skipped.length} skipped`;

  const { hash, logs } = await send(client, wallet, actions, now);
  const results = logs.map((log) =>
    log.eventName === "ActionExecuted"
      ? `${log.args.kind === ActionKind.Compound ? "compounded" : "rebalanced"} #${log.args.positionId}`
      : `contract skipped #${log.args.positionId}`,
  );
  return `${results.join(", ")} (${hash})`;
}
