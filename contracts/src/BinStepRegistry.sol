// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice Lets anyone create a test token and its pool against the quote token, and keeps
/// a list the app can read. The app cannot find pools from logs: the Initialize event does
/// not index the hook, and public RPCs only serve small log ranges.
/// @dev Testnet only. The tokens can be minted by anyone, so listings carry no value. The
/// registry holds no rights over the hook or manager, and listings are unverified.
contract BinStepRegistry {
    using PoolIdLibrary for PoolKey;

    struct Listing {
        address token;
        address creator;
        bytes32 poolId;
        bool baseIsToken0;
        uint256 priceE6;
        string name;
        string symbol;
    }

    uint8 public constant TOKEN_DECIMALS = 18;
    int24 public constant TICK_SPACING = 10;
    /// @notice Tokens the creator starts with, so they can add liquidity straight away.
    uint256 public constant CREATOR_USD = 100_000;
    uint256 public constant MIN_PRICE_E6 = 1e3;
    uint256 public constant MAX_PRICE_E6 = 1e13;
    uint256 private constant MAX_NAME_BYTES = 32;
    uint256 private constant MAX_SYMBOL_BYTES = 11;

    IPoolManager public immutable poolManager;
    address public immutable hook;
    address public immutable quote;

    Listing[] private listings;

    event Created(address indexed token, address indexed creator, bytes32 indexed poolId, string symbol, uint256 priceE6);

    error InvalidName();
    error InvalidSymbol();
    error InvalidPrice(uint256 priceE6);

    constructor(IPoolManager poolManager_, address hook_, address quote_) {
        poolManager = poolManager_;
        hook = hook_;
        quote = quote_;
    }

    function count() external view returns (uint256) {
        return listings.length;
    }

    /// @notice A page of listings, oldest first. Stops at the end of the list.
    function page(uint256 offset, uint256 limit) external view returns (Listing[] memory out) {
        uint256 total = listings.length;
        uint256 size = offset >= total ? 0 : Math.min(limit, total - offset);
        out = new Listing[](size);
        for (uint256 i; i < size; ++i) {
            out[i] = listings[offset + i];
        }
    }

    function create(string calldata name, string calldata symbol, uint256 priceE6) external returns (address) {
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME_BYTES) revert InvalidName();
        if (bytes(symbol).length == 0 || bytes(symbol).length > MAX_SYMBOL_BYTES) revert InvalidSymbol();
        if (priceE6 < MIN_PRICE_E6 || priceE6 > MAX_PRICE_E6) revert InvalidPrice(priceE6);

        MockERC20 token = new MockERC20(name, symbol, TOKEN_DECIMALS);
        bool baseIsToken0 = address(token) < quote;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(baseIsToken0 ? address(token) : quote),
            currency1: Currency.wrap(baseIsToken0 ? quote : address(token)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        poolManager.initialize(key, _sqrtPriceX96(baseIsToken0, priceE6));
        token.mint(msg.sender, FullMath.mulDiv(CREATOR_USD * 1e6, 10 ** TOKEN_DECIMALS, priceE6));

        bytes32 poolId = PoolId.unwrap(key.toId());
        listings.push(Listing(address(token), msg.sender, poolId, baseIsToken0, priceE6, name, symbol));
        emit Created(address(token), msg.sender, poolId, symbol, priceE6);
        return address(token);
    }

    /// @dev Raw price is token1 base units per token0 base units, so decimals count.
    function _sqrtPriceX96(bool baseIsToken0, uint256 priceE6) private pure returns (uint160) {
        uint256 unit = 10 ** TOKEN_DECIMALS;
        uint256 ratioX192 = baseIsToken0 ? FullMath.mulDiv(priceE6, 1 << 192, unit) : FullMath.mulDiv(unit, 1 << 192, priceE6);
        return uint160(Math.sqrt(ratioX192));
    }
}
