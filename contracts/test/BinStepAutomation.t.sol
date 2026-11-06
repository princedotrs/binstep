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
        auto_ = new BinStepAutomation(lp, forwarder, address(this), 50, 300);
        lp.setKeeper(address(auto_));
        metadata = abi.encodePacked(bytes32(uint256(1)), bytes10("rebalance"), workflowOwner);
    }

    function _action(BinStepAutomation.ActionKind kind, uint256 p, int24 newLower, int24 refTick)
        internal
        pure
        returns (BinStepAutomation.Action[] memory actions)
    {
        actions = new BinStepAutomation.Action[](1);
        actions[0] = BinStepAutomation.Action(kind, p, newLower, refTick);
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
        _send(_now(), _action(BinStepAutomation.ActionKind.Compound, p, 0, _tick()));
        assertGt(lp.getBinLiquidity(p)[15], before);
    }

    function test_reportRebalancesAPosition() public {
        _mint(bob, -16, 32, Strategy.Spot, 500e18, 500e18);
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        swap(key, true, -120e18, ZERO_BYTES);
        int24 tick = _tick();
        assertLt(tick, -30, "price should have left the range");
        assertGt(tick, -160, "background liquidity should absorb the swap");

        int24 newLower = tick / SPACING - 6;
        _send(_now(), _action(BinStepAutomation.ActionKind.Rebalance, p, newLower, tick));
        assertEq(lp.getPosition(p).lowerBin, newLower);
    }

    function test_livePoolMustMatchTheReportedPrice() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.recordLogs();
        _send(_now(), _action(BinStepAutomation.ActionKind.Rebalance, p, 90, 1000));
        assertEq(lp.getPosition(p).lowerBin, -3, "manipulated pool must not rebalance");
        _assertSkipped(p);
    }

    function test_newRangeMustStayNearTheReportedPrice() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.recordLogs();
        _send(_now(), _action(BinStepAutomation.ActionKind.Rebalance, p, 5000, 0));
        assertEq(lp.getPosition(p).lowerBin, -3);
        _assertSkipped(p);
    }

    function test_positionsThatOptedOutAreSkippedWithoutFailingTheRest() public {
        uint256 optedOut = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        uint256 optedIn = _mint(bob, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.prank(alice);
        lp.setAutomation(optedOut, false, false);

        BinStepAutomation.Action[] memory actions = new BinStepAutomation.Action[](2);
        actions[0] = BinStepAutomation.Action(BinStepAutomation.ActionKind.Rebalance, optedOut, -2, 0);
        actions[1] = BinStepAutomation.Action(BinStepAutomation.ActionKind.Rebalance, optedIn, -2, 0);
        _send(_now(), actions);

        assertEq(lp.getPosition(optedOut).lowerBin, -3);
        assertEq(lp.getPosition(optedIn).lowerBin, -2);
    }

    function test_outsidersCannotCallExecuteDirectly() public {
        BinStepAutomation.Action memory a = BinStepAutomation.Action(BinStepAutomation.ActionKind.Compound, 1, 0, 0);
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
        auto_.setLimits(1, 1);
        vm.stopPrank();
    }

    function test_gasForMaxSizeRebalanceFitsTheDefaultReportBudget() public {
        uint256 p = _mint(alice, -16, 32, Strategy.Curve, 50e18, 50e18);
        BinStepAutomation.Action[] memory actions =
            _action(BinStepAutomation.ActionKind.Rebalance, p, -15, _tick());
        vm.prank(forwarder);
        uint256 start = gasleft();
        auto_.onReport(metadata, abi.encode(_now(), actions));
        uint256 used = start - gasleft();
        emit log_named_uint("gas for 32-bin rebalance", used);
        assertEq(lp.getPosition(p).lowerBin, -15);
        assertLt(used, 5_000_000);
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
