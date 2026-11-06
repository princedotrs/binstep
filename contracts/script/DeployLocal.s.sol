// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {BinStepAutomation} from "../src/BinStepAutomation.sol";
import {BinStepHook} from "../src/BinStepHook.sol";
import {BinStepManager} from "../src/BinStepManager.sol";
import {Strategy} from "../src/libraries/Strategy.sol";

/// @notice Deploys everything to a local Anvil node and seeds one position per
/// strategy. The deployer stands in for the CRE forwarder.
contract DeployLocal is Script {
    using PoolIdLibrary for PoolKey;

    int24 constant SPACING = 10;
    int24 constant MAX_TICK_DEVIATION = 200;
    uint64 constant MAX_REPORT_AGE = 3600;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run() external {
        uint256 deployerKey = vm.envOr(
            "DEPLOYER_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // Anvil account 0.
        );
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        PoolManager poolManager = new PoolManager(deployer);
        PoolSwapTest swapRouter = new PoolSwapTest(poolManager);
        BinStepManager manager = new BinStepManager(poolManager, deployer);
        BinStepAutomation automation =
            new BinStepAutomation(manager, deployer, deployer, MAX_TICK_DEVIATION, MAX_REPORT_AGE);

        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        bytes memory args = abi.encode(address(poolManager), address(manager));
        (address predicted, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(BinStepHook).creationCode, args);
        BinStepHook hook = new BinStepHook{salt: salt}(poolManager, address(manager));
        require(address(hook) == predicted, "hook address mismatch");

        manager.setHook(address(hook));
        manager.setKeeper(address(automation));

        (MockERC20 token0, MockERC20 token1) = _deployTokens(deployer);
        token0.approve(address(manager), type(uint256).max);
        token1.approve(address(manager), type(uint256).max);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING,
            hooks: IHooks(address(hook))
        });
        poolManager.initialize(key, SQRT_PRICE_1_1);

        uint256 spot = manager.mint(_mintParams(key, -8, 16, Strategy.Spot));
        uint256 curve = manager.mint(_mintParams(key, -8, 16, Strategy.Curve));
        uint256 bidAsk = manager.mint(_mintParams(key, -8, 16, Strategy.BidAsk));

        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeAddress(json, "poolManager", address(poolManager));
        vm.serializeAddress(json, "swapRouter", address(swapRouter));
        vm.serializeAddress(json, "manager", address(manager));
        vm.serializeAddress(json, "automation", address(automation));
        vm.serializeAddress(json, "hook", address(hook));
        vm.serializeAddress(json, "token0", address(token0));
        vm.serializeAddress(json, "token1", address(token1));
        string memory out = vm.serializeBytes32(json, "poolId", PoolId.unwrap(key.toId()));
        vm.writeJson(out, "./deployments/local.json");

        console2.log("hook", address(hook));
        console2.log("positions", spot, curve, bidAsk);
    }

    function _deployTokens(address to) private returns (MockERC20 token0, MockERC20 token1) {
        MockERC20 a = new MockERC20("BinStep Test A", "BSA", 18);
        MockERC20 b = new MockERC20("BinStep Test B", "BSB", 18);
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);
        token0.mint(to, 1_000_000e18);
        token1.mint(to, 1_000_000e18);
    }

    function _mintParams(PoolKey memory key, int24 lowerBin, uint8 numBins, Strategy strategy)
        private
        pure
        returns (BinStepManager.MintParams memory)
    {
        return BinStepManager.MintParams({
            key: key,
            lowerBin: lowerBin,
            numBins: numBins,
            strategy: strategy,
            amount0Max: 1000e18,
            amount1Max: 1000e18,
            minTick: -100,
            maxTick: 100,
            autoCompound: true,
            autoRebalance: true
        });
    }
}
