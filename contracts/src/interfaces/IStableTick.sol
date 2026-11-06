// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IStableTick {
    function stableTick(PoolId id) external view returns (int24);
}
