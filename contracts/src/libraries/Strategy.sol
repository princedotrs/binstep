// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

enum Strategy {
    Spot,
    Curve,
    BidAsk
}

/// @notice Integer liquidity weights for each supported shape.
library StrategyLib {
    function weights(Strategy strategy, uint256 numBins) internal pure returns (uint256[] memory w) {
        w = new uint256[](numBins);
        for (uint256 i; i < numBins; ++i) {
            uint256 twice = 2 * i;
            uint256 last = numBins - 1;
            uint256 distance = twice > last ? twice - last : last - twice;
            if (strategy == Strategy.Spot) w[i] = 1;
            else if (strategy == Strategy.Curve) w[i] = numBins - distance;
            else w[i] = distance + 1;
        }
    }
}
