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
import {BinDistribution} from "./libraries/BinDistribution.sol";

/// @notice Restricts liquidity to the BinStep manager, charges a Meteora DLMM
/// style volatility fee, and keeps a time-weighted price that v4 pools lack. It
/// never returns swap deltas and never blocks removals, so it cannot take
/// swapper funds or trap LP funds.
/// @dev A bin is one tickSpacing wide. One tick is 1 bp of price, so tickSpacing
/// plays the role of Meteora's binStep. Fee math follows Meteora's published
/// formulas, with its 1e9 fee rates converted to v4's 1e6 units. v4 fixes the fee
/// for a whole swap, so unlike Meteora it cannot step up per bin inside one swap.
contract BinStepHook is BaseHook {
    using LPFeeLibrary for uint24;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 public constant BASE_FEE = 500;
    uint24 public constant MAX_FEE = 10_000;

    uint256 public constant VARIABLE_FEE_CONTROL = 100_000;
    uint256 public constant MAX_VOLATILITY_ACCUMULATOR = 350_000;
    uint256 public constant VOLATILITY_PER_BIN = 10_000;
    uint256 public constant REDUCTION_FACTOR = 5_000;
    uint256 public constant FILTER_PERIOD = 30;
    uint256 public constant DECAY_PERIOD = 600;

    /// @notice Seconds a price must hold before the stable tick fully reflects it.
    uint256 public constant STABLE_WINDOW = 300;

    uint256 private constant BPS = 10_000;
    uint256 private constant VARIABLE_FEE_PRECISION = 1e11;
    uint256 private constant FEE_UNIT_CONVERSION = 1_000;

    struct PoolState {
        int24 lastTick;
        int24 stableTick;
        int24 indexReference;
        int24 tickSpacing;
        uint40 lastUpdate;
        uint32 volatilityReference;
        uint32 volatilityAccumulator;
    }

    address public immutable manager;
    mapping(PoolId => PoolState) public poolStates;

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
        PoolState memory state = poolStates[id];
        int24 activeBin = BinDistribution.binOf(state.lastTick, state.tickSpacing);
        (int24 indexReference, uint256 volatilityReference) = _references(state, activeBin);
        uint256 accumulator = _accumulator(volatilityReference, indexReference, activeBin);
        return _fee(accumulator, state.tickSpacing);
    }

    /// @notice A time-weighted tick. Price moves in the current block do not affect
    /// it, so moving it means holding a manipulated price for real time.
    function stableTick(PoolId id) external view returns (int24) {
        return _stableTick(poolStates[id]);
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
        poolStates[key.toId()] = PoolState({
            lastTick: tick,
            stableTick: tick,
            indexReference: BinDistribution.binOf(tick, key.tickSpacing),
            tickSpacing: key.tickSpacing,
            lastUpdate: uint40(block.timestamp),
            volatilityReference: 0,
            volatilityAccumulator: 0
        });
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
        PoolState storage state = poolStates[id];
        PoolState memory previous = state;
        (, int24 tick,,) = poolManager.getSlot0(id);

        int24 previousBin = BinDistribution.binOf(previous.lastTick, previous.tickSpacing);
        (int24 indexReference, uint256 volatilityReference) = _references(previous, previousBin);
        int24 activeBin = BinDistribution.binOf(tick, previous.tickSpacing);

        state.stableTick = _stableTick(previous);
        state.lastTick = tick;
        state.indexReference = indexReference;
        state.volatilityReference = uint32(volatilityReference);
        state.volatilityAccumulator = uint32(_accumulator(volatilityReference, indexReference, activeBin));
        state.lastUpdate = uint40(block.timestamp);
        return (this.afterSwap.selector, 0);
    }

    /// @dev Rapid swaps share a reference, moderate gaps reduce it, long gaps reset it.
    function _references(PoolState memory state, int24 activeBin)
        private
        view
        returns (int24 indexReference, uint256 volatilityReference)
    {
        uint256 elapsed = block.timestamp - state.lastUpdate;
        if (elapsed < FILTER_PERIOD) return (state.indexReference, state.volatilityReference);
        if (elapsed < DECAY_PERIOD) return (activeBin, state.volatilityAccumulator * REDUCTION_FACTOR / BPS);
        return (activeBin, 0);
    }

    function _accumulator(uint256 volatilityReference, int24 indexReference, int24 activeBin)
        private
        pure
        returns (uint256)
    {
        int256 distance = int256(indexReference) - int256(activeBin);
        uint256 binsMoved = distance < 0 ? uint256(-distance) : uint256(distance);
        uint256 accumulator = volatilityReference + binsMoved * VOLATILITY_PER_BIN;
        return accumulator > MAX_VOLATILITY_ACCUMULATOR ? MAX_VOLATILITY_ACCUMULATOR : accumulator;
    }

    function _fee(uint256 accumulator, int24 binStep) private pure returns (uint24) {
        uint256 step = accumulator * uint24(binStep);
        uint256 variable1e9 = _divUp(VARIABLE_FEE_CONTROL * step * step, VARIABLE_FEE_PRECISION);
        uint256 fee = BASE_FEE + _divUp(variable1e9, FEE_UNIT_CONVERSION);
        return fee > MAX_FEE ? MAX_FEE : uint24(fee);
    }

    /// @dev The price held since the last swap pulls the average toward itself.
    function _stableTick(PoolState memory state) private view returns (int24) {
        uint256 elapsed = block.timestamp - state.lastUpdate;
        if (elapsed >= STABLE_WINDOW) return state.lastTick;
        int256 gap = int256(state.lastTick) - int256(state.stableTick);
        return int24(int256(state.stableTick) + gap * int256(elapsed) / int256(STABLE_WINDOW));
    }

    function _divUp(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : (numerator - 1) / denominator + 1;
    }
}
