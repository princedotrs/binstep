// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Test.sol";
import {BinStepFixture} from "./BinStepFixture.sol";
import {BinStepAutomation} from "../src/BinStepAutomation.sol";
import {BinStepManager} from "../src/BinStepManager.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";
import {Strategy} from "../src/libraries/Strategy.sol";

contract BinStepAutomationTest is BinStepFixture {
    BinStepAutomation auto_;
    address forwarder = makeAddr("forwarder");
    address workflowOwner = makeAddr("workflowOwner");
    bytes metadata;

    function setUp() public {
        setUpPool();
        vm.warp(1_800_000_000);
        auto_ = new BinStepAutomation(lp, forwarder, address(this), 300);
        lp.setKeeper(address(auto_));
        metadata = abi.encodePacked(bytes32(uint256(1)), bytes10("rebalance"), workflowOwner);
    }

    function _action(BinStepAutomation.ActionKind kind, uint256 p)
        internal
        pure
        returns (BinStepAutomation.Action[] memory actions)
    {
        actions = new BinStepAutomation.Action[](1);
        actions[0] = BinStepAutomation.Action(kind, p);
    }

    function _send(uint64 observedAt, BinStepAutomation.Action[] memory actions) internal {
        vm.prank(forwarder);
        auto_.onReport(metadata, abi.encode(observedAt, actions));
    }

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function test_advertisesTheReceiverInterface() public view {
        assertTrue(auto_.supportsInterface(type(IReceiver).interfaceId));
    }

    function test_onlyTheForwarderCanDeliverReports() public {
        vm.expectRevert(abi.encodeWithSelector(BinStepAutomation.UnauthorizedForwarder.selector, address(this)));
        auto_.onReport(metadata, "");
    }

    function test_rejectsOtherWorkflowOwnersWhenConfigured() public {
        auto_.setExpectedWorkflowOwner(workflowOwner);
        _send(_now(), new BinStepAutomation.Action[](0));

        bytes memory rogue = abi.encodePacked(bytes32(uint256(1)), bytes10("rebalance"), bob);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(BinStepAutomation.UnauthorizedWorkflow.selector, bob));
        auto_.onReport(rogue, abi.encode(_now() + 1, new BinStepAutomation.Action[](0)));
    }

    function test_rejectsMalformedMetadataWhenConfigured() public {
        auto_.setExpectedWorkflowOwner(workflowOwner);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(BinStepAutomation.UnauthorizedWorkflow.selector, address(0)));
        auto_.onReport(hex"00", abi.encode(_now(), new BinStepAutomation.Action[](0)));
    }

    function test_rejectsReplayedStaleAndFutureReports() public {
        BinStepAutomation.Action[] memory none = new BinStepAutomation.Action[](0);
        uint64 start = 1_800_000_000;
        _send(start, none);

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(BinStepAutomation.ReportNotNewer.selector, start));
        auto_.onReport(metadata, abi.encode(start, none));

        vm.warp(start + 1000);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(BinStepAutomation.ReportTooOld.selector, start + 600));
        auto_.onReport(metadata, abi.encode(start + 600, none));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(BinStepAutomation.ReportFromFuture.selector, start + 1001));
        auto_.onReport(metadata, abi.encode(start + 1001, none));
    }

    function test_reportCompoundsAPosition() public {
        uint256 p = _mint(alice, -10, 20, Strategy.Spot, 100e18, 100e18);
        for (uint256 i; i < 10; ++i) {
            swap(key, true, -2e18, ZERO_BYTES);
            swap(key, false, -2e18, ZERO_BYTES);
        }
        uint128 before = lp.getBinLiquidity(p)[15];
        _send(_now(), _action(BinStepAutomation.ActionKind.Compound, p));
        assertGt(lp.getBinLiquidity(p)[15], before);
    }

    function test_reportRebalancesToTheContractsOwnRange() public {
        _background();
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 1e18, 1e18);
        swap(key, true, -300e18, ZERO_BYTES);
        uint64 later = 1_800_000_000 + uint64(hook.STABLE_WINDOW());
        vm.warp(later);
        int24 expected = lp.successorLowerBin(p);
        _send(later, _action(BinStepAutomation.ActionKind.Rebalance, p));
        assertEq(lp.getPosition(p).lowerBin, expected);
    }

    function test_manipulatedPoolIsSkippedEvenIfTheReportLooksFine() public {
        _background();
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 1e18, 1e18);
        swap(key, true, -300e18, ZERO_BYTES);
        vm.recordLogs();
        _send(_now(), _action(BinStepAutomation.ActionKind.Rebalance, p));
        assertEq(lp.getPosition(p).lowerBin, -3, "price moved this block, so nothing may happen");
        _assertSkipped(p);
    }

    function test_positionsThatOptedOutAreSkippedWithoutFailingTheRest() public {
        _background();
        uint256 optedOut = _mint(alice, -3, 6, Strategy.Spot, 1e18, 1e18);
        uint256 optedIn = _mint(alice, -3, 6, Strategy.Spot, 1e18, 1e18);
        vm.prank(alice);
        lp.setAutomation(optedOut, false, false);
        swap(key, true, -300e18, ZERO_BYTES);
        uint64 later = 1_800_000_000 + uint64(hook.STABLE_WINDOW());
        vm.warp(later);

        BinStepAutomation.Action[] memory actions = new BinStepAutomation.Action[](2);
        actions[0] = BinStepAutomation.Action(BinStepAutomation.ActionKind.Rebalance, optedOut);
        actions[1] = BinStepAutomation.Action(BinStepAutomation.ActionKind.Rebalance, optedIn);
        _send(later, actions);

        assertEq(lp.getPosition(optedOut).lowerBin, -3);
        assertTrue(lp.getPosition(optedIn).lowerBin != -3);
    }

    function test_tooLittleGasRevertsInsteadOfSilentlySkipping() public {
        uint256 p = _mint(alice, -10, 20, Strategy.Spot, 10e18, 10e18);
        BinStepAutomation.Action[] memory actions = _action(BinStepAutomation.ActionKind.Compound, p);
        bytes memory report = abi.encode(uint64(1_800_000_000), actions);

        vm.prank(forwarder);
        vm.expectRevert(BinStepAutomation.InsufficientGas.selector);
        auto_.onReport{gas: 1_000_000}(metadata, report);

        assertEq(auto_.lastObservedAt(), 0, "a failed delivery must stay retryable");
        vm.prank(forwarder);
        auto_.onReport{gas: 5_000_000}(metadata, report);
        assertEq(auto_.lastObservedAt(), 1_800_000_000);
    }

    function test_outsidersCannotCallExecuteDirectly() public {
        BinStepAutomation.Action memory a = BinStepAutomation.Action(BinStepAutomation.ActionKind.Compound, 1);
        vm.expectRevert(BinStepAutomation.OnlySelf.selector);
        auto_.execute(a);
    }

    function test_onlyOwnerCanChangeSettings() public {
        vm.startPrank(bob);
        vm.expectRevert();
        auto_.setForwarder(bob);
        vm.expectRevert();
        auto_.setExpectedWorkflowOwner(bob);
        vm.expectRevert();
        auto_.setMaxReportAge(1);
        vm.stopPrank();
    }

    function test_maxSizeRebalanceFitsTheMinimumActionGas() public {
        _background();
        uint256 p = _mint(alice, -16, 32, Strategy.Curve, 50e18, 50e18);
        swap(key, true, -1200e18, ZERO_BYTES);
        uint64 later = 1_800_000_000 + uint64(hook.STABLE_WINDOW());
        vm.warp(later);
        int24 before = lp.getPosition(p).lowerBin;
        assertTrue(_tick() < -160, "position must be out of range");

        bytes memory report = abi.encode(later, _action(BinStepAutomation.ActionKind.Rebalance, p));
        vm.prank(forwarder);
        uint256 start = gasleft();
        auto_.onReport(metadata, report);
        uint256 used = start - gasleft();
        emit log_named_uint("gas for 32-bin rebalance", used);
        assertTrue(lp.getPosition(p).lowerBin != before);
        assertLt(used, auto_.MIN_ACTION_GAS());
    }

    function _assertSkipped(uint256 p) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("ActionSkipped(uint256,bytes)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == topic && uint256(logs[i].topics[1]) == p) return;
        }
        fail();
    }
}
