// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BinStepManager} from "./BinStepManager.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @notice Receives CRE reports and applies them to opted-in positions.
/// @dev Reports are not trusted for policy. A forwarder delivers reports from
/// any workflow, and the mock forwarder does not check signatures, so every
/// limit that protects funds is enforced here.
contract BinStepAutomation is IReceiver, Ownable {
    enum ActionKind {
        Compound,
        Rebalance
    }

    struct Action {
        ActionKind kind;
        uint256 positionId;
        int24 newLowerBin;
        int24 referenceTick;
    }

    /// @dev Metadata layout: bytes32 workflowId, bytes10 workflowName, address workflowOwner.
    uint256 private constant METADATA_OWNER_OFFSET = 42;
    uint256 private constant METADATA_MIN_LENGTH = 62;

    /// @notice Covers a 32-bin rebalance, which measures about 2.2M gas.
    uint256 public constant MIN_ACTION_GAS = 3_000_000;

    BinStepManager public immutable manager;
    address public forwarder;
    address public expectedWorkflowOwner;
    int24 public maxTickDeviation;
    uint64 public maxReportAge;
    uint64 public lastObservedAt;

    event ForwarderSet(address forwarder);
    event ExpectedWorkflowOwnerSet(address workflowOwner);
    event LimitsSet(int24 maxTickDeviation, uint64 maxReportAge);
    event ActionExecuted(uint256 indexed positionId, ActionKind kind);
    event ActionSkipped(uint256 indexed positionId, bytes reason);

    error UnauthorizedForwarder(address caller);
    error UnauthorizedWorkflow(address workflowOwner);
    error ReportNotNewer(uint64 observedAt);
    error ReportTooOld(uint64 observedAt);
    error ReportFromFuture(uint64 observedAt);
    error OnlySelf();
    error InsufficientGas();
    error RangeTooFarFromPrice(int24 newLowerBin, int24 referenceTick);

    constructor(BinStepManager manager_, address forwarder_, address owner_, int24 maxTickDeviation_, uint64 maxReportAge_)
        Ownable(owner_)
    {
        manager = manager_;
        forwarder = forwarder_;
        maxTickDeviation = maxTickDeviation_;
        maxReportAge = maxReportAge_;
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @notice The zero address disables the check, which local simulation needs.
    function setExpectedWorkflowOwner(address workflowOwner) external onlyOwner {
        expectedWorkflowOwner = workflowOwner;
        emit ExpectedWorkflowOwnerSet(workflowOwner);
    }

    function setLimits(int24 maxTickDeviation_, uint64 maxReportAge_) external onlyOwner {
        maxTickDeviation = maxTickDeviation_;
        maxReportAge = maxReportAge_;
        emit LimitsSet(maxTickDeviation_, maxReportAge_);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        _checkWorkflow(metadata);

        (uint64 observedAt, Action[] memory actions) = abi.decode(report, (uint64, Action[]));
        if (observedAt <= lastObservedAt) revert ReportNotNewer(observedAt);
        if (observedAt > block.timestamp) revert ReportFromFuture(observedAt);
        if (block.timestamp - observedAt > maxReportAge) revert ReportTooOld(observedAt);
        lastObservedAt = observedAt;

        // One bad action must not block the rest of the batch.
        for (uint256 i; i < actions.length; ++i) {
            // Otherwise an out-of-gas action would be caught and look like a skip,
            // consuming the report. Reverting keeps it retryable.
            if (gasleft() < MIN_ACTION_GAS) revert InsufficientGas();
            try this.execute(actions[i]) {
                emit ActionExecuted(actions[i].positionId, actions[i].kind);
            } catch (bytes memory reason) {
                emit ActionSkipped(actions[i].positionId, reason);
            }
        }
    }

    /// @dev External only so that `onReport` can catch a failed action.
    function execute(Action calldata action) external {
        if (msg.sender != address(this)) revert OnlySelf();

        (int24 minTick, int24 maxTick) = _tickBounds(action.referenceTick);
        if (action.kind == ActionKind.Compound) {
            manager.compound(action.positionId, minTick, maxTick);
        } else {
            _checkRange(action);
            manager.rebalance(action.positionId, action.newLowerBin, minTick, maxTick);
        }
    }

    function _checkWorkflow(bytes calldata metadata) private view {
        address expected = expectedWorkflowOwner;
        if (expected == address(0)) return;
        if (metadata.length < METADATA_MIN_LENGTH) revert UnauthorizedWorkflow(address(0));
        address actual = address(bytes20(metadata[METADATA_OWNER_OFFSET:METADATA_MIN_LENGTH]));
        if (actual != expected) revert UnauthorizedWorkflow(actual);
    }

    function _tickBounds(int24 referenceTick) private view returns (int24 minTick, int24 maxTick) {
        int256 low = int256(referenceTick) - maxTickDeviation;
        int256 high = int256(referenceTick) + maxTickDeviation;
        minTick = low < TickMath.MIN_TICK ? TickMath.MIN_TICK : int24(low);
        maxTick = high > TickMath.MAX_TICK ? TickMath.MAX_TICK : int24(high);
    }

    /// @dev The new range must sit within one range-width of the reported price.
    function _checkRange(Action calldata action) private view {
        BinStepManager.Position memory p = manager.getPosition(action.positionId);
        int256 spacing = p.key.tickSpacing;
        if (spacing == 0) return; // Unknown position; the manager rejects it.

        int256 tick = action.referenceTick;
        int256 referenceBin = tick / spacing;
        if (tick < 0 && tick % spacing != 0) referenceBin -= 1;

        int256 numBins = int256(uint256(p.numBins));
        int256 distance = int256(action.newLowerBin) + numBins / 2 - referenceBin;
        if (distance < 0) distance = -distance;
        if (distance > numBins) revert RangeTooFarFromPrice(action.newLowerBin, action.referenceTick);
    }
}
