import { parseAbiItem, type PublicClient } from "viem";
import { AUTOMATION_BLOCK, addresses } from "./addresses";
import { blockChunks } from "./stats";

const COMPOUND = 0;

const executedEvent = parseAbiItem("event ActionExecuted(uint256 indexed positionId, uint8 kind)");

export type AutomationCounts = { compounds: number; rebalances: number };

export function countActions(actions: { positionId: bigint; kind: number }[]) {
  const counts: Record<string, AutomationCounts> = {};
  for (const { positionId, kind } of actions) {
    const count = (counts[positionId.toString()] ??= { compounds: 0, rebalances: 0 });
    if (kind === COMPOUND) count.compounds += 1;
    else count.rebalances += 1;
  }
  return counts;
}

/** BinStepAutomation logs each action it completes, so skipped ones are not counted. */
export async function scanAutomation(client: PublicClient, logRange: bigint) {
  if (AUTOMATION_BLOCK === undefined) return {};
  const toBlock = await client.getBlockNumber();
  const chunks = await Promise.all(
    blockChunks(BigInt(AUTOMATION_BLOCK), toBlock, logRange).map(([fromBlock, to]) =>
      client.getLogs({ address: addresses.automation, event: executedEvent, fromBlock, toBlock: to }),
    ),
  );
  return countActions(chunks.flat().map(({ args }) => ({ positionId: args.positionId ?? 0n, kind: args.kind ?? 0 })));
}
