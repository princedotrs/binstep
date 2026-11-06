// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BinStepFixture} from "./BinStepFixture.sol";
import {BinStepManager} from "../src/BinStepManager.sol";
import {Strategy} from "../src/libraries/Strategy.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract BinStepManagerTest is BinStepFixture {
    function setUp() public {
        setUpPool();
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
    }

    // ---- mint ----

    function test_mintStoresTheSameLiquidityAsThePool() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        uint128[] memory bins = lp.getBinLiquidity(p);
        assertEq(bins.length, 6);
        for (uint256 i; i < 6; ++i) {
            assertGt(bins[i], 0);
            assertEq(bins[i], _v4Liquidity(p, -3 + int24(int256(i))));
        }
    }

    function test_mintOnlyPullsWhatItUses() public {
        (uint256 before0, uint256 before1) = _balances(alice);
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        (uint256 after0, uint256 after1) = _balances(alice);
        assertLe(before0 - after0, 10e18);
        assertLe(before1 - after1, 10e18);
        assertGt(before0 - after0, 9.9e18);
        assertGt(before1 - after1, 9.9e18);
        _assertManagerHoldsOnlyIdle(_ids(p));
    }

    function test_mintShapesLiquidityByStrategy() public {
        uint256 curve = _mint(alice, -3, 6, Strategy.Curve, 10e18, 10e18);
        uint256 bidAsk = _mint(alice, -3, 6, Strategy.BidAsk, 10e18, 10e18);
        uint128[] memory c = lp.getBinLiquidity(curve);
        uint128[] memory b = lp.getBinLiquidity(bidAsk);
        assertGt(c[1], c[0]);
        assertGt(c[3], c[5]);
        assertLt(b[1], b[0]);
        assertLt(b[3], b[5]);
    }

    function test_oneSidedDepositOnlyTakesThatToken() public {
        (uint256 before0, uint256 before1) = _balances(alice);
        uint256 p = _mint(alice, -6, 6, Strategy.BidAsk, 0, 10e18);
        (uint256 after0, uint256 after1) = _balances(alice);
        assertEq(after0, before0);
        assertGt(before1 - after1, 9.9e18);
        assertGt(lp.getBinLiquidity(p)[0], 0);
    }

    function test_mintRejectsBadInput() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.InvalidBinCount.selector, 0));
        lp.mint(_params(-3, 0, Strategy.Spot, 1e18, 1e18));
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.InvalidBinCount.selector, 33));
        lp.mint(_params(-3, 33, Strategy.Spot, 1e18, 1e18));
        vm.expectRevert(BinStepManager.NoLiquidity.selector);
        lp.mint(_params(-3, 6, Strategy.Spot, 0, 0));

        BinStepManager.MintParams memory wrongHook = _params(-3, 6, Strategy.Spot, 1e18, 1e18);
        wrongHook.key.hooks = IHooks(address(0));
        vm.expectRevert(BinStepManager.UnsupportedPool.selector);
        lp.mint(wrongHook);

        BinStepManager.MintParams memory native = _params(-3, 6, Strategy.Spot, 1e18, 1e18);
        native.key.currency0 = Currency.wrap(address(0));
        vm.expectRevert(BinStepManager.UnsupportedPool.selector);
        lp.mint(native);

        BinStepManager.MintParams memory moved = _params(-3, 6, Strategy.Spot, 1e18, 1e18);
        moved.minTick = 100;
        moved.maxTick = 200;
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.TickOutOfBounds.selector, 0));
        lp.mint(moved);
        vm.stopPrank();
    }

    function test_mintRejectsBinsPastTheTickLimit() public {
        vm.prank(alice);
        vm.expectRevert();
        lp.mint(_params(88727, 6, Strategy.Spot, 1e18, 1e18));
    }

    // ---- compound ----

    function test_compoundTurnsFeesIntoLiquidity() public {
        uint256 p = _mint(alice, -10, 20, Strategy.Spot, 100e18, 100e18);
        uint128 before = lp.getBinLiquidity(p)[12];
        _roundTrip(20);
        vm.prank(alice);
        lp.compound(p, ANY_MIN, ANY_MAX);
        assertGt(lp.getBinLiquidity(p)[12], before);
        _assertManagerHoldsOnlyIdle(_ids(p));
    }

    function test_compoundWithNoFeesChangesNothing() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        uint128 before = lp.getBinLiquidity(p)[0];
        vm.prank(alice);
        lp.compound(p, ANY_MIN, ANY_MAX);
        assertEq(lp.getBinLiquidity(p)[0], before);
    }

    function test_compoundAccessControl() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.NotAuthorized.selector, bob));
        lp.compound(p, ANY_MIN, ANY_MAX);

        vm.prank(keeper);
        lp.compound(p, ANY_MIN, ANY_MAX);

        vm.prank(alice);
        lp.setAutomation(p, false, true);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.NotAuthorized.selector, keeper));
        lp.compound(p, ANY_MIN, ANY_MAX);
    }

    function test_compoundRespectsTheTickGuard() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.TickOutOfBounds.selector, 0));
        lp.compound(p, 10, 20);
    }

    // ---- rebalance ----

    function test_rebalanceMovesLiquidityToTheNewBins() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        swap(key, true, -40e18, ZERO_BYTES);
        int24 tick = _tick();
        assertLt(tick, -30, "price should have left the range");

        int24 newLower = (tick - 1) / SPACING + 1;
        vm.prank(keeper);
        lp.rebalance(p, newLower, ANY_MIN, ANY_MAX);

        assertEq(_v4Liquidity(p, -3), 0);
        BinStepManager.Position memory pos = lp.getPosition(p);
        assertEq(pos.lowerBin, newLower);
        uint256 live;
        uint128[] memory bins = lp.getBinLiquidity(p);
        for (uint256 i; i < bins.length; ++i) {
            assertEq(bins[i], _v4Liquidity(p, newLower + int24(int256(i))));
            live += bins[i];
        }
        assertGt(live, 0);
        _assertManagerHoldsOnlyIdle(_ids(p));
    }

    function test_rebalanceKeepsTokensTheNewRangeCannotUseAsIdle() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        // Above the price only token0 is usable, so token1 must wait as idle.
        vm.prank(alice);
        lp.rebalance(p, 100, ANY_MIN, ANY_MAX);
        BinStepManager.Position memory pos = lp.getPosition(p);
        assertGt(pos.idle1, 9.9e18);
        assertLt(pos.idle0, 1e6);
        _assertManagerHoldsOnlyIdle(_ids(p));
    }

    function test_rebalanceAccessControl() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.NotAuthorized.selector, bob));
        lp.rebalance(p, 0, ANY_MIN, ANY_MAX);

        vm.prank(alice);
        lp.setAutomation(p, true, false);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.NotAuthorized.selector, keeper));
        lp.rebalance(p, 0, ANY_MIN, ANY_MAX);
    }

    // ---- close ----

    function test_closeReturnsPrincipalAndFees() public {
        (uint256 start0, uint256 start1) = _balances(alice);
        uint256 p = _mint(alice, -10, 20, Strategy.Spot, 100e18, 100e18);
        _roundTrip(20);
        vm.prank(alice);
        lp.close(p);
        (uint256 end0, uint256 end1) = _balances(alice);
        assertGt(end0 + end1, start0 + start1, "fees should make the LP whole and then some");
        (uint256 held0, uint256 held1) = _balances(address(lp));
        assertEq(held0, 0);
        assertEq(held1, 0);
    }

    function test_closeReturnsIdleBalances() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.startPrank(alice);
        lp.rebalance(p, 100, ANY_MIN, ANY_MAX);
        (uint256 before0, uint256 before1) = _balances(alice);
        lp.close(p);
        vm.stopPrank();
        (uint256 after0, uint256 after1) = _balances(alice);
        assertGt(after0 - before0, 9.9e18);
        assertGt(after1 - before1, 9.9e18);
    }

    function test_onlyTheOwnerCanClose() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.NotAuthorized.selector, bob));
        lp.close(p);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.NotAuthorized.selector, keeper));
        lp.close(p);
    }

    function test_positionCannotBeUsedAfterClose() public {
        uint256 p = _mint(alice, -3, 6, Strategy.Spot, 10e18, 10e18);
        vm.startPrank(alice);
        lp.close(p);
        vm.expectRevert(abi.encodeWithSelector(BinStepManager.NotAuthorized.selector, alice));
        lp.close(p);
        vm.stopPrank();
    }

    // ---- isolation ----

    function test_positionsSplitFeesAndDoNotShareBalances() public {
        uint256 a = _mint(alice, -10, 20, Strategy.Spot, 100e18, 100e18);
        uint256 b = _mint(bob, -10, 20, Strategy.Spot, 100e18, 100e18);
        _roundTrip(20);

        (uint256 aliceBefore0, uint256 aliceBefore1) = _balances(alice);
        (uint256 bobBefore0, uint256 bobBefore1) = _balances(bob);
        vm.prank(alice);
        lp.close(a);
        _assertManagerHoldsOnlyIdle(_ids(b));
        vm.prank(bob);
        lp.close(b);

        (uint256 aliceAfter0, uint256 aliceAfter1) = _balances(alice);
        (uint256 bobAfter0, uint256 bobAfter1) = _balances(bob);
        uint256 aliceGot = aliceAfter0 - aliceBefore0 + aliceAfter1 - aliceBefore1;
        uint256 bobGot = bobAfter0 - bobBefore0 + bobAfter1 - bobBefore1;
        assertApproxEqRel(aliceGot, bobGot, 1e15);
    }

    function testFuzz_lifecycleNeverLosesTrackOfTokens(
        uint64 amount0,
        uint64 amount1,
        uint8 numBinsSeed,
        uint8 shape,
        int8 newLowerSeed,
        bool zeroForOne
    ) public {
        uint256 a0 = bound(amount0, 1e12, 18e18);
        uint256 a1 = bound(amount1, 1e12, 18e18);
        uint8 n = uint8(bound(numBinsSeed, 1, 12));
        uint256 p = _mint(alice, -int24(uint24(n)) / 2, n, Strategy(shape % 3), a0, a1);
        _assertManagerHoldsOnlyIdle(_ids(p));

        if (a0 > 1e16 && a1 > 1e16) swap(key, zeroForOne, -1e15, ZERO_BYTES);

        vm.startPrank(alice);
        lp.compound(p, ANY_MIN, ANY_MAX);
        _assertManagerHoldsOnlyIdle(_ids(p));
        lp.rebalance(p, newLowerSeed, ANY_MIN, ANY_MAX);
        _assertManagerHoldsOnlyIdle(_ids(p));
        lp.close(p);
        vm.stopPrank();

        (uint256 held0, uint256 held1) = _balances(address(lp));
        assertEq(held0, 0);
        assertEq(held1, 0);
    }

    function _roundTrip(uint256 times) internal {
        for (uint256 i; i < times; ++i) {
            swap(key, true, -2e18, ZERO_BYTES);
            swap(key, false, -2e18, ZERO_BYTES);
        }
    }
}
