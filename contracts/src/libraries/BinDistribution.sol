// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Turns strategy weights and token budgets into per-bin liquidity.
/// @dev Bin `b` covers ticks [b * spacing, (b + 1) * spacing). Each side of the
/// active bin scales to its own token, which is what makes one-sided deposits work.
library BinDistribution {
    using SafeCast for uint256;

    uint128 private constant UNIT = 1e18;

    struct Costs {
        uint256 above0;
        uint256 below1;
        uint256 active0;
        uint256 active1;
        uint256 activeIndex;
        bool hasActive;
    }

    /// @dev Floors toward negative infinity so that bin -1 covers ticks [-spacing, 0).
    function binOf(int24 tick, int24 spacing) internal pure returns (int24 bin) {
        bin = tick / spacing;
        if (tick < 0 && tick % spacing != 0) bin -= 1;
    }

    function tickLower(int24 lowerBin, uint256 index, int24 spacing) internal pure returns (int24) {
        return int24((int256(lowerBin) + int256(index)) * spacing);
    }

    /// @param amount0 Token0 budget. The result never spends more than this.
    /// @param amount1 Token1 budget. The result never spends more than this.
    function distribute(
        uint160 sqrtPriceX96,
        int24 tick,
        int24 lowerBin,
        int24 spacing,
        uint256[] memory weights,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128[] memory liquidity) {
        uint256 n = weights.length;
        liquidity = new uint128[](n);

        Costs memory c = _costs(sqrtPriceX96, tick, lowerBin, spacing, weights);

        // Each bin's settlement rounds up by at most one wei.
        uint256 budget0 = amount0 > n ? amount0 - n : 0;
        uint256 budget1 = amount1 > n ? amount1 - n : 0;

        // The active bin needs both tokens, so it is unusable if one is missing.
        bool useActive = c.hasActive && (c.active0 == 0 || budget0 > 0) && (c.active1 == 0 || budget1 > 0);
        uint256 cost0 = c.above0 + (useActive ? c.active0 : 0);
        uint256 cost1 = c.below1 + (useActive ? c.active1 : 0);
        uint256 k0 = cost0 == 0 ? 0 : FullMath.mulDiv(budget0, UNIT, cost0);
        uint256 k1 = cost1 == 0 ? 0 : FullMath.mulDiv(budget1, UNIT, cost1);

        uint256 kActive;
        if (useActive) {
            if (c.active0 > 0 && c.active1 > 0) kActive = k0 < k1 ? k0 : k1;
            else kActive = c.active0 > 0 ? k0 : k1;
        }

        for (uint256 i; i < n; ++i) {
            uint256 k;
            if (c.hasActive && i == c.activeIndex) k = kActive;
            else if (tick < tickLower(lowerBin, i, spacing)) k = k0;
            else k = k1;
            liquidity[i] = (weights[i] * k).toUint128();
        }
    }

    function _costs(uint160 sqrtPriceX96, int24 tick, int24 lowerBin, int24 spacing, uint256[] memory weights)
        private
        pure
        returns (Costs memory c)
    {
        for (uint256 i; i < weights.length; ++i) {
            int24 lower = tickLower(lowerBin, i, spacing);
            int24 upper = lower + spacing;
            uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
            uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upper);
            uint256 w = weights[i];

            if (tick < lower) {
                c.above0 += w * SqrtPriceMath.getAmount0Delta(sqrtLower, sqrtUpper, UNIT, true);
            } else if (tick >= upper) {
                c.below1 += w * SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, UNIT, true);
            } else {
                c.hasActive = true;
                c.activeIndex = i;
                c.active0 = w * SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtUpper, UNIT, true);
                c.active1 = w * SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtPriceX96, UNIT, true);
            }
        }
    }
}
