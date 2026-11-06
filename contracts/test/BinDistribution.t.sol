// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {Strategy, StrategyLib} from "../src/libraries/Strategy.sol";
import {BinDistribution} from "../src/libraries/BinDistribution.sol";

contract BinDistributionTest is Test {
    int24 constant SPACING = 10;

    function _weights(Strategy s, uint256 n) internal pure returns (uint256[] memory) {
        return StrategyLib.weights(s, n);
    }

    function test_spotIsUniform() public pure {
        uint256[] memory w = _weights(Strategy.Spot, 5);
        for (uint256 i; i < 5; ++i) assertEq(w[i], 1);
    }

    function test_curvePeaksInTheMiddle() public pure {
        uint256[] memory w = _weights(Strategy.Curve, 5);
        assertEq(w[0], 1);
        assertEq(w[1], 3);
        assertEq(w[2], 5);
        assertEq(w[3], 3);
        assertEq(w[4], 1);
    }

    function test_bidAskPeaksAtTheEdges() public pure {
        uint256[] memory w = _weights(Strategy.BidAsk, 5);
        assertEq(w[0], 5);
        assertEq(w[1], 3);
        assertEq(w[2], 1);
        assertEq(w[3], 3);
        assertEq(w[4], 5);
    }

    function test_evenBinCountsStaySymmetricAndNonZero() public pure {
        uint256[] memory curve = _weights(Strategy.Curve, 4);
        assertEq(curve[0], 1);
        assertEq(curve[1], 3);
        assertEq(curve[2], 3);
        assertEq(curve[3], 1);
    }

    function test_binsAboveHoldToken0AndBelowHoldToken1() public pure {
        // Price sits in bin 0, range covers bins -2..2.
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(5);
        uint128[] memory l =
            BinDistribution.distribute(sqrtP, 5, -2, SPACING, _weights(Strategy.Spot, 5), 1e18, 1e18);
        for (uint256 i; i < 5; ++i) assertGt(l[i], 0);
        // Uniform weight on each side.
        assertEq(l[0], l[1]);
        assertEq(l[3], l[4]);
    }

    function test_oneSidedToken1OnlyFillsBinsBelow() public pure {
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(5);
        uint128[] memory l =
            BinDistribution.distribute(sqrtP, 5, -2, SPACING, _weights(Strategy.Spot, 5), 0, 1e18);
        assertGt(l[0], 0);
        assertGt(l[1], 0);
        assertEq(l[2], 0);
        assertEq(l[3], 0);
        assertEq(l[4], 0);
    }

    function test_oneSidedToken0OnlyFillsBinsAbove() public pure {
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(5);
        uint128[] memory l =
            BinDistribution.distribute(sqrtP, 5, -2, SPACING, _weights(Strategy.Spot, 5), 1e18, 0);
        assertEq(l[0], 0);
        assertEq(l[1], 0);
        assertEq(l[2], 0);
        assertGt(l[3], 0);
        assertGt(l[4], 0);
    }

    function test_rangeEntirelyBelowPriceIgnoresToken0() public pure {
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(500);
        uint128[] memory l =
            BinDistribution.distribute(sqrtP, 500, -2, SPACING, _weights(Strategy.Spot, 3), 1e18, 1e18);
        assertGt(l[0], 0);
        assertEq(l[0], l[2]);
    }

    function test_priceExactlyOnBinBoundary() public pure {
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(0);
        uint128[] memory l =
            BinDistribution.distribute(sqrtP, 0, -1, SPACING, _weights(Strategy.Spot, 2), 1e18, 1e18);
        assertGt(l[0], 0);
        assertGt(l[1], 0);
    }

    function test_nothingAvailableMeansNoLiquidity() public pure {
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(5);
        uint128[] memory l =
            BinDistribution.distribute(sqrtP, 5, -2, SPACING, _weights(Strategy.Curve, 5), 0, 0);
        for (uint256 i; i < 5; ++i) assertEq(l[i], 0);
    }

    function testFuzz_neverSpendsMoreThanTheBudget(
        uint96 amount0,
        uint96 amount1,
        int24 tickSeed,
        int24 lowerBin,
        uint8 numBinsSeed,
        uint8 shape
    ) public pure {
        uint256 n = bound(numBinsSeed, 1, 32);
        int24 lower = int24(bound(lowerBin, -2000, 2000));
        int24 tick = int24(bound(tickSeed, -30000, 30000));
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(tick);

        uint128[] memory l =
            BinDistribution.distribute(sqrtP, tick, lower, SPACING, _weights(Strategy(shape % 3), n), amount0, amount1);

        (uint256 spent0, uint256 spent1) = _spent(l, lower, tick, sqrtP);
        assertLe(spent0, amount0);
        assertLe(spent1, amount1);
    }

    function _spent(uint128[] memory l, int24 lower, int24 tick, uint160 sqrtP)
        internal
        pure
        returns (uint256 spent0, uint256 spent1)
    {
        for (uint256 i; i < l.length; ++i) {
            if (l[i] == 0) continue;
            int24 lo = (lower + int24(int256(i))) * SPACING;
            int24 hi = lo + SPACING;
            uint160 a = TickMath.getSqrtPriceAtTick(lo);
            uint160 b = TickMath.getSqrtPriceAtTick(hi);
            if (tick < lo) {
                spent0 += SqrtPriceMath.getAmount0Delta(a, b, l[i], true);
            } else if (tick >= hi) {
                spent1 += SqrtPriceMath.getAmount1Delta(a, b, l[i], true);
            } else {
                spent0 += SqrtPriceMath.getAmount0Delta(sqrtP, b, l[i], true);
                spent1 += SqrtPriceMath.getAmount1Delta(a, sqrtP, l[i], true);
            }
        }
    }
}
