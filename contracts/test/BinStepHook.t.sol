// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {BinStepHook} from "../src/BinStepHook.sol";

contract BinStepHookTest is Test, Deployers {
    using StateLibrary for IPoolManager;

    BinStepHook hook;
    PoolId id;

    ModifyLiquidityParams wide =
        ModifyLiquidityParams({tickLower: -1200, tickUpper: 1200, liquidityDelta: 1e20, salt: 0});

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        address hookAddress = address(
            uint160(
                (uint160(0x4444) << 144) | Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG
                    | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            )
        );
        // The liquidity router stands in for the manager in these tests.
        deployCodeTo("BinStepHook.sol", abi.encode(manager, address(modifyLiquidityRouter)), hookAddress);
        hook = BinStepHook(hookAddress);

        (key, id) = initPool(currency0, currency1, IHooks(hookAddress), LPFeeLibrary.DYNAMIC_FEE_FLAG, 10, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(key, wide, ZERO_BYTES);
    }

    function test_rejectsStaticFeePools() public {
        vm.expectRevert();
        manager.initialize(
            PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook))), SQRT_PRICE_1_1
        );
    }

    function test_blocksLiquidityFromAnyoneButTheManager() public {
        PoolModifyLiquidityTest other = new PoolModifyLiquidityTest(manager);
        vm.expectRevert();
        other.modifyLiquidity(key, wide, ZERO_BYTES);
    }

    function test_removalsAreNeverBlocked() public {
        ModifyLiquidityParams memory down = wide;
        down.liquidityDelta = -1e20;
        modifyLiquidityRouter.modifyLiquidity(key, down, ZERO_BYTES);
    }

    function test_startsAtBaseFee() public view {
        assertEq(hook.currentFee(id), hook.BASE_FEE());
    }

    /// variableFee = ceil(C * (va * binStep)^2 / 1e11), in Meteora's 1e9 fee units.
    function _feeForBins(uint256 bins) internal view returns (uint256) {
        uint256 va = bins * 10_000;
        uint256 scaled = hook.VARIABLE_FEE_CONTROL() * (va * 10) ** 2;
        uint256 variable1e9 = (scaled + 1e11 - 1) / 1e11;
        uint256 fee = hook.BASE_FEE() + (variable1e9 + 999) / 1000;
        return fee > hook.MAX_FEE() ? hook.MAX_FEE() : fee;
    }

    function _activeBin() internal view returns (int256 bin) {
        (, int24 tick,,) = manager.getSlot0(id);
        bin = int256(tick) / 10;
        if (tick < 0 && tick % 10 != 0) bin -= 1;
    }

    function test_feeFollowsTheVolatilityFormula() public {
        swap(key, true, -1e18, ZERO_BYTES);
        uint256 bins = uint256(-_activeBin());
        assertGt(bins, 1);
        assertEq(hook.currentFee(id), _feeForBins(bins));
    }

    function test_variableFeeGrowsWithTheSquareOfBinsCrossed() public {
        swap(key, true, -5e17, ZERO_BYTES);
        uint256 bins = uint256(-_activeBin());
        assertGt(bins, 4);
        uint256 full = hook.currentFee(id) - hook.BASE_FEE();
        uint256 half = _feeForBins(bins / 2) - hook.BASE_FEE();
        assertGt(full, 3 * half);
    }

    function test_smallSwapAcrossABinBoundaryCountsAsOneBin() public {
        swap(key, true, -3e16, ZERO_BYTES);
        (, int24 tick,,) = manager.getSlot0(id);
        assertLt(tick, 0);
        assertGt(tick, -10, "swap should stay inside the next bin");
        assertEq(hook.currentFee(id), _feeForBins(1));
    }

    function test_movementInsideOneBinDoesNotRaiseTheFee() public {
        swap(key, false, -3e16, ZERO_BYTES);
        (, int24 tick,,) = manager.getSlot0(id);
        assertGt(tick, 0);
        assertLt(tick, 10);
        assertEq(hook.currentFee(id), hook.BASE_FEE());
    }

    function test_rapidSwapsKeepTheSameIndexReference() public {
        // Inside the filter period, volatility is measured from the same starting bin.
        swap(key, true, -1e18, ZERO_BYTES);
        swap(key, true, -1e18, ZERO_BYTES);
        assertEq(hook.currentFee(id), _feeForBins(uint256(-_activeBin())));
    }

    function test_feeIsUnchangedInsideTheFilterPeriod() public {
        swap(key, true, -1e18, ZERO_BYTES);
        uint24 fee = hook.currentFee(id);
        vm.warp(1 + hook.FILTER_PERIOD() - 1);
        assertEq(hook.currentFee(id), fee);
    }

    function test_feeReducesAfterTheFilterPeriod() public {
        swap(key, true, -3e18, ZERO_BYTES);
        uint24 fee = hook.currentFee(id);
        vm.warp(1 + hook.FILTER_PERIOD());
        uint24 reduced = hook.currentFee(id);
        assertLt(reduced, fee);
        assertGt(reduced, hook.BASE_FEE());
    }

    function test_feeResetsAfterTheDecayPeriod() public {
        swap(key, true, -1e18, ZERO_BYTES);
        vm.warp(1 + hook.DECAY_PERIOD());
        assertEq(hook.currentFee(id), hook.BASE_FEE());
    }

    function test_feeIsCapped() public {
        swap(key, true, -6e19, ZERO_BYTES);
        assertEq(hook.currentFee(id), hook.MAX_FEE());
    }

    function test_swapsPayTheDynamicFee() public {
        assertEq(_feeChargedOnSwap(), hook.BASE_FEE());
        uint24 expected = hook.currentFee(id);
        assertGt(expected, hook.BASE_FEE());
        assertEq(_feeChargedOnSwap(), expected);
    }

    // ---- time-weighted price ----

    function test_stableTickIgnoresSameBlockManipulation() public {
        swap(key, true, -5e18, ZERO_BYTES);
        (, int24 live,,) = manager.getSlot0(id);
        assertLt(live, -100);
        assertEq(hook.stableTick(id), 0);
    }

    function test_stableTickMovesInProportionToTime() public {
        swap(key, true, -5e18, ZERO_BYTES);
        (, int24 live,,) = manager.getSlot0(id);
        vm.warp(1 + hook.STABLE_WINDOW() / 2);
        assertEq(hook.stableTick(id), live / 2);
    }

    function test_stableTickCatchesUpAfterTheWindow() public {
        swap(key, true, -5e18, ZERO_BYTES);
        (, int24 live,,) = manager.getSlot0(id);
        vm.warp(1 + hook.STABLE_WINDOW());
        assertEq(hook.stableTick(id), live);
    }

    function test_shortSpikeBarelyMovesTheStableTick() public {
        swap(key, true, -5e18, ZERO_BYTES);
        vm.warp(1 + 1);
        swap(key, false, -5e18, ZERO_BYTES);
        assertLt(_abs(hook.stableTick(id)), 10);
    }

    function _abs(int24 x) internal pure returns (int256) {
        return x < 0 ? -int256(x) : int256(x);
    }

    function _feeChargedOnSwap() internal returns (uint24 fee) {
        bytes32 swapEvent = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
        vm.recordLogs();
        swap(key, true, -1e18, ZERO_BYTES);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != swapEvent) continue;
            (,,,,, fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
        }
    }
}
