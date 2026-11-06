// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BinStepHook} from "../src/BinStepHook.sol";
import {BinStepManager} from "../src/BinStepManager.sol";
import {Strategy} from "../src/libraries/Strategy.sol";

abstract contract BinStepFixture is Test, Deployers {
    using StateLibrary for IPoolManager;

    int24 constant SPACING = 10;
    int24 constant ANY_MIN = -887272;
    int24 constant ANY_MAX = 887272;

    BinStepManager lp;
    BinStepHook hook;
    PoolId id;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");

    function setUpPool() internal {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        lp = new BinStepManager(manager, address(this));
        address hookAddress = address(
            uint160(
                (uint160(0x4444) << 144) | Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG
                    | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            )
        );
        deployCodeTo("BinStepHook.sol", abi.encode(manager, address(lp)), hookAddress);
        hook = BinStepHook(hookAddress);
        lp.setHook(address(hook));
        lp.setKeeper(keeper);

        (key, id) =
            initPool(currency0, currency1, IHooks(hookAddress), LPFeeLibrary.DYNAMIC_FEE_FLAG, SPACING, SQRT_PRICE_1_1);

        _fund(alice);
        _fund(bob);
    }

    function _fund(address who) internal {
        IERC20 t0 = IERC20(Currency.unwrap(currency0));
        IERC20 t1 = IERC20(Currency.unwrap(currency1));
        t0.transfer(who, 1000e18);
        t1.transfer(who, 1000e18);
        vm.startPrank(who);
        t0.approve(address(lp), type(uint256).max);
        t1.approve(address(lp), type(uint256).max);
        vm.stopPrank();
    }

    function _params(int24 lowerBin, uint8 numBins, Strategy s, uint256 a0, uint256 a1)
        internal
        view
        returns (BinStepManager.MintParams memory)
    {
        return BinStepManager.MintParams({
            key: key,
            lowerBin: lowerBin,
            numBins: numBins,
            strategy: s,
            amount0Max: a0,
            amount1Max: a1,
            minTick: ANY_MIN,
            maxTick: ANY_MAX,
            autoCompound: true,
            autoRebalance: true
        });
    }

    function _mint(address who, int24 lowerBin, uint8 numBins, Strategy s, uint256 a0, uint256 a1)
        internal
        returns (uint256 positionId)
    {
        vm.prank(who);
        positionId = lp.mint(_params(lowerBin, numBins, s, a0, a1));
    }

    function _v4Liquidity(uint256 positionId, int24 bin) internal view returns (uint128) {
        int24 lower = bin * SPACING;
        return manager.getPositionLiquidity(
            id, keccak256(abi.encodePacked(address(lp), lower, lower + SPACING, bytes32(positionId)))
        );
    }

    function _balances(address who) internal view returns (uint256, uint256) {
        return (currency0.balanceOf(who), currency1.balanceOf(who));
    }

    function _tick() internal view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(id);
    }

    function _assertManagerHoldsOnlyIdle(uint256[] memory positionIds) internal view {
        uint256 idle0;
        uint256 idle1;
        for (uint256 i; i < positionIds.length; ++i) {
            BinStepManager.Position memory p = lp.getPosition(positionIds[i]);
            idle0 += p.idle0;
            idle1 += p.idle1;
        }
        (uint256 held0, uint256 held1) = _balances(address(lp));
        assertEq(held0, idle0, "token0 not fully accounted");
        assertEq(held1, idle1, "token1 not fully accounted");
    }
}
