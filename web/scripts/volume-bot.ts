/**
 * Trades on every pool so positions earn fees and fall out of range, then runs the automation
 * workflow. One loop does both, so the two never send from the same wallet at once.
 * Start it with scripts/demo-bot.sh. Test tokens only: anyone can mint them.
 */
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  http,
  maxUint256,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { swapRouterAbi } from "../src/lib/abi";
import { RPC_URL, STATE_VIEW, addresses } from "../src/lib/addresses";
import { poolKeyOf, type Market } from "../src/lib/markets";
import { tickToUsd, usdToTick } from "../src/lib/math";
import { readMarkets } from "../src/lib/read";
import { sqrtPriceAtTick } from "../src/lib/tx";

const VISIT_MS = 45_000;
const AUTOMATION_MS = 300_000;
const WORKFLOW_TIMEOUT_MS = 150_000;
const MIN_ETH = parseEther("0.005");

/** A Curve position spans 80 ticks each side, so a step puts it out of range. */
const STEP_TICKS = 120;
const CHURN_TICKS = 20;
const MIN_MOVE_TICKS = 3;
/** Each level holds this long, so the stable price catches up and a rebalance can run. */
const VISITS_PER_LEVEL = 5;
const LEVELS = [0, 1, 0, -1];

const TOKEN_FLOAT = 10n ** 27n;
/** The price limit ends each swap, so this only has to be more than it will spend. */
const SWAP_AMOUNT = 10n ** 26n;

const ETH_PRICE_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const CRE_DIR = resolve(import.meta.dirname, "../../cre");

const key = process.env.DEPLOYER_KEY as Hex | undefined;
if (!key) throw new Error("DEPLOYER_KEY is not set. Set it in contracts/deployer.env or on the host.");

const account = privateKeyToAccount(key);
const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) }) as unknown as PublicClient;
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });

const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
const mintAbi = parseAbi(["function mint(address to, uint256 value)"]);

const log = (message: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

const send = async (call: Parameters<typeof wallet.writeContract>[0]) => {
  const hash = await wallet.writeContract(call);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
};

const funded = new Set<Address>();

/** Test tokens mint freely, so the bot holds far more than a swap needs. */
async function fund(token: Address) {
  if (funded.has(token)) return;
  const [balance, allowance] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, addresses.swapRouter] }),
  ]);
  if (balance < TOKEN_FLOAT / 2n) {
    await send({ address: token, abi: mintAbi, functionName: "mint", args: [account.address, TOKEN_FLOAT] } as never);
  }
  if (allowance < maxUint256 / 2n) {
    await send({ address: token, abi: erc20Abi, functionName: "approve", args: [addresses.swapRouter, maxUint256] } as never);
  }
  funded.add(token);
}

async function ethPriceUsd() {
  const res = await fetch(ETH_PRICE_URL);
  const { data } = (await res.json()) as { data: { amount: string } };
  return Number(data.amount);
}

type Walk = { center: number; visits: number };
const walks = new Map<string, Walk>();

/** tWETH stays near the real price, because the workflow refuses to act 3% from it. */
const startingCenter = async (market: Market, tick: number) =>
  market.symbol === "tWETH" ? usdToTick(await ethPriceUsd(), market) : tick;

function nextTarget(walk: Walk, tick: number) {
  const level = LEVELS[Math.floor(walk.visits / VISITS_PER_LEVEL) % LEVELS.length];
  const churn = Math.round((Math.random() * 2 - 1) * CHURN_TICKS);
  const target = walk.center + level * STEP_TICKS + churn;
  if (Math.abs(target - tick) >= MIN_MOVE_TICKS) return target;
  return tick + (Math.random() < 0.5 ? -1 : 1) * CHURN_TICKS;
}

async function visit(market: Market) {
  const [[, tick], liquidity] = await Promise.all([
    client.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [market.poolId] }),
    client.readContract({ address: STATE_VIEW, abi: stateViewAbi, functionName: "getLiquidity", args: [market.poolId] }),
  ]);
  // With nothing to fill it, a swap trades nothing and only moves the price.
  if (liquidity === 0n) return;

  const walk = walks.get(market.id) ?? { center: await startingCenter(market, tick), visits: 0 };
  walks.set(market.id, walk);
  const target = nextTarget(walk, tick);
  walk.visits += 1;

  const key = poolKeyOf(market);
  const zeroForOne = target < tick;
  await fund(zeroForOne ? key.currency0 : key.currency1);
  await send({
    address: addresses.swapRouter,
    abi: swapRouterAbi,
    functionName: "swap",
    args: [
      key,
      { zeroForOne, amountSpecified: -SWAP_AMOUNT, sqrtPriceLimitX96: sqrtPriceAtTick(target) },
      { takeClaims: false, settleUsingBurn: false },
      "0x",
    ],
  } as never);
  log(`${market.symbol}: $${tickToUsd(tick, market).toFixed(4)} -> $${tickToUsd(target, market).toFixed(4)}`);
}

async function runAutomation() {
  const args = ["workflow", "simulate", "automation", "--target", "base-sepolia", "-e", "base-sepolia.env"];
  const { stdout, stderr } = await promisify(execFile)(
    "cre",
    [...args, "--non-interactive", "--trigger-index", "0", "--broadcast"],
    { cwd: CRE_DIR, timeout: WORKFLOW_TIMEOUT_MS, maxBuffer: 10_000_000 },
  );
  const lines = `${stdout}\n${stderr}`.split("\n").filter((line) => /act #|workflow execution failed/.test(line));
  log(`automation: ${lines.map((line) => line.replace(/.*USER LOG\]\s*/, "")).join(", ") || "nothing to do"}`);
}

async function main() {
  log(`trading from ${account.address}`);
  let lastAutomation = 0;
  for (;;) {
    const markets = await readMarkets(client);
    for (const market of markets) {
      const balance = await client.getBalance({ address: account.address });
      if (balance < MIN_ETH) {
        log(`stopping: ${formatEther(balance)} ETH left`);
        return;
      }
      await visit(market).catch((error: Error) => log(`${market.symbol} failed: ${error.message.split("\n")[0]}`));
      if (Date.now() - lastAutomation >= AUTOMATION_MS) {
        lastAutomation = Date.now();
        await runAutomation().catch((error: Error) => log(`automation failed: ${error.message.split("\n")[0]}`));
      }
      await new Promise((done) => setTimeout(done, VISIT_MS));
    }
  }
}

await main();
