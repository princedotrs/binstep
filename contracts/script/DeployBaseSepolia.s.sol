// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {BinStepAutomation} from "../src/BinStepAutomation.sol";
import {BinStepHook} from "../src/BinStepHook.sol";
import {BinStepManager} from "../src/BinStepManager.sol";
import {BinDistribution} from "../src/libraries/BinDistribution.sol";
import {Strategy} from "../src/libraries/Strategy.sol";

/// @notice Creates a mintable test WETH/USDC pool on the real Base Sepolia
/// PoolManager, started at ETH_PRICE_USD, with one position per strategy.
/// @dev Also runs against an Anvil fork of Base Sepolia.
contract DeployBaseSepolia is Script {
    using PoolIdLibrary for PoolKey;

    IPoolManager constant POOL_MANAGER = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    address constant SWAP_ROUTER = 0x8B5bcC363ddE2614281aD875bad385E0A785D3B9;
    address constant MOCK_FORWARDER = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;

    int24 constant SPACING = 10;
    int24 constant MAX_TICK_DRIFT = 50;
    uint32 constant MIN_REBALANCE_INTERVAL = 300;
    uint64 constant MAX_REPORT_AGE = 3600;
    uint256 constant POSITION_WETH = 100;

    struct Deployed {
        BinStepManager manager;
        BinStepAutomation automation;
        BinStepHook hook;
        MockERC20 weth;
        MockERC20 usdc;
        PoolKey key;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        uint256 ethPriceUsd = vm.envUint("ETH_PRICE_USD");
        address forwarder = vm.envOr("FORWARDER", MOCK_FORWARDER);
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        Deployed memory d = _deployContracts(deployer, forwarder);
        d = _createPool(d, deployer, ethPriceUsd);
        _seedPositions(d, ethPriceUsd);
        vm.stopBroadcast();

        _write(d, ethPriceUsd);
    }

    function _deployContracts(address deployer, address forwarder) private returns (Deployed memory d) {
        d.manager = new BinStepManager(POOL_MANAGER, deployer, MAX_TICK_DRIFT, MIN_REBALANCE_INTERVAL);
        d.automation = new BinStepAutomation(d.manager, forwarder, deployer, MAX_REPORT_AGE);

        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        bytes memory args = abi.encode(address(POOL_MANAGER), address(d.manager));
        (address predicted, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(BinStepHook).creationCode, args);
        d.hook = new BinStepHook{salt: salt}(POOL_MANAGER, address(d.manager));
        require(address(d.hook) == predicted, "hook address mismatch");

        d.manager.setHook(address(d.hook));
        d.manager.setKeeper(address(d.automation));
    }

    function _createPool(Deployed memory d, address deployer, uint256 ethPriceUsd)
        private
        returns (Deployed memory)
    {
        d.weth = new MockERC20("Test WETH", "tWETH", 18);
        d.usdc = new MockERC20("Test USDC", "tUSDC", 6);
        d.weth.mint(deployer, 1_000_000e18);
        d.usdc.mint(deployer, 100_000_000_000e6);

        d.weth.approve(address(d.manager), type(uint256).max);
        d.usdc.approve(address(d.manager), type(uint256).max);
        d.weth.approve(SWAP_ROUTER, type(uint256).max);
        d.usdc.approve(SWAP_ROUTER, type(uint256).max);

        bool wethIsToken0 = address(d.weth) < address(d.usdc);
        d.key = PoolKey({
            currency0: Currency.wrap(wethIsToken0 ? address(d.weth) : address(d.usdc)),
            currency1: Currency.wrap(wethIsToken0 ? address(d.usdc) : address(d.weth)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING,
            hooks: IHooks(address(d.hook))
        });
        POOL_MANAGER.initialize(d.key, _sqrtPriceX96(wethIsToken0, ethPriceUsd));
        return d;
    }

    /// @dev Raw price is token1 base units per token0 base units, so decimals count.
    function _sqrtPriceX96(bool wethIsToken0, uint256 ethPriceUsd) private pure returns (uint160) {
        uint256 usdcPerWeth = ethPriceUsd * 1e6;
        uint256 wethBase = 1e18;
        uint256 ratioX192 = wethIsToken0
            ? FullMath.mulDiv(usdcPerWeth, 1 << 192, wethBase)
            : FullMath.mulDiv(wethBase, 1 << 192, usdcPerWeth);
        return uint160(Math.sqrt(ratioX192));
    }

    function _seedPositions(Deployed memory d, uint256 ethPriceUsd) private {
        bool wethIsToken0 = address(d.weth) < address(d.usdc);
        int24 tick = TickMath.getTickAtSqrtPrice(_sqrtPriceX96(wethIsToken0, ethPriceUsd));
        int24 active = BinDistribution.binOf(tick, SPACING);

        uint256 wethAmount = POSITION_WETH * 1e18;
        uint256 usdcAmount = POSITION_WETH * ethPriceUsd * 1e6;
        uint256 amount0 = wethIsToken0 ? wethAmount : usdcAmount;
        uint256 amount1 = wethIsToken0 ? usdcAmount : wethAmount;

        d.manager.mint(_params(d.key, active - 8, 16, Strategy.Spot, amount0, amount1, tick));
        d.manager.mint(_params(d.key, active - 8, 16, Strategy.Curve, amount0, amount1, tick));
        d.manager.mint(_params(d.key, active - 8, 16, Strategy.BidAsk, amount0, amount1, tick));

        // Depth beyond the test positions, so swaps can move the price past them.
        d.manager.mint(_params(d.key, active - 32, 32, Strategy.Spot, amount0, amount1, tick));
        d.manager.mint(_params(d.key, active + 1, 32, Strategy.Spot, amount0, amount1, tick));
    }

    function _params(
        PoolKey memory key,
        int24 lowerBin,
        uint8 numBins,
        Strategy strategy,
        uint256 amount0,
        uint256 amount1,
        int24 tick
    ) private pure returns (BinStepManager.MintParams memory) {
        return BinStepManager.MintParams({
            key: key,
            lowerBin: lowerBin,
            numBins: numBins,
            strategy: strategy,
            amount0Max: amount0,
            amount1Max: amount1,
            minTick: tick - 100,
            maxTick: tick + 100,
            autoCompound: true,
            autoRebalance: true
        });
    }

    function _write(Deployed memory d, uint256 ethPriceUsd) private {
        string memory json = "deployment";
        vm.serializeAddress(json, "poolManager", address(POOL_MANAGER));
        vm.serializeAddress(json, "swapRouter", SWAP_ROUTER);
        vm.serializeAddress(json, "manager", address(d.manager));
        vm.serializeAddress(json, "automation", address(d.automation));
        vm.serializeAddress(json, "hook", address(d.hook));
        vm.serializeAddress(json, "weth", address(d.weth));
        vm.serializeAddress(json, "usdc", address(d.usdc));
        vm.serializeAddress(json, "token0", Currency.unwrap(d.key.currency0));
        vm.serializeAddress(json, "token1", Currency.unwrap(d.key.currency1));
        vm.serializeBool(json, "wethIsToken0", address(d.weth) < address(d.usdc));
        vm.serializeUint(json, "ethPriceUsd", ethPriceUsd);
        string memory out = vm.serializeBytes32(json, "poolId", PoolId.unwrap(d.key.toId()));
        vm.writeJson(out, "./deployments/base-sepolia.json");
        console2.log("hook", address(d.hook));
        console2.log("automation", address(d.automation));
    }
}
