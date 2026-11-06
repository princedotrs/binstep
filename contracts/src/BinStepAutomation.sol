// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BinStepManager} from "./BinStepManager.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @notice Receives CRE reports and applies them to opted-in positions.
/// @dev A report only says which positions to act on and when. A forwarder
/// delivers reports from any workflow, and the mock forwarder does not check
/// signatures, so the price, the new range and the cooldown all come from
/// onchain state in the manager and hook, never from the report.
contract BinStepAutomation is IReceiver, Ownable {
    enum ActionKind {
        Compound,
        Rebalance
    }

    struct Action {
        ActionKind kind;
        uint256 positionId;
    }

    /// @dev Metadata layout: bytes32 workflowId, bytes10 workflowName, address workflowOwner.
    uint256 private constant METADATA_OWNER_OFFSET = 42;
    uint256 private constant METADATA_MIN_LENGTH = 62;

    /// @notice Covers a 32-bin rebalance onto fresh ticks, which measures about 4.04M gas.
    uint256 public constant MIN_ACTION_GAS = 4_500_000;

    BinStepManager public immutable manager;
    address public forwarder;
    address public expectedWorkflowOwner;
    uint64 public maxReportAge;
    uint64 public lastObservedAt;

    event ForwarderSet(address forwarder);
    event ExpectedWorkflowOwnerSet(address workflowOwner);
    event MaxReportAgeSet(uint64 maxReportAge);
    event ActionExecuted(uint256 indexed positionId, ActionKind kind);
    event ActionSkipped(uint256 indexed positionId, bytes reason);

    error UnauthorizedForwarder(address caller);
    error UnauthorizedWorkflow(address workflowOwner);
    error ReportNotNewer(uint64 observedAt);
    error ReportTooOld(uint64 observedAt);
    error ReportFromFuture(uint64 observedAt);
    error OnlySelf();
    error InsufficientGas();

    constructor(BinStepManager manager_, address forwarder_, address owner_, uint64 maxReportAge_) Ownable(owner_) {
        manager = manager_;
        forwarder = forwarder_;
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

    function setMaxReportAge(uint64 maxReportAge_) external onlyOwner {
        maxReportAge = maxReportAge_;
        emit MaxReportAgeSet(maxReportAge_);
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

        if (action.kind == ActionKind.Compound) manager.keeperCompound(action.positionId);
        else manager.keeperRebalance(action.positionId);
    }

    function _checkWorkflow(bytes calldata metadata) private view {
        address expected = expectedWorkflowOwner;
        if (expected == address(0)) return;
        if (metadata.length < METADATA_MIN_LENGTH) revert UnauthorizedWorkflow(address(0));
        address actual = address(bytes20(metadata[METADATA_OWNER_OFFSET:METADATA_MIN_LENGTH]));
        if (actual != expected) revert UnauthorizedWorkflow(actual);
    }
}
