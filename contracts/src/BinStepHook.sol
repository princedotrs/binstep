// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Restricts liquidity to the BinStep manager and charges a fee that
/// rises with recent price movement. It never returns swap deltas and never
/// blocks removals, so it cannot take swapper funds or trap LP funds.
contract BinStepHook is BaseHook {
    using LPFeeLibrary for uint24;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 public constant BASE_FEE = 500;
    uint24 public constant FEE_PER_BIN = 100;
    uint24 public constant MAX_FEE = 10_000;
    uint256 public constant DECAY_PERIOD = 60;

    uint256 private constant MAX_VOLATILITY = (MAX_FEE - BASE_FEE) / FEE_PER_BIN;

    struct FeeState {
        int24 lastTick;
        uint40 lastUpdate;
        uint32 volatility;
    }

    address public immutable manager;
    mapping(PoolId => FeeState) public feeStates;

    error OnlyManager(address sender);
    error DynamicFeeRequired();

    constructor(IPoolManager poolManager_, address manager_) BaseHook(poolManager_) {
        manager = manager_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: true,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice The LP fee, in hundredths of a bip, the next swap would pay.
    function currentFee(PoolId id) public view returns (uint24) {
        uint256 volatility = _decayedVolatility(feeStates[id]);
        return uint24(BASE_FEE + volatility * FEE_PER_BIN);
    }

    function _beforeInitialize(address, PoolKey calldata key, uint160) internal pure override returns (bytes4) {
        if (!key.fee.isDynamicFee()) revert DynamicFeeRequired();
        return this.beforeInitialize.selector;
    }

    function _afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        internal
        override
        returns (bytes4)
    {
        feeStates[key.toId()] = FeeState({lastTick: tick, lastUpdate: uint40(block.timestamp), volatility: 0});
        return this.afterInitialize.selector;
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (sender != manager) revert OnlyManager(sender);
        return this.beforeAddLiquidity.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint24 fee = currentFee(key.toId()) | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee);
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        FeeState storage state = feeStates[id];
        (, int24 tick,,) = poolManager.getSlot0(id);

        int256 change = _binOf(tick, key.tickSpacing) - _binOf(state.lastTick, key.tickSpacing);
        uint256 binsMoved = change < 0 ? uint256(-change) : uint256(change);
        uint256 volatility = _decayedVolatility(state) + binsMoved;

        state.volatility = uint32(volatility > MAX_VOLATILITY ? MAX_VOLATILITY : volatility);
        state.lastTick = tick;
        state.lastUpdate = uint40(block.timestamp);
        return (this.afterSwap.selector, 0);
    }

    /// @dev Floors toward negative infinity so that bin -1 covers ticks [-spacing, 0).
    function _binOf(int24 tick, int24 spacing) private pure returns (int256 bin) {
        bin = int256(tick) / spacing;
        if (tick < 0 && tick % spacing != 0) bin -= 1;
    }

    function _decayedVolatility(FeeState memory state) private view returns (uint256) {
        uint256 halvings = (block.timestamp - state.lastUpdate) / DECAY_PERIOD;
        return halvings >= 32 ? 0 : uint256(state.volatility) >> halvings;
    }
}
