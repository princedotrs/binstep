import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_RPC, addresses } from "@/lib/addresses";
import { AIRDROP_USDC, AIRDROP_WETH, decideAirdrop, type AirdropKind } from "@/lib/airdrop";

const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const COOLDOWN_MS = 20_000;
const RECEIPT_TIMEOUT_MS = 8_000;

const multicallAbi = parseAbi([
  "struct Call { address target; bool allowFailure; uint256 value; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3Value(Call[] calls) payable returns (Result[])",
]);
const mintAbi = parseAbi(["function mint(address to, uint256 value)"]);

const lastSent = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();

const reply = (status: number, body: object) => Response.json(body, { status });

const pub = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) });

async function readWallet(to: Address) {
  const balance = (address: Address) =>
    pub.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [to] });
  const [weth, usdc, eth] = await Promise.all([
    balance(addresses.weth),
    balance(addresses.usdc),
    pub.getBalance({ address: to }),
  ]);
  return { weth, usdc, eth };
}

/** One atomic transaction, so a user never gets tokens without the gas to use them. */
async function send(key: Hex, to: Address, gas: bigint) {
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC) });
  const mint = (target: Address, amount: bigint) => ({
    target,
    allowFailure: false,
    value: 0n,
    callData: encodeFunctionData({ abi: mintAbi, functionName: "mint", args: [to, amount] }),
  });
  const hash = await wallet.writeContract({
    address: MULTICALL3,
    abi: multicallAbi,
    functionName: "aggregate3Value",
    value: gas,
    args: [
      [
        mint(addresses.weth, AIRDROP_WETH),
        mint(addresses.usdc, AIRDROP_USDC),
        ...(gas > 0n ? [{ target: to, allowFailure: false, value: gas, callData: "0x" as Hex }] : []),
      ],
    ],
  });
  await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS }).catch(() => {});
  return hash;
}

export async function POST(request: Request) {
  const key = process.env.AIRDROP_PRIVATE_KEY as Hex | undefined;
  if (!key) return reply(503, { error: "Airdrop is not set up" });

  const body = await request.json().catch(() => null);
  const to = body?.address;
  const kind: AirdropKind | undefined = body?.kind === "first" || body?.kind === "more" ? body.kind : undefined;
  if (typeof to !== "string" || !isAddress(to) || !kind) return reply(400, { error: "Invalid request" });

  const id = to.toLowerCase();
  const waited = Date.now() - (lastSent.get(id) ?? 0);
  if (waited < COOLDOWN_MS) return reply(429, { error: "Try again in a few seconds" });

  try {
    const decision = decideAirdrop(kind, await readWallet(to));
    if (!decision.send) return reply(200, { sent: false, reason: decision.reason });
    lastSent.set(id, Date.now());

    // One signer, so sends run in order to keep its nonces valid.
    const job = queue.then(() => send(key, to, decision.gas));
    queue = job.catch(() => {});
    const hash = await job;
    return reply(200, { sent: true, hash, gas: decision.gas.toString() });
  } catch {
    lastSent.delete(id);
    return reply(502, { error: "Airdrop failed. Try again." });
  }
}
