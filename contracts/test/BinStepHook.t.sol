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

    function test_feeRisesWithBinsCrossed() public {
        swap(key, true, -1e18, ZERO_BYTES);
        (, uint256 moved) = _moved();
        assertGt(moved, 0);
        assertEq(hook.currentFee(id), hook.BASE_FEE() + hook.FEE_PER_BIN() * moved);
    }

    function test_smallSwapAcrossABinBoundaryCountsAsOneBin() public {
        swap(key, true, -3e16, ZERO_BYTES);
        (, int24 tick,,) = manager.getSlot0(id);
        assertLt(tick, 0);
        assertGt(tick, -10, "swap should stay inside the next bin");
        assertEq(hook.currentFee(id), hook.BASE_FEE() + hook.FEE_PER_BIN());
    }

    function test_movementInsideOneBinDoesNotRaiseTheFee() public {
        swap(key, false, -3e16, ZERO_BYTES);
        (, int24 tick,,) = manager.getSlot0(id);
        assertGt(tick, 0);
        assertLt(tick, 10);
        assertEq(hook.currentFee(id), hook.BASE_FEE());
    }

    function test_feeDecaysOverTime() public {
        swap(key, true, -1e18, ZERO_BYTES);
        (uint24 before,) = _moved();
        vm.warp(block.timestamp + hook.DECAY_PERIOD());
        uint24 afterOne = hook.currentFee(id);
        assertLt(afterOne, before);
        assertGt(afterOne, hook.BASE_FEE());
        vm.warp(block.timestamp + 40 * hook.DECAY_PERIOD());
        assertEq(hook.currentFee(id), hook.BASE_FEE());
    }

    function test_feeIsCapped() public {
        for (uint256 i; i < 12; ++i) {
            swap(key, i % 2 == 0, -3e19, ZERO_BYTES);
        }
        assertEq(hook.currentFee(id), hook.MAX_FEE());
    }

    function test_swapsPayTheDynamicFee() public {
        assertEq(_feeChargedOnSwap(), hook.BASE_FEE());
        uint24 expected = hook.currentFee(id);
        assertGt(expected, hook.BASE_FEE());
        assertEq(_feeChargedOnSwap(), expected);
    }

    function _moved() internal view returns (uint24 fee, uint256 moved) {
        fee = hook.currentFee(id);
        moved = (fee - hook.BASE_FEE()) / hook.FEE_PER_BIN();
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
