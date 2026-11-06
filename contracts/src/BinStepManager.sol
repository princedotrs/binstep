// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {FixedPoint128} from "@uniswap/v4-core/src/libraries/FixedPoint128.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IStableTick} from "./interfaces/IStableTick.sol";
import {BinDistribution} from "./libraries/BinDistribution.sol";
import {Strategy, StrategyLib} from "./libraries/Strategy.sol";

/// @notice Owns every BinStep position in the PoolManager. The position id is
/// the v4 salt, so each position earns and collects its own fees.
contract BinStepManager is IUnlockCallback, Ownable {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    uint8 public constant MAX_BINS = 32;

    /// @dev Compound weights keep each bin's share of the position to this precision.
    uint256 private constant WEIGHT_PRECISION = 1e6;

    struct Position {
        address owner;
        PoolKey key;
        int24 lowerBin;
        uint8 numBins;
        Strategy strategy;
        bool autoCompound;
        bool autoRebalance;
        uint256 idle0;
        uint256 idle1;
    }

    struct MintParams {
        PoolKey key;
        int24 lowerBin;
        uint8 numBins;
        Strategy strategy;
        uint256 amount0Max;
        uint256 amount1Max;
        int24 minTick;
        int24 maxTick;
        bool autoCompound;
        bool autoRebalance;
    }

    /// @notice Everything an automation run needs for one position, in one read.
    struct PositionSnapshot {
        uint256 positionId;
        address owner;
        PoolId poolId;
        int24 lowerBin;
        uint8 numBins;
        bool autoCompound;
        bool autoRebalance;
        bool inRange;
        int24 successorLowerBin;
        int24 liveTick;
        int24 stableTick;
        uint256 pending0;
        uint256 pending1;
        uint256 idle0;
        uint256 idle1;
        uint256 nextRebalanceAt;
    }

    enum Op {
        Mint,
        Compound,
        Rebalance,
        Close
    }

    IPoolManager public immutable poolManager;
    address public hook;
    address public keeper;
    uint256 public lastPositionId;

    /// @notice Most the live price may sit from the hook's stable tick for keeper actions.
    int24 public maxTickDrift;
    /// @notice Least time between keeper rebalances of one position.
    uint32 public minRebalanceInterval;

    mapping(uint256 => Position) private positions;
    mapping(uint256 => uint128[]) private binLiquidity;
    mapping(uint256 => uint256) public lastKeeperRebalance;

    event HookSet(address hook);
    event KeeperSet(address keeper);
    event KeeperLimitsSet(int24 maxTickDrift, uint32 minRebalanceInterval);
    event AutomationSet(uint256 indexed positionId, bool autoCompound, bool autoRebalance);
    event Minted(uint256 indexed positionId, address indexed owner, PoolId indexed poolId, int24 lowerBin, uint8 numBins, Strategy strategy);
    event Compounded(uint256 indexed positionId, uint256 fees0, uint256 fees1);
    event Rebalanced(uint256 indexed positionId, int24 oldLowerBin, int24 newLowerBin);
    event Closed(uint256 indexed positionId, uint256 amount0, uint256 amount1);

    error OnlyPoolManager();
    error HookAlreadySet();
    error UnsupportedPool();
    error PoolNotInitialized();
    error InvalidBinCount(uint8 numBins);
    error NoLiquidity();
    error NotAuthorized(address caller);
    error TickOutOfBounds(int24 tick);
    error PriceNotStable(int24 liveTick, int24 stableTick);
    error RebalanceTooSoon(uint256 nextAllowedAt);
    error PositionInRange();
    error NothingToRebalance();

    constructor(IPoolManager poolManager_, address owner_, int24 maxTickDrift_, uint32 minRebalanceInterval_)
        Ownable(owner_)
    {
        poolManager = poolManager_;
        maxTickDrift = maxTickDrift_;
        minRebalanceInterval = minRebalanceInterval_;
    }

    function setHook(address hook_) external onlyOwner {
        if (hook != address(0)) revert HookAlreadySet();
        hook = hook_;
        emit HookSet(hook_);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setKeeperLimits(int24 maxTickDrift_, uint32 minRebalanceInterval_) external onlyOwner {
        maxTickDrift = maxTickDrift_;
        minRebalanceInterval = minRebalanceInterval_;
        emit KeeperLimitsSet(maxTickDrift_, minRebalanceInterval_);
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    function getBinLiquidity(uint256 positionId) external view returns (uint128[] memory) {
        return binLiquidity[positionId];
    }

    /// @notice Fees earned across all of a position's bins and not yet collected.
    function pendingFees(uint256 positionId) public view returns (uint256 amount0, uint256 amount1) {
        Position storage p = positions[positionId];
        uint128[] memory bins = binLiquidity[positionId];
        PoolId poolId = p.key.toId();
        int24 spacing = p.key.tickSpacing;

        for (uint256 i; i < bins.length; ++i) {
            if (bins[i] == 0) continue;
            int24 lower = BinDistribution.tickLower(p.lowerBin, i, spacing);
            int24 upper = lower + spacing;
            (uint256 inside0, uint256 inside1) = poolManager.getFeeGrowthInside(poolId, lower, upper);
            (, uint256 last0, uint256 last1) =
                poolManager.getPositionInfo(poolId, address(this), lower, upper, bytes32(positionId));
            unchecked {
                amount0 += FullMath.mulDiv(inside0 - last0, bins[i], FixedPoint128.Q128);
                amount1 += FullMath.mulDiv(inside1 - last1, bins[i], FixedPoint128.Q128);
            }
        }
    }

    /// @notice Open positions with ids in [firstId, firstId + count).
    /// @dev One call, because CRE allows 15 chain reads per run and a position has
    /// up to 32 bins.
    function automationSnapshot(uint256 firstId, uint256 count)
        external
        view
        returns (PositionSnapshot[] memory snapshots)
    {
        uint256 end = firstId + count > lastPositionId + 1 ? lastPositionId + 1 : firstId + count;
        uint256 found;
        snapshots = new PositionSnapshot[](end > firstId ? end - firstId : 0);
        for (uint256 id = firstId; id < end; ++id) {
            if (positions[id].owner == address(0)) continue;
            snapshots[found++] = _snapshot(id);
        }
        assembly ("memory-safe") {
            mstore(snapshots, found)
        }
    }

    function _snapshot(uint256 id) private view returns (PositionSnapshot memory s) {
        Position storage p = positions[id];
        PoolId poolId = p.key.toId();
        (, int24 tick,,) = poolManager.getSlot0(poolId);
        int24 activeBin = BinDistribution.binOf(tick, p.key.tickSpacing);
        bool inRange = activeBin >= p.lowerBin && activeBin < p.lowerBin + int24(uint24(p.numBins));
        (uint256 pending0, uint256 pending1) = pendingFees(id);
        uint256 last = lastKeeperRebalance[id];

        s.positionId = id;
        s.owner = p.owner;
        s.poolId = poolId;
        s.lowerBin = p.lowerBin;
        s.numBins = p.numBins;
        s.autoCompound = p.autoCompound;
        s.autoRebalance = p.autoRebalance;
        s.inRange = inRange;
        s.successorLowerBin = inRange ? p.lowerBin : successorLowerBin(id);
        s.liveTick = tick;
        s.stableTick = IStableTick(address(p.key.hooks)).stableTick(poolId);
        s.pending0 = pending0;
        s.pending1 = pending1;
        s.idle0 = p.idle0;
        s.idle1 = p.idle1;
        s.nextRebalanceAt = last == 0 ? 0 : last + minRebalanceInterval;
    }

    function mint(MintParams calldata params) external returns (uint256 positionId) {
        if (address(params.key.hooks) != hook || hook == address(0)) revert UnsupportedPool();
        if (Currency.unwrap(params.key.currency0) == address(0)) revert UnsupportedPool();
        if (params.numBins == 0 || params.numBins > MAX_BINS) revert InvalidBinCount(params.numBins);
        _checkTick(params.key, params.minTick, params.maxTick);

        positionId = ++lastPositionId;
        positions[positionId] = Position({
            owner: msg.sender,
            key: params.key,
            lowerBin: params.lowerBin,
            numBins: params.numBins,
            strategy: params.strategy,
            autoCompound: params.autoCompound,
            autoRebalance: params.autoRebalance,
            idle0: 0,
            idle1: 0
        });
        binLiquidity[positionId] = new uint128[](params.numBins);

        poolManager.unlock(abi.encode(Op.Mint, positionId, params.amount0Max, params.amount1Max));
        emit Minted(positionId, msg.sender, params.key.toId(), params.lowerBin, params.numBins, params.strategy);
    }

    function setAutomation(uint256 positionId, bool autoCompound, bool autoRebalance) external {
        Position storage p = positions[positionId];
        if (msg.sender != p.owner) revert NotAuthorized(msg.sender);
        p.autoCompound = autoCompound;
        p.autoRebalance = autoRebalance;
        emit AutomationSet(positionId, autoCompound, autoRebalance);
    }

    /// @notice Reinvests collected fees and idle balances into the current bins.
    function compound(uint256 positionId, int24 minTick, int24 maxTick) external {
        Position storage p = positions[positionId];
        if (msg.sender != p.owner) revert NotAuthorized(msg.sender);
        _checkTick(p.key, minTick, maxTick);
        poolManager.unlock(abi.encode(Op.Compound, positionId, uint256(0), uint256(0)));
    }

    /// @notice Moves the whole position to a chosen range without swapping.
    /// @dev Tokens the new range cannot hold stay on the position as idle balance.
    function rebalance(uint256 positionId, int24 newLowerBin, int24 minTick, int24 maxTick) external {
        Position storage p = positions[positionId];
        if (msg.sender != p.owner) revert NotAuthorized(msg.sender);
        _checkTick(p.key, minTick, maxTick);
        poolManager.unlock(abi.encode(Op.Rebalance, positionId, uint256(int256(newLowerBin)), uint256(0)));
    }

    /// @notice Keeper compound for an opted-in position while the price is stable.
    function keeperCompound(uint256 positionId) external {
        Position storage p = positions[positionId];
        if (msg.sender != keeper || !p.autoCompound) revert NotAuthorized(msg.sender);
        _checkStable(p.key);
        poolManager.unlock(abi.encode(Op.Compound, positionId, uint256(0), uint256(0)));
    }

    /// @notice Keeper rebalance for an opted-in position that has left its range.
    /// @dev The keeper only says when. The contract derives where, so a bad report
    /// cannot choose a range. See `successorLowerBin`.
    function keeperRebalance(uint256 positionId) external {
        Position storage p = positions[positionId];
        if (msg.sender != keeper || !p.autoRebalance) revert NotAuthorized(msg.sender);
        _checkStable(p.key);

        uint256 last = lastKeeperRebalance[positionId];
        if (last != 0 && block.timestamp < last + minRebalanceInterval) {
            revert RebalanceTooSoon(last + minRebalanceInterval);
        }

        int24 newLowerBin = successorLowerBin(positionId);
        if (newLowerBin == p.lowerBin) revert NothingToRebalance();

        lastKeeperRebalance[positionId] = block.timestamp;
        poolManager.unlock(abi.encode(Op.Rebalance, positionId, uint256(int256(newLowerBin)), uint256(0)));
    }

    /// @notice Where a keeper rebalance would put an out-of-range position.
    /// @dev An out-of-range position holds one token, which can only sit on one side
    /// of the price. The successor is the same width, directly beside the active
    /// bin. It earns nothing until the price comes back to it: this is a limit-order
    /// style re-entry, not a re-centre, which would need a swap.
    function successorLowerBin(uint256 positionId) public view returns (int24) {
        Position storage p = positions[positionId];
        int24 spacing = p.key.tickSpacing;
        (, int24 tick,,) = poolManager.getSlot0(p.key.toId());
        int24 activeBin = BinDistribution.binOf(tick, spacing);
        int24 numBins = int24(uint24(p.numBins));

        if (activeBin >= p.lowerBin + numBins) return activeBin - numBins;
        if (activeBin < p.lowerBin) return activeBin + 1;
        revert PositionInRange();
    }

    function close(uint256 positionId) external {
        Position storage p = positions[positionId];
        if (msg.sender != p.owner) revert NotAuthorized(msg.sender);
        poolManager.unlock(abi.encode(Op.Close, positionId, uint256(0), uint256(0)));
        delete positions[positionId];
        delete binLiquidity[positionId];
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (Op op, uint256 id, uint256 arg0, uint256 arg1) = abi.decode(data, (Op, uint256, uint256, uint256));
        Position storage p = positions[id];

        if (op == Op.Mint) _onMint(p, id, arg0, arg1);
        else if (op == Op.Compound) _onCompound(p, id);
        else if (op == Op.Rebalance) _onRebalance(p, id, int24(int256(arg0)));
        else _onClose(p, id);
        return "";
    }

    function _onMint(Position storage p, uint256 id, uint256 amount0Max, uint256 amount1Max) private {
        uint256[] memory weights = StrategyLib.weights(p.strategy, p.numBins);
        (int256 delta0, int256 delta1, bool added) = _deploy(p, id, weights, amount0Max, amount1Max);
        if (!added) revert NoLiquidity();
        _pay(p.key.currency0, p.owner, uint256(-delta0));
        _pay(p.key.currency1, p.owner, uint256(-delta1));
    }

    function _onCompound(Position storage p, uint256 id) private {
        (int256 fees0, int256 fees1) = _pull(p, id, false);
        uint256[] memory weights = _compoundWeights(p, id);
        (int256 spent0, int256 spent1,) = _deploy(p, id, weights, p.idle0 + uint256(fees0), p.idle1 + uint256(fees1));
        _settleIdle(p, fees0 + spent0, fees1 + spent1);
        emit Compounded(id, uint256(fees0), uint256(fees1));
    }

    function _onRebalance(Position storage p, uint256 id, int24 newLowerBin) private {
        int24 oldLowerBin = p.lowerBin;
        (int256 out0, int256 out1) = _pull(p, id, true);
        p.lowerBin = newLowerBin;
        uint256[] memory weights = StrategyLib.weights(p.strategy, p.numBins);
        (int256 spent0, int256 spent1,) = _deploy(p, id, weights, p.idle0 + uint256(out0), p.idle1 + uint256(out1));
        _settleIdle(p, out0 + spent0, out1 + spent1);
        emit Rebalanced(id, oldLowerBin, newLowerBin);
    }

    function _onClose(Position storage p, uint256 id) private {
        (int256 out0, int256 out1) = _pull(p, id, true);
        uint256 total0 = uint256(out0) + p.idle0;
        uint256 total1 = uint256(out1) + p.idle1;
        address owner_ = p.owner;
        Currency currency0 = p.key.currency0;
        Currency currency1 = p.key.currency1;
        uint256 idle0 = p.idle0;
        uint256 idle1 = p.idle1;
        p.idle0 = 0;
        p.idle1 = 0;

        if (out0 > 0) poolManager.take(currency0, owner_, uint256(out0));
        if (out1 > 0) poolManager.take(currency1, owner_, uint256(out1));
        if (idle0 > 0) IERC20(Currency.unwrap(currency0)).safeTransfer(owner_, idle0);
        if (idle1 > 0) IERC20(Currency.unwrap(currency1)).safeTransfer(owner_, idle1);
        emit Closed(id, total0, total1);
    }

    /// @dev With `remove` it withdraws everything; otherwise it only collects fees.
    function _pull(Position storage p, uint256 id, bool remove) private returns (int256 total0, int256 total1) {
        uint128[] storage bins = binLiquidity[id];
        for (uint256 i; i < p.numBins; ++i) {
            uint128 liquidity = bins[i];
            if (liquidity == 0) continue;
            int24 lower = BinDistribution.tickLower(p.lowerBin, i, p.key.tickSpacing);
            int256 change = remove ? -int256(uint256(liquidity)) : int256(0);
            BalanceDelta delta = _modify(p.key, id, lower, change);
            total0 += delta.amount0();
            total1 += delta.amount1();
            if (remove) bins[i] = 0;
        }
    }

    /// @dev Current liquidity is the weight, so a Curve stays a Curve and a one-sided
    /// position stays one-sided. An empty position falls back to its strategy.
    function _compoundWeights(Position storage p, uint256 id) private view returns (uint256[] memory weights) {
        uint128[] memory bins = binLiquidity[id];
        uint256 largest;
        for (uint256 i; i < bins.length; ++i) {
            if (bins[i] > largest) largest = bins[i];
        }
        if (largest == 0) return StrategyLib.weights(p.strategy, p.numBins);

        weights = new uint256[](bins.length);
        for (uint256 i; i < bins.length; ++i) {
            if (bins[i] == 0) continue;
            uint256 weight = uint256(bins[i]) * WEIGHT_PRECISION / largest;
            weights[i] = weight == 0 ? 1 : weight;
        }
    }

    function _deploy(Position storage p, uint256 id, uint256[] memory weights, uint256 available0, uint256 available1)
        private
        returns (int256 total0, int256 total1, bool added)
    {
        (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(p.key.toId());
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();

        int24 spacing = p.key.tickSpacing;
        uint128[] memory amounts =
            BinDistribution.distribute(sqrtPriceX96, tick, p.lowerBin, spacing, weights, available0, available1);

        uint128[] storage bins = binLiquidity[id];
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] == 0) continue;
            int24 lower = BinDistribution.tickLower(p.lowerBin, i, spacing);
            BalanceDelta delta = _modify(p.key, id, lower, int256(uint256(amounts[i])));
            total0 += delta.amount0();
            total1 += delta.amount1();
            bins[i] += amounts[i];
            added = true;
        }
    }

    function _modify(PoolKey storage key, uint256 id, int24 lower, int256 liquidityDelta)
        private
        returns (BalanceDelta delta)
    {
        (delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: lower,
                tickUpper: lower + key.tickSpacing,
                liquidityDelta: liquidityDelta,
                salt: bytes32(id)
            }),
            ""
        );
    }

    /// @dev Positive deltas are held here as idle; negative ones are paid from idle.
    function _settleIdle(Position storage p, int256 net0, int256 net1) private {
        Currency currency0 = p.key.currency0;
        Currency currency1 = p.key.currency1;
        if (net0 > 0) {
            p.idle0 += uint256(net0);
            poolManager.take(currency0, address(this), uint256(net0));
        } else if (net0 < 0) {
            p.idle0 -= uint256(-net0);
            _pay(currency0, address(this), uint256(-net0));
        }
        if (net1 > 0) {
            p.idle1 += uint256(net1);
            poolManager.take(currency1, address(this), uint256(net1));
        } else if (net1 < 0) {
            p.idle1 -= uint256(-net1);
            _pay(currency1, address(this), uint256(-net1));
        }
    }

    function _pay(Currency currency, address from, uint256 amount) private {
        if (amount == 0) return;
        IERC20 token = IERC20(Currency.unwrap(currency));
        poolManager.sync(currency);
        if (from == address(this)) token.safeTransfer(address(poolManager), amount);
        else token.safeTransferFrom(from, address(poolManager), amount);
        poolManager.settle();
    }

    /// @dev Moving the live price in this block widens the gap, so it fails here.
    function _checkStable(PoolKey memory key) private view {
        PoolId id = key.toId();
        (, int24 liveTick,,) = poolManager.getSlot0(id);
        int24 stable = IStableTick(address(key.hooks)).stableTick(id);
        int256 drift = int256(liveTick) - int256(stable);
        if (drift < 0) drift = -drift;
        if (drift > maxTickDrift) revert PriceNotStable(liveTick, stable);
    }

    function _checkTick(PoolKey memory key, int24 minTick, int24 maxTick) private view {
        (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(key.toId());
        if (sqrtPriceX96 == 0) revert PoolNotInitialized();
        if (tick < minTick || tick > maxTick) revert TickOutOfBounds(tick);
    }
}
