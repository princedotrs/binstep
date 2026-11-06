// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BinStepFixture} from "./BinStepFixture.sol";
import {BinStepManager} from "../src/BinStepManager.sol";
import {BinStepRegistry} from "../src/BinStepRegistry.sol";
import {BinDistribution} from "../src/libraries/BinDistribution.sol";
import {Strategy} from "../src/libraries/Strategy.sol";

contract BinStepRegistryTest is BinStepFixture {
    using StateLibrary for IPoolManager;

    BinStepRegistry registry;
    address quote;

    function setUp() public {
        setUpPool();
        quote = Currency.unwrap(currency1);
        registry = new BinStepRegistry(manager, address(hook), quote);
    }

    function _keyOf(BinStepRegistry.Listing memory l) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(l.baseIsToken0 ? l.token : quote),
            currency1: Currency.wrap(l.baseIsToken0 ? quote : l.token),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: SPACING,
            hooks: IHooks(address(hook))
        });
    }

    function _create() internal returns (BinStepRegistry.Listing memory) {
        vm.prank(alice);
        registry.create("Alice Coin", "ALC", 2e6);
        return registry.page(registry.count() - 1, 1)[0];
    }

    function test_createListsTheTokenAndItsPool() public {
        BinStepRegistry.Listing memory l = _create();
        assertEq(registry.count(), 1);
        assertEq(l.creator, alice);
        assertEq(l.priceE6, 2e6);
        assertEq(l.name, "Alice Coin");
        assertEq(l.symbol, "ALC");
        assertEq(l.poolId, PoolId.unwrap(_id(l)));
        assertEq(l.baseIsToken0, l.token < quote);

        (uint160 sqrtPrice,,,) = manager.getSlot0(_id(l));
        assertGt(sqrtPrice, 0);
    }

    function _id(BinStepRegistry.Listing memory l) internal view returns (PoolId) {
        PoolKey memory k = _keyOf(l);
        return PoolId.wrap(keccak256(abi.encode(k)));
    }

    function test_theCreatorStartsWithTokens() public {
        BinStepRegistry.Listing memory l = _create();
        assertEq(IERC20(l.token).balanceOf(alice), 50_000e18);
    }

    function test_thePoolStartsAtThePrice() public {
        BinStepRegistry.Listing memory l = _create();
        (, int24 tick,,) = manager.getSlot0(_id(l));
        // 2 USD is 2e6 quote units per 1e18 base units: 1.0001^tick is 2e-12, or its inverse.
        int24 expected = l.baseIsToken0 ? int24(-269_393) : int24(269_393);
        assertApproxEqAbs(tick, expected, 2);
    }

    function test_anyoneCanAddLiquidityAndSwap() public {
        BinStepRegistry.Listing memory l = _create();
        PoolKey memory k = _keyOf(l);
        (, int24 tick,,) = manager.getSlot0(_id(l));
        int24 active = BinDistribution.binOf(tick, SPACING);

        deal(quote, alice, 1_000_000e18);
        vm.startPrank(alice);
        IERC20(l.token).approve(address(lp), type(uint256).max);
        IERC20(quote).approve(address(lp), type(uint256).max);
        IERC20(l.token).approve(address(swapRouter), type(uint256).max);
        uint256 position = lp.mint(
            BinStepManager.MintParams({
                key: k,
                lowerBin: active - 8,
                numBins: 16,
                strategy: Strategy.Spot,
                amount0Max: 1_000e18,
                amount1Max: 1_000e18,
                minTick: ANY_MIN,
                maxTick: ANY_MAX,
                autoCompound: false,
                autoRebalance: false
            })
        );
        assertGt(position, 0);

        uint256 before = IERC20(l.token).balanceOf(alice);
        bool zeroForOne = l.baseIsToken0;
        swapRouter.swap(
            k,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        assertEq(IERC20(l.token).balanceOf(alice), before - 1e18);
    }

    function test_createWorksAtThePriceLimits() public {
        registry.create("Low", "LOW", registry.MIN_PRICE_E6());
        registry.create("High", "HIGH", registry.MAX_PRICE_E6());
        assertEq(registry.count(), 2);
    }

    function test_rejectsAPriceOutsideTheLimits() public {
        uint256 low = registry.MIN_PRICE_E6() - 1;
        uint256 high = registry.MAX_PRICE_E6() + 1;
        vm.expectRevert(abi.encodeWithSelector(BinStepRegistry.InvalidPrice.selector, low));
        registry.create("Low", "LOW", low);
        vm.expectRevert(abi.encodeWithSelector(BinStepRegistry.InvalidPrice.selector, high));
        registry.create("High", "HIGH", high);
    }

    function test_rejectsBadNamesAndSymbols() public {
        vm.expectRevert(BinStepRegistry.InvalidName.selector);
        registry.create("", "OK", 1e6);
        vm.expectRevert(BinStepRegistry.InvalidName.selector);
        registry.create("a name well over the thirty two byte limit", "OK", 1e6);
        vm.expectRevert(BinStepRegistry.InvalidSymbol.selector);
        registry.create("Fine", "", 1e6);
        vm.expectRevert(BinStepRegistry.InvalidSymbol.selector);
        registry.create("Fine", "WELLTOOLONGSYMBOL", 1e6);
    }

    function test_twoTokensCanShareASymbol() public {
        BinStepRegistry.Listing memory first = _create();
        BinStepRegistry.Listing memory second = _create();
        assertTrue(first.token != second.token);
        assertTrue(first.poolId != second.poolId);
    }

    function test_pagesStopAtTheEnd() public {
        _create();
        _create();
        _create();
        assertEq(registry.page(0, 2).length, 2);
        assertEq(registry.page(2, 5).length, 1);
        assertEq(registry.page(3, 5).length, 0);
        assertEq(registry.page(9, 5).length, 0);
    }
}
