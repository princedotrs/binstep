// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {BinStepManager} from "../src/BinStepManager.sol";
import {BinDistribution} from "../src/libraries/BinDistribution.sol";
import {Strategy} from "../src/libraries/Strategy.sol";

/// @notice Adds mintable test markets against tUSDC to an existing BinStep deployment.
/// The hook and manager are shared, so each market only needs a token, a pool and liquidity.
/// @dev Positions are not automated, because the automation workflow only prices ETH.
/// Prices are reference points for test tokens, taken in November 2026. Nothing pegs them.
contract DeployMarkets is Script {
    using PoolIdLibrary for PoolKey;

    struct Listing {
        string name;
        string symbol;
        uint8 decimals;
        uint256 priceE6;
    }

    int24 constant SPACING = 10;
    uint256 constant POSITION_USD = 220_000;
    uint256 constant POSITIONS = 3;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);
        string memory deployment = vm.readFile(vm.envOr("DEPLOYMENT_FILE", string("./deployments/base-sepolia.json")));
        IPoolManager poolManager = IPoolManager(vm.parseJsonAddress(deployment, ".poolManager"));
        BinStepManager manager = BinStepManager(vm.parseJsonAddress(deployment, ".manager"));
        address hook = vm.parseJsonAddress(deployment, ".hook");
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(deployment, ".usdc"));

        Listing[] memory listings = _listings();
        string memory out = "[";

        vm.startBroadcast(deployerKey);
        usdc.mint(deployer, POSITION_USD * POSITIONS * listings.length * 1e6);
        usdc.approve(address(manager), type(uint256).max);
        for (uint256 i; i < listings.length; ++i) {
            string memory entry = _list(listings[i], deployer, poolManager, manager, hook, address(usdc));
            out = string.concat(out, i == 0 ? "" : ",", entry);
        }
        vm.stopBroadcast();

        vm.writeFile(vm.envOr("MARKETS_FILE", string("./deployments/base-sepolia.markets.json")), string.concat(out, "]"));
    }

    function _listings() private pure returns (Listing[] memory list) {
        list = new Listing[](7);
        list[0] = Listing("Test Wrapped Bitcoin", "tWBTC", 8, 75_926e6);
        list[1] = Listing("Test Zcash", "tZEC", 8, 1_307e6);
        list[2] = Listing("Test Staked Ether", "tstETH", 18, 2_234e6);
        list[3] = Listing("Test NVIDIA", "tNVDA", 18, 220e6);
        list[4] = Listing("Test Gold", "tXAU", 18, 4_062e6);
        list[5] = Listing("Test WTI Crude", "tWTI", 18, 91e6);
        list[6] = Listing("Test OUSG", "tOUSG", 18, 116e6);
    }

    function _list(
        Listing memory listing,
        address deployer,
        IPoolManager poolManager,
        BinStepManager manager,
        address hook,
        address usdc
    ) private returns (string memory) {
        uint256 baseAmount = FullMath.mulDiv(POSITION_USD * 1e6, 10 ** listing.decimals, listing.priceE6);
        MockERC20 token = new MockERC20(listing.name, listing.symbol, listing.decimals);
        token.mint(deployer, baseAmount * POSITIONS);
        token.approve(address(manager), type(uint256).max);

        bool baseIsToken0 = address(token) < usdc;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(baseIsToken0 ? address(token) : usdc),
            currency1: Currency.wrap(baseIsToken0 ? usdc : address(token)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING,
            hooks: IHooks(hook)
        });
        uint160 sqrtPrice = _sqrtPriceX96(baseIsToken0, listing);
        poolManager.initialize(key, sqrtPrice);

        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPrice);
        int24 active = BinDistribution.binOf(tick, SPACING);
        uint256 usdcAmount = POSITION_USD * 1e6;
        uint256 amount0 = baseIsToken0 ? baseAmount : usdcAmount;
        uint256 amount1 = baseIsToken0 ? usdcAmount : baseAmount;

        manager.mint(_params(key, active - 8, 16, Strategy.Curve, amount0, amount1, tick));
        manager.mint(_params(key, active - 32, 32, Strategy.Spot, amount0, amount1, tick));
        manager.mint(_params(key, active + 1, 32, Strategy.Spot, amount0, amount1, tick));

        console2.log(listing.symbol, address(token));
        return string.concat(
            '{"symbol":"', listing.symbol,
            '","decimals":', vm.toString(uint256(listing.decimals)),
            ',"token":"', vm.toString(address(token)),
            '","poolId":"', vm.toString(PoolId.unwrap(key.toId())),
            '","baseIsToken0":', vm.toString(baseIsToken0), "}"
        );
    }

    /// @dev Raw price is token1 base units per token0 base units, so decimals count.
    function _sqrtPriceX96(bool baseIsToken0, Listing memory listing) private pure returns (uint160) {
        uint256 baseUnit = 10 ** listing.decimals;
        uint256 ratioX192 = baseIsToken0
            ? FullMath.mulDiv(listing.priceE6, 1 << 192, baseUnit)
            : FullMath.mulDiv(baseUnit, 1 << 192, listing.priceE6);
        return uint160(Math.sqrt(ratioX192));
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
            autoCompound: false,
            autoRebalance: false
        });
    }
}
